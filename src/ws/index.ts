import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import type { CsDealsClient } from '../core/client.js';
import { CsDealsAuthError } from '../core/errors.js';
import type { CsDealsWebSocketEvents, CsDealsWebSocketOptions, FeedEvent, FeedEventName } from './types.js';

interface Frame {
  event?: string;
  seq?: unknown;
  data?: { listing_id?: unknown } | null;
}

const CLOSE_UNAUTHORIZED = 4401;
const CLOSE_TOO_MANY = 4429;
const FEED_EVENTS = new Set<string>(['listing.created', 'listing.price_changed', 'listing.amount_changed', 'listing.removed', 'listing.sold']);
const MAX_TRACKED_LISTINGS = 1_000_000;

const DEFAULTS = {
  connectTimeoutMs: 10_000,
  reconnectDelayMs: 1_000,
  maxReconnectDelayMs: 30_000,
  idleTimeoutMs: 120_000,
} as const;

/** Marketplace-wide listing activity. No account events: those are webhooks. At most 3 sockets per key. */
export class CsDealsWebSocket extends EventEmitter<CsDealsWebSocketEvents> {
  private readonly client: CsDealsClient;
  private readonly opts: Required<Omit<CsDealsWebSocketOptions, 'appIds' | 'events'>>;
  private readonly filter: { app_ids?: number[]; events?: FeedEventName[] };
  private readonly lastSeq = new Map<number, number>();
  private ws: WebSocket | null = null;
  private ready = false;
  private everReady = false;
  private stopped = true;
  private terminal = false;
  private attempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private idleTimer: NodeJS.Timeout | null = null;

  constructor(client: CsDealsClient, options: CsDealsWebSocketOptions = {}) {
    super();
    const { appIds, events, ...rest } = options;
    this.client = client;
    this.opts = { ...DEFAULTS, ...rest };
    this.filter = { ...(appIds?.length ? { app_ids: appIds } : {}), ...(events?.length ? { events } : {}) };
  }

  get connected(): boolean {
    return this.ready;
  }

  /** Resolves once subscribed. Rejects (and stays inactive) if the first attempt fails. */
  async connect(): Promise<void> {
    if (!this.stopped) return;
    this.stopped = false;
    this.terminal = false;
    this.attempts = 0;
    try {
      await this.open();
    } catch (err) {
      this.stopped = true;
      this.teardownSocket();
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    this.stopped = true;
    this.clearReconnect();
    const ws = this.ws;
    if (!ws) return;
    await new Promise<void>((resolve) => {
      ws.once('close', () => resolve());
      ws.close(1000, 'client disconnect');
      setTimeout(() => ws.terminate(), 2_000).unref();
    });
  }

  private open(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const settle = (err?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(readyTimer);
        err ? reject(err) : resolve();
      };

      const ws = new WebSocket(this.client.wsUrl, {
        agent: this.client.wsAgent,
        headers: this.client.requestHeaders(),
        handshakeTimeout: this.opts.connectTimeoutMs,
      });
      this.ws = ws;
      const readyTimer = setTimeout(() => {
        settle(new Error(`no subscribe acknowledgement within ${this.opts.connectTimeoutMs}ms`));
        ws.terminate();
      }, this.opts.connectTimeoutMs);

      const onReady = () => {
        this.ready = true;
        this.attempts = 0;
        const reconnect = this.everReady;
        this.everReady = true;
        this.armIdle();
        settle();
        this.emit('connect', reconnect);
      };

      ws.on('ping', () => this.armIdle());
      ws.on('message', (raw) => {
        this.armIdle();
        const frame = parse(raw);
        if (!frame) return;
        if (frame.event === 'connected') {
          if (Object.keys(this.filter).length === 0) onReady();
          else ws.send(JSON.stringify({ op: 'subscribe', ...this.filter }));
        } else if (frame.event === 'subscribed') {
          if (!this.ready) onReady();
        } else if (frame.event === 'error') {
          this.emitError(new Error('cs.deals feed rejected the subscribe'));
          ws.terminate();
        } else {
          this.onFrame(frame);
        }
      });
      ws.on('error', (err) => {
        this.emitError(err);
        settle(err);
      });
      ws.on('close', (code, reason) => {
        if (this.ws !== ws) return;
        if (code === CLOSE_UNAUTHORIZED || code === CLOSE_TOO_MANY) {
          this.terminal = true;
          const err = code === CLOSE_UNAUTHORIZED ? new CsDealsAuthError() : new Error('cs.deals allows 3 feed sockets per key (4429)');
          this.emitError(err);
          settle(err);
        }
        settle(new Error(`closed during connect: ${code} ${reason.toString()}`));
        this.onClose(code, reason.toString());
      });
    });
  }

  private onFrame(frame: Frame): void {
    const listingId = frame.data?.listing_id;
    if (!frame.event || !FEED_EVENTS.has(frame.event) || typeof frame.seq !== 'number' || typeof listingId !== 'number') return;
    const last = this.lastSeq.get(listingId);
    if (last !== undefined && frame.seq <= last) return;
    this.lastSeq.delete(listingId);
    this.lastSeq.set(listingId, frame.seq);
    if (this.lastSeq.size > MAX_TRACKED_LISTINGS) this.lastSeq.delete(this.lastSeq.keys().next().value as number);
    this.emit('event', frame as FeedEvent);
  }

  private armIdle(): void {
    this.clearIdle();
    if (!this.ready || this.opts.idleTimeoutMs <= 0) return;
    // A half-open socket never fires close on its own, so silence is the only sign it died.
    this.idleTimer = setTimeout(() => {
      this.emitError(new Error(`no feed frame within ${this.opts.idleTimeoutMs}ms`));
      this.ws?.terminate();
    }, this.opts.idleTimeoutMs);
  }

  private onClose(code: number, reason: string): void {
    this.teardownSocket();
    const reconnect = !this.stopped && !this.terminal;
    if (!reconnect) this.stopped = true;
    this.emit('disconnect', { code, reason, reconnect });
    if (reconnect) this.scheduleReconnect();
  }

  private teardownSocket(): void {
    this.clearIdle();
    this.ready = false;
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.on('error', () => {});
      this.ws = null;
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    const base = Math.min(this.opts.reconnectDelayMs * 2 ** Math.min(this.attempts, 16), this.opts.maxReconnectDelayMs);
    const delay = base + Math.floor(Math.random() * Math.min(base, 1_000));
    this.attempts += 1;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.stopped) return;
      this.emit('connecting', this.attempts);
      this.open().catch(() => {
        if (!this.ws) this.scheduleReconnect();
      });
    }, delay);
  }

  private emitError(err: Error): void {
    if (this.listenerCount('error') > 0) this.emit('error', err);
  }

  private clearIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  private clearReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
  }
}

function parse(raw: WebSocket.RawData): Frame | null {
  try {
    const text = Array.isArray(raw) ? Buffer.concat(raw).toString('utf8') : Buffer.from(raw as ArrayBuffer).toString('utf8');
    const frame = JSON.parse(text) as unknown;
    return typeof frame === 'object' && frame !== null ? (frame as Frame) : null;
  } catch {
    return null;
  }
}

export { LiveBook } from './live-book.js';
export * from './types.js';

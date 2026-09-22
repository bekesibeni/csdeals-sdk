import { isRecord } from "../../core/client.js";
import { CsDealsError } from "../../core/errors.js";
import type { ConditionalResult, LeanListing } from "../../core/types.js";
import type { Book } from "../market/types.js";
import {
  FEED_EVENTS,
  type FeedCloseInfo,
  type FeedEvent,
  type FeedEventMap,
  type FeedEventName,
  type FeedFilter,
  type FeedOptions,
  type FeedSocket,
  type SubscribedAck,
} from "./types.js";

const OPEN = 1;
const CLOSE_UNAUTHORIZED = 4401;
const CLOSE_TOO_MANY = 4429;
const SUBSCRIBE_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_TRACKED = 1_000_000;

interface FeedListeners {
  event: (event: FeedEvent) => void;
  connected: (info: { reconnect: boolean }) => void;
  subscribed: (ack: SubscribedAck) => void;
  disconnected: (info: FeedCloseInfo) => void;
  error: (error: Error) => void;
}

type ListenerName = keyof FeedListeners | FeedEventName;
type ListenerFor<K extends ListenerName> = K extends keyof FeedListeners
  ? FeedListeners[K]
  : K extends FeedEventName
    ? (data: FeedEventMap[K], event: FeedEvent) => void
    : never;

const KNOWN_EVENTS = new Set<string>(FEED_EVENTS);

function defaultSocketFactory(url: string): FeedSocket {
  const Ctor = (globalThis as { WebSocket?: new (url: string) => FeedSocket }).WebSocket;
  if (!Ctor) {
    throw new CsDealsError({
      key: "NOT_CONFIGURED",
      status: 0,
      message: "No global WebSocket (Node 22+); pass socketFactory",
    });
  }
  return new Ctor(url);
}

function messageText(data: unknown): string | null {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
  if (data instanceof Uint8Array) return new TextDecoder().decode(data);
  return null;
}

/**
 * Marketplace-wide listing activity. Carries no account events: those arrive by webhook.
 * `seq` is global and gappy; only its order means anything.
 */
export class CsDealsFeed {
  private socket: FeedSocket | null = null;
  private filter: FeedFilter | undefined;
  private closedByUser = false;
  private attempts = 0;
  private everConnected = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly listeners = new Map<string, Set<(...args: never[]) => void>>();
  private readonly lastSeq = new Map<number, number>();
  private pendingSubscribe: {
    resolve: (ack: SubscribedAck) => void;
    reject: (err: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  private connectWaiters: { resolve: () => void; reject: (err: Error) => void }[] = [];

  constructor(
    private readonly url: string,
    private readonly options: FeedOptions = {},
  ) {
    this.filter = options.filter;
  }

  get connected(): boolean {
    return this.socket?.readyState === OPEN;
  }

  on<K extends ListenerName>(name: K, listener: ListenerFor<K>): () => void {
    let set = this.listeners.get(name);
    if (!set) {
      set = new Set();
      this.listeners.set(name, set);
    }
    set.add(listener as (...args: never[]) => void);
    return () => set.delete(listener as (...args: never[]) => void);
  }

  /** Resolves on the server's `connected` frame. */
  connect(): Promise<void> {
    this.closedByUser = false;
    const waiter = new Promise<void>((resolve, reject) => this.connectWaiters.push({ resolve, reject }));
    if (!this.socket) this.open();
    else if (this.everConnected && this.connected) this.settleConnect(null);
    return waiter;
  }

  /** Replaces the filter (the server does not merge) and resolves on its acknowledgement. */
  subscribe(filter: FeedFilter): Promise<SubscribedAck> {
    this.filter = filter;
    if (!this.connected) return Promise.reject(new CsDealsError({ key: "NETWORK_ERROR", status: 0, message: "Feed is not connected" }));
    this.pendingSubscribe?.reject(new CsDealsError({ key: "UNKNOWN", status: 0, message: "Superseded by a newer subscribe" }));
    clearTimeout(this.pendingSubscribe?.timer);
    return new Promise<SubscribedAck>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingSubscribe = null;
        reject(new CsDealsError({ key: "TIMEOUT", status: 0, message: "Feed subscribe was not acknowledged" }));
      }, SUBSCRIBE_TIMEOUT_MS);
      this.pendingSubscribe = { resolve, reject, timer };
      this.sendFilter(filter);
    });
  }

  close(): void {
    this.closedByUser = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.socket?.close(1000, "client close");
    this.socket = null;
  }

  private open(): void {
    let socket: FeedSocket;
    try {
      socket = (this.options.socketFactory ?? defaultSocketFactory)(this.url);
    } catch (err) {
      this.fail(err as Error);
      return;
    }
    this.socket = socket;
    socket.addEventListener("message", (event) => {
      if (this.socket === socket) this.onMessage(event.data);
    });
    socket.addEventListener("error", () => {
      if (this.socket === socket) this.emit("error", new CsDealsError({ key: "NETWORK_ERROR", status: 0, message: "Feed socket error" }));
    });
    socket.addEventListener("close", (event) => {
      if (this.socket === socket) this.onClose(event.code, event.reason);
    });
  }

  private onMessage(data: unknown): void {
    const text = messageText(data);
    if (text === null) return;
    let frame: unknown;
    try {
      frame = JSON.parse(text);
    } catch {
      return;
    }
    if (!isRecord(frame) || typeof frame.event !== "string") return;

    switch (frame.event) {
      case "connected": {
        const reconnect = this.everConnected;
        this.everConnected = true;
        this.attempts = 0;
        if (this.filter && (this.filter.events?.length || this.filter.app_ids?.length)) this.sendFilter(this.filter);
        this.settleConnect(null);
        this.emit("connected", { reconnect });
        return;
      }
      case "subscribed": {
        const ack = (isRecord(frame.data) ? frame.data : { events: "all", app_ids: "all" }) as unknown as SubscribedAck;
        if (this.pendingSubscribe) {
          clearTimeout(this.pendingSubscribe.timer);
          this.pendingSubscribe.resolve(ack);
          this.pendingSubscribe = null;
        }
        this.emit("subscribed", ack);
        return;
      }
      case "error": {
        const err = new CsDealsError({ key: "INVALID_REQUEST", status: 0, message: "Feed rejected a message" });
        if (this.pendingSubscribe) {
          clearTimeout(this.pendingSubscribe.timer);
          this.pendingSubscribe.reject(err);
          this.pendingSubscribe = null;
        } else {
          this.emit("error", err);
        }
        return;
      }
    }

    if (!KNOWN_EVENTS.has(frame.event)) return;
    if (typeof frame.seq !== "number" || !isRecord(frame.data)) return;
    const listingId = frame.data.listing_id;
    if (typeof listingId !== "number") return;
    if (this.options.dropStale !== false && !this.advance(listingId, frame.seq)) return;

    const event = frame as unknown as FeedEvent;
    this.emit("event", event);
    this.emit(event.event, event.data, event);
  }

  private advance(listingId: number, seq: number): boolean {
    const last = this.lastSeq.get(listingId);
    if (last !== undefined && seq <= last) return false;
    this.lastSeq.delete(listingId);
    this.lastSeq.set(listingId, seq);
    const max = this.options.maxTrackedListings ?? DEFAULT_MAX_TRACKED;
    if (this.lastSeq.size > max) {
      const oldest = this.lastSeq.keys().next().value;
      if (oldest !== undefined) this.lastSeq.delete(oldest);
    }
    return true;
  }

  private onClose(code: number, reason: string): void {
    this.socket = null;
    const fatal = code === CLOSE_UNAUTHORIZED || code === CLOSE_TOO_MANY;
    const willReconnect = !this.closedByUser && !fatal && this.options.reconnect !== false;
    if (this.pendingSubscribe) {
      clearTimeout(this.pendingSubscribe.timer);
      this.pendingSubscribe.reject(new CsDealsError({ key: "NETWORK_ERROR", status: 0, message: "Feed closed" }));
      this.pendingSubscribe = null;
    }
    this.emit("disconnected", { code, reason, willReconnect });

    if (fatal) {
      this.fail(
        new CsDealsError({
          key: code === CLOSE_UNAUTHORIZED ? "UNAUTHORIZED" : "RATE_LIMITED",
          status: code,
          message: code === CLOSE_UNAUTHORIZED ? "Feed rejected the API key" : "More than 3 feed connections for this user",
        }),
      );
      return;
    }
    if (!willReconnect) {
      if (!this.closedByUser) this.fail(new CsDealsError({ key: "NETWORK_ERROR", status: code, message: `Feed closed (${code})` }));
      return;
    }
    const base = Math.min(1_000 * 2 ** this.attempts, this.options.maxReconnectDelayMs ?? 30_000);
    this.attempts++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.closedByUser) this.open();
    }, base / 2 + Math.random() * (base / 2));
  }

  private fail(err: Error): void {
    this.settleConnect(err);
    this.emit("error", err);
  }

  private settleConnect(err: Error | null): void {
    const waiters = this.connectWaiters;
    this.connectWaiters = [];
    for (const waiter of waiters) {
      if (err) waiter.reject(err);
      else waiter.resolve();
    }
  }

  private sendFilter(filter: FeedFilter): void {
    this.socket?.send(
      JSON.stringify({
        op: "subscribe",
        ...(filter.events?.length ? { events: filter.events } : {}),
        ...(filter.app_ids?.length ? { app_ids: filter.app_ids } : {}),
      }),
    );
  }

  private emit(name: string, ...args: unknown[]): void {
    const set = this.listeners.get(name);
    if (!set) return;
    for (const listener of [...set]) {
      try {
        (listener as (...a: unknown[]) => void)(...args);
      } catch (err) {
        if (name !== "error") this.emit("error", err as Error);
      }
    }
  }
}

export interface LiveBookOptions {
  app_id?: number;
}

/**
 * A local copy of the active book, kept current by the feed. Implements the documented protocol:
 * buffer events, load `GET /book`, drop buffered events at or below its `seq`, replay the rest.
 * Resyncs by itself after every reconnect.
 */
export class LiveBook {
  readonly listings = new Map<number, LeanListing>();
  /** The snapshot `seq` of the last sync. */
  snapshotSeq = 0;
  private buffer: FeedEvent[] | null = null;
  private syncing: Promise<void> | null = null;
  private readonly unsubscribe: (() => void)[] = [];
  private readonly changeListeners = new Set<(event: FeedEvent) => void>();
  private readonly syncListeners = new Set<(seq: number) => void>();

  constructor(
    private readonly feed: CsDealsFeed,
    private readonly fetchBook: (appId: number | undefined) => Promise<ConditionalResult<Book>>,
    private readonly options: LiveBookOptions = {},
  ) {}

  /** Connects, subscribes and loads the first snapshot. */
  async start(): Promise<void> {
    this.unsubscribe.push(
      this.feed.on("event", (event) => this.onEvent(event)),
      this.feed.on("connected", ({ reconnect }) => {
        if (reconnect) void this.sync().catch(() => undefined);
      }),
    );
    await this.feed.connect();
    await this.feed.subscribe({
      events: ["listing.created", "listing.price_changed", "listing.amount_changed", "listing.removed"],
      ...(this.options.app_id !== undefined ? { app_ids: [this.options.app_id] } : {}),
    });
    await this.sync();
  }

  onChange(listener: (event: FeedEvent) => void): () => void {
    this.changeListeners.add(listener);
    return () => this.changeListeners.delete(listener);
  }

  onSync(listener: (seq: number) => void): () => void {
    this.syncListeners.add(listener);
    return () => this.syncListeners.delete(listener);
  }

  sync(): Promise<void> {
    this.syncing ??= this.runSync().finally(() => {
      this.syncing = null;
    });
    return this.syncing;
  }

  stop(): void {
    for (const off of this.unsubscribe.splice(0)) off();
    this.feed.close();
  }

  private async runSync(): Promise<void> {
    this.buffer = [];
    try {
      const result = await this.fetchBook(this.options.app_id);
      if (result.notModified) throw new CsDealsError({ key: "INVALID_RESPONSE", status: 304, message: "Book sync got a 304" });
      this.listings.clear();
      for (const listing of result.data.listings) this.listings.set(listing.id, listing);
      this.snapshotSeq = result.data.seq;
      const buffered = this.buffer;
      this.buffer = null;
      for (const event of buffered) if (event.seq > this.snapshotSeq) this.apply(event);
      for (const listener of this.syncListeners) listener(this.snapshotSeq);
    } finally {
      this.buffer = null;
    }
  }

  private onEvent(event: FeedEvent): void {
    if (this.buffer) {
      this.buffer.push(event);
      return;
    }
    this.apply(event);
  }

  private apply(event: FeedEvent): void {
    switch (event.event) {
      case "listing.created": {
        const d = event.data;
        this.listings.set(d.listing_id, {
          id: d.listing_id,
          app_id: d.app_id,
          market_hash_name: d.market_hash_name,
          price: d.price,
          amount: d.amount,
          commodity: d.commodity,
          created_at: d.created_at,
        });
        break;
      }
      case "listing.price_changed": {
        const held = this.listings.get(event.data.listing_id);
        if (!held) return;
        held.price = event.data.price_after;
        break;
      }
      case "listing.amount_changed": {
        const held = this.listings.get(event.data.listing_id);
        if (!held) return;
        if (event.data.new_amount <= 0) this.listings.delete(event.data.listing_id);
        else held.amount = event.data.new_amount;
        break;
      }
      case "listing.removed":
        if (!this.listings.delete(event.data.listing_id)) return;
        break;
      default:
        return;
    }
    for (const listener of this.changeListeners) listener(event);
  }
}

export * from "./types.js";

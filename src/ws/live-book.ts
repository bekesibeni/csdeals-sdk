import { EventEmitter } from 'node:events';
import type { LeanListing } from '../core/types.js';
import type { Book } from '../modules/market/types.js';
import type { CsDealsWebSocket } from './index.js';
import type { BookChange, BookDiff, BookListing, FeedEvent, LiveBookEvents, LiveBookOptions } from './types.js';

const DEFAULT_RESYNC_MS = 300_000;
const MIN_RETRY_MS = 10_000;
const MAX_RETRY_MS = 60_000;

function leanOf(listing: LeanListing): LeanListing {
  const { id, app_id, market_hash_name, price, amount, commodity, created_at } = listing;
  return { id, app_id, market_hash_name, price, amount, commodity, created_at };
}

function sameLean(a: LeanListing, b: LeanListing): boolean {
  return (
    a.price === b.price &&
    a.amount === b.amount &&
    a.market_hash_name === b.market_hash_name &&
    a.app_id === b.app_id &&
    a.commodity === b.commodity &&
    a.created_at === b.created_at
  );
}

/**
 * A local copy of the active book, run the way cs.deals documents it: hold feed events, read
 * `GET /book`, drop what the snapshot already covers, replay the rest. The feed is known to miss
 * events, so the book is re-read on an interval and after every reconnect, and each read reports
 * what it corrected as `sync`.
 */
export class LiveBook extends EventEmitter<LiveBookEvents> {
  readonly listings = new Map<number, BookListing>();
  /** The `seq` of the last snapshot. */
  snapshotSeq = 0;
  /** Epoch ms of the last successful read, 0 before the first. An old value means reads are failing. */
  syncedAt = 0;
  private held: FeedEvent[] | null = null;
  private syncing: Promise<void> | null = null;
  private syncAgain = false;
  private stopped = true;
  private retryMs = 0;
  private retryTimer: NodeJS.Timeout | null = null;
  private intervalTimer: NodeJS.Timeout | null = null;

  constructor(
    readonly socket: CsDealsWebSocket,
    private readonly readBook: () => Promise<Book>,
    private readonly options: LiveBookOptions = {},
  ) {
    super();
  }

  /** Connects, subscribes and loads the first snapshot. Nothing is applied before it. */
  async start(): Promise<void> {
    this.stopped = false;
    this.held = [];
    this.socket.on('event', this.onEvent);
    this.socket.on('connect', this.onConnect);
    this.socket.on('error', this.onSocketError);
    try {
      await this.socket.connect();
      await this.sync();
    } catch (err) {
      await this.stop();
      throw err;
    }
    const every = this.options.resyncIntervalMs ?? DEFAULT_RESYNC_MS;
    if (every > 0) this.intervalTimer = setInterval(() => this.resync(), every);
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.intervalTimer) clearInterval(this.intervalTimer);
    this.retryTimer = null;
    this.intervalTimer = null;
    this.held = null;
    this.socket.off('event', this.onEvent);
    this.socket.off('connect', this.onConnect);
    this.socket.off('error', this.onSocketError);
    await this.socket.disconnect();
  }

  /** A call during a running read queues one more, so the snapshot always postdates the call. */
  sync(): Promise<void> {
    if (this.syncing) {
      this.syncAgain = true;
      return this.syncing;
    }
    this.syncing = (async () => {
      try {
        do {
          this.syncAgain = false;
          await this.readOnce();
        } while (this.syncAgain && !this.stopped);
      } finally {
        this.syncing = null;
      }
    })();
    return this.syncing;
  }

  private readonly onEvent = (event: FeedEvent): void => {
    if (this.stopped) return;
    if (this.held) this.held.push(event);
    else this.apply(event);
  };

  private readonly onConnect = (reconnect: boolean): void => {
    if (reconnect) this.resync();
  };

  private readonly onSocketError = (err: Error): void => {
    this.emitError(err);
  };

  private resync(): void {
    if (this.stopped) return;
    this.sync().then(
      () => {
        this.retryMs = 0;
      },
      (err: unknown) => {
        this.emitError(err instanceof Error ? err : new Error(String(err)));
        if (this.stopped || this.retryTimer) return;
        this.retryMs = Math.min(Math.max(this.retryMs * 2, MIN_RETRY_MS), MAX_RETRY_MS);
        this.retryTimer = setTimeout(() => {
          this.retryTimer = null;
          this.resync();
        }, this.retryMs);
      },
    );
  }

  private async readOnce(): Promise<void> {
    this.held ??= [];
    let book: Book;
    try {
      book = await this.readBook();
    } catch (err) {
      // Before the first snapshot there is nothing to apply to, so keep holding.
      if (this.syncedAt > 0) this.release();
      throw err;
    }
    if (this.stopped) return;
    const diff = this.merge(book);
    this.syncedAt = Date.now();
    this.safeEmit('sync', diff);
    this.release();
  }

  private merge(book: Book): BookDiff {
    const initial = this.syncedAt === 0;
    const added: BookListing[] = [];
    const changed: BookChange[] = [];
    const removed: BookListing[] = [];
    const seen = new Set<number>();
    for (const row of book.listings) {
      seen.add(row.id);
      const current = this.listings.get(row.id);
      if (!current) {
        this.listings.set(row.id, row);
        added.push(row);
      } else if (!sameLean(current, row)) {
        const before = leanOf(current);
        Object.assign(current, row);
        changed.push({ before, after: current });
      }
    }
    for (const [id, current] of this.listings) {
      if (seen.has(id)) continue;
      this.listings.delete(id);
      removed.push(current);
    }
    this.snapshotSeq = book.seq;
    return { seq: book.seq, initial, added, changed, removed };
  }

  private release(): void {
    const held = this.held ?? [];
    this.held = null;
    for (const event of held) this.apply(event);
  }

  private apply(event: FeedEvent): void {
    // The snapshot already holds it: a frame that lost the race to the HTTP read would roll a row back.
    if (event.seq <= this.snapshotSeq) return;
    if (this.options.appId !== undefined && event.data.app_id !== this.options.appId) return;
    switch (event.event) {
      case 'listing.created': {
        const { listing_id, ...detail } = event.data;
        this.listings.set(listing_id, { ...detail, id: listing_id });
        break;
      }
      case 'listing.price_changed': {
        const current = this.listings.get(event.data.listing_id);
        if (!current) return;
        current.price = event.data.price_after;
        break;
      }
      case 'listing.amount_changed': {
        const current = this.listings.get(event.data.listing_id);
        if (!current) return;
        if (event.data.new_amount <= 0) this.listings.delete(event.data.listing_id);
        else current.amount = event.data.new_amount;
        break;
      }
      case 'listing.removed':
        if (!this.listings.delete(event.data.listing_id)) return;
        break;
      default:
        return;
    }
    this.safeEmit('change', event);
  }

  private safeEmit<K extends 'sync' | 'change'>(name: K, ...args: LiveBookEvents[K]): void {
    try {
      (this.emit as (name: K, ...args: LiveBookEvents[K]) => boolean)(name, ...args);
    } catch (err) {
      this.emitError(err instanceof Error ? err : new Error(String(err)));
    }
  }

  private emitError(err: Error): void {
    if (this.listenerCount('error') > 0) this.emit('error', err);
  }
}

import type { LeanListing, ListingRow } from '../core/types.js';

/** Carries the full listing row: item detail and `trade_locked_until` included. */
export interface ListingCreatedEvent extends Omit<Partial<ListingRow>, 'id'> {
  listing_id: number;
  app_id: number;
  market_hash_name: string;
  price: number;
  amount: number;
  commodity: boolean;
  created_at: string;
}

export interface ListingPriceChangedEvent {
  listing_id: number;
  app_id: number;
  price_before: number;
  price_after: number;
}

export interface ListingAmountChangedEvent {
  listing_id: number;
  app_id: number;
  /** 0 when the copy sells. 1 only while cs.deals splits an old stacked listing. */
  new_amount: number;
}

export interface ListingRemovedEvent {
  listing_id: number;
  app_id: number;
}

export interface ListingSoldEvent {
  listing_id: number;
  app_id: number;
  market_hash_name: string;
  price: number;
  amount: number;
  listed_at: string;
  sold_at: string;
}

export interface FeedEventMap {
  'listing.created': ListingCreatedEvent;
  'listing.price_changed': ListingPriceChangedEvent;
  'listing.amount_changed': ListingAmountChangedEvent;
  'listing.removed': ListingRemovedEvent;
  'listing.sold': ListingSoldEvent;
}

export type FeedEventName = keyof FeedEventMap;

/** `seq` is global and gappy; only its order means anything. */
export type FeedEvent = {
  [K in FeedEventName]: { event: K; data: FeedEventMap[K]; seq: number; ts: string };
}[FeedEventName];

export interface CsDealsWebSocketOptions {
  /** Games to stream. Omit for every game. */
  appIds?: number[];
  /** Events to stream. Omit for all five. */
  events?: FeedEventName[];
  /** Handshake plus the subscribe acknowledgement. Default 10 000. */
  connectTimeoutMs?: number;
  /** First reconnect delay; doubles per attempt. Default 1 000. */
  reconnectDelayMs?: number;
  /** Backoff ceiling. Default 30 000. */
  maxReconnectDelayMs?: number;
  /** Silence after which the socket is declared dead. The feed documents no heartbeat. Default 120 000. */
  idleTimeoutMs?: number;
}

export interface DisconnectInfo {
  code: number;
  reason: string;
  /** False after `disconnect()`, a rejected key (4401) or a fourth socket (4429). */
  reconnect: boolean;
}

export interface CsDealsWebSocketEvents {
  connecting: [attempt: number];
  /** Subscribed. After a reconnect, whatever happened in the gap is gone: re-read `GET /book`. */
  connect: [reconnect: boolean];
  /** In `seq` order per listing: a frame that does not beat the last one for its listing is dropped. */
  event: [event: FeedEvent];
  disconnect: [info: DisconnectInfo];
  error: [err: Error];
}

/** A book row. One first seen through `listing.created` also keeps the event's item detail. */
export type BookListing = LeanListing & Partial<ListingRow>;

export interface BookChange {
  before: LeanListing;
  after: BookListing;
}

/** What one read of the book found against the local copy. Outside the first read, each entry is a change the feed missed. */
export interface BookDiff {
  seq: number;
  initial: boolean;
  added: BookListing[];
  changed: BookChange[];
  removed: BookListing[];
}

export interface LiveBookOptions {
  appId?: number;
  /** Re-reads the book on this interval. The feed is known to drop events. Default 300 000; 0 turns it off. */
  resyncIntervalMs?: number;
  /** Timings for the book's own socket. */
  socket?: Omit<CsDealsWebSocketOptions, 'appIds' | 'events'>;
}

export interface LiveBookEvents {
  /** After every successful read, before the events held during it are replayed. */
  sync: [diff: BookDiff];
  change: [event: FeedEvent];
  /** Failed reads (retried on their own) and socket errors. */
  error: [err: Error];
}

import type { Cents, IsoDateTime, ItemDetailFields } from "../../core/types.js";

export interface ListingCreatedEvent extends Partial<ItemDetailFields> {
  listing_id: number;
  app_id: number;
  market_hash_name: string;
  price: Cents;
  amount: number;
  commodity: boolean;
  created_at: IsoDateTime;
  [field: string]: unknown;
}

export interface ListingPriceChangedEvent {
  listing_id: number;
  app_id: number;
  price_before: Cents;
  price_after: Cents;
}

export interface ListingAmountChangedEvent {
  listing_id: number;
  app_id: number;
  /** 0 means sold out. */
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
  price: Cents;
  amount: number;
  listed_at: IsoDateTime;
  sold_at: IsoDateTime;
}

export interface FeedEventMap {
  "listing.created": ListingCreatedEvent;
  "listing.price_changed": ListingPriceChangedEvent;
  "listing.amount_changed": ListingAmountChangedEvent;
  "listing.removed": ListingRemovedEvent;
  "listing.sold": ListingSoldEvent;
}

export type FeedEventName = keyof FeedEventMap;

export const FEED_EVENTS = [
  "listing.created",
  "listing.price_changed",
  "listing.amount_changed",
  "listing.removed",
  "listing.sold",
] as const satisfies readonly FeedEventName[];

export type FeedEvent = {
  [K in FeedEventName]: { event: K; data: FeedEventMap[K]; seq: number; ts: IsoDateTime };
}[FeedEventName];

export interface FeedFilter {
  /** Empty or absent: every event. */
  events?: FeedEventName[];
  /** Empty or absent: every game. */
  app_ids?: number[];
}

export interface SubscribedAck {
  events: FeedEventName[] | "all";
  app_ids: number[] | "all";
}

export interface FeedCloseInfo {
  code: number;
  reason: string;
  willReconnect: boolean;
}

/** The slice of a WHATWG WebSocket the feed uses; Node 24's global `WebSocket` satisfies it. */
export interface FeedSocket {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "open" | "error", listener: (event: unknown) => void): void;
  addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
  addEventListener(type: "close", listener: (event: { code: number; reason: string }) => void): void;
}

export type FeedSocketFactory = (url: string) => FeedSocket;

export interface FeedOptions {
  /** Applied on connect and re-applied after every reconnect. */
  filter?: FeedFilter;
  /** Default true. 4401 (bad key) and 4429 (over 3 sockets) never reconnect. */
  reconnect?: boolean;
  maxReconnectDelayMs?: number;
  /** Drop an event whose `seq` does not beat the last one applied for that listing. Default true. */
  dropStale?: boolean;
  /** Bound on per-listing `seq` memory; oldest entries are evicted first. */
  maxTrackedListings?: number;
  /** Test seam; defaults to the global `WebSocket`. */
  socketFactory?: FeedSocketFactory;
}

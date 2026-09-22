import type {
  AppIdParam,
  BulkPageLimit,
  Cents,
  ConditionalParams,
  IsoDateTime,
  LeanListing,
  ListingRow,
  PageMetadata,
  PageParams,
  RequestOptions,
} from "../../core/types.js";

// ── Entities ──

export interface ListingsResponse {
  listings: ListingRow[];
  /** Pass back as `cursor`; `null` once the book is exhausted. */
  next_cursor: number | null;
  metadata: PageMetadata;
}

export interface Book {
  /** The last WebSocket `seq` published before the snapshot. */
  seq: number;
  listings: LeanListing[];
}

export interface PriceRow {
  app_id: number;
  market_hash_name: string;
  /** Steam-derived. */
  market_price: Cents;
  recommended_price: Cents;
  lowest_listing_price: Cents | null;
  updated_at: IsoDateTime | null;
}

export interface PricesResponse {
  prices: PriceRow[];
  metadata: PageMetadata;
}

export interface PriceAllRow extends PriceRow {
  /** Units listed. */
  stock: number;
  listing_count: number;
}

export interface PricesAll {
  prices: PriceAllRow[];
  generated_at: IsoDateTime;
}

export interface Sale {
  app_id: number;
  market_hash_name: string;
  price: Cents;
  amount: number;
  sold_at: IsoDateTime;
}

export interface SalesResponse {
  sales: Sale[];
  metadata: PageMetadata;
}

export interface SaleAverage {
  app_id: number;
  market_hash_name: string;
  average_price: Cents;
  sales: number;
  volume: number;
}

export interface SalesAverages {
  averages: SaleAverage[];
  window_days: number;
  generated_at: IsoDateTime;
}

// ── Params ──

export interface ListingsParams extends RequestOptions {
  limit?: BulkPageLimit;
  page?: number;
  /** A listing id from a previous `next_cursor`. Stable through a churning book, unlike `page`. */
  cursor?: number;
  app_id?: AppIdParam;
}

export interface AppFilterParams extends RequestOptions {
  app_id?: AppIdParam;
}

export interface ConditionalAppParams extends AppFilterParams, ConditionalParams {}

export interface PricesParams extends PageParams, RequestOptions {
  app_id?: AppIdParam;
}

export interface SalesParams extends PageParams, RequestOptions {
  app_id?: AppIdParam;
  /** Exact match, 1-200 characters. */
  market_hash_name?: string;
}

import type { LeanListing, ListingRow, PageMetadata, PageParams } from '../../core/types.js';

export interface ListingsResponse {
  listings: ListingRow[];
  /** Pass back as `cursor`; null once the book is exhausted. */
  next_cursor: number | null;
  metadata: PageMetadata;
}

export interface Book {
  /** The last feed `seq` published before the snapshot. */
  seq: number;
  listings: LeanListing[];
}

export interface PriceRow {
  app_id: number;
  market_hash_name: string;
  /** Steam-derived. */
  market_price: number;
  recommended_price: number;
  lowest_listing_price: number | null;
  updated_at: string | null;
}

export interface PricesResponse {
  prices: PriceRow[];
  metadata: PageMetadata;
}

export interface AllPricesRow extends PriceRow {
  /** Units listed. */
  stock: number;
  listing_count: number;
}

export interface AllPrices {
  prices: AllPricesRow[];
  generated_at: string;
}

export interface Sale {
  app_id: number;
  market_hash_name: string;
  price: number;
  amount: number;
  sold_at: string;
}

export interface SalesResponse {
  sales: Sale[];
  metadata: PageMetadata;
}

export interface SaleAverage {
  app_id: number;
  market_hash_name: string;
  average_price: number;
  sales: number;
  volume: number;
}

export interface SalesAverages {
  averages: SaleAverage[];
  window_days: number;
  generated_at: string;
}

export interface GetListingsParams {
  appId?: number;
  /** 500 or 1000. */
  limit?: 500 | 1000;
  page?: number;
  /** A previous `next_cursor`. Stable through a churning book, unlike `page`. */
  cursor?: number;
}

export interface ConditionalParams {
  appId?: number;
  /** The `etag` of a previous read. */
  etag?: string;
}

export interface GetPricesParams extends PageParams {
  appId?: number;
}

export interface GetSalesParams extends PageParams {
  appId?: number;
  /** Exact match. */
  marketHashName?: string;
}

import type { BulkResult, LeanListing, PageMetadata, PageParams } from '../../core/types.js';
import type { TokenLine } from '../trading/types.js';

export interface SteamInventoryItem {
  /** Signed, account-bound, valid 30 minutes. Covers at most this row's `amount`. */
  token: string;
  app_id: number;
  steam_asset_id: string;
  market_hash_name: string;
  /** One row is one Steam stack. */
  amount: number;
  commodity: boolean;
  tradable: boolean;
  market_price: number;
  recommended_price: number;
  icon_url: string;
}

export interface SteamInventoryResponse {
  items: SteamInventoryItem[];
}

export interface SellResult {
  /** Each matches `deposit_id` on a trade; nothing lists until the offer is accepted. */
  deposit_ids: number[];
}

export interface ListResult {
  listings: LeanListing[];
}

export interface EditResult extends BulkResult {
  listing: LeanListing | null;
}

export interface EditListingsResult {
  /** In request order; each listing is its own transaction. `LISTING_DISABLED` lands per row here. */
  results: EditResult[];
}

export interface DelistResult {
  listing_id: number;
}

export interface DelistManyResult {
  /** Every id with `ok: true`: the call is all or nothing and throws otherwise. */
  results: BulkResult[];
}

export interface RepriceResult {
  listings: LeanListing[];
}

export interface PriceDecayState {
  start_price: number;
  end_price: number;
  total_hours: number;
  elapsed_hours: number;
}

export interface MyListing extends LeanListing {
  /** Commodities only: how many more copies the backpack could list. 0 otherwise. */
  available_amount: number;
  price_decay: PriceDecayState | null;
}

export type MyListingStatus = 'ACTIVE' | 'DISABLED' | 'FILLED' | 'PRIVATE';

export interface MyListingsResponse {
  listings: MyListing[];
  metadata: PageMetadata;
}

export interface MyListingsValue {
  listing_count: number;
  item_count: number;
  total_value: number;
}

export interface PriceDecay {
  startPrice: number;
  /** Below `startPrice`. */
  endPrice: number;
  /** 24-168. */
  totalHours: number;
}

export interface SellGroup {
  items: TokenLine[];
  /** Per copy. */
  price: number;
}

export interface BackpackLine {
  /** Backpack item id. */
  id: number;
  amount: number;
}

/** A flat `price` or a `priceDecay` curve, not both. Lists one listing per copy. */
export interface ListGroup {
  items: BackpackLine[];
  price?: number;
  priceDecay?: PriceDecay;
}

/** Price only: a listing holds one copy, so there is no amount to edit. */
export interface ListingEdit {
  listingId: number;
  price?: number;
  priceDecay?: PriceDecay;
}

/** A flat `price` or a `priceDecay` curve, not both. */
export interface Reprice {
  price?: number;
  priceDecay?: PriceDecay;
}

export interface GetMyListingsParams extends PageParams {
  appId?: number;
  status?: MyListingStatus;
}

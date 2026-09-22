import type {
  AppIdParam,
  BulkResult,
  Cents,
  LeanListing,
  PageMetadata,
  PageParams,
  PriceDecayInput,
  RequestOptions,
  TokenLine,
} from "../../core/types.js";

// ── Entities ──

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
  market_price: Cents;
  recommended_price: Cents;
  icon_url: string;
}

export interface SteamInventoryResponse {
  items: SteamInventoryItem[];
}

export interface SellResult {
  /** Each matches `deposit_id` on a `trades` row; nothing lists until the offer is accepted. */
  deposit_ids: number[];
}

export interface ListResult {
  listings: LeanListing[];
}

export interface EditResult extends BulkResult {
  listing: LeanListing | null;
}

export interface EditListingsResult {
  /** In request order. Each listing is its own transaction. */
  results: EditResult[];
}

export interface DelistResult {
  listing_id: number;
}

export interface DelistManyResult {
  results: BulkResult[];
}

export interface PriceDecayState {
  start_price: Cents;
  end_price: Cents;
  total_hours: number;
  elapsed_hours: number;
}

export interface MyListing extends LeanListing {
  /** How many more copies can be added from the backpack. */
  available_amount: number;
  price_decay: PriceDecayState | null;
}

export type MyListingStatus = "ACTIVE" | "DISABLED" | "FILLED" | "PRIVATE";

export interface MyListingsResponse {
  listings: MyListing[];
  metadata: PageMetadata;
}

export interface MyListingsValue {
  listing_count: number;
  item_count: number;
  total_value: Cents;
}

// ── Params ──

export interface SteamInventoryParams extends RequestOptions {
  app_id: AppIdParam;
}

export interface SellGroup {
  /** 1-50 stacks sold as one listing. */
  items: TokenLine[];
  /** Per copy. */
  price: Cents;
}

export interface SellParams extends RequestOptions {
  /** 1-50 groups. One trade offer per game, at most 500 copies per offer. */
  listings: SellGroup[];
}

export interface BackpackLine {
  /** Backpack item id. The same commodity id may appear in several groups; they draw from one pool. */
  id: number;
  amount: number;
}

export type ListGroup =
  | { items: BackpackLine[]; price: Cents; price_decay?: never }
  | { items: BackpackLine[]; price_decay: PriceDecayInput; price?: never };

export interface ListParams extends RequestOptions {
  /** 1-50 groups; each becomes one listing. */
  listings: ListGroup[];
}

/**
 * `price` alone reprices the whole stack in place. `amount` alone grows or shrinks it (surplus
 * returns to the backpack). `amount` WITH `price` is a partial reprice: this listing keeps `amount`
 * at the new price and the rest moves to a new listing at the old one, even if the price is equal.
 */
export interface ListingEdit {
  listing_id: number;
  price?: Cents;
  price_decay?: PriceDecayInput;
  amount?: number;
}

export interface MyListingsParams extends PageParams, RequestOptions {
  app_id?: AppIdParam;
  status?: MyListingStatus;
}

export interface MyListingsValueParams extends RequestOptions {
  app_id?: AppIdParam;
}

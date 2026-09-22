import type {
  AppIdParam,
  BulkPageLimit,
  Cents,
  IsoDateTime,
  PageMetadata,
  PageParams,
  RequestOptions,
  TokenLine,
  Trade,
  TradeStatus,
} from "../../core/types.js";

// ── Entities ──

export interface PurchasedItem {
  order_item_id: number;
  app_id: number;
  market_hash_name: string;
  steam_asset_id: string;
  /** What was actually charged per copy: at or below the line's `max_price`. */
  price: Cents;
  amount: number;
}

export interface PurchaseResult {
  order_id: number;
  created_at: IsoDateTime;
  items: PurchasedItem[];
}

export interface BackpackItem {
  /** Backpack item id: what `withdraw` and `selling.list` take. Not a listing id, not a Steam asset id. */
  id: number;
  app_id: number;
  market_hash_name: string;
  amount: number;
  commodity: boolean;
  market_price: Cents;
  trade_locked_until: IsoDateTime | null;
}

export interface BackpackResponse {
  items: BackpackItem[];
  metadata: PageMetadata;
}

export interface DepositResult {
  /** Each matches `deposit_id` on a `trades` row. */
  deposit_ids: number[];
}

export interface WithdrawResult {
  /** One per trade offer (one per holding bot); each matches `withdraw_id` on a `trades` row. */
  withdraw_ids: number[];
}

export interface TradesResponse {
  trades: Trade[];
  metadata: PageMetadata;
}

// ── Params ──

export interface PurchaseLine {
  listing_id: number;
  /** 1-500. */
  amount: number;
  /** A ceiling in cents: a cheaper listing fills at its current price, a dearer one fails the order. */
  max_price: Cents;
  /** From a private listing's share link, 8-24 characters. */
  private_token?: string;
}

export interface PurchaseParams extends RequestOptions {
  /** 1-50 lines, one per listing. Atomic: every line fills or none does. */
  items: PurchaseLine[];
}

export interface BackpackParams extends PageParams, RequestOptions {
  app_id?: AppIdParam;
  /** 1-200 characters. */
  search?: string;
}

export interface DepositParams extends RequestOptions {
  items: TokenLine[];
}

export interface WithdrawLine {
  /** Backpack item id. */
  id: number;
  amount: number;
}

export interface WithdrawParams extends RequestOptions {
  /** 1-50. */
  items: WithdrawLine[];
  two_factor_auth_token?: string;
}

export interface TradesParams extends RequestOptions {
  page?: number;
  limit?: BulkPageLimit;
  status?: TradeStatus;
}

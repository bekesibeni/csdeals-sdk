import type { PageMetadata, PageParams, Trade, TradeStatus } from '../../core/types.js';

export interface PurchasedItem {
  order_item_id: number;
  app_id: number;
  market_hash_name: string;
  steam_asset_id: string;
  /** Charged per copy: at or below the line's `maxPrice`. */
  price: number;
  amount: number;
}

export interface PurchaseResult {
  order_id: number;
  created_at: string;
  items: PurchasedItem[];
}

export interface BackpackItem {
  /** What `withdraw` and `selling.list` take. Not a listing id, not a Steam asset id. */
  id: number;
  app_id: number;
  market_hash_name: string;
  amount: number;
  commodity: boolean;
  market_price: number;
  trade_locked_until: string | null;
}

export interface BackpackResponse {
  items: BackpackItem[];
  metadata: PageMetadata;
}

export interface DepositResult {
  /** Each matches `deposit_id` on a trade. */
  deposit_ids: number[];
}

export interface WithdrawResult {
  /** One per trade offer (one per holding bot); each matches `withdraw_id` on a trade. */
  withdraw_ids: number[];
}

export interface TradesResponse {
  trades: Trade[];
  metadata: PageMetadata;
}

export interface PurchaseLine {
  listingId: number;
  /** 1-500. */
  amount: number;
  /** A ceiling in cents: a cheaper listing fills at its current price, a dearer one fails the order. */
  maxPrice: number;
  /** From a private listing's share link. */
  privateToken?: string;
}

export interface GetBackpackParams extends PageParams {
  appId?: number;
  search?: string;
}

export interface TokenLine {
  /** From `selling.getSteamInventory`; valid 30 minutes. */
  token: string;
  amount: number;
}

export interface WithdrawLine {
  /** Backpack item id. */
  id: number;
  amount: number;
}

export interface WithdrawParams {
  /** 1-50 lines. */
  items: WithdrawLine[];
  /** Only when withdrawal 2FA is on for the account. */
  twoFactorToken?: string;
}

export interface GetTradesParams {
  page?: number;
  /** 500 or 1000. */
  limit?: 500 | 1000;
  status?: TradeStatus;
}

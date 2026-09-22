export const APP_ID = {
  CS2: 730,
  RUST: 252490,
  DOTA2: 570,
  TF2: 440,
  SBOX: 590830,
} as const;

export type AppId = (typeof APP_ID)[keyof typeof APP_ID];

/** A known `AppId`, or any app id cs.deals adds later. */
export type AppIdParam = AppId | (number & {});

/** Integer US cents. `4250` is $42.50. */
export type Cents = number;

/** ISO 8601, UTC. */
export type IsoDateTime = string;

export type PageLimit = 5 | 10 | 25 | 30 | 50 | 100;
export type BulkPageLimit = 500 | 1000;

export interface PageMetadata {
  total_pages: number;
  total_items: number;
  current_page: number;
  current_limit: number;
}

export interface PageParams {
  page?: number;
  limit?: PageLimit;
}

export interface Sticker {
  slot: number;
  sticker_id: number;
  name: string;
  image: string;
  wear: number | null;
  scale: number | null;
  rotation: number | null;
  tint_id: number | null;
  offset_x: number | null;
  offset_y: number | null;
  offset_z: number | null;
  pattern: number | null;
}

export interface Tf2Attributes {
  craftable: boolean;
  uncraftable: boolean;
  festivized: boolean;
  strange_parts: boolean;
  holiday_restricted: boolean;
}

export interface ItemDetailFields {
  cs_weapon: string | null;
  cs_type: string | null;
  cs_wear: string | null;
  cs_rarity: string | null;
  cs_collection: string | null;
  cs_is_stattrak: boolean | null;
  cs_is_souvenir: boolean | null;
  cs_is_highlight: boolean | null;
  cs_inspect_link: string | null;
  /** The float value. */
  cs_paint_wear: number | null;
  cs_paint_seed: number | null;
  cs_paint_index: number | null;
  cs_fade_percentage: number | null;
  cs_blue_percentage: number | null;
  cs_stickers: Sticker[] | null;
  cs_keychains: Sticker[] | null;
  rust_category: string | null;
  rust_type: string | null;
  rust_collection: string | null;
  dota_rarity: string | null;
  dota_hero: string | null;
  dota_quality: string | null;
  dota_type: string | null;
  dota_slot: string | null;
  dota_collection: string | null;
  dota_event: string | null;
  tf2_classes: string[];
  tf2_quality: string | null;
  tf2_effect: string | null;
  tf2_wear: string | null;
  tf2_spells: string[];
  tf2_warpaint: string | null;
  tf2_sheen: string | null;
  tf2_collection: string | null;
  tf2_grade: string | null;
  tf2_paint_color: string | null;
  tf2_attributes: Tf2Attributes | null;
  tf2_wiki_link: string | null;
  tf2_inspect_link: string | null;
  tf2_type: string | null;
}

export interface LeanListing {
  id: number;
  app_id: number;
  market_hash_name: string;
  price: Cents;
  amount: number;
  commodity: boolean;
  created_at: IsoDateTime;
}

export interface ListingRow extends LeanListing, ItemDetailFields {
  steam_asset_id: string;
  icon_url: string;
  trade_locked_until: IsoDateTime | null;
}

export interface PriceDecayInput {
  start_price: Cents;
  /** Must be below `start_price`. */
  end_price: Cents;
  /** 24 to 168. */
  total_hours: number;
}

export const TRADE_STATUSES = [
  "Invalid",
  "Active",
  "Accepted",
  "Countered",
  "Expired",
  "Canceled",
  "Declined",
  "InvalidItems",
  "CreatedNeedsConfirmation",
  "CanceledBySecondFactor",
  "InEscrow",
  "Reversed",
] as const;

export type TradeStatus = (typeof TRADE_STATUSES)[number];

export type TradeType = "SELL" | "INSTANT_SELL" | "WITHDRAW" | "LEGACY_DEPOSIT" | "LEGACY_WITHDRAW";

export interface TradeItem {
  app_id: number;
  market_hash_name: string;
  steam_asset_id: string;
  amount: number;
  /** Market value at trade time. */
  value: Cents;
}

export interface Trade {
  id: number;
  type: TradeType;
  status: TradeStatus;
  deposit_id: number | null;
  withdraw_id: number | null;
  steam_offer_id: string | null;
  value: Cents;
  error: string | null;
  created_at: IsoDateTime;
  updated_at: IsoDateTime | null;
  items: TradeItem[];
}

export interface BulkResult {
  listing_id: number;
  ok: boolean;
  error: string | null;
}

export interface CachedRead<T> {
  notModified: false;
  etag: string | null;
  data: T;
}

export interface NotModified {
  notModified: true;
  etag: string;
}

export type ConditionalResult<T> = CachedRead<T> | NotModified;

export interface ConditionalParams {
  /** Send the `etag` from a previous read; an unchanged resource answers `notModified`. */
  etag?: string;
}

export interface RateLimitInfo {
  method: string;
  path: string;
  limit: number;
  remaining: number;
  /** Unix milliseconds. */
  resetAt: number | null;
}

export interface RateLimitRule {
  requests: number;
  perMs: number;
}

/** From the reference overview, corrected against live `X-RateLimit-Limit` headers where they disagree. */
export const RATE_LIMITS = {
  "GET /public/v1": { requests: 30, perMs: 60_000 },
  "GET /auth/api-key": { requests: 6, perMs: 60_000 },
  "GET /public/v1/prices/all": { requests: 30, perMs: 60_000 },
  "GET /public/v1/prices": { requests: 60, perMs: 60_000 },
  "GET /public/v1/listings": { requests: 1, perMs: 1_000 },
  "GET /public/v1/listings/:id": { requests: 120, perMs: 60_000 },
  "GET /public/v1/book": { requests: 6, perMs: 60_000 },
  "GET /public/v1/sales": { requests: 1, perMs: 5_000 },
  "GET /public/v1/sales/averages": { requests: 30, perMs: 60_000 },
  "POST /public/v1/purchase": { requests: 30, perMs: 60_000 },
  "GET /public/v1/steam-inventory": { requests: 5, perMs: 60_000 },
  "POST /public/v1/sell": { requests: 30, perMs: 60_000 },
  "POST /public/v1/list": { requests: 30, perMs: 60_000 },
  "PATCH /public/v1/list": { requests: 30, perMs: 60_000 },
  "POST /public/v1/delist": { requests: 30, perMs: 60_000 },
  "GET /public/v1/my-listings": { requests: 60, perMs: 60_000 },
  "GET /public/v1/my-listings/value": { requests: 30, perMs: 60_000 },
  "GET /public/v1/backpack": { requests: 30, perMs: 60_000 },
  "POST /public/v1/deposit": { requests: 30, perMs: 60_000 },
  "GET /public/v1/trades": { requests: 1, perMs: 1_000 },
  "GET /public/v1/user": { requests: 60, perMs: 60_000 },
  "GET /public/v1/orders": { requests: 60, perMs: 60_000 },
  "GET /public/v1/orders/export": { requests: 5, perMs: 60_000 },
  "GET /public/v1/transactions": { requests: 30, perMs: 60_000 },
  "POST /public/v1/crypto-withdraw": { requests: 5, perMs: 60_000 },
  "GET /public/v1/crypto-withdraw/:id": { requests: 30, perMs: 60_000 },
} as const satisfies Record<string, RateLimitRule>;

export interface RequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface TokenLine {
  /** From `selling.steamInventory`; valid 30 minutes and covers at most that row's `amount`. */
  token: string;
  amount: number;
}

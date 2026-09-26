export enum AppId {
  CS2 = 730,
  Rust = 252490,
  Dota2 = 570,
  TF2 = 440,
  SBox = 590830,
}

export enum TradeStatus {
  Invalid = 'Invalid',
  Active = 'Active',
  Accepted = 'Accepted',
  Countered = 'Countered',
  Expired = 'Expired',
  Canceled = 'Canceled',
  Declined = 'Declined',
  InvalidItems = 'InvalidItems',
  CreatedNeedsConfirmation = 'CreatedNeedsConfirmation',
  CanceledBySecondFactor = 'CanceledBySecondFactor',
  InEscrow = 'InEscrow',
  Reversed = 'Reversed',
}

export type TradeType = 'SELL' | 'INSTANT_SELL' | 'WITHDRAW' | 'LEGACY_DEPOSIT' | 'LEGACY_WITHDRAW';

export interface PageMetadata {
  total_pages: number;
  total_items: number;
  current_page: number;
  current_limit: number;
}

export interface PageParams {
  page?: number;
  /** 5, 10, 25, 30, 50 or 100. */
  limit?: number;
}

/** A read made with an ETag: an unchanged resource answers `notModified` and carries no data. */
export type Conditional<T> = { notModified: true; etag: string | undefined } | { notModified: false; etag: string | undefined; data: T };

export interface TradeItem {
  app_id: number;
  market_hash_name: string;
  steam_asset_id: string;
  amount: number;
  /** Market value at trade time, cents. */
  value: number;
}

/** One Steam trade offer. `withdraw_id` ties it to the `withdraw` call that made it. */
export interface Trade {
  id: number;
  type: TradeType;
  status: TradeStatus;
  deposit_id: number | null;
  withdraw_id: number | null;
  /** Set before the offer turns `Active`. */
  steam_offer_id: string | null;
  value: number;
  error: string | null;
  created_at: string;
  updated_at: string | null;
  items: TradeItem[];
}

/** What `GET /book` and the feed carry per listing. Prices are integer US cents. */
export interface LeanListing {
  id: number;
  app_id: number;
  market_hash_name: string;
  price: number;
  amount: number;
  commodity: boolean;
  created_at: string;
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

export interface ListingRow extends LeanListing, ItemDetailFields {
  steam_asset_id: string;
  icon_url: string;
  trade_locked_until: string | null;
}

export interface BulkResult {
  listing_id: number;
  ok: boolean;
  error: string | null;
}

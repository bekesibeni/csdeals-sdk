import type { PurchaseResult } from '../modules/trading/types.js';

/** The `error` codes cs.deals documents. The wire spells the auth one the British way. */
export enum CsDealsErrorCode {
  ListingPriceChanged = 'LISTING_PRICE_CHANGED',
  ListingOutOfStock = 'LISTING_OUT_OF_STOCK',
  ListingNotActive = 'LISTING_NOT_ACTIVE',
  ListingNotFound = 'LISTING_NOT_FOUND',
  InsufficientBalance = 'INSUFFICIENT_BALANCE',
  PurchaseOwnListing = 'PURCHASE_OWN_LISTING',
  PurchasingDisabled = 'PURCHASING_DISABLED',
  TradeUrlNotSet = 'TRADE_URL_NOT_SET',
  SteamIdNotSet = 'STEAM_ID_NOT_SET',
  ItemNotOwned = 'ITEM_NOT_OWNED',
  InsufficientItemAmount = 'INSUFFICIENT_ITEM_AMOUNT',
  InsufficientItems = 'INSUFFICIENT_ITEMS',
  ItemTradeLocked = 'ITEM_TRADE_LOCKED',
  ActiveTradeLimit = 'ACTIVE_TRADE_LIMIT',
  WithdrawItemLimit = 'WITHDRAW_ITEM_LIMIT',
  DepositItemLimit = 'DEPOSIT_ITEM_LIMIT',
  BotUnavailable = 'BOT_UNAVAILABLE',
  TradingWithdrawDisabled = 'TRADING_WITHDRAW_DISABLED',
  WithdrawLimitExceeded = 'WITHDRAW_LIMIT_EXCEEDED',
  WithdrawDailyLimitExceeded = 'WITHDRAW_DAILY_LIMIT_EXCEEDED',
  WithdrawDisabled = 'WITHDRAW_DISABLED',
  ListingLimitReached = 'LISTING_LIMIT_REACHED',
  ListingDisabled = 'LISTING_DISABLED',
  MaintenanceMode = 'MAINTENANCE_MODE',
  InvalidWebhookUrl = 'INVALID_WEBHOOK_URL',
  RateLimited = 'RATE_LIMITED',
  Unauthorised = 'UNAUTHORISED',
}

interface ErrorBody {
  error?: unknown;
  message?: unknown;
  data?: unknown;
}

export class CsDealsApiError extends Error {
  readonly status: number;
  /** The `error` field, e.g. `LISTING_PRICE_CHANGED`. Compare against `CsDealsErrorCode`. */
  readonly code: string | null;
  /** Detail such as `listing_ids` on a lost purchase race. */
  readonly data: Record<string, unknown> | null;
  readonly body: unknown;
  /** Seconds from the `Retry-After` header, when the response carried one (429s do). */
  readonly retryAfterSec: number | null;

  constructor(status: number, body: unknown, retryAfterSec: number | null = null) {
    const parsed = (typeof body === 'object' && body !== null ? body : {}) as ErrorBody;
    const code = typeof parsed.error === 'string' ? parsed.error : null;
    super(`cs.deals request failed: ${status}${code ? ` ${code}` : ''}`);
    this.name = 'CsDealsApiError';
    this.status = status;
    this.code = code;
    this.data = typeof parsed.data === 'object' && parsed.data !== null ? (parsed.data as Record<string, unknown>) : null;
    this.body = body;
    this.retryAfterSec = retryAfterSec;
  }

  get isRateLimited(): boolean {
    return this.status === 429;
  }

  get isRetryable(): boolean {
    return this.status === 408 || this.status === 429 || this.status >= 500;
  }
}

/**
 * A purchase answered 200 but charged above the request's ceilings or delivered a different number
 * of copies. The order stands and the money moved: reconcile it, never buy again.
 */
export class PurchaseMismatchError extends Error {
  readonly order: PurchaseResult;

  constructor(order: PurchaseResult) {
    super(`cs.deals order ${order.order_id} does not match the purchase request`);
    this.name = 'PurchaseMismatchError';
    this.order = order;
  }
}

/** The feed closed with 4401: the key is missing or revoked. Terminal. */
export class CsDealsAuthError extends Error {
  constructor() {
    super('cs.deals rejected the API key on the feed socket (4401)');
    this.name = 'CsDealsAuthError';
  }
}

export const CSDEALS_ERROR_CODE = {
  LISTING_PRICE_CHANGED: "LISTING_PRICE_CHANGED",
  LISTING_OUT_OF_STOCK: "LISTING_OUT_OF_STOCK",
  LISTING_NOT_ACTIVE: "LISTING_NOT_ACTIVE",
  LISTING_NOT_FOUND: "LISTING_NOT_FOUND",
  INSUFFICIENT_BALANCE: "INSUFFICIENT_BALANCE",
  PURCHASE_OWN_LISTING: "PURCHASE_OWN_LISTING",
  PURCHASING_DISABLED: "PURCHASING_DISABLED",
  TRADE_URL_NOT_SET: "TRADE_URL_NOT_SET",
  STEAM_ID_NOT_SET: "STEAM_ID_NOT_SET",
  ITEM_NOT_OWNED: "ITEM_NOT_OWNED",
  INSUFFICIENT_ITEM_AMOUNT: "INSUFFICIENT_ITEM_AMOUNT",
  INSUFFICIENT_ITEMS: "INSUFFICIENT_ITEMS",
  ITEM_TRADE_LOCKED: "ITEM_TRADE_LOCKED",
  ACTIVE_TRADE_LIMIT: "ACTIVE_TRADE_LIMIT",
  WITHDRAW_ITEM_LIMIT: "WITHDRAW_ITEM_LIMIT",
  DEPOSIT_ITEM_LIMIT: "DEPOSIT_ITEM_LIMIT",
  BOT_UNAVAILABLE: "BOT_UNAVAILABLE",
  TRADING_WITHDRAW_DISABLED: "TRADING_WITHDRAW_DISABLED",
  WITHDRAW_LIMIT_EXCEEDED: "WITHDRAW_LIMIT_EXCEEDED",
  WITHDRAW_DAILY_LIMIT_EXCEEDED: "WITHDRAW_DAILY_LIMIT_EXCEEDED",
  WITHDRAW_DISABLED: "WITHDRAW_DISABLED",
  LISTING_LIMIT_REACHED: "LISTING_LIMIT_REACHED",
  INVALID_WEBHOOK_URL: "INVALID_WEBHOOK_URL",
  RATE_LIMITED: "RATE_LIMITED",
  // The wire spells it the British way; we fold it onto the synthetic key.
  UNAUTHORISED: "UNAUTHORIZED",
} as const satisfies Record<string, string>;

export type CsDealsCodedKey = (typeof CSDEALS_ERROR_CODE)[keyof typeof CSDEALS_ERROR_CODE];

export type CsDealsSyntheticKey =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "TIMEOUT"
  | "NETWORK_ERROR"
  | "INVALID_RESPONSE"
  | "INVALID_REQUEST"
  | "NOT_CONFIGURED"
  | "UNKNOWN";

export type CsDealsErrorKey = CsDealsCodedKey | CsDealsSyntheticKey;

export interface CsDealsErrorInit {
  key: CsDealsErrorKey;
  status: number;
  message?: string;
  providerCode?: string | null;
  data?: Record<string, unknown> | null;
  retryAfterMs?: number | null;
  method?: string | null;
  path?: string | null;
}

export class CsDealsError extends Error {
  readonly key: CsDealsErrorKey;
  readonly status: number;
  /** The raw `error` string as received, also for codes this SDK does not know yet. */
  readonly providerCode: string | null;
  /** The provider's `data` detail, e.g. `listing_ids` or `itemIds`. */
  readonly data: Record<string, unknown> | null;
  readonly retryAfterMs: number | null;
  readonly method: string | null;
  readonly path: string | null;

  constructor(init: CsDealsErrorInit) {
    super(init.message ?? init.providerCode ?? init.key);
    this.name = "CsDealsError";
    this.key = init.key;
    this.status = init.status;
    this.providerCode = init.providerCode ?? null;
    this.data = init.data ?? null;
    this.retryAfterMs = init.retryAfterMs ?? null;
    this.method = init.method ?? null;
    this.path = init.path ?? null;
  }

  get retryable(): boolean {
    if (this.key === "TIMEOUT" || this.key === "NETWORK_ERROR" || this.key === "RATE_LIMITED") {
      return true;
    }
    if (this.key === "PURCHASING_DISABLED" || this.key === "TRADING_WITHDRAW_DISABLED") return true;
    return this.status === 408 || this.status >= 500;
  }

  /**
   * True when a write may have landed despite the error. cs.deals has no idempotency key, so
   * read the outcome back (orders, trades, transactions) instead of resending.
   */
  get ambiguous(): boolean {
    if (this.method === null || this.method === "GET") return false;
    if (this.key === "TIMEOUT" || this.key === "NETWORK_ERROR" || this.status >= 500) return true;
    return this.key === "INVALID_RESPONSE" && this.status >= 200 && this.status < 300;
  }
}

export function isError(err: unknown, key: CsDealsErrorKey): err is CsDealsError {
  return err instanceof CsDealsError && err.key === key;
}

export function isAuthError(err: unknown): err is CsDealsError {
  return err instanceof CsDealsError && (err.key === "UNAUTHORIZED" || err.key === "FORBIDDEN");
}

export function isRateLimited(err: unknown): err is CsDealsError {
  return isError(err, "RATE_LIMITED");
}

export function isNotFound(err: unknown): err is CsDealsError {
  return err instanceof CsDealsError && (err.key === "NOT_FOUND" || err.key === "LISTING_NOT_FOUND");
}

export function keyForCode(code: unknown): CsDealsErrorKey {
  if (typeof code !== "string" || code.length === 0) return "UNKNOWN";
  const normalized = code.trim().toUpperCase();
  return (CSDEALS_ERROR_CODE as Record<string, CsDealsCodedKey>)[normalized] ?? "UNKNOWN";
}

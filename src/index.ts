export { CsDealsSDK, type CsDealsSDKOptions } from "./csdeals.js";
export {
  type CallOptions,
  CsDealsClient,
  type CsDealsClientOptions,
  DEFAULT_BASE_URL,
  type HttpMethod,
  type Query,
  SDK_VERSION,
} from "./core/client.js";
export {
  CSDEALS_ERROR_CODE,
  type CsDealsCodedKey,
  CsDealsError,
  type CsDealsErrorKey,
  type CsDealsSyntheticKey,
  isAuthError,
  isError,
  isNotFound,
  isRateLimited,
  keyForCode,
} from "./core/errors.js";
export { formatUsdCents, parseUsdCents } from "./core/money.js";
export { type IterateOptions, iterateCursor, iteratePages } from "./core/paginate.js";
export {
  MAX_ACTIVE_TRADES,
  MAX_COPIES_PER_OFFER,
  MAX_LINES_PER_REQUEST,
  MAX_PURCHASE_AMOUNT,
  PRICE_DECAY_MAX_HOURS,
  PRICE_DECAY_MIN_HOURS,
} from "./core/validate.js";

export * from "./core/types.js";

export { initMarketModule } from "./modules/market/index.js";
export * from "./modules/market/types.js";

export { initTradingModule } from "./modules/trading/index.js";
export * from "./modules/trading/types.js";

export { initSellingModule } from "./modules/selling/index.js";
export * from "./modules/selling/types.js";

export { initAccountModule } from "./modules/account/index.js";
export * from "./modules/account/types.js";

export {
  ATTEMPT_HEADER,
  DELIVERY_HEADER,
  EVENT_HEADER,
  parseWebhook,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  verifyWebhook,
  verifyWebhookSignature,
  WEBHOOK_SOURCE_IPS,
  WEBHOOK_TOLERANCE_SECONDS,
} from "./modules/webhooks/index.js";
export * from "./modules/webhooks/types.js";

export { CsDealsFeed, LiveBook, type LiveBookOptions } from "./modules/feed/index.js";
export * from "./modules/feed/types.js";

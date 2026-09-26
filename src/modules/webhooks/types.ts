import type { Trade } from '../../core/types.js';

export type WebhookHeaders = Record<string, string | string[] | undefined> | Headers;

/**
 * A delivery body. `id` is stable across retries and inside the signed bytes, so dedupe on it rather
 * than on the unsigned `X-CSDeals-Delivery` header. Deliveries are unordered.
 */
export interface WebhookDelivery {
  id: string;
  /** Currently always `trade.updated`. */
  event: string;
  ts: string;
  /** Exactly a `trading.getTrades()` row. Apply it only if its `updated_at` beats the one you hold. */
  data: Trade;
}

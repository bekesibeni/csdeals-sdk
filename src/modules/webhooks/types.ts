import type { IsoDateTime, Trade } from "../../core/types.js";

export type WebhookHeaders = Record<string, string | string[] | undefined> | Headers;

export type KnownWebhookEvent = "trade.updated";

export interface WebhookEnvelope<T = unknown> {
  /** Delivery id (UUID); matches `X-CSDeals-Delivery` and is stable across retries. */
  id: string;
  event: string;
  ts: IsoDateTime;
  data: T;
}

export interface VerifiedWebhook {
  /** Dedupe on this: a retry reuses it. */
  deliveryId: string;
  event: string;
  /** 1 on the first try. */
  attempt: number;
  /** Unix seconds the signature was made at. */
  timestamp: number;
  ts: IsoDateTime | null;
  /** Set for `trade.updated`. Apply only if its `updated_at` beats what you hold for that trade id. */
  trade: Trade | null;
  raw: WebhookEnvelope;
}

export interface VerifySignatureInput {
  /** The raw received bytes. A re-serialised body will not verify. */
  rawBody: string | Uint8Array;
  signature: string | null | undefined;
  timestamp: string | null | undefined;
  /** The whole `whsec_...` string, used as the HMAC key as-is. */
  secret: string;
  /** Injectable clock, unix seconds. */
  nowSeconds?: number;
  toleranceSeconds?: number;
}

export interface VerifyWebhookOptions {
  secret: string;
  nowSeconds?: number;
  toleranceSeconds?: number;
}

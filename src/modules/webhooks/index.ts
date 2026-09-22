import { createHmac, timingSafeEqual } from "node:crypto";
import { isRecord } from "../../core/client.js";
import { CsDealsError } from "../../core/errors.js";
import type { Trade } from "../../core/types.js";
import type {
  VerifiedWebhook,
  VerifySignatureInput,
  VerifyWebhookOptions,
  WebhookEnvelope,
  WebhookHeaders,
} from "./types.js";

export const WEBHOOK_TOLERANCE_SECONDS = 300;

export const SIGNATURE_HEADER = "x-csdeals-signature";
export const TIMESTAMP_HEADER = "x-csdeals-timestamp";
export const DELIVERY_HEADER = "x-csdeals-delivery";
export const EVENT_HEADER = "x-csdeals-event";
export const ATTEMPT_HEADER = "x-csdeals-attempt";

/** An allowlist is a first filter, not authentication: verify the signature regardless. */
export const WEBHOOK_SOURCE_IPS = ["45.38.124.18", "92.113.180.106", "167.17.48.70"] as const;

function header(headers: WebhookHeaders, name: string): string | undefined {
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name) return Array.isArray(value) ? value[0] : value;
  }
  return undefined;
}

function toBuffer(body: string | Uint8Array): Buffer {
  return typeof body === "string" ? Buffer.from(body, "utf8") : Buffer.from(body.buffer, body.byteOffset, body.byteLength);
}

/** `X-CSDeals-Signature: sha256=hex(HMAC_SHA256(secret, "<timestamp>.<raw body>"))`, constant time, 300s window. */
export function verifyWebhookSignature(input: VerifySignatureInput): boolean {
  const signature = input.signature?.trim() ?? "";
  const timestamp = input.timestamp?.trim() ?? "";
  if (!input.secret || !/^\d{1,12}$/.test(timestamp)) return false;
  const match = /^sha256=([a-fA-F0-9]{64})$/.exec(signature);
  if (!match?.[1]) return false;

  const ts = Number(timestamp);
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1_000);
  if (Math.abs(now - ts) > (input.toleranceSeconds ?? WEBHOOK_TOLERANCE_SECONDS)) return false;

  const expected = createHmac("sha256", input.secret)
    .update(`${timestamp}.`)
    .update(toBuffer(input.rawBody))
    .digest();
  const received = Buffer.from(match[1], "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

function invalid(message: string): CsDealsError {
  return new CsDealsError({ key: "INVALID_RESPONSE", status: 400, message });
}

/** Parses a delivery body. Unknown events pass through with `trade: null` instead of failing. */
export function parseWebhook(value: unknown): { envelope: WebhookEnvelope; trade: Trade | null } {
  if (!isRecord(value)) throw invalid("Webhook body was not an object");
  if (typeof value.id !== "string" || !value.id) throw invalid("Webhook has no delivery id");
  if (typeof value.event !== "string" || !value.event) throw invalid("Webhook has no event");
  const envelope: WebhookEnvelope = {
    id: value.id,
    event: value.event,
    ts: typeof value.ts === "string" ? value.ts : "",
    data: value.data,
  };
  if (envelope.event !== "trade.updated") return { envelope, trade: null };

  const data = value.data;
  if (
    !isRecord(data) ||
    typeof data.id !== "number" ||
    typeof data.status !== "string" ||
    typeof data.type !== "string" ||
    !Array.isArray(data.items)
  ) {
    throw invalid("trade.updated carried no trade row");
  }
  return { envelope, trade: data as unknown as Trade };
}

/**
 * Verifies the signature, then parses. Treat the result as a wake-up: dedupe on `deliveryId`,
 * apply a trade only when its `updated_at` is newer than yours, and keep `trading.trades()` as
 * the source of truth.
 */
export function verifyWebhook(
  rawBody: string | Uint8Array,
  headers: WebhookHeaders,
  options: VerifyWebhookOptions,
): VerifiedWebhook {
  const timestamp = header(headers, TIMESTAMP_HEADER);
  const ok = verifyWebhookSignature({
    rawBody,
    signature: header(headers, SIGNATURE_HEADER),
    timestamp,
    secret: options.secret,
    nowSeconds: options.nowSeconds,
    toleranceSeconds: options.toleranceSeconds,
  });
  if (!ok) {
    throw new CsDealsError({ key: "UNAUTHORIZED", status: 401, message: "Webhook signature verification failed" });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(toBuffer(rawBody).toString("utf8"));
  } catch {
    throw invalid("Webhook body was not valid JSON");
  }
  const { envelope, trade } = parseWebhook(parsed);
  const deliveryHeader = header(headers, DELIVERY_HEADER);
  const attempt = Number(header(headers, ATTEMPT_HEADER) ?? "1");

  return {
    deliveryId: deliveryHeader || envelope.id,
    event: envelope.event,
    attempt: Number.isSafeInteger(attempt) && attempt > 0 ? attempt : 1,
    timestamp: Number(timestamp),
    ts: envelope.ts || null,
    trade,
    raw: envelope,
  };
}

export * from "./types.js";

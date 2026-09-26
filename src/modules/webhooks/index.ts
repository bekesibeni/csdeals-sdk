import { createHmac, timingSafeEqual } from 'node:crypto';
import type { WebhookDelivery, WebhookHeaders } from './types.js';

export const WEBHOOK_TOLERANCE_SECONDS = 300;

/** The sending addresses. A filter, not authentication: verify the signature regardless. */
export const WEBHOOK_SOURCE_IPS = ['45.38.124.18', '92.113.180.106', '167.17.48.70'] as const;

function header(headers: WebhookHeaders, name: string): string | undefined {
  if (headers instanceof Headers) return headers.get(name) ?? undefined;
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === name) return Array.isArray(value) ? value[0] : value;
  }
  return undefined;
}

/**
 * `X-CSDeals-Signature: sha256=hex(HMAC_SHA256(secret, "<X-CSDeals-Timestamp>.<raw body>"))`, with the
 * whole `whsec_...` string as the key. Pass the raw bytes: a re-serialised body will not verify.
 */
export function verifyWebhookSignature(
  rawBody: string | Buffer,
  headers: WebhookHeaders,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  const timestamp = header(headers, 'x-csdeals-timestamp')?.trim() ?? '';
  const match = /^sha256=([a-f0-9]{64})$/i.exec(header(headers, 'x-csdeals-signature')?.trim() ?? '');
  if (!secret || !match?.[1] || !/^\d{1,12}$/.test(timestamp)) return false;
  if (Math.abs(nowSeconds - Number(timestamp)) > WEBHOOK_TOLERANCE_SECONDS) return false;

  const expected = createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest();
  const received = Buffer.from(match[1], 'hex');
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export function parseWebhook(rawBody: string | Buffer): WebhookDelivery {
  return JSON.parse(typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8')) as WebhookDelivery;
}

export function initWebhooksModule(secret: string | undefined) {
  const requireSecret = (): string => {
    if (!secret) throw new Error('CsDealsSDK: webhookSecret is required to verify webhooks');
    return secret;
  };

  return {
    verify: (rawBody: string | Buffer, headers: WebhookHeaders, nowSeconds?: number): boolean =>
      verifyWebhookSignature(rawBody, headers, requireSecret(), nowSeconds),
    parse: parseWebhook,
  };
}

export * from './types.js';

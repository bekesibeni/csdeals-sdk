import { describe, expect, it } from "vitest";
import { CsDealsError, CsDealsSDK, verifyWebhook, verifyWebhookSignature } from "../src/index.js";

// Deliveries are the trigger for crediting a finished trade. A forged, tampered or replayed one
// that verifies would settle a trade that never happened, so every rejection below guards money.

const SECRET = "whsec_test_0123456789abcdef";
const TS = "1755083061";
const BODY =
  '{"id":"0f4dc9a1-1a2b-4c3d-9e8f-2b7c6d5e4f3a","event":"trade.updated","ts":"2026-08-13T11:04:21.000Z","data":{"id":91422,"type":"WITHDRAW","status":"Accepted","deposit_id":null,"withdraw_id":5512,"steam_offer_id":"7654321098","value":42500,"error":null,"created_at":"2026-08-13T11:01:02.000Z","updated_at":"2026-08-13T11:04:21.000Z","items":[{"app_id":730,"market_hash_name":"AK-47 | Redline (Field-Tested)","steam_asset_id":"38472910384","amount":1,"value":42500}]}}';
// Computed outside this codebase: printf '%s' "$TS.$BODY" | openssl dgst -sha256 -hmac "$SECRET"
const SIGNATURE = "sha256=bf1c3ee4856ef27c38115c009904130859e9bfdb10e0463486d62837a791e3f3";
const NOW = Number(TS) + 10;

function headers(overrides: Record<string, string> = {}) {
  return {
    "X-CSDeals-Signature": SIGNATURE,
    "X-CSDeals-Timestamp": TS,
    "X-CSDeals-Delivery": "0f4dc9a1-1a2b-4c3d-9e8f-2b7c6d5e4f3a",
    "X-CSDeals-Event": "trade.updated",
    "X-CSDeals-Attempt": "2",
    ...overrides,
  };
}

function check(overrides: Partial<Parameters<typeof verifyWebhookSignature>[0]> = {}) {
  return verifyWebhookSignature({
    rawBody: BODY,
    signature: SIGNATURE,
    timestamp: TS,
    secret: SECRET,
    nowSeconds: NOW,
    ...overrides,
  });
}

describe("webhook signature", () => {
  it("accepts the documented scheme: full whsec_ secret as the key over `<ts>.<raw body>`", () => {
    expect(check()).toBe(true);
    expect(check({ rawBody: new TextEncoder().encode(BODY) })).toBe(true);
  });

  it("rejects a tampered body", () => {
    expect(check({ rawBody: BODY.replace("42500", "92500") })).toBe(false);
  });

  it("rejects a re-serialised body, which is why the raw bytes must be passed", () => {
    expect(check({ rawBody: JSON.stringify(JSON.parse(BODY), null, 2) })).toBe(false);
  });

  it("rejects the wrong secret, including the secret with its whsec_ prefix stripped", () => {
    expect(check({ secret: "whsec_other" })).toBe(false);
    expect(check({ secret: SECRET.slice("whsec_".length) })).toBe(false);
  });

  it("rejects a replay outside the 300 second window, in either direction", () => {
    expect(check({ nowSeconds: Number(TS) + 301 })).toBe(false);
    expect(check({ nowSeconds: Number(TS) - 301 })).toBe(false);
  });

  it("rejects a moved timestamp, since it is inside the signed string", () => {
    expect(check({ timestamp: String(Number(TS) + 1), nowSeconds: Number(TS) })).toBe(false);
  });

  it("rejects a signature without the sha256= prefix", () => {
    expect(check({ signature: SIGNATURE.slice("sha256=".length) })).toBe(false);
  });
});

describe("verifyWebhook", () => {
  it("returns the trade row and the delivery id to dedupe on", () => {
    const out = verifyWebhook(BODY, headers(), { secret: SECRET, nowSeconds: NOW });
    expect(out.deliveryId).toBe("0f4dc9a1-1a2b-4c3d-9e8f-2b7c6d5e4f3a");
    expect(out.attempt).toBe(2);
    expect(out.trade?.withdraw_id).toBe(5512);
    expect(out.trade?.status).toBe("Accepted");
  });

  it("reads lower-case, array and Headers-object header forms", () => {
    const lower = Object.fromEntries(Object.entries(headers()).map(([k, v]) => [k.toLowerCase(), [v]]));
    expect(verifyWebhook(BODY, lower, { secret: SECRET, nowSeconds: NOW }).trade?.id).toBe(91422);
    expect(verifyWebhook(BODY, new Headers(headers()), { secret: SECRET, nowSeconds: NOW }).trade?.id).toBe(91422);
  });

  it("throws UNAUTHORIZED on a bad signature rather than returning a parsed body", () => {
    expect(() => verifyWebhook(BODY, headers({ "X-CSDeals-Signature": `sha256=${"0".repeat(64)}` }), { secret: SECRET, nowSeconds: NOW })).toThrow(
      expect.objectContaining({ key: "UNAUTHORIZED" }),
    );
  });

  it("refuses to verify without a configured secret", () => {
    const sdk = new CsDealsSDK({ apiKey: "csd_x" });
    expect(() => sdk.verifyWebhook(BODY, headers())).toThrow(CsDealsError);
  });
});

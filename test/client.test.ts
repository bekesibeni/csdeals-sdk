import { describe, expect, it } from "vitest";
import { CsDealsError, CsDealsSDK } from "../src/index.js";
import { hangUntilAborted, json, KEY, PAGE, sdkWith } from "./helpers.js";

const PURCHASE = { items: [{ listing_id: 12345, amount: 1, max_price: 4250 }] };

async function caught(promise: Promise<unknown>): Promise<CsDealsError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(CsDealsError);
    return err as CsDealsError;
  }
  throw new Error("expected a rejection");
}

describe("writes are sent exactly once", () => {
  // cs.deals has no idempotency key. A resent purchase buys twice, a resent withdraw or crypto
  // cashout moves value twice, so the transport must never retry a write, whatever the error.
  it("does not resend a purchase that answered 503, and flags it ambiguous", async () => {
    const { sdk, calls } = sdkWith(() => json({ error: "INTERNAL" }, 503), { maxRetries: 5 });
    const err = await caught(sdk.trading.purchase(PURCHASE));
    expect(calls).toHaveLength(1);
    expect(err.status).toBe(503);
    expect(err.ambiguous).toBe(true);
  });

  it("does not resend a withdraw that timed out, and flags it ambiguous", async () => {
    const { sdk, calls } = sdkWith(hangUntilAborted, { maxRetries: 5, timeoutMs: 20 });
    const err = await caught(sdk.trading.withdraw({ items: [{ id: 77, amount: 1 }] }));
    expect(calls).toHaveLength(1);
    expect(err.key).toBe("TIMEOUT");
    expect(err.ambiguous).toBe(true);
  });

  it("does not resend a crypto withdrawal whose socket dropped", async () => {
    const { sdk, calls } = sdkWith(
      () => {
        throw new TypeError("fetch failed");
      },
      { maxRetries: 5 },
    );
    const err = await caught(
      sdk.account.cryptoWithdraw({ amount: 10_000, ticker: "USDC", address: "0xabc" }),
    );
    expect(calls).toHaveLength(1);
    expect(err.key).toBe("NETWORK_ERROR");
    expect(err.ambiguous).toBe(true);
  });

  it("calls a 2xx write with an unreadable body ambiguous, since the money already moved", async () => {
    const { sdk } = sdkWith(() => new Response("<html>ok</html>", { status: 200 }));
    const err = await caught(sdk.trading.purchase(PURCHASE));
    expect(err.key).toBe("INVALID_RESPONSE");
    expect(err.ambiguous).toBe(true);
  });

  it("does not call a business rejection ambiguous: nothing moved and a retry decision is safe", async () => {
    const { sdk } = sdkWith(() => json({ error: "INSUFFICIENT_BALANCE" }, 400));
    const err = await caught(sdk.trading.purchase(PURCHASE));
    expect(err.key).toBe("INSUFFICIENT_BALANCE");
    expect(err.ambiguous).toBe(false);
  });
});

describe("reads retry within bounds", () => {
  // A bot that gives up on the first 429 stalls its whole loop; one that retries forever
  // hammers a per-second meter and gets the key flagged.
  it("retries a 429 read after Retry-After and returns the later answer", async () => {
    let n = 0;
    const { sdk, calls } = sdkWith(
      () => (n++ === 0 ? json({ error: "RATE_LIMITED" }, 429, { "retry-after": "0" }) : json({ id: 1, steam_id: null, name: "x", balance: 5 })),
      { maxRetries: 2 },
    );
    const user = await sdk.account.user();
    expect(user.balance).toBe(5);
    expect(calls).toHaveLength(2);
  });

  it("stops after maxRetries", async () => {
    const { sdk, calls } = sdkWith(() => json({ error: "RATE_LIMITED" }, 429, { "retry-after": "0" }), {
      maxRetries: 2,
    });
    const err = await caught(sdk.account.user());
    expect(err.key).toBe("RATE_LIMITED");
    expect(calls).toHaveLength(3);
  });

  it("hands a long Retry-After back to the caller instead of sleeping through it", async () => {
    const { sdk, calls } = sdkWith(() => json({ error: "RATE_LIMITED" }, 429, { "retry-after": "60" }), {
      maxRetries: 3,
    });
    const err = await caught(sdk.account.user());
    expect(calls).toHaveLength(1);
    expect(err.retryAfterMs).toBe(60_000);
  });
});

describe("error mapping", () => {
  // Callers branch on `key`; a mis-mapped code turns "someone outbid you" into "retry the buy".
  it("keeps the provider's data so the caller knows which listings failed", async () => {
    const { sdk } = sdkWith(() => json({ error: "LISTING_PRICE_CHANGED", data: { listing_ids: [12345] } }, 409));
    const err = await caught(sdk.trading.purchase(PURCHASE));
    expect(err.key).toBe("LISTING_PRICE_CHANGED");
    expect(err.data).toEqual({ listing_ids: [12345] });
  });

  it("folds the wire's UNAUTHORISED onto UNAUTHORIZED and keeps the raw code", async () => {
    const { sdk } = sdkWith(() => json({ error: "UNAUTHORISED" }, 401));
    const err = await caught(sdk.account.user());
    expect(err.key).toBe("UNAUTHORIZED");
    expect(err.providerCode).toBe("UNAUTHORISED");
  });

  it("verifyKey answers false for a dead key instead of throwing", async () => {
    const { sdk } = sdkWith(() => json({ error: "UNAUTHORISED" }, 401));
    expect(await sdk.account.verifyKey()).toBe(false);
  });

  it("keeps an unknown code verbatim and falls back to the status for the key", async () => {
    const { sdk } = sdkWith(() => json({ error: "SOMETHING_NEW" }, 404));
    const err = await caught(sdk.account.cryptoWithdrawal(9));
    expect(err.key).toBe("NOT_FOUND");
    expect(err.providerCode).toBe("SOMETHING_NEW");
  });
});

describe("transport", () => {
  it("sends the bearer key, and query values as strings with unset ones dropped", async () => {
    const { sdk, calls } = sdkWith(() => json({ trades: [], metadata: PAGE }));
    await sdk.trading.trades({ limit: 500 });
    const call = calls[0]!;
    expect(call.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(call.url.pathname).toBe("/public/v1/trades");
    expect(Object.fromEntries(call.url.searchParams)).toEqual({ page: "1", limit: "500" });
  });

  it("never follows a redirect, which would forward the bearer key to another host", async () => {
    const { sdk, calls } = sdkWith(() => json({ id: 1, steam_id: null, name: "x", balance: 0 }));
    await sdk.account.user();
    expect(calls[0]!.init.redirect).toBe("error");
  });

  it("refuses a non-https base URL so the key never travels in cleartext", () => {
    expect(() => new CsDealsSDK({ apiKey: KEY, baseUrl: "http://api.cs.deals" })).toThrow(CsDealsError);
    expect(() => new CsDealsSDK({ apiKey: " " })).toThrow(CsDealsError);
  });

  it("answers notModified on a 304 and sends the etag back", async () => {
    const { sdk, calls } = sdkWith(() => new Response(null, { status: 304, headers: { etag: 'W/"a"' } }));
    const result = await sdk.market.pricesAll({ etag: 'W/"a"' });
    expect(result.notModified).toBe(true);
    expect(calls[0]!.headers["if-none-match"]).toBe('W/"a"');
  });
});

import { describe, expect, it } from "vitest";
import { CsDealsError, type ListingRow } from "../src/index.js";
import { json, PAGE, sdkWith } from "./helpers.js";

function noNetwork() {
  return sdkWith(() => {
    throw new Error("the request should have been refused before the network");
  });
}

async function refused(promise: Promise<unknown>): Promise<CsDealsError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(CsDealsError);
    expect((err as CsDealsError).key).toBe("INVALID_REQUEST");
    return err as CsDealsError;
  }
  throw new Error("expected INVALID_REQUEST");
}

describe("purchase", () => {
  it("sends max_price as the integer cents given, with nothing added", async () => {
    // max_price is the only thing standing between a stale quote and an overpay.
    const { sdk, calls } = sdkWith(() => json({ order_id: 1, created_at: "", items: [] }));
    await sdk.trading.purchase({ items: [{ listing_id: 12345, amount: 2, max_price: 4250 }] });
    expect(calls[0]!.body).toEqual({ items: [{ listing_id: 12345, amount: 2, max_price: 4250 }] });
  });

  it("refuses a fractional max_price before the network: dollars passed where cents belong", async () => {
    // 42.5 as "cents" means the caller converted wrong; a server that rounds it would buy at
    // a hundredth of the intended ceiling or, the other way round, a hundred times over it.
    const { sdk, calls } = noNetwork();
    await refused(sdk.trading.purchase({ items: [{ listing_id: 1, amount: 1, max_price: 42.5 }] }));
    expect(calls).toHaveLength(0);
  });

  it("refuses more than 50 lines and a zero amount before spending a rate-limited call", async () => {
    const { sdk, calls } = noNetwork();
    const line = { listing_id: 1, amount: 1, max_price: 100 };
    await refused(sdk.trading.purchase({ items: Array.from({ length: 51 }, () => line) }));
    await refused(sdk.trading.purchase({ items: [{ ...line, amount: 0 }] }));
    expect(calls).toHaveLength(0);
  });
});

describe("withdrawals", () => {
  it("refuses a malformed 2FA token instead of sending it", async () => {
    const { sdk, calls } = noNetwork();
    await refused(sdk.trading.withdraw({ items: [{ id: 1, amount: 1 }], two_factor_auth_token: "12345" }));
    await refused(sdk.account.cryptoWithdraw({ amount: 100, ticker: "BTC", address: "bc1", two_factor_auth_token: "abcdef" }));
    expect(calls).toHaveLength(0);
  });
});

describe("listing edits", () => {
  // `amount` together with `price` splits a listing; `amount` alone returns stock to the
  // backpack. A price-only edit that leaked an `amount` key would silently pull items off sale.
  it("sends a price-only edit without an amount key", async () => {
    const { sdk, calls } = sdkWith(() => json({ id: 55120 }));
    await sdk.selling.editListing({ listing_id: 55120, price: 3990 });
    expect(calls[0]!.method).toBe("PATCH");
    expect(calls[0]!.body).toEqual({ listing_id: 55120, price: 3990 });
  });

  it("sends the bulk shape for editListings and delistMany, the single shape otherwise", async () => {
    const { sdk, calls } = sdkWith(() => json({ results: [] }));
    await sdk.selling.editListings([{ listing_id: 1, price: 10 }, { listing_id: 2, amount: 3 }]);
    await sdk.selling.delist(7);
    await sdk.selling.delistMany([7, 8]);
    expect(calls.map((c) => c.body)).toEqual([
      { listings: [{ listing_id: 1, price: 10 }, { listing_id: 2, amount: 3 }] },
      { listing_id: 7 },
      { listing_ids: [7, 8] },
    ]);
  });

  it("refuses an edit that names no change, and price with price_decay together", async () => {
    const { sdk, calls } = noNetwork();
    await refused(sdk.selling.editListing({ listing_id: 1 }));
    await refused(
      sdk.selling.editListing({
        listing_id: 1,
        price: 10,
        price_decay: { start_price: 20, end_price: 10, total_hours: 48 },
      }),
    );
    expect(calls).toHaveLength(0);
  });

  it("refuses a price decay that rises or runs outside 24-168 hours", async () => {
    const { sdk, calls } = noNetwork();
    const items = [{ id: 1, amount: 1 }];
    await refused(sdk.selling.list({ listings: [{ items, price_decay: { start_price: 10, end_price: 20, total_hours: 48 } }] }));
    await refused(sdk.selling.list({ listings: [{ items, price_decay: { start_price: 20, end_price: 10, total_hours: 12 } }] }));
    expect(calls).toHaveLength(0);
  });
});

describe("paging", () => {
  it("walks listings by cursor and stops when next_cursor is null", async () => {
    const row = (id: number) => ({ id }) as ListingRow;
    const { sdk, calls } = sdkWith((call) => {
      const cursor = call.url.searchParams.get("cursor");
      return cursor === null
        ? json({ listings: [row(3), row(2)], next_cursor: 2, metadata: PAGE })
        : json({ listings: [row(1)], next_cursor: null, metadata: PAGE });
    });
    const ids: number[] = [];
    for await (const listing of sdk.market.iterateListings({ app_id: 730 }, { minIntervalMs: 0 })) ids.push(listing.id);
    expect(ids).toEqual([3, 2, 1]);
    expect(calls.map((c) => c.url.searchParams.get("cursor"))).toEqual([null, "2"]);
  });

  it("walks offset pages until total_pages", async () => {
    const { sdk, calls } = sdkWith((call) => {
      const page = Number(call.url.searchParams.get("page"));
      return json({ transactions: [{ id: page }], metadata: { ...PAGE, total_pages: 2, current_page: page } });
    });
    const ids: number[] = [];
    for await (const tx of sdk.account.iterateTransactions({}, { minIntervalMs: 0 })) ids.push(tx.id);
    expect(ids).toEqual([1, 2]);
    expect(calls).toHaveLength(2);
  });
});

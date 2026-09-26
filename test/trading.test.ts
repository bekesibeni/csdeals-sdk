import { afterEach, describe, expect, it } from 'vitest';
import { CsDealsApiError, CsDealsErrorCode, PurchaseMismatchError, type PurchaseResult } from '../src/index.js';
import { KEY, type Reply, startServer } from './support/server.js';

let server: Awaited<ReturnType<typeof startServer>> | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

const order = (items: { price: number; amount: number }[]): PurchaseResult => ({
  order_id: 9001,
  created_at: 't',
  items: items.map((item, i) => ({ order_item_id: i + 1, app_id: 252490, market_hash_name: 'Red Beenie Hat', steam_asset_id: String(i), ...item })),
});

async function buyAgainst(reply: Reply) {
  server = await startServer(() => reply);
  return server.sdk.trading.purchase([
    { listingId: 11, amount: 2, maxPrice: 100 },
    { listingId: 12, amount: 1, maxPrice: 250 },
  ]);
}

describe('purchase', () => {
  // max_price is the only thing standing between a moved listing and an overpaid order. A mapping
  // that dropped or renamed it would buy at whatever the listing costs by the time the call lands.
  it('sends every line with its ceiling on the wire, authenticated', async () => {
    await buyAgainst({ body: order([{ price: 90, amount: 2 }, { price: 250, amount: 1 }]) });
    const [req] = server!.requests;
    expect(req?.method).toBe('POST');
    expect(req?.path).toBe('/public/v1/purchase');
    expect(req?.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(req?.body).toEqual({
      items: [
        { listing_id: 11, amount: 2, max_price: 100 },
        { listing_id: 12, amount: 1, max_price: 250 },
      ],
    });
  });

  // The order stands whatever we do next, so the caller must reconcile it instead of treating the
  // throw as "not bought" and buying again.
  it('throws PurchaseMismatchError carrying the order when a copy was charged above every ceiling', async () => {
    const err = await buyAgainst({ body: order([{ price: 90, amount: 2 }, { price: 300, amount: 1 }]) }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PurchaseMismatchError);
    expect((err as PurchaseMismatchError).order.order_id).toBe(9001);
  });

  it('throws when the basket total beats the ceilings even though each copy is under the highest one', async () => {
    const err = await buyAgainst({ body: order([{ price: 200, amount: 2 }, { price: 100, amount: 1 }]) }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PurchaseMismatchError);
  });

  // Fewer copies than asked means we would promise the client items that never reached the backpack.
  it('throws when the copy count differs from the request', async () => {
    const err = await buyAgainst({ body: order([{ price: 90, amount: 1 }, { price: 250, amount: 1 }]) }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PurchaseMismatchError);
  });

  it('surfaces a lost race as CsDealsApiError with the losing listings', async () => {
    const err = await buyAgainst({ status: 400, body: { error: 'LISTING_PRICE_CHANGED', data: { listing_ids: [12] } } }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CsDealsApiError);
    expect((err as CsDealsApiError).code).toBe(CsDealsErrorCode.ListingPriceChanged);
    expect((err as CsDealsApiError).data).toEqual({ listing_ids: [12] });
  });

  // There is no idempotency key. A resent purchase after a 5xx that actually landed buys twice.
  it('does not resend a purchase that answered 503', async () => {
    const err = await buyAgainst({ status: 503, body: { error: 'INTERNAL' } }).catch((e: unknown) => e);
    expect((err as CsDealsApiError).isRetryable).toBe(true);
    expect(server!.requests).toHaveLength(1);
  });
});

describe('errors', () => {
  it('reads Retry-After off a 429', async () => {
    server = await startServer(() => ({ status: 429, body: { error: 'RATE_LIMITED' }, headers: { 'retry-after': '7' } }));
    const err = (await server.sdk.trading.getTrades().catch((e: unknown) => e)) as CsDealsApiError;
    expect(err.isRateLimited).toBe(true);
    expect(err.retryAfterSec).toBe(7);
  });

  // Outages at the edge answer with an HTML page. A purchase that got one may still have landed, and
  // only the 5xx status tells the caller to reconcile from orders rather than treat it as a bug.
  it('keeps the status of a non-JSON error page', async () => {
    const err = await buyAgainst({ status: 502, raw: '<html>Bad gateway</html>', headers: { 'content-type': 'text/html' } }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CsDealsApiError);
    expect((err as CsDealsApiError).status).toBe(502);
    expect((err as CsDealsApiError).isRetryable).toBe(true);
  });
});

describe('conditional reads', () => {
  // Read as data, an unchanged book would be an empty one, and every listing would drop out of the catalog.
  it('returns a 304 as notModified, never as a body', async () => {
    server = await startServer((req) =>
      req.headers['if-none-match'] === '"v1"' ? { status: 304 } : { body: { seq: 5, listings: [] }, headers: { etag: '"v1"' } },
    );
    const first = await server.sdk.market.getBook({ appId: 252490 });
    expect(first).toMatchObject({ notModified: false, etag: '"v1"', data: { seq: 5 } });
    const second = await server.sdk.market.getBook({ appId: 252490, etag: '"v1"' });
    expect(second).toEqual({ notModified: true, etag: '"v1"' });
  });
});

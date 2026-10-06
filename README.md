# csdeals-sdk

A TypeScript SDK for the [CS Deals](https://cs.deals/docs) public v1 API: market data, buying,
selling, withdrawing to Steam, account history, crypto cashouts, signed webhooks and the listing feed.

```bash
pnpm add github:bekesibeni/csdeals-sdk
```

`dist/` is not committed, so pnpm builds the package on install. pnpm 11 needs it in the consuming
repo's `allowBuilds`. The bare name covers the build-script gate, the exact `name@<resolved-spec>`
keys cover the git-dep prepare gate. The install error prints the exact key to paste:

```yaml
allowBuilds:
  csdeals-sdk: true
  'csdeals-sdk@git+ssh://git@github.com/bekesibeni/csdeals-sdk.git#<sha>': true
  'csdeals-sdk@git+https://git@github.com:bekesibeni/csdeals-sdk.git#<sha>': true
```

HTTP runs on [got](https://github.com/sindresorhus/got) 16 with retries off, redirects off and
gzip/brotli decompression, through keep-alive agents or the proxy agent. The feed socket egresses
through the same agent.

```ts
import { AppId, CsDealsSDK } from 'csdeals-sdk';

const sdk = new CsDealsSDK({
  apiKey: process.env.CSDEALS_API_KEY!,             // csd_...
  webhookSecret: process.env.CSDEALS_WEBHOOK_SECRET, // whsec_..., only needed to verify webhooks
  proxy: 'socks5://user:pass@host:port',            // optional
});

const { balance } = await sdk.account.getUser();     // cents

const { listings } = await sdk.market.getListings({ appId: AppId.Rust, limit: 500 });
const order = await sdk.trading.purchase([
  { listingId: listings[0].id, maxPrice: listings[0].price },
]);

const { items } = await sdk.trading.getBackpack({ appId: AppId.Rust });
await sdk.trading.withdraw({ items: items.map(({ id, amount }) => ({ id, amount })) });

sdk.destroy();
```

Every price, balance and amount is an **integer in cents** (`4250` = $42.50), both ways. Params are
camelCase; responses are the wire shape, `snake_case`, exactly what the docs show.

## Things that will bite you

**A listing holds one copy.** Since 2026-10-06 every copy for sale is its own listing with `amount: 1`:
40 copies of a commodity are 40 listings. A purchase line buys exactly one listing, so several copies
mean several lines, and losing a race to another buyer answers `LISTING_NOT_FOUND`.

**A purchase has no idempotency key.** Sending the same order twice buys twice, so the SDK never
resends anything and neither should you. On a timeout or a 5xx, read the outcome back before trying
again: `account.getOrders()` or `trading.getBackpack()` for a purchase, `trading.getTrades()` for a
withdraw, deposit or sale.

**`maxPrice` is a ceiling, not a price.** A cheaper listing fills at its current price, a dearer one
fails the order with `LISTING_PRICE_CHANGED`. `trading.purchase` throws `PurchaseMismatchError`
(carrying the `order`) when what came back charged more than the lines allowed, charged any copy
above the highest `maxPrice`, or holds a different number of copies than requested. The order has
already been placed by then: the error is there so it never passes as the one you asked for.

**A withdraw only goes to the Steam account linked to the key.** There is no trade URL parameter.
An item still inside its trade hold fails the whole call with `ITEM_TRADE_LOCKED`, and more than 50
items fails it with `WITHDRAW_ITEM_LIMIT`, so filter and chunk:

```ts
const now = Date.now();
const ready = items.filter((i) => !i.trade_locked_until || Date.parse(i.trade_locked_until) <= now);
for (let i = 0; i < ready.length; i += 50) {
  const { withdraw_ids } = await sdk.trading.withdraw({
    items: ready.slice(i, i + 50).map(({ id, amount }) => ({ id, amount })),
  });
}
```

**The feed misses events.** CS Deals says so, and the documented fix is to re-read `GET /book`.
`LiveBook` does that on start, after every reconnect and on an interval. Anything built on the raw
socket alone drifts.

**Deduplicate webhooks on the body `id`, not the `X-CSDeals-Delivery` header.** Both are stable
across retries, but only the body is signed: a replayed body with a fresh header would otherwise
pass as new.

## API

`sdk.market`

| Method | Endpoint |
| --- | --- |
| `getListings({ appId, limit, page, cursor })` | `GET /listings`, full item detail, pages of 500 or 1000 |
| `getListing(id)` | `GET /listings/{id}`, `LISTING_NOT_FOUND` once gone |
| `getBook({ appId, etag })` | `GET /book`, every active listing plus `seq`, ETag-aware |
| `getPrices({ appId, page, limit })` | `GET /prices` |
| `getAllPrices({ appId, etag })` | `GET /prices/all`, one cached response, ETag-aware |
| `getSales({ appId, marketHashName, page, limit })` | `GET /sales` |
| `getSalesAverages({ appId, etag })` | `GET /sales/averages`, 30-day volume-weighted |

The ETag-aware reads return `{ notModified: false, etag, data }`, or `{ notModified: true, etag }`
on a 304.

`sdk.trading`

| Method | Endpoint |
| --- | --- |
| `purchase(lines)` | `POST /purchase`, atomic, one copy per line: every line fills or none does |
| `getBackpack({ appId, search, page, limit })` | `GET /backpack` |
| `withdraw({ items, twoFactorToken })` | `POST /withdraw`, backpack to the linked Steam account |
| `deposit(items)` | `POST /deposit`, Steam to backpack, unlisted |
| `getTrades({ status, page, limit })` | `GET /trades` |

`sdk.selling`

| Method | Endpoint |
| --- | --- |
| `getSteamInventory(appId)` | `GET /steam-inventory`, tokens valid 30 minutes |
| `sell(groups)` | `POST /sell`, Steam items straight to listings |
| `list(groups)` | `POST /list`, backpack items to one listing per copy, fixed price or `priceDecay` |
| `editListing(change)` / `editListings(changes)` | `PATCH /list`, price only, one or up to 50 each on its own |
| `repriceListings(ids, { price or priceDecay })` | `PATCH /list`, up to 500 at one price, all or nothing |
| `delist(id)` / `delistMany(ids)` | `POST /delist`, one or up to 500 all or nothing, items return to the backpack |
| `getMyListings({ appId, status, page, limit })` | `GET /my-listings` |
| `getMyListingsValue(appId?)` | `GET /my-listings/value` |

An edit changes the price only; sending `amount` is a `BAD_REQUEST`. To sell more copies, list them; to
sell fewer, delist them. A bulk `repriceListings` or `delistMany` does not say which id failed: after
an error, refetch `getMyListings` and retry with the ids still there. While listing is switched
off site-wide, listing, repricing and delisting answer 503 `LISTING_DISABLED`.

`sdk.account`

| Method | Endpoint |
| --- | --- |
| `getUser()` | `GET /user`, `{ id, steam_id, name, balance }` |
| `getOrders({ page, limit })` | `GET /orders` |
| `exportOrders({ side, appId, from, to })` | `GET /orders/export`, JSON rows |
| `getTransactions({ action, page, limit })` | `GET /transactions` |
| `cryptoWithdraw({ amount, ticker, address, twoFactorToken })` | `POST /crypto-withdraw` |
| `getCryptoWithdrawal(id)` | `GET /crypto-withdraw/{id}` |

`sdk.webhooks`: `verify(rawBody, headers)` and `parse(rawBody)`. The standalone
`verifyWebhookSignature(rawBody, headers, secret)` needs no SDK instance.

```ts
app.post('/webhooks/csdeals', { config: { rawBody: true } }, async (req, reply) => {
  if (!sdk.webhooks.verify(req.rawBody!, req.headers)) return reply.code(401).send();
  const delivery = sdk.webhooks.parse(req.rawBody!);
  if (await seen(delivery.id)) return reply.send();
  await queue.add('csdeals-trade', delivery.data);
  return reply.send();
});
```

- The signature is `sha256=hex(HMAC_SHA256(secret, "<X-CSDeals-Timestamp>.<raw body>"))`, with the
  whole `whsec_...` string as the key, compared in constant time, with a 300-second replay window.
  Pass the **raw** bytes: a re-serialised body will not verify.
- Answer any 2xx within 10 seconds. A failed delivery is retried up to 6 times, then dropped.
  After 20 dropped deliveries in a row the URL is removed from the account, so `getTrades()` stays
  the source of truth and is worth reconciling against on a timer.
- Deliveries are unordered. Apply a trade only if its `updated_at` beats what you hold for that `id`.
- The URL is registered under **Settings → Developer** on the site; there is no API for it. The
  secret is derived from the API key, so rerolling the key rotates it.
- `WEBHOOK_SOURCE_IPS` lists the three sending addresses. A filter, not authentication.

### Feed

`sdk.createWebSocket({ appIds, events })` follows marketplace-wide listing activity over
`wss://api.cs.deals/public/v1/ws`. It carries no account events; those are webhooks.

```ts
const ws = sdk.createWebSocket({ appIds: [AppId.Rust], events: ['listing.created'] });
ws.on('event', (event) => {});         // FeedEvent, discriminated on event.event
ws.on('connect', (reconnect) => {});
ws.on('error', (err) => {});
await ws.connect();                    // resolves once the filter is acknowledged
```

- The key rides in the `Authorization` header, never the URL.
- Events for one listing can arrive out of order; one whose `seq` does not beat the last applied for
  that listing is dropped.
- The server sends no heartbeat, so a socket silent past `idleTimeoutMs` (120s) is dropped and
  reconnected. Reconnects back off 1s to 30s and re-send the filter.
- Close codes `4401` (bad key, `CsDealsAuthError`) and `4429` (more than 3 sockets per user) are final.

`sdk.createLiveBook({ appId })` keeps a local copy of the active book the way CS Deals documents it:
hold feed events, read `GET /book`, drop what the snapshot already covers, replay the rest. It
re-reads after every reconnect and every `resyncIntervalMs` (5 minutes; 0 turns it off), retries a
failed read with backoff, and reports what each read corrected:

```ts
const book = sdk.createLiveBook({ appId: AppId.Rust });
book.on('sync', ({ initial, added, changed, removed }) => {});   // what the feed had missed
book.on('change', (event) => {});                                // live, after the snapshot
book.on('error', (err) => {});
await book.start();
book.listings;     // Map<listing id, BookListing>
book.syncedAt;     // epoch ms of the last good read; an old value means reads are failing
await book.stop();
```

`GET /book` is limited to 6 a minute, so keep one `LiveBook` per process.

## Rate limits

Per key, per endpoint. A 429 throws with `retryAfterSec` from the `Retry-After` header.

| Route | Limit |
| --- | --- |
| `listings`, `trades` | 1 / second |
| `sales` | 1 / 5 seconds |
| `book` | 6 / minute |
| `steam-inventory`, `orders/export`, `crypto-withdraw` | 5 / minute |
| `withdraw` | not limited |

## Errors

Every non-2xx throws `CsDealsApiError` with `status`, `code` (the API's `error` string; the
documented ones are in `CsDealsErrorCode`), `data` (e.g. `listing_ids` on `LISTING_PRICE_CHANGED`),
the raw `body`, `retryAfterSec`, and the helpers `isRateLimited` (429) and `isRetryable`
(408/429/5xx). Transport failures and timeouts reject with the underlying error.

```ts
try {
  await sdk.trading.purchase(lines);
} catch (err) {
  if (err instanceof CsDealsApiError && err.code === CsDealsErrorCode.ListingPriceChanged) {
    const lost = err.data?.listing_ids;   // losing a race is normal: drop these and move on
  } else throw err;
}
```

## Options

```ts
new CsDealsSDK({
  apiKey,          // required
  webhookSecret,   // enables sdk.webhooks.verify
  baseUrl,         // default https://api.cs.deals/public/v1
  wsUrl,           // default wss://api.cs.deals/public/v1/ws
  timeout,         // ms, default 30s; bulk reads raise their own
  proxy,           // socks5://, http://, https://, or a bare host:port (socks5)
});
```

`sdk.client` exposes `get`, `getConditional`, `post` and `patch` for any route this SDK does not
model yet.

## Development

```bash
pnpm install
pnpm typecheck
pnpm test        # local HTTP + WebSocket server, no key needed
pnpm build
pnpm smoke       # READ-ONLY check against the live API, key from .env (CSDEALS_API_KEY)
```

## License

Proprietary.

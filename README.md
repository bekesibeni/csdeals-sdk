# csdeals-sdk

TypeScript SDK for the [CS Deals](https://cs.deals/docs) public v1 API (`api.cs.deals`): market data,
buying, selling, withdrawing to Steam, account history, crypto cashouts, signed webhooks and the
listing WebSocket feed.

Server-to-server. ESM-only. Node 24+. Zero runtime dependencies (native `fetch` and `WebSocket`).

```bash
pnpm add github:bekesibeni/csdeals-sdk
```

`dist/` is not committed; the package builds itself on install via `prepare`. pnpm 11 needs it
allowlisted in the consuming repo's `pnpm-workspace.yaml`:

```yaml
allowBuilds:
  csdeals-sdk: true
```

## Features

- ✅ Every documented REST route, typed field for field against the OpenAPI schema
- ✅ Wire-native shapes: `snake_case`, integer cents, exactly what the docs show
- ✅ One typed error class, every documented error code
- ✅ Reads retry with backoff and honour `Retry-After`; writes are never resent
- ✅ Pre-flight validation, so a malformed request never spends a rate-limited call
- ✅ Page and cursor iterators paced to each route's meter
- ✅ Webhook signature verification (constant time, replay window)
- ✅ WebSocket feed with per-listing `seq` ordering, auto-reconnect, and a self-syncing `LiveBook`
- ✅ ETag support on the cached bulk reads

## Quick Start

```ts
import { APP_ID, CsDealsSDK } from 'csdeals-sdk';

const sdk = new CsDealsSDK({
  apiKey: process.env.CSDEALS_API_KEY!,             // csd_...
  webhookSecret: process.env.CSDEALS_WEBHOOK_SECRET, // whsec_..., enables sdk.verifyWebhook
});

const { balance } = await sdk.account.user();        // cents

const { listings } = await sdk.market.listings({ app_id: APP_ID.CS2, limit: 500 });
const pick = listings[0]!;

const order = await sdk.trading.purchase({
  items: [{ listing_id: pick.id, amount: 1, max_price: pick.price }],
});

const backpack = await sdk.trading.backpack({ app_id: APP_ID.CS2 });
await sdk.trading.withdraw({ items: backpack.items.map(({ id, amount }) => ({ id, amount })) });
```

## Modules

### Market (`sdk.market`)

```ts
sdk.market.listings({ limit?: 500 | 1000, page?, cursor?, app_id? })  // 1 req/s, full item detail
sdk.market.listing(id)                                                // LISTING_NOT_FOUND once gone
sdk.market.book({ app_id?, etag? })                                   // every active listing + seq, 6/min
sdk.market.prices({ page?, limit?, app_id? })
sdk.market.pricesAll({ app_id?, etag? })                              // one cached response, start here
sdk.market.sales({ page?, limit?, app_id?, market_hash_name? })       // 1 req / 5 s
sdk.market.salesAverages({ app_id?, etag? })                          // 30-day volume-weighted
sdk.market.iterateListings({ app_id }) / iteratePrices() / iterateSales()
```

### Trading (`sdk.trading`)

```ts
sdk.trading.purchase({ items: [{ listing_id, amount, max_price, private_token? }] })  // atomic
sdk.trading.backpack({ page?, limit?, app_id?, search? })
sdk.trading.deposit({ items: [{ token, amount }] })        // Steam -> backpack, unlisted
sdk.trading.withdraw({ items: [{ id, amount }], two_factor_auth_token? })
sdk.trading.trades({ page?, limit?: 500 | 1000, status? })  // 1 req/s
sdk.trading.iterateTrades() / iterateBackpack()
```

### Selling (`sdk.selling`)

```ts
sdk.selling.steamInventory({ app_id })                     // tokens valid 30 min, 5/min
sdk.selling.sell({ listings: [{ items: [{ token, amount }], price }] })
sdk.selling.list({ listings: [{ items: [{ id, amount }], price }] })   // or price_decay
sdk.selling.editListing({ listing_id, price?, price_decay?, amount? })
sdk.selling.editListings([...])                             // up to 50, per-listing results
sdk.selling.delist(listingId) / delistMany([ids])
sdk.selling.myListings({ page?, limit?, app_id?, status? })
sdk.selling.myListingsValue({ app_id? })
sdk.selling.iterateMyListings()
```

`editListing` semantics come from the API, and the difference matters:

| Sent | Effect |
|---|---|
| `price` | Reprices the whole stack in place |
| `amount` | Grows the listing from the backpack, or shrinks it and returns the surplus |
| `amount` + `price` | **Partial reprice**: this listing keeps `amount` at the new price, the rest moves to a new listing at the old price. Happens even when the price is unchanged |

A price updater should send `price` only.

### Account (`sdk.account`)

```ts
sdk.account.apiInfo()                  // GET /public/v1, unauthenticated
sdk.account.verifyKey()                // true | false
sdk.account.user()                     // { id, steam_id, name, balance }
sdk.account.orders({ page?, limit? })
sdk.account.exportOrders({ side?, app_id?, from?, to? })     // typed JSON rows
sdk.account.exportOrdersCsv({ side?, app_id?, from?, to? })  // CSV text
sdk.account.transactions({ page?, limit?, action? })
sdk.account.cryptoWithdraw({ amount, ticker, address, fee_level?, two_factor_auth_token? })
sdk.account.cryptoWithdrawal(id)
sdk.account.iterateOrders() / iterateTransactions()
```

## Money

Every price, balance and amount is an **integer in cents** (`4250` = $42.50), both ways. The SDK
refuses a non-integer where the API wants cents, so dollars passed by mistake fail before the
network instead of buying at a hundredth of the intended price. `formatUsdCents` and
`parseUsdCents` convert at your display boundary. The one exception is `CryptoWithdrawal.token_amount`,
which is in the crypto's own units.

## Error Handling

Every failure is a `CsDealsError`. Branch on `key`, and log `providerCode` (the raw `error` string)
and `data`:

```ts
import { CsDealsError, isError } from 'csdeals-sdk';

try {
  await sdk.trading.purchase({ items });
} catch (e) {
  if (isError(e, 'LISTING_OUT_OF_STOCK') || isError(e, 'LISTING_PRICE_CHANGED')) {
    const lost = e.data?.listing_ids;   // losing a race is normal; drop these and move on
  } else if (e instanceof CsDealsError && e.ambiguous) {
    // Timeout, dropped socket or 5xx on a write: it may have gone through. Read it back.
  } else throw e;
}
```

- `key`: one of the documented codes (`LISTING_PRICE_CHANGED`, `INSUFFICIENT_BALANCE`,
  `ACTIVE_TRADE_LIMIT`, `WITHDRAW_DAILY_LIMIT_EXCEEDED`, ...), or a synthetic one: `UNAUTHORIZED`,
  `FORBIDDEN`, `NOT_FOUND`, `RATE_LIMITED`, `TIMEOUT`, `NETWORK_ERROR`, `INVALID_RESPONSE`,
  `INVALID_REQUEST` (refused before sending), `NOT_CONFIGURED`, `UNKNOWN`.
- `retryable`: transport failure, 408/429/5xx, or a site-wide pause.
- `ambiguous`: **a write that may have landed.** cs.deals has no idempotency key, so the SDK never
  resends a write, and neither should you until you have read the outcome back:

| Write | Where to look |
|---|---|
| `purchase` | `account.orders()` (`side: "bought"`) or `trading.backpack()` |
| `withdraw` / `deposit` / `sell` | `trading.trades()`: a new `withdraw_id` / `deposit_id` |
| `cryptoWithdraw` | `account.transactions({ action: "WITHDRAWAL" })` |
| `list` / `editListing` / `delist` | `selling.myListings()` |

## Webhooks

Register the URL under **Settings → Developer** on the site; there is no API for it. The secret
(`whsec_...`) is derived from the API key, so rerolling the key rotates it.

```ts
// Fastify: register the route with a raw body (e.g. fastify-raw-body).
app.post('/webhooks/csdeals', { config: { rawBody: true } }, async (req, reply) => {
  const hook = sdk.verifyWebhook(req.rawBody!, req.headers);   // throws UNAUTHORIZED on a bad signature
  if (await seen(hook.deliveryId)) return reply.send();        // retries reuse the delivery id
  if (hook.trade) await queue.add('csdeals-trade', hook.trade);
  return reply.send();                                         // any 2xx within 10 s
});
```

- The signature is `sha256=hex(HMAC_SHA256(secret, "<X-CSDeals-Timestamp>.<raw body>"))`, with the
  whole `whsec_...` string as the key. Pass the **raw** bytes: a re-serialised body will not verify.
- Deliveries are unordered. Apply a trade only if its `updated_at` beats what you hold for that `id`.
- Up to 6 retries, then the delivery is dropped. Keep `trading.trades()` as the source of truth and
  reconcile against it.
- Unknown event names come through with `trade: null`; ignore them.
- `WEBHOOK_SOURCE_IPS` lists the three sending addresses. It is a filter, not authentication.

## Feed

Marketplace-wide listing activity. It carries no account events (those are webhooks).

```ts
const feed = sdk.feed();
feed.on('listing.created', (listing) => { /* full item fields: float, seed, stickers */ });
feed.on('listing.price_changed', ({ listing_id, price_after }) => {});
feed.on('error', (err) => {});
await feed.connect();
await feed.subscribe({ events: ['listing.created'], app_ids: [730] });  // replaces the filter
```

- Events for one listing can arrive out of order. The feed drops any event whose `seq` does not
  beat the last one applied for that listing (`dropStale: false` turns this off).
- Reconnects with backoff and re-sends the filter. Close codes `4401` (bad key) and `4429` (more
  than 3 sockets per user) are final.

For a local copy of the whole book, `LiveBook` runs the documented sync (buffer events, load
`GET /book`, drop what the snapshot already covers, replay the rest) and redoes it after every
reconnect:

```ts
const book = await sdk.liveBook({ app_id: 730 });
book.listings;            // Map<listing id, LeanListing>, always current
book.onChange((event) => {});
book.stop();
```

## Rate Limits

Limits are per key, per endpoint. `RATE_LIMITS` exports the table (corrected against live
headers). The tight ones:

| Route | Limit |
|---|---|
| `listings`, `trades` | 1 / second (pages of 500 or 1000) |
| `sales` | 1 / 5 seconds |
| `book` | 6 / minute |
| `steam-inventory`, `orders/export`, `crypto-withdraw` | 5 / minute |
| `withdraw` | not limited |

`onRateLimit` receives `X-RateLimit-Limit/Remaining/Reset` after every response. The iterators
pace themselves (`minIntervalMs`) to their route's meter. Reads retry a 429 after `Retry-After`,
unless it is longer than `maxRetryDelayMs` (10 s), in which case the error is handed back.

## Options

```ts
new CsDealsSDK({
  apiKey,                 // required
  webhookSecret,          // enables verifyWebhook
  baseUrl,                // default https://api.cs.deals (https only)
  timeoutMs,              // default 15 s; bulk reads raise their own
  maxRetries,             // default 2, GETs only
  maxRetryDelayMs,        // default 10 s
  maxResponseBytes,       // default 8 MB; bulk reads raise their own
  fetch,                  // inject for tests or proxies
  onRateLimit,
});
```

`sdk.request(method, path, options)` reaches any route this SDK does not model yet, under the same
retry rules.

## Environment Variables

```bash
CSDEALS_API_KEY=csd_...
CSDEALS_WEBHOOK_SECRET=whsec_...
```

`pnpm smoke` runs a **read-only** check against the live API with the key from `.env`.

## License

Proprietary.

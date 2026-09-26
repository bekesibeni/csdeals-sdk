// Live READ-ONLY check against the real API. Never add a write here: purchase, withdraw, sell,
// deposit, list, delist and crypto-withdraw move real money or items.
import { AppId, CsDealsApiError, CsDealsSDK } from '../dist/index.mjs';

const apiKey = process.env.CSDEALS_API_KEY;
if (!apiKey) {
  console.error('CSDEALS_API_KEY missing (.env)');
  process.exit(1);
}

const sdk = new CsDealsSDK({ apiKey });
let failures = 0;

const keysOf = (value) => (value && typeof value === 'object' ? Object.keys(value).sort().join(',') : String(value));

async function check(name, fn) {
  try {
    const out = await fn();
    console.log(`ok   ${name}${out === undefined ? '' : `  ${out}`}`);
  } catch (err) {
    failures++;
    console.log(`FAIL ${name}  ${err instanceof CsDealsApiError ? `${err.status} ${err.code}` : (err?.stack ?? err)}`);
  }
}

await check('user', async () => keysOf(await sdk.account.getUser()));
await check('listings', async () => {
  const r = await sdk.market.getListings({ appId: AppId.Rust, limit: 500 });
  return `rows=${r.listings.length} next=${r.next_cursor}`;
});
await check('listing 404', async () => {
  const err = await sdk.market.getListing(999_999_999).then(() => null, (e) => e);
  return err instanceof CsDealsApiError ? `${err.status} ${err.code}` : `unexpected ${err}`;
});
await check('book', async () => {
  const r = await sdk.market.getBook({ appId: AppId.Rust });
  return r.notModified ? '304' : `seq=${r.data.seq} rows=${r.data.listings.length}`;
});
await check('allPrices + etag', async () => {
  const first = await sdk.market.getAllPrices({ appId: AppId.Rust });
  if (first.notModified) return 'first read was 304?';
  const second = await sdk.market.getAllPrices({ appId: AppId.Rust, etag: first.etag });
  return `rows=${first.data.prices.length} second.notModified=${second.notModified}`;
});
await check('trades', async () => {
  const r = await sdk.trading.getTrades({ limit: 500 });
  return `rows=${r.trades.length} total=${r.metadata.total_items}`;
});
await check('backpack', async () => {
  const r = await sdk.trading.getBackpack({ limit: 5 });
  return `rows=${r.items.length} total=${r.metadata.total_items}`;
});
await check('orders', async () => {
  const r = await sdk.account.getOrders({ limit: 5 });
  return `rows=${r.orders.length}`;
});
await check('transactions', async () => {
  const r = await sdk.account.getTransactions({ limit: 5 });
  return `rows=${r.transactions.length}`;
});
await check('feed', async () => {
  const socket = sdk.createWebSocket({ appIds: [AppId.Rust] });
  let events = 0;
  socket.on('event', () => events++);
  await socket.connect();
  await new Promise((r) => setTimeout(r, 10_000));
  await socket.disconnect();
  return `events10s=${events}`;
});

sdk.destroy();
process.exit(failures ? 1 : 0);

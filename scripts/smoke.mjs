// Live READ-ONLY check against the real API. Never add a write here: purchase, withdraw, sell,
// deposit, list, delist and crypto-withdraw move real money or items.
import { CsDealsError, CsDealsSDK } from "../dist/index.mjs";

const apiKey = process.env.CSDEALS_API_KEY;
if (!apiKey) {
  console.error("CSDEALS_API_KEY missing (.env)");
  process.exit(1);
}

const budgets = new Map();
const sdk = new CsDealsSDK({
  apiKey,
  webhookSecret: process.env.CSDEALS_WEBHOOK_SECRET,
  onRateLimit: (info) => budgets.set(`${info.method} ${info.path}`, `${info.remaining}/${info.limit}`),
});

let failures = 0;

function keysOf(value) {
  return value && typeof value === "object" ? Object.keys(value).sort().join(",") : String(value);
}

async function check(name, fn) {
  try {
    const out = await fn();
    console.log(`ok   ${name}${out === undefined ? "" : `  ${out}`}`);
  } catch (err) {
    failures++;
    if (err instanceof CsDealsError) {
      console.log(`FAIL ${name}  ${err.key} status=${err.status} code=${err.providerCode} ${err.message}`);
    } else {
      console.log(`FAIL ${name}  ${err?.stack ?? err}`);
    }
  }
}

await check("apiInfo", async () => {
  const info = await sdk.account.apiInfo();
  return `version=${info.version} ws=${info.websocket?.path} events=${info.events?.join("|")} rest=${info.rest?.length}`;
});
await check("verifyKey", async () => String(await sdk.account.verifyKey()));
await check("user", async () => keysOf(await sdk.account.user()));
await check("prices", async () => {
  const r = await sdk.market.prices({ limit: 5 });
  return `rows=${r.prices.length} meta=${JSON.stringify(r.metadata)} row=${keysOf(r.prices[0])}`;
});
await check("listings", async () => {
  const r = await sdk.market.listings({ limit: 500, app_id: 730 });
  return `rows=${r.listings.length} next=${r.next_cursor} rowKeys=${Object.keys(r.listings[0] ?? {}).length}`;
});
await check("listing 404", async () => {
  try {
    await sdk.market.listing(999_999_999);
    return "unexpected 200";
  } catch (err) {
    if (err instanceof CsDealsError) return `${err.key} status=${err.status} code=${err.providerCode}`;
    throw err;
  }
});
await check("pricesAll + etag", async () => {
  const first = await sdk.market.pricesAll({ app_id: 252490 });
  if (first.notModified) return "first read was 304?";
  const second = await sdk.market.pricesAll({ app_id: 252490, etag: first.etag ?? undefined });
  return `rows=${first.data.prices.length} etag=${first.etag} second.notModified=${second.notModified} row=${keysOf(first.data.prices[0])}`;
});
await check("sales", async () => {
  const r = await sdk.market.sales({ limit: 5 });
  return `rows=${r.sales.length} row=${keysOf(r.sales[0])}`;
});
await check("trades", async () => {
  const r = await sdk.trading.trades({ limit: 500 });
  return `rows=${r.trades.length} total=${r.metadata.total_items} row=${keysOf(r.trades[0])}`;
});
await check("backpack", async () => {
  const r = await sdk.trading.backpack({ limit: 5 });
  return `rows=${r.items.length} total=${r.metadata.total_items} row=${keysOf(r.items[0])}`;
});
await check("myListings", async () => {
  const r = await sdk.selling.myListings({ limit: 5 });
  return `rows=${r.listings.length} row=${keysOf(r.listings[0])}`;
});
await check("myListingsValue", async () => keysOf(await sdk.selling.myListingsValue()));
await check("orders", async () => {
  const r = await sdk.account.orders({ limit: 5 });
  return `rows=${r.orders.length} row=${keysOf(r.orders[0])}`;
});
await check("transactions", async () => {
  const r = await sdk.account.transactions({ limit: 5 });
  return `rows=${r.transactions.length} row=${keysOf(r.transactions[0])}`;
});
await check("exportOrders json", async () => {
  const r = await sdk.account.exportOrders({});
  return `rows=${r.orders.length} row=${keysOf(r.orders[0])}`;
});
await check("feed connect", async () => {
  const feed = sdk.feed({ reconnect: false });
  let events = 0;
  feed.on("event", () => events++);
  await feed.connect();
  const ack = await feed.subscribe({ app_ids: [730] });
  await new Promise((r) => setTimeout(r, 5_000));
  feed.close();
  return `ack=${JSON.stringify(ack)} events5s=${events}`;
});

console.log("\nrate-limit budgets:");
for (const [route, budget] of budgets) console.log(`  ${route}  ${budget}`);
process.exit(failures ? 1 : 0);

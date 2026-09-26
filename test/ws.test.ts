import { afterEach, describe, expect, it } from 'vitest';
import { type BookDiff, CsDealsAuthError, type CsDealsWebSocket, type LiveBook } from '../src/index.js';
import { KEY, type Reply, startServer, tick, until } from './support/server.js';

const RUST = 252490;

let server: Awaited<ReturnType<typeof startServer>> | undefined;
const running: (CsDealsWebSocket | LiveBook)[] = [];
afterEach(async () => {
  for (const item of running.splice(0)) await ('stop' in item ? item.stop() : item.disconnect());
  await server?.close();
  server = undefined;
});

const created = (id: number, seq: number, price = 100) => ({
  event: 'listing.created',
  seq,
  ts: 't',
  data: { listing_id: id, app_id: RUST, market_hash_name: 'Red Beenie Hat', price, amount: 1, commodity: true, created_at: 't', rust_type: 'Hat' },
});
const priced = (id: number, seq: number, price: number) => ({
  event: 'listing.price_changed',
  seq,
  ts: 't',
  data: { listing_id: id, app_id: RUST, price_before: 0, price_after: price },
});
const lean = (id: number, price: number) => ({ id, app_id: RUST, market_hash_name: 'Red Beenie Hat', price, amount: 1, commodity: true, created_at: 't' });
const bookReply = (seq: number, listings: ReturnType<typeof lean>[]): Reply => ({ body: { seq, listings } });

describe('feed socket', () => {
  // A key in the URL ends up in every proxy and access log between us and cs.deals.
  it('authenticates with a Bearer header and resolves once the filter is acknowledged', async () => {
    server = await startServer();
    const socket = server.sdk.createWebSocket({ appIds: [RUST], events: ['listing.removed'] });
    running.push(socket);
    const peer = server.nextPeer();
    await socket.connect();
    expect((await peer).headers.authorization).toBe(`Bearer ${KEY}`);
    expect((await peer).subscribes).toEqual([{ op: 'subscribe', app_ids: [RUST], events: ['listing.removed'] }]);
  });

  // Applying a stale price over a newer one leaves a local book that buys at a price that no longer exists.
  it('drops a frame whose seq does not beat the last one for that listing', async () => {
    server = await startServer();
    const socket = server.sdk.createWebSocket();
    running.push(socket);
    const peer = server.nextPeer();
    const seen: number[] = [];
    socket.on('event', (e) => {
      if (e.event === 'listing.price_changed') seen.push(e.data.price_after);
    });
    await socket.connect();
    for (const frame of [priced(1, 10, 500), priced(1, 9, 400), priced(2, 5, 300), priced(1, 11, 600)]) (await peer).send(frame);
    await until(() => seen.length === 3);
    expect(seen).toEqual([500, 300, 600]);
  });

  it('treats 4401 as a dead key, not a blip to reconnect through', async () => {
    server = await startServer(undefined, { feedCloseCode: 4401 });
    const socket = server.sdk.createWebSocket({ reconnectDelayMs: 10 });
    socket.on('error', () => {});
    await expect(socket.connect()).rejects.toBeInstanceOf(CsDealsAuthError);
    await tick(100);
    expect(server.peers).toHaveLength(1);
  });

  // The feed sends no heartbeat, so a half-open socket would otherwise look like a quiet market forever.
  it('drops a silent socket and reconnects, announcing it as a reconnect', async () => {
    server = await startServer();
    const socket = server.sdk.createWebSocket({ idleTimeoutMs: 100, reconnectDelayMs: 10 });
    running.push(socket);
    socket.on('error', () => {});
    const connects: boolean[] = [];
    socket.on('connect', (reconnect) => connects.push(reconnect));
    await socket.connect();
    await until(() => connects.length >= 2);
    expect(connects.slice(0, 2)).toEqual([false, true]);
  });
});

describe('LiveBook', () => {
  // The documented sync: events held while the snapshot loads must be dropped when the snapshot
  // already reflects them and applied when newer. Either mistake leaves a phantom listing or a stale
  // price in the book we buy from.
  it('drops held events at or below the snapshot seq and applies the newer ones', async () => {
    let release!: (reply: Reply) => void;
    server = await startServer((req) => (req.path.endsWith('/book') ? new Promise<Reply>((r) => (release = r)) : { body: {} }));
    const book = server.sdk.createLiveBook({ appId: RUST, resyncIntervalMs: 0 });
    running.push(book);
    const changes: number[] = [];
    book.on('change', (e) => changes.push(e.seq));
    const peer = server.nextPeer();
    const started = book.start();
    await until(() => server!.requests.some((r) => r.path.endsWith('/book')));
    for (const frame of [priced(1, 99, 111), created(2, 100), priced(1, 101, 222)]) (await peer).send(frame);
    await tick();
    release(bookReply(100, [lean(1, 150)]));
    await started;

    expect(book.snapshotSeq).toBe(100);
    expect(book.listings.get(1)?.price).toBe(222);
    expect(book.listings.has(2)).toBe(false);
    expect(changes).toEqual([101]);
  });

  // A frame can reach us after the HTTP snapshot that already includes it. Applying it would roll a
  // row back to an older state the book has moved past.
  it('ignores a frame at or below the snapshot that arrives after the read', async () => {
    server = await startServer((req) => (req.path.endsWith('/book') ? bookReply(100, [lean(1, 150)]) : { body: {} }));
    const book = server.sdk.createLiveBook({ appId: RUST, resyncIntervalMs: 0 });
    running.push(book);
    const peer = server.nextPeer();
    await book.start();
    (await peer).send(created(3, 99));
    (await peer).send(priced(1, 100, 999));
    (await peer).send(priced(1, 101, 160));
    await until(() => book.listings.get(1)?.price === 160);
    expect(book.listings.has(3)).toBe(false);
  });

  // The feed was measured missing creations, a price rise and a removal with no seq gap. The re-read
  // is the only thing that catches them, and a consumer mirroring the book needs to be told.
  it('reports what a re-read corrected, keeping the detail a created event carried', async () => {
    let current = bookReply(100, [lean(1, 150), lean(2, 200)]);
    server = await startServer((req) => (req.path.endsWith('/book') ? current : { body: {} }));
    const book = server.sdk.createLiveBook({ appId: RUST, resyncIntervalMs: 0 });
    running.push(book);
    const diffs: BookDiff[] = [];
    book.on('sync', (diff) => diffs.push(diff));
    const peer = server.nextPeer();
    await book.start();
    (await peer).send(created(4, 110, 70));
    await until(() => book.listings.has(4));

    current = bookReply(120, [lean(1, 175), lean(3, 50), lean(4, 70)]);
    await book.sync();

    const diff = diffs[1]!;
    expect(diffs[0]!.initial).toBe(true);
    expect(diff.initial).toBe(false);
    expect(diff.added.map((l) => l.id)).toEqual([3]);
    expect(diff.changed.map((c) => [c.before.price, c.after.price])).toEqual([[150, 175]]);
    expect(diff.removed.map((l) => l.id)).toEqual([2]);
    expect(book.listings.get(4)?.rust_type).toBe('Hat');
  });

  // Events in a reconnect gap are gone. A read already in flight may predate the gap, so the
  // reconnect has to queue a fresh one rather than ride the old one.
  it('queues another read when the socket reconnects during one', async () => {
    let reads = 0;
    let releaseSecond!: (reply: Reply) => void;
    server = await startServer((req) => {
      if (!req.path.endsWith('/book')) return { body: {} };
      reads += 1;
      return reads === 2 ? new Promise<Reply>((r) => (releaseSecond = r)) : bookReply(100 + reads, [lean(1, 150)]);
    });
    const book = server.sdk.createLiveBook({ appId: RUST, resyncIntervalMs: 0, socket: { reconnectDelayMs: 10 } });
    running.push(book);
    const first = server.nextPeer();
    await book.start();
    const pending = book.sync();
    await until(() => reads === 2);

    const second = server.nextPeer();
    (await first).socket.terminate();
    await second;
    await tick(50);
    releaseSecond(bookReply(102, [lean(1, 150)]));
    await pending;
    expect(reads).toBe(3);
  });
});

import { describe, expect, it } from "vitest";
import {
  type Book,
  type ConditionalResult,
  CsDealsFeed,
  type FeedEvent,
  type FeedSocket,
  LiveBook,
} from "../src/index.js";

class FakeSocket implements FeedSocket {
  readyState = 0;
  sent: unknown[] = [];
  private handlers = new Map<string, ((event: never) => void)[]>();

  addEventListener(type: string, listener: (event: never) => void): void {
    const list = this.handlers.get(type) ?? [];
    list.push(listener);
    this.handlers.set(type, list);
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }

  close(code = 1000, reason = ""): void {
    this.readyState = 3;
    this.fire("close", { code, reason });
  }

  fire(type: string, event: unknown): void {
    for (const listener of this.handlers.get(type) ?? []) listener(event as never);
  }

  frame(value: unknown): void {
    this.fire("message", { data: JSON.stringify(value) });
  }

  open(): void {
    this.readyState = 1;
    this.frame({ event: "connected", data: null, ts: "t" });
  }
}

function feedWithSocket() {
  const sockets: FakeSocket[] = [];
  const feed = new CsDealsFeed("wss://example.test/ws", {
    reconnect: false,
    socketFactory: () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    },
  });
  return { feed, sockets };
}

const created = (listingId: number, seq: number, price = 100) => ({
  event: "listing.created",
  seq,
  ts: "t",
  data: {
    listing_id: listingId,
    app_id: 730,
    market_hash_name: "AK-47 | Redline (Field-Tested)",
    price,
    amount: 1,
    commodity: false,
    created_at: "t",
  },
});

const priced = (listingId: number, seq: number, price: number) => ({
  event: "listing.price_changed",
  seq,
  ts: "t",
  data: { listing_id: listingId, app_id: 730, price_before: 0, price_after: price },
});

describe("feed ordering", () => {
  // Events for one listing can arrive out of order across server processes. Applying a stale
  // price over a newer one leaves a local book that buys at a price that no longer exists.
  it("drops an event whose seq does not beat the last one applied for that listing", async () => {
    const { feed, sockets } = feedWithSocket();
    const seen: number[] = [];
    feed.on("listing.price_changed", (data) => seen.push(data.price_after));
    const connected = feed.connect();
    sockets[0]!.open();
    await connected;

    sockets[0]!.frame(priced(1, 10, 500));
    sockets[0]!.frame(priced(1, 9, 400));
    sockets[0]!.frame(priced(2, 5, 300));
    sockets[0]!.frame(priced(1, 11, 600));
    expect(seen).toEqual([500, 300, 600]);
  });

  it("sends the subscribe op and resolves on the server's acknowledgement", async () => {
    const { feed, sockets } = feedWithSocket();
    const connected = feed.connect();
    sockets[0]!.open();
    await connected;
    const ack = feed.subscribe({ events: ["listing.created"], app_ids: [730] });
    expect(sockets[0]!.sent).toEqual([{ op: "subscribe", events: ["listing.created"], app_ids: [730] }]);
    sockets[0]!.frame({ event: "subscribed", data: { events: ["listing.created"], app_ids: [730] } });
    await expect(ack).resolves.toEqual({ events: ["listing.created"], app_ids: [730] });
  });

  it("treats close code 4401 as a dead key, not a blip to reconnect through", async () => {
    const sockets: FakeSocket[] = [];
    const feed = new CsDealsFeed("wss://example.test/ws", {
      socketFactory: () => {
        const socket = new FakeSocket();
        sockets.push(socket);
        return socket;
      },
    });
    feed.on("error", () => undefined);
    const connected = feed.connect();
    sockets[0]!.close(4401, "unauthorised");
    await expect(connected).rejects.toMatchObject({ key: "UNAUTHORIZED" });
    await new Promise((r) => setTimeout(r, 1_500));
    expect(sockets).toHaveLength(1);
  });
});

describe("LiveBook", () => {
  // The documented sync: events buffered while the snapshot loads must be dropped when the
  // snapshot already reflects them, and applied when they are newer. Getting either wrong
  // leaves a phantom listing or a stale price in the book a bot buys from.
  it("drops buffered events at or below the snapshot seq and applies the newer ones", async () => {
    const { feed, sockets } = feedWithSocket();
    let releaseBook!: (value: ConditionalResult<Book>) => void;
    const book = new LiveBook(
      feed,
      () => new Promise((resolve) => (releaseBook = resolve)),
    );
    const changes: FeedEvent[] = [];
    book.onChange((event) => changes.push(event));

    const started = book.start();
    sockets[0]!.open();
    await new Promise((r) => setTimeout(r, 0));
    sockets[0]!.frame({ event: "subscribed", data: { events: "all", app_ids: "all" } });
    await new Promise((r) => setTimeout(r, 0));

    sockets[0]!.frame(priced(1, 99, 111));
    sockets[0]!.frame(created(2, 100));
    sockets[0]!.frame(priced(1, 101, 222));
    releaseBook({
      notModified: false,
      etag: null,
      data: {
        seq: 100,
        listings: [
          { id: 1, app_id: 730, market_hash_name: "x", price: 150, amount: 1, commodity: false, created_at: "t" },
        ],
      },
    });
    await started;

    expect(book.snapshotSeq).toBe(100);
    expect(book.listings.get(1)?.price).toBe(222);
    expect(book.listings.has(2)).toBe(false);
    expect(changes.map((c) => c.seq)).toEqual([101]);

    sockets[0]!.frame({ event: "listing.removed", seq: 102, ts: "t", data: { listing_id: 1, app_id: 730 } });
    expect(book.listings.size).toBe(0);
  });
});

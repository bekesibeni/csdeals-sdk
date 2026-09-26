import { createServer, type IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { type WebSocket, WebSocketServer } from 'ws';
import { CsDealsSDK } from '../../src/index.js';

export const KEY = 'csd_test_key';

export interface Received {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
  headers: IncomingHttpHeaders;
}

export interface Reply {
  status?: number;
  body?: unknown;
  /** Sent as-is instead of JSON-encoding `body`. */
  raw?: string;
  headers?: Record<string, string>;
}

export interface FeedPeer {
  socket: WebSocket;
  headers: IncomingHttpHeaders;
  /** Subscribe ops the client sent. */
  subscribes: unknown[];
  send(frame: unknown): void;
}

/** A real HTTP + WebSocket server on a random port, so the tests exercise the actual client. */
export async function startServer(
  handler: (req: Received) => Reply | Promise<Reply> = () => ({ body: {} }),
  options: { feedCloseCode?: number } = {},
) {
  const requests: Received[] = [];
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', async () => {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const received = { method: req.method ?? 'GET', path: url.pathname, query: url.searchParams, body: raw ? JSON.parse(raw) : null, headers: req.headers };
      requests.push(received);
      const reply = await handler(received);
      res.writeHead(reply.status ?? 200, { 'content-type': 'application/json', ...reply.headers });
      res.end(reply.raw ?? (reply.body === undefined ? '' : JSON.stringify(reply.body)));
    });
  });

  const wss = new WebSocketServer({ server, path: '/ws' });
  const peers: FeedPeer[] = [];
  const waiting: ((peer: FeedPeer) => void)[] = [];
  wss.on('connection', (socket, req) => {
    const peer: FeedPeer = { socket, headers: req.headers, subscribes: [], send: (frame) => socket.send(JSON.stringify(frame)) };
    socket.on('message', (raw) => {
      const op = JSON.parse(raw.toString()) as { op?: string };
      if (op.op !== 'subscribe') return;
      peer.subscribes.push(op);
      peer.send({ event: 'subscribed', data: op });
    });
    peers.push(peer);
    waiting.shift()?.(peer);
    if (options.feedCloseCode) socket.close(options.feedCloseCode, 'rejected');
    else peer.send({ event: 'connected', data: null });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const sdk = new CsDealsSDK({
    apiKey: KEY,
    webhookSecret: 'whsec_test',
    baseUrl: `http://127.0.0.1:${port}/public/v1`,
    wsUrl: `ws://127.0.0.1:${port}/ws`,
  });

  return {
    sdk,
    requests,
    peers,
    /** The next socket to connect, or the latest one if it already has. */
    nextPeer(): Promise<FeedPeer> {
      return new Promise((resolve) => waiting.push(resolve));
    },
    async close(): Promise<void> {
      sdk.destroy();
      for (const client of wss.clients) client.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

export const tick = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

export async function until(condition: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await tick(10);
  }
}

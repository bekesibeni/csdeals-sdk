import { HttpClient } from '@benji/stdlib/http.js';
import type { HttpClientOptions, HttpResponse } from '@benji/stdlib/http.js';
import { Agent as NodeHttpAgent } from 'node:http';
import type { Agent as HttpAgent } from 'node:http';
import { Agent as NodeHttpsAgent } from 'node:https';
import type { Agent as HttpsAgent } from 'node:https';
import { HttpProxyAgent } from 'http-proxy-agent';
import { HttpsProxyAgent } from 'https-proxy-agent';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { CsDealsApiError } from './errors.js';
import type { Conditional } from './types.js';

export interface CsDealsClientOptions {
  /** `csd_...`, sent as `Authorization: Bearer`. */
  apiKey: string;
  /** Default `https://api.cs.deals/public/v1`. */
  baseUrl?: string;
  /** Default `wss://api.cs.deals/public/v1/ws`. */
  wsUrl?: string;
  /** Request timeout in ms. Default 30 000; the whole-book reads raise their own. */
  timeout?: number;
  /** `socks5://`, `http://` or `https://` proxy URL; a bare `host:port` is treated as SOCKS5. */
  proxy?: string;
}

export const DEFAULT_BASE_URL = 'https://api.cs.deals/public/v1';
export const DEFAULT_WS_URL = 'wss://api.cs.deals/public/v1/ws';
const DEFAULT_TIMEOUT_MS = 30_000;
const SDK_VERSION = '0.2.0';

type QueryValue = string | number | boolean | null | undefined;
export type Query = Record<string, QueryValue>;
export type Body = Record<string, unknown>;

interface Agents {
  http: HttpAgent;
  https: HttpsAgent;
}

export class CsDealsClient {
  readonly baseUrl: string;
  readonly wsUrl: string;
  readonly userAgent: string;
  private readonly apiKey: string;
  private readonly http: HttpClient;
  private readonly agents: Agents;

  constructor({ apiKey, baseUrl = DEFAULT_BASE_URL, wsUrl = DEFAULT_WS_URL, timeout = DEFAULT_TIMEOUT_MS, proxy }: CsDealsClientOptions) {
    if (!apiKey) throw new Error('CsDealsClient: apiKey is required');
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    this.wsUrl = wsUrl;
    this.userAgent = `csdeals-sdk/${SDK_VERSION} (+https://github.com/bekesibeni/csdeals-sdk)`;
    this.agents = proxy ? buildProxyAgents(proxy) : buildDirectAgents();

    const httpOptions: HttpClientOptions = {
      defaultHeaders: {
        Accept: 'application/json',
        'User-Agent': this.userAgent,
        Authorization: `Bearer ${apiKey}`,
      },
      defaultTimeout: timeout,
      gzip: true,
      httpAgent: this.agents.http,
      httpsAgent: this.agents.https,
    };
    this.http = new HttpClient(httpOptions);
  }

  /** Agent for the WebSocket, so it egresses exactly like REST. */
  get wsAgent(): HttpAgent {
    return this.wsUrl.startsWith('ws:') ? this.agents.http : this.agents.https;
  }

  /** What the socket's upgrade request carries. */
  requestHeaders(): Record<string, string> {
    return { Authorization: `Bearer ${this.apiKey}`, 'User-Agent': this.userAgent };
  }

  /** Destroys the agents so one-off scripts can exit immediately. Safe to call repeatedly. */
  destroy(): void {
    try {
      this.agents.http.destroy();
    } finally {
      this.agents.https.destroy();
    }
  }

  async get<T>(path: string, query?: Query, timeout?: number): Promise<T> {
    const response = await this.send('GET', path, { query, timeout });
    return unwrap<T>(response);
  }

  /** `get` with `If-None-Match`: an unchanged resource comes back as `notModified` rather than a body. */
  async getConditional<T>(path: string, query?: Query, options: { etag?: string | undefined; timeout?: number } = {}): Promise<Conditional<T>> {
    const response = await this.send('GET', path, {
      query,
      timeout: options.timeout,
      headers: options.etag ? { 'If-None-Match': options.etag } : undefined,
    });
    const etag = typeof response.headers.etag === 'string' ? response.headers.etag : undefined;
    if (response.statusCode === 304) return { notModified: true, etag: etag ?? options.etag };
    return { notModified: false, etag, data: unwrap<T>(response) };
  }

  async post<T>(path: string, body: Body, timeout?: number): Promise<T> {
    return unwrap<T>(await this.send('POST', path, { body, timeout }));
  }

  async patch<T>(path: string, body: Body, timeout?: number): Promise<T> {
    return unwrap<T>(await this.send('PATCH', path, { body, timeout }));
  }

  private send(
    method: string,
    path: string,
    options: { query?: Query | undefined; body?: Body; timeout?: number | undefined; headers?: Record<string, string> | undefined },
  ): Promise<HttpResponse> {
    const url = new URL(path.replace(/^\/+/, ''), this.baseUrl);
    for (const [key, value] of Object.entries(options.query ?? {})) {
      if (value !== undefined && value !== null) url.searchParams.append(key, String(value));
    }
    return this.http.request({
      method,
      url: url.toString(),
      ...(options.headers ? { headers: options.headers } : {}),
      ...(options.body ? { json: options.body } : {}),
      ...(options.timeout === undefined ? {} : { timeout: options.timeout }),
    });
  }
}

function unwrap<T>(response: HttpResponse): T {
  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new CsDealsApiError(response.statusCode, response.jsonBody ?? null, parseRetryAfter(response.headers['retry-after']));
  }
  return response.jsonBody as T;
}

/** `Retry-After` is either delta-seconds or an HTTP date. */
function parseRetryAfter(value: string | string[] | undefined): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds);
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(0, Math.ceil((at - Date.now()) / 1000)) : null;
}

function buildDirectAgents(): Agents {
  return { http: new NodeHttpAgent({ keepAlive: true }), https: new NodeHttpsAgent({ keepAlive: true }) };
}

function buildProxyAgents(proxy: string): Agents {
  const proxyUrl = /^(https?|socks5h?):\/\//.test(proxy) ? proxy : `socks5://${proxy}`;
  if (proxyUrl.startsWith('socks5')) {
    return { http: new SocksProxyAgent(proxyUrl), https: new SocksProxyAgent(proxyUrl) };
  }
  return { http: new HttpProxyAgent(proxyUrl), https: new HttpsProxyAgent(proxyUrl) };
}

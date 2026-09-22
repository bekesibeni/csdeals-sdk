import { CsDealsError, keyForCode } from "./errors.js";
import type { ConditionalResult, RateLimitInfo, RequestOptions } from "./types.js";

export const SDK_VERSION = "0.1.0";
export const DEFAULT_BASE_URL = "https://api.cs.deals";

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_RETRY_DELAY_MS = 10_000;

export type HttpMethod = "GET" | "POST" | "PATCH";

export type QueryValue = string | number | boolean | null | undefined;
export type Query = Record<string, QueryValue>;

export interface CallOptions extends RequestOptions {
  query?: Query;
  body?: unknown;
  /** Sent as `If-None-Match`. */
  etag?: string;
  maxResponseBytes?: number;
}

export interface CsDealsClientOptions {
  /** `csd_...`, sent as `Authorization: Bearer`. */
  apiKey: string;
  /** Defaults to production; must be https. */
  baseUrl?: string;
  timeoutMs?: number;
  /** Retries apply to GETs only. A write is never resent: cs.deals has no idempotency key. */
  maxRetries?: number;
  /** A `Retry-After` longer than this is thrown to the caller instead of slept through. */
  maxRetryDelayMs?: number;
  maxResponseBytes?: number;
  fetch?: typeof globalThis.fetch;
  /** Called with the `X-RateLimit-*` budget after every response that carries it. */
  onRateLimit?: (info: RateLimitInfo) => void;
  userAgent?: string;
}

interface RawResponse {
  status: number;
  headers: Headers;
  text: string;
}

export function pickRequestOptions(options: RequestOptions | undefined): RequestOptions {
  const out: RequestOptions = {};
  if (options?.signal) out.signal = options.signal;
  if (options?.timeoutMs !== undefined) out.timeoutMs = options.timeoutMs;
  return out;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function assertHttps(value: string, what: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new CsDealsError({ key: "NOT_CONFIGURED", status: 0, message: `Invalid ${what}` });
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new CsDealsError({
      key: "NOT_CONFIGURED",
      status: 0,
      message: `${what} must be a plain https URL`,
    });
  }
  return url.toString().replace(/\/+$/, "");
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new CsDealsError({ key: "NETWORK_ERROR", status: 0, message: "Aborted" }));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new CsDealsError({ key: "NETWORK_ERROR", status: 0, message: "Aborted" }));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

function headerInt(headers: Headers, name: string): number | null {
  const raw = headers.get(name);
  if (raw === null || raw.trim() === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export function buildQuery(query: Query | undefined): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue;
    params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}

export function parseJson(text: string, status: number, method: string, path: string): unknown {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new CsDealsError({
      key: "INVALID_RESPONSE",
      status,
      method,
      path,
      message: `cs.deals ${method} ${path} returned a non-JSON body`,
    });
  }
}

async function readBoundedText(response: Response, maxBytes: number, context: string): Promise<string> {
  const tooLarge = () =>
    new CsDealsError({
      key: "INVALID_RESPONSE",
      status: response.status,
      message: `cs.deals ${context} response exceeds ${maxBytes} bytes`,
    });
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge();
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw tooLarge();
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

function toHttpError(status: number, headers: Headers, text: string, method: string, path: string): CsDealsError {
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  const body = isRecord(payload) ? payload : {};
  const providerCode = typeof body.error === "string" ? body.error : null;
  const data = isRecord(body.data) ? body.data : null;
  const providerMessage = typeof body.message === "string" ? body.message : null;

  let key = keyForCode(providerCode);
  if (key === "UNKNOWN") {
    if (status === 401) key = "UNAUTHORIZED";
    else if (status === 403) key = "FORBIDDEN";
    else if (status === 404) key = "NOT_FOUND";
    else if (status === 429) key = "RATE_LIMITED";
    else if (status === 400 || status === 422) key = "INVALID_REQUEST";
  }

  return new CsDealsError({
    key,
    status,
    providerCode,
    data,
    retryAfterMs: parseRetryAfter(headers.get("retry-after")),
    method,
    path,
    message:
      providerMessage ??
      `cs.deals ${method} ${path} failed with ${status}${providerCode ? ` ${providerCode}` : ""}`,
  });
}

export class CsDealsClient {
  readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly maxRetryDelayMs: number;
  private readonly maxResponseBytes: number;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly onRateLimit: ((info: RateLimitInfo) => void) | undefined;
  private readonly userAgent: string;

  constructor(options: CsDealsClientOptions) {
    const apiKey = options.apiKey?.trim() ?? "";
    if (!apiKey) {
      throw new CsDealsError({ key: "NOT_CONFIGURED", status: 0, message: "CsDeals requires an apiKey" });
    }
    this.apiKey = apiKey;
    this.baseUrl = assertHttps(options.baseUrl ?? DEFAULT_BASE_URL, "baseUrl");
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = Math.max(0, options.maxRetries ?? 2);
    this.maxRetryDelayMs = options.maxRetryDelayMs ?? DEFAULT_MAX_RETRY_DELAY_MS;
    this.maxResponseBytes = options.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.onRateLimit = options.onRateLimit;
    this.userAgent = options.userAgent ?? `csdeals-sdk/${SDK_VERSION}`;
  }

  /** The WebSocket feed URL with the key as `api_key`, since a WHATWG WebSocket cannot set headers. */
  feedUrl(): string {
    const url = new URL(`${this.baseUrl}/public/v1/ws`);
    url.protocol = "wss:";
    url.searchParams.set("api_key", this.apiKey);
    return url.toString();
  }

  async get<T>(path: string, options: CallOptions = {}): Promise<T> {
    return this.json<T>("GET", path, options);
  }

  async post<T>(path: string, body: unknown, options: CallOptions = {}): Promise<T> {
    return this.json<T>("POST", path, { ...options, body });
  }

  async patch<T>(path: string, body: unknown, options: CallOptions = {}): Promise<T> {
    return this.json<T>("PATCH", path, { ...options, body });
  }

  async getText(path: string, options: CallOptions = {}): Promise<string> {
    const raw = await this.execute("GET", path, options);
    return raw.text;
  }

  async getConditional<T>(path: string, options: CallOptions = {}): Promise<ConditionalResult<T>> {
    const raw = await this.execute("GET", path, options);
    if (raw.status === 304) {
      return { notModified: true, etag: raw.headers.get("etag") ?? options.etag ?? "" };
    }
    return {
      notModified: false,
      etag: raw.headers.get("etag"),
      data: this.decode<T>(raw, "GET", path),
    };
  }

  /** Escape hatch for routes this SDK does not model. GETs retry; writes never do. */
  async request<T = unknown>(method: HttpMethod, path: string, options: CallOptions = {}): Promise<T> {
    return this.json<T>(method, path, options);
  }

  private async json<T>(method: HttpMethod, path: string, options: CallOptions): Promise<T> {
    const raw = await this.execute(method, path, options);
    return this.decode<T>(raw, method, path);
  }

  private decode<T>(raw: RawResponse, method: string, path: string): T {
    const value = parseJson(raw.text, raw.status, method, path);
    if (value !== null && typeof value === "object") return value as T;
    if (value === null && raw.status === 204) return value as T;
    throw new CsDealsError({
      key: "INVALID_RESPONSE",
      status: raw.status,
      method,
      path,
      message: `cs.deals ${method} ${path} returned no JSON object`,
    });
  }

  private async execute(method: HttpMethod, path: string, options: CallOptions): Promise<RawResponse> {
    const attempts = method === "GET" ? this.maxRetries + 1 : 1;
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.once(method, path, options);
      } catch (err) {
        if (!(err instanceof CsDealsError) || !err.retryable || attempt >= attempts - 1) throw err;
        const delay = err.retryAfterMs ?? Math.min(2 ** attempt * 250, 4_000);
        if (delay > this.maxRetryDelayMs) throw err;
        await sleep(delay, options.signal);
      }
    }
  }

  private async once(method: HttpMethod, path: string, options: CallOptions): Promise<RawResponse> {
    const cleanPath = `/${path.replace(/^\/+/, "")}`;
    const url = `${this.baseUrl}${cleanPath}${buildQuery(options.query)}`;
    const headers: Record<string, string> = {
      accept: "application/json",
      authorization: `Bearer ${this.apiKey}`,
      "user-agent": this.userAgent,
    };
    let body: string | undefined;
    if (method !== "GET") {
      headers["content-type"] = "application/json";
      body = JSON.stringify(options.body ?? {});
    }
    if (options.etag) headers["if-none-match"] = options.etag;

    const timeoutMs = options.timeoutMs ?? this.timeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onOuterAbort = () => controller.abort();
    options.signal?.addEventListener("abort", onOuterAbort, { once: true });

    try {
      let response: Response;
      try {
        response = await this.fetchImpl(url, {
          method,
          headers,
          ...(body !== undefined ? { body } : {}),
          redirect: "error",
          signal: controller.signal,
        });
      } catch (err) {
        if (controller.signal.aborted && !options.signal?.aborted) {
          throw new CsDealsError({
            key: "TIMEOUT",
            status: 0,
            method,
            path: cleanPath,
            message: `cs.deals ${method} ${cleanPath} timed out after ${timeoutMs}ms`,
          });
        }
        throw new CsDealsError({
          key: "NETWORK_ERROR",
          status: 0,
          method,
          path: cleanPath,
          message: (err as Error)?.message ?? `cs.deals ${method} ${cleanPath} failed`,
        });
      }

      this.reportRateLimit(method, cleanPath, response.headers);
      if (response.status === 304) return { status: 304, headers: response.headers, text: "" };

      let text: string;
      try {
        text = await readBoundedText(
          response,
          options.maxResponseBytes ?? this.maxResponseBytes,
          `${method} ${cleanPath}`,
        );
      } catch (err) {
        if (err instanceof CsDealsError) throw err;
        throw new CsDealsError({
          key: controller.signal.aborted && !options.signal?.aborted ? "TIMEOUT" : "NETWORK_ERROR",
          status: response.ok ? 0 : response.status,
          method,
          path: cleanPath,
          message: (err as Error)?.message ?? `cs.deals ${method} ${cleanPath} body read failed`,
        });
      }

      if (!response.ok) throw toHttpError(response.status, response.headers, text, method, cleanPath);
      return { status: response.status, headers: response.headers, text };
    } catch (err) {
      if (err instanceof CsDealsError && err.method === null) {
        throw new CsDealsError({
          key: err.key,
          status: err.status,
          providerCode: err.providerCode,
          data: err.data,
          retryAfterMs: err.retryAfterMs,
          method,
          path: cleanPath,
          message: err.message,
        });
      }
      throw err;
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onOuterAbort);
    }
  }

  private reportRateLimit(method: string, path: string, headers: Headers): void {
    if (!this.onRateLimit) return;
    const limit = headerInt(headers, "x-ratelimit-limit");
    const remaining = headerInt(headers, "x-ratelimit-remaining");
    if (limit === null || remaining === null) return;
    const reset = headerInt(headers, "x-ratelimit-reset");
    try {
      this.onRateLimit({ method, path, limit, remaining, resetAt: reset === null ? null : reset * 1_000 });
    } catch {
      // A throwing observer must not fail the request it is observing.
    }
  }
}

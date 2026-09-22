import { CsDealsSDK, type CsDealsSDKOptions } from "../src/index.js";

export const KEY = "csd_test_key";

export interface Call {
  url: URL;
  method: string;
  headers: Record<string, string>;
  body: unknown;
  init: RequestInit;
}

export type Handler = (call: Call) => Response | Promise<Response>;

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

export function sdkWith(handler: Handler, extra: Partial<CsDealsSDKOptions> = {}) {
  const calls: Call[] = [];
  const fetchStub = async (input: string | URL | Request, init: RequestInit = {}) => {
    const headers = Object.fromEntries(
      Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]),
    );
    const call: Call = {
      url: new URL(String(input)),
      method: init.method ?? "GET",
      headers,
      body: typeof init.body === "string" ? JSON.parse(init.body) : null,
      init,
    };
    calls.push(call);
    return handler(call);
  };
  const sdk = new CsDealsSDK({
    apiKey: KEY,
    maxRetries: 0,
    fetch: fetchStub as typeof globalThis.fetch,
    ...extra,
  });
  return { sdk, calls };
}

/** A fetch that never answers until the SDK aborts it. */
export function hangUntilAborted(call: Call): Promise<Response> {
  return new Promise((_, reject) => {
    call.init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
  });
}

export const PAGE = { total_pages: 1, total_items: 0, current_page: 1, current_limit: 100 };

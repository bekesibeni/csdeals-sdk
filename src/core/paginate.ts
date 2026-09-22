import type { PageMetadata } from "./types.js";

export interface PagedResponse {
  metadata: PageMetadata;
}

export interface IterateOptions {
  /** First page, 1-based. */
  startPage?: number;
  /** Stop after this many pages. */
  maxPages?: number;
  /** Minimum gap between page requests, for routes metered per second. */
  minIntervalMs?: number;
  signal?: AbortSignal;
}

export function wait(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener("abort", done);
      clearTimeout(timer);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}

/** Yields rows page by page until `metadata.total_pages` is reached or a page comes back empty. */
export async function* iteratePages<R extends PagedResponse, T>(
  fetchPage: (page: number) => Promise<R>,
  rows: (response: R) => T[],
  options: IterateOptions = {},
): AsyncGenerator<T, void, undefined> {
  let page = options.startPage ?? 1;
  let fetched = 0;
  let last = 0;
  for (;;) {
    if (options.signal?.aborted) return;
    if (options.maxPages !== undefined && fetched >= options.maxPages) return;
    await wait(last + (options.minIntervalMs ?? 0) - Date.now(), options.signal);
    if (options.signal?.aborted) return;
    last = Date.now();
    const response = await fetchPage(page);
    fetched++;
    const batch = rows(response);
    yield* batch;
    if (batch.length === 0 || page >= response.metadata.total_pages) return;
    page++;
  }
}

/** Yields rows until the cursor comes back `null`. */
export async function* iterateCursor<R, T>(
  fetchPage: (cursor: number | undefined) => Promise<R>,
  rows: (response: R) => T[],
  nextCursor: (response: R) => number | null,
  options: Omit<IterateOptions, "startPage"> & { startCursor?: number } = {},
): AsyncGenerator<T, void, undefined> {
  let cursor = options.startCursor;
  let fetched = 0;
  let last = 0;
  for (;;) {
    if (options.signal?.aborted) return;
    if (options.maxPages !== undefined && fetched >= options.maxPages) return;
    await wait(last + (options.minIntervalMs ?? 0) - Date.now(), options.signal);
    if (options.signal?.aborted) return;
    last = Date.now();
    const response = await fetchPage(cursor);
    fetched++;
    yield* rows(response);
    const next = nextCursor(response);
    if (next === null || next === cursor) return;
    cursor = next;
  }
}

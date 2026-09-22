import { type CsDealsClient, pickRequestOptions } from "../../core/client.js";
import { type IterateOptions, iterateCursor, iteratePages } from "../../core/paginate.js";
import type { ConditionalResult, ListingRow, RequestOptions } from "../../core/types.js";
import { assertOneOf, assertPositiveInt, assertText } from "../../core/validate.js";
import type {
  Book,
  ConditionalAppParams,
  ListingsParams,
  ListingsResponse,
  PriceRow,
  PricesAll,
  PricesParams,
  PricesResponse,
  Sale,
  SalesAverages,
  SalesParams,
  SalesResponse,
} from "./types.js";

const BULK_READ = { timeoutMs: 120_000, maxResponseBytes: 256 * 1024 * 1024 };

export function initMarketModule(client: CsDealsClient) {
  const module = {
    /** Active listings with full item detail, newest first. Metered at 1 request/second. */
    async listings(params: ListingsParams = {}): Promise<ListingsResponse> {
      assertOneOf(params.limit, [500, 1000] as const, "limit");
      if (params.cursor !== undefined) assertPositiveInt(params.cursor, "cursor");
      if (params.page !== undefined) assertPositiveInt(params.page, "page");
      return client.get("/public/v1/listings", {
        ...pickRequestOptions(params),
        query: {
          limit: params.limit ?? 1000,
          page: params.page,
          cursor: params.cursor,
          app_id: params.app_id,
        },
      });
    },

    /** One listing; `LISTING_NOT_FOUND` once sold or delisted. */
    async listing(id: number, options?: RequestOptions): Promise<ListingRow> {
      assertPositiveInt(id, "id");
      return client.get(`/public/v1/listings/${id}`, pickRequestOptions(options));
    },

    /** Every active listing plus the feed `seq` it is valid at. 6/min: for (re)syncing, not polling. */
    async book(params: ConditionalAppParams = {}): Promise<ConditionalResult<Book>> {
      return client.getConditional("/public/v1/book", {
        ...BULK_READ,
        ...pickRequestOptions(params),
        etag: params.etag,
        query: { app_id: params.app_id },
      });
    },

    async prices(params: PricesParams = {}): Promise<PricesResponse> {
      return client.get("/public/v1/prices", {
        ...pickRequestOptions(params),
        query: { page: params.page ?? 1, limit: params.limit ?? 100, app_id: params.app_id },
      });
    },

    /** Every price in one cached response (60s, ETag). */
    async pricesAll(params: ConditionalAppParams = {}): Promise<ConditionalResult<PricesAll>> {
      return client.getConditional("/public/v1/prices/all", {
        ...BULK_READ,
        ...pickRequestOptions(params),
        etag: params.etag,
        query: { app_id: params.app_id },
      });
    },

    /** Recent sales, newest first. Metered at 1 request per 5 seconds. */
    async sales(params: SalesParams = {}): Promise<SalesResponse> {
      if (params.market_hash_name !== undefined) assertText(params.market_hash_name, 1, 200, "market_hash_name");
      return client.get("/public/v1/sales", {
        ...pickRequestOptions(params),
        query: {
          page: params.page ?? 1,
          limit: params.limit ?? 100,
          app_id: params.app_id,
          market_hash_name: params.market_hash_name,
        },
      });
    },

    /** 30-day volume-weighted average sale price per item (cached 10 min, ETag). */
    async salesAverages(params: ConditionalAppParams = {}): Promise<ConditionalResult<SalesAverages>> {
      return client.getConditional("/public/v1/sales/averages", {
        ...BULK_READ,
        ...pickRequestOptions(params),
        etag: params.etag,
        query: { app_id: params.app_id },
      });
    },

    /** Walks the whole book by cursor, paced to the 1 request/second meter. */
    iterateListings(
      params: Omit<ListingsParams, "page" | "cursor"> = {},
      options: IterateOptions & { startCursor?: number } = {},
    ): AsyncGenerator<ListingRow, void, undefined> {
      return iterateCursor(
        (cursor) => module.listings({ ...params, cursor }),
        (r) => r.listings,
        (r) => r.next_cursor,
        { minIntervalMs: 1_000, signal: params.signal, ...options },
      );
    },

    iteratePrices(
      params: Omit<PricesParams, "page"> = {},
      options: IterateOptions = {},
    ): AsyncGenerator<PriceRow, void, undefined> {
      return iteratePages(
        (page) => module.prices({ ...params, page }),
        (r) => r.prices,
        { minIntervalMs: 1_000, signal: params.signal, ...options },
      );
    },

    /** Paced to the 1 request per 5 seconds meter. */
    iterateSales(
      params: Omit<SalesParams, "page"> = {},
      options: IterateOptions = {},
    ): AsyncGenerator<Sale, void, undefined> {
      return iteratePages(
        (page) => module.sales({ ...params, page }),
        (r) => r.sales,
        { minIntervalMs: 5_000, signal: params.signal, ...options },
      );
    },
  };
  return module;
}

export * from "./types.js";

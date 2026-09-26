import type { CsDealsClient } from '../../core/client.js';
import type { Conditional, ListingRow } from '../../core/types.js';
import type {
  AllPrices,
  Book,
  ConditionalParams,
  GetListingsParams,
  GetPricesParams,
  GetSalesParams,
  ListingsResponse,
  PricesResponse,
  SalesAverages,
  SalesResponse,
} from './types.js';

/** The whole-market reads are several MB. */
const BULK_TIMEOUT_MS = 120_000;

export function initMarketModule(client: CsDealsClient) {
  return {
    /** Active listings with full item detail, newest first. 1 request/second. */
    async getListings(params: GetListingsParams = {}): Promise<ListingsResponse> {
      return client.get('listings', {
        app_id: params.appId,
        limit: params.limit ?? 1000,
        page: params.page,
        cursor: params.cursor,
      });
    },

    /** One listing with `trade_locked_until`; 404 `LISTING_NOT_FOUND` once sold or delisted. */
    async getListing(id: number): Promise<ListingRow> {
      return client.get(`listings/${id}`);
    },

    /** Every active listing plus the feed `seq` it is valid at. 6/min: for syncing, not polling. */
    async getBook(params: ConditionalParams = {}): Promise<Conditional<Book>> {
      return client.getConditional('book', { app_id: params.appId }, { etag: params.etag, timeout: BULK_TIMEOUT_MS });
    },

    async getPrices(params: GetPricesParams = {}): Promise<PricesResponse> {
      return client.get('prices', { app_id: params.appId, page: params.page ?? 1, limit: params.limit ?? 100 });
    },

    /** Every price with stock and listing count, one cached response (60 s). */
    async getAllPrices(params: ConditionalParams = {}): Promise<Conditional<AllPrices>> {
      return client.getConditional('prices/all', { app_id: params.appId }, { etag: params.etag, timeout: BULK_TIMEOUT_MS });
    },

    /** Recent sales, newest first. 1 request per 5 seconds. */
    async getSales(params: GetSalesParams = {}): Promise<SalesResponse> {
      return client.get('sales', {
        app_id: params.appId,
        market_hash_name: params.marketHashName,
        page: params.page ?? 1,
        limit: params.limit ?? 100,
      });
    },

    /** 30-day volume-weighted average sale price per item (cached 10 min). */
    async getSalesAverages(params: ConditionalParams = {}): Promise<Conditional<SalesAverages>> {
      return client.getConditional('sales/averages', { app_id: params.appId }, { etag: params.etag, timeout: BULK_TIMEOUT_MS });
    },
  };
}

export * from './types.js';

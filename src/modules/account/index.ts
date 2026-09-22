import { type CsDealsClient, type Query, pickRequestOptions } from "../../core/client.js";
import { isError } from "../../core/errors.js";
import { type IterateOptions, iteratePages } from "../../core/paginate.js";
import type { RequestOptions } from "../../core/types.js";
import { assertOneOf, assertPositiveInt, assertText, assertTwoFactor } from "../../core/validate.js";
import {
  type ApiInfo,
  type CryptoWithdrawal,
  type CryptoWithdrawParams,
  type ExportOrdersParams,
  type Order,
  type OrdersExport,
  type OrdersParams,
  type OrdersResponse,
  TRANSACTION_ACTIONS,
  type Transaction,
  type TransactionsParams,
  type TransactionsResponse,
  type User,
} from "./types.js";

const EXPORT_READ = { timeoutMs: 300_000, maxResponseBytes: 512 * 1024 * 1024 };
const CRYPTO_TICKERS = ["BTC", "LTC", "ETH", "USDC", "SOL"] as const;
const FEE_LEVELS = ["LOW", "MEDIUM", "HIGH"] as const;

function isoDate(value: string | Date | undefined): string | undefined {
  if (value === undefined) return undefined;
  return value instanceof Date ? value.toISOString() : value;
}

function exportQuery(params: ExportOrdersParams, format: "csv" | "json"): Query {
  assertOneOf(params.side, ["bought", "sold"] as const, "side");
  return {
    format,
    side: params.side,
    app_id: params.app_id,
    from: isoDate(params.from),
    to: isoDate(params.to),
  };
}

export function initAccountModule(client: CsDealsClient) {
  const module = {
    /** `GET /public/v1`, the one unauthenticated route: API version, feed path, route list. */
    async apiInfo(options?: RequestOptions): Promise<ApiInfo> {
      return client.get("/public/v1", pickRequestOptions(options));
    },

    /** True when the key is live, false when cs.deals answers UNAUTHORISED. */
    async verifyKey(options?: RequestOptions): Promise<boolean> {
      try {
        await client.getText("/auth/api-key", pickRequestOptions(options));
        return true;
      } catch (err) {
        if (isError(err, "UNAUTHORIZED")) return false;
        throw err;
      }
    },

    async user(options?: RequestOptions): Promise<User> {
      return client.get("/public/v1/user", pickRequestOptions(options));
    },

    /** Bought and sold order items, newest first. */
    async orders(params: OrdersParams = {}): Promise<OrdersResponse> {
      return client.get("/public/v1/orders", {
        ...pickRequestOptions(params),
        query: { page: params.page ?? 1, limit: params.limit ?? 100 },
      });
    },

    /** The whole order history, oldest first, as typed rows. 5/min. */
    async exportOrders(params: ExportOrdersParams = {}): Promise<OrdersExport> {
      return client.get("/public/v1/orders/export", {
        ...EXPORT_READ,
        ...pickRequestOptions(params),
        query: exportQuery(params, "json"),
      });
    },

    /** The same export as a CSV document with a header row. 5/min. */
    async exportOrdersCsv(params: ExportOrdersParams = {}): Promise<string> {
      return client.getText("/public/v1/orders/export", {
        ...EXPORT_READ,
        ...pickRequestOptions(params),
        query: exportQuery(params, "csv"),
      });
    },

    /** Every balance movement with the running balance after it. */
    async transactions(params: TransactionsParams = {}): Promise<TransactionsResponse> {
      assertOneOf(params.action, TRANSACTION_ACTIONS, "action");
      return client.get("/public/v1/transactions", {
        ...pickRequestOptions(params),
        query: { page: params.page ?? 1, limit: params.limit ?? 100, action: params.action },
      });
    },

    /**
     * Sends balance to a crypto address. Never retried: on an `ambiguous` error, read
     * `transactions({ action: "WITHDRAWAL" })` before trying again.
     */
    async cryptoWithdraw(params: CryptoWithdrawParams): Promise<CryptoWithdrawal> {
      assertPositiveInt(params?.amount, "amount");
      assertOneOf(params.ticker, CRYPTO_TICKERS, "ticker");
      assertText(params.address, 1, 512, "address");
      assertOneOf(params.fee_level, FEE_LEVELS, "fee_level");
      assertTwoFactor(params.two_factor_auth_token);
      return client.post(
        "/public/v1/crypto-withdraw",
        {
          amount: params.amount,
          ticker: params.ticker,
          address: params.address,
          fee_level: params.fee_level ?? "MEDIUM",
          ...(params.two_factor_auth_token !== undefined
            ? { two_factor_auth_token: params.two_factor_auth_token }
            : {}),
        },
        pickRequestOptions(params),
      );
    },

    async cryptoWithdrawal(id: number, options?: RequestOptions): Promise<CryptoWithdrawal> {
      assertPositiveInt(id, "id");
      return client.get(`/public/v1/crypto-withdraw/${id}`, pickRequestOptions(options));
    },

    iterateOrders(
      params: Omit<OrdersParams, "page"> = {},
      options: IterateOptions = {},
    ): AsyncGenerator<Order, void, undefined> {
      return iteratePages(
        (page) => module.orders({ ...params, page }),
        (r) => r.orders,
        { minIntervalMs: 1_000, signal: params.signal, ...options },
      );
    },

    iterateTransactions(
      params: Omit<TransactionsParams, "page"> = {},
      options: IterateOptions = {},
    ): AsyncGenerator<Transaction, void, undefined> {
      return iteratePages(
        (page) => module.transactions({ ...params, page }),
        (r) => r.transactions,
        { minIntervalMs: 2_000, signal: params.signal, ...options },
      );
    },
  };
  return module;
}

export * from "./types.js";

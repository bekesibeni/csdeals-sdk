import { type CsDealsClient, pickRequestOptions } from "../../core/client.js";
import { type IterateOptions, iteratePages } from "../../core/paginate.js";
import { TRADE_STATUSES, type Trade } from "../../core/types.js";
import {
  assertLines,
  assertOneOf,
  assertPositiveInt,
  assertRange,
  assertText,
  assertTokenLines,
  assertTwoFactor,
  MAX_PURCHASE_AMOUNT,
} from "../../core/validate.js";
import type {
  BackpackItem,
  BackpackParams,
  BackpackResponse,
  DepositParams,
  DepositResult,
  PurchaseParams,
  PurchaseResult,
  TradesParams,
  TradesResponse,
  WithdrawParams,
  WithdrawResult,
} from "./types.js";

export function initTradingModule(client: CsDealsClient) {
  const module = {
    /**
     * Buys listings atomically. Never retried: on an `ambiguous` error, read `account.orders()`
     * before deciding whether it went through.
     */
    async purchase(params: PurchaseParams): Promise<PurchaseResult> {
      assertLines(params.items, "items");
      params.items.forEach((line, i) => {
        assertPositiveInt(line?.listing_id, `items[${i}].listing_id`);
        assertRange(line.amount, 1, MAX_PURCHASE_AMOUNT, `items[${i}].amount`);
        assertPositiveInt(line.max_price, `items[${i}].max_price`);
        if (line.private_token !== undefined) assertText(line.private_token, 8, 24, `items[${i}].private_token`);
      });
      return client.post(
        "/public/v1/purchase",
        {
          items: params.items.map((line) => ({
            listing_id: line.listing_id,
            amount: line.amount,
            max_price: line.max_price,
            ...(line.private_token !== undefined ? { private_token: line.private_token } : {}),
          })),
        },
        pickRequestOptions(params),
      );
    },

    async backpack(params: BackpackParams = {}): Promise<BackpackResponse> {
      if (params.search !== undefined) assertText(params.search, 1, 200, "search");
      return client.get("/public/v1/backpack", {
        ...pickRequestOptions(params),
        query: {
          page: params.page ?? 1,
          limit: params.limit ?? 100,
          app_id: params.app_id,
          search: params.search,
        },
      });
    },

    /** Moves Steam items into the backpack unlisted: we get a trade offer to accept. */
    async deposit(params: DepositParams): Promise<DepositResult> {
      assertTokenLines(params.items, "items");
      return client.post(
        "/public/v1/deposit",
        { items: params.items.map((line) => ({ token: line.token, amount: line.amount })) },
        pickRequestOptions(params),
      );
    },

    /**
     * Sends backpack items to Steam, one offer per holding bot. Never retried: on an `ambiguous`
     * error, read `trades()` for a new `withdraw_id` before trying again.
     */
    async withdraw(params: WithdrawParams): Promise<WithdrawResult> {
      assertLines(params.items, "items");
      params.items.forEach((line, i) => {
        assertPositiveInt(line?.id, `items[${i}].id`);
        assertPositiveInt(line.amount, `items[${i}].amount`);
      });
      assertTwoFactor(params.two_factor_auth_token);
      return client.post(
        "/public/v1/withdraw",
        {
          items: params.items.map((line) => ({ id: line.id, amount: line.amount })),
          ...(params.two_factor_auth_token !== undefined
            ? { two_factor_auth_token: params.two_factor_auth_token }
            : {}),
        },
        pickRequestOptions(params),
      );
    },

    /** Your Steam trades, newest first. Metered at 1 request/second. */
    async trades(params: TradesParams = {}): Promise<TradesResponse> {
      assertOneOf(params.limit, [500, 1000] as const, "limit");
      assertOneOf(params.status, TRADE_STATUSES, "status");
      return client.get("/public/v1/trades", {
        ...pickRequestOptions(params),
        query: { page: params.page ?? 1, limit: params.limit ?? 1000, status: params.status },
      });
    },

    iterateTrades(
      params: Omit<TradesParams, "page"> = {},
      options: IterateOptions = {},
    ): AsyncGenerator<Trade, void, undefined> {
      return iteratePages(
        (page) => module.trades({ ...params, page }),
        (r) => r.trades,
        { minIntervalMs: 1_000, signal: params.signal, ...options },
      );
    },

    iterateBackpack(
      params: Omit<BackpackParams, "page"> = {},
      options: IterateOptions = {},
    ): AsyncGenerator<BackpackItem, void, undefined> {
      return iteratePages(
        (page) => module.backpack({ ...params, page }),
        (r) => r.items,
        { minIntervalMs: 2_000, signal: params.signal, ...options },
      );
    },
  };
  return module;
}

export * from "./types.js";

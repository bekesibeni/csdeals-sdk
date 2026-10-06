import type { CsDealsClient } from '../../core/client.js';
import { PurchaseMismatchError } from '../../core/errors.js';
import type {
  BackpackResponse,
  DepositResult,
  GetBackpackParams,
  GetTradesParams,
  PurchaseLine,
  PurchaseResult,
  TokenLine,
  TradesResponse,
  WithdrawParams,
  WithdrawResult,
} from './types.js';

/** Rows carry no listing id, so a basket is held to its highest ceiling, its total and its copy count. */
function matchesRequest(order: PurchaseResult, lines: PurchaseLine[]): boolean {
  const items = order.items ?? [];
  const ceiling = Math.max(...lines.map((line) => line.maxPrice));
  const allowed = lines.reduce((sum, line) => sum + line.maxPrice, 0);
  const requested = lines.length;
  const charged = items.reduce((sum, item) => sum + item.price * item.amount, 0);
  const copies = items.reduce((sum, item) => sum + item.amount, 0);
  return items.every((item) => item.price <= ceiling) && charged <= allowed && copies === requested;
}

export function initTradingModule(client: CsDealsClient) {
  return {
    /**
     * Buys 1-50 listings atomically into the backpack. There is no idempotency key: after a timeout
     * or a 5xx, look for the order in `account.getOrders()` rather than buying again.
     */
    async purchase(lines: PurchaseLine[]): Promise<PurchaseResult> {
      const order = await client.post<PurchaseResult>('purchase', {
        items: lines.map((line) => ({
          listing_id: line.listingId,
          amount: 1,
          max_price: line.maxPrice,
          private_token: line.privateToken,
        })),
      });
      if (!matchesRequest(order, lines)) throw new PurchaseMismatchError(order);
      return order;
    },

    async getBackpack(params: GetBackpackParams = {}): Promise<BackpackResponse> {
      return client.get('backpack', {
        app_id: params.appId,
        search: params.search,
        page: params.page ?? 1,
        limit: params.limit ?? 100,
      });
    },

    /**
     * Sends backpack items to the account's linked Steam account, one offer per holding bot. Same
     * rule as `purchase`: after a timeout, look for a new `withdraw_id` in `getTrades()` first.
     */
    async withdraw(params: WithdrawParams): Promise<WithdrawResult> {
      return client.post('withdraw', {
        items: params.items.map((line) => ({ id: line.id, amount: line.amount })),
        two_factor_auth_token: params.twoFactorToken,
      });
    },

    /** Moves Steam items into the backpack unlisted; the account gets a trade offer to accept. */
    async deposit(items: TokenLine[]): Promise<DepositResult> {
      return client.post('deposit', { items: items.map((line) => ({ token: line.token, amount: line.amount })) });
    },

    /** The account's Steam trades, newest first. 1 request/second. */
    async getTrades(params: GetTradesParams = {}): Promise<TradesResponse> {
      return client.get('trades', { page: params.page ?? 1, limit: params.limit ?? 1000, status: params.status });
    },
  };
}

export * from './types.js';

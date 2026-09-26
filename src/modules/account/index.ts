import type { CsDealsClient } from '../../core/client.js';
import type { PageParams } from '../../core/types.js';
import type {
  CryptoWithdrawal,
  CryptoWithdrawParams,
  ExportOrdersParams,
  GetTransactionsParams,
  OrdersExport,
  OrdersResponse,
  TransactionsResponse,
  User,
} from './types.js';

const EXPORT_TIMEOUT_MS = 300_000;

const isoDate = (value: Date | string | undefined) => (value instanceof Date ? value.toISOString() : value);

export function initAccountModule(client: CsDealsClient) {
  return {
    async getUser(): Promise<User> {
      return client.get('user');
    },

    /** Bought and sold order items, newest first. Where a timed-out `purchase` is settled. */
    async getOrders(params: PageParams = {}): Promise<OrdersResponse> {
      return client.get('orders', { page: params.page ?? 1, limit: params.limit ?? 100 });
    },

    /** The whole order history, oldest first. 5/min. */
    async exportOrders(params: ExportOrdersParams = {}): Promise<OrdersExport> {
      return client.get(
        'orders/export',
        { format: 'json', side: params.side, app_id: params.appId, from: isoDate(params.from), to: isoDate(params.to) },
        EXPORT_TIMEOUT_MS,
      );
    },

    /** Every balance movement with the running balance after it. */
    async getTransactions(params: GetTransactionsParams = {}): Promise<TransactionsResponse> {
      return client.get('transactions', { action: params.action, page: params.page ?? 1, limit: params.limit ?? 100 });
    },

    /** No idempotency key: after a timeout, look in `getTransactions({ action: 'WITHDRAWAL' })` first. */
    async cryptoWithdraw(params: CryptoWithdrawParams): Promise<CryptoWithdrawal> {
      return client.post('crypto-withdraw', {
        amount: params.amount,
        ticker: params.ticker,
        address: params.address,
        two_factor_auth_token: params.twoFactorToken,
      });
    },

    async getCryptoWithdrawal(id: number): Promise<CryptoWithdrawal> {
      return client.get(`crypto-withdraw/${id}`);
    },
  };
}

export * from './types.js';

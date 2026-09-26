import type { PageMetadata, PageParams } from '../../core/types.js';

export interface User {
  id: number;
  steam_id: string | null;
  name: string;
  /** Cents. */
  balance: number;
}

export type OrderSide = 'bought' | 'sold';

export interface Order {
  order_item_id: number;
  order_id: number;
  side: OrderSide;
  app_id: number;
  market_hash_name: string;
  price: number;
  amount: number;
  created_at: string;
}

export interface OrdersResponse {
  orders: Order[];
  metadata: PageMetadata;
}

export interface ExportedOrder {
  order_item_id: number;
  order_id: number;
  side: OrderSide;
  app_id: number;
  market_hash_name: string;
  amount: number;
  unit_price: number;
  total_value: number;
  /** Selling commission; only on `sold` rows. */
  fee: number | null;
  net: number;
  created_at: string;
  settled_at: string | null;
}

export interface OrdersExport {
  orders: ExportedOrder[];
}

export type TransactionAction =
  | 'DEPOSIT'
  | 'WITHDRAWAL'
  | 'WITHDRAWAL_REFUND'
  | 'INSTANT_SELL_PAYOUT'
  | 'PURCHASE'
  | 'SALE'
  | 'BALANCE_ADJUSTMENT'
  | 'TRADE_REVERSAL_REFUND';

export interface Transaction {
  id: number;
  action: TransactionAction;
  /** Signed. */
  amount: number;
  /** Running balance after this movement. */
  balance: number;
  message: string;
  created_at: string;
}

export interface TransactionsResponse {
  transactions: Transaction[];
  metadata: PageMetadata;
}

export type CryptoTicker = 'BTC' | 'LTC' | 'ETH' | 'USDC' | 'SOL';

export type CryptoWithdrawalStatus = 'CREATED' | 'PENDING' | 'CANCELLED' | 'DECLINED' | 'FAILED' | 'CONFIRMING' | 'SUCCESS' | 'CHARGEBACK';

export interface CryptoWithdrawal {
  withdrawal_id: number;
  status: CryptoWithdrawalStatus;
  /** Deducted from the balance in full; fees come off it. */
  balance_amount: number;
  token_amount: number;
  ticker: CryptoTicker;
  created_at: string;
  /** Set from `CONFIRMING` on. */
  tx_hash: string | null;
  network_fee: string | null;
}

export interface ExportOrdersParams {
  side?: OrderSide;
  appId?: number;
  from?: Date | string;
  to?: Date | string;
}

export interface GetTransactionsParams extends PageParams {
  action?: TransactionAction;
}

export interface CryptoWithdrawParams {
  /** Cents off the balance, fees included. */
  amount: number;
  ticker: CryptoTicker;
  address: string;
  twoFactorToken?: string;
}

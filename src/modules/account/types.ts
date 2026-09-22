import type { AppIdParam, Cents, IsoDateTime, PageMetadata, PageParams, RequestOptions } from "../../core/types.js";

// ── Entities ──

export interface ApiInfo {
  version: string;
  websocket: { path: string; auth: string };
  events: string[];
  rest: string[];
}

export interface User {
  id: number;
  steam_id: string | null;
  name: string;
  balance: Cents;
}

export type OrderSide = "bought" | "sold";

export interface Order {
  order_item_id: number;
  order_id: number;
  side: OrderSide;
  app_id: number;
  market_hash_name: string;
  price: Cents;
  amount: number;
  created_at: IsoDateTime;
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
  unit_price: Cents;
  total_value: Cents;
  /** Selling commission; only ever set on `sold` rows. */
  fee: Cents | null;
  net: Cents;
  created_at: IsoDateTime;
  settled_at: IsoDateTime | null;
}

export interface OrdersExport {
  orders: ExportedOrder[];
}

export const TRANSACTION_ACTIONS = [
  "DEPOSIT",
  "WITHDRAWAL",
  "WITHDRAWAL_REFUND",
  "INSTANT_SELL_PAYOUT",
  "PURCHASE",
  "SALE",
  "BALANCE_ADJUSTMENT",
  "TRADE_REVERSAL_REFUND",
] as const;

export type TransactionAction = (typeof TRANSACTION_ACTIONS)[number];

export interface Transaction {
  id: number;
  action: TransactionAction;
  /** Signed. */
  amount: Cents;
  /** Running balance after this movement. */
  balance: Cents;
  message: string;
  created_at: IsoDateTime;
}

export interface TransactionsResponse {
  transactions: Transaction[];
  metadata: PageMetadata;
}

export type CryptoTicker = "BTC" | "LTC" | "ETH" | "USDC" | "SOL";
export type CryptoFeeLevel = "LOW" | "MEDIUM" | "HIGH";

export type CryptoWithdrawalStatus =
  | "CREATED"
  | "PENDING"
  | "CANCELLED"
  | "DECLINED"
  | "FAILED"
  | "CONFIRMING"
  | "SUCCESS"
  | "CHARGEBACK";

export interface CryptoWithdrawal {
  withdrawal_id: number;
  status: CryptoWithdrawalStatus;
  /** Deducted from the balance in full; fees come off it. */
  balance_amount: Cents;
  token_amount: number;
  ticker: CryptoTicker;
  created_at: IsoDateTime;
  /** Set from `CONFIRMING` on. */
  tx_hash: string | null;
  network_fee: string | null;
}

// ── Params ──

export interface OrdersParams extends PageParams, RequestOptions {}

export interface ExportOrdersParams extends RequestOptions {
  side?: OrderSide;
  app_id?: AppIdParam;
  from?: string | Date;
  to?: string | Date;
}

export interface TransactionsParams extends PageParams, RequestOptions {
  action?: TransactionAction;
}

export interface CryptoWithdrawParams extends RequestOptions {
  /** Cents off the balance, fees included. Below the per-currency minimum answers 400. */
  amount: Cents;
  ticker: CryptoTicker;
  address: string;
  fee_level?: CryptoFeeLevel;
  two_factor_auth_token?: string;
}

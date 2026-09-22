import { CsDealsError } from "./errors.js";
import type { PriceDecayInput, TokenLine } from "./types.js";

export const MAX_LINES_PER_REQUEST = 50;
export const MAX_PURCHASE_AMOUNT = 500;
export const MAX_COPIES_PER_OFFER = 500;
export const MAX_ACTIVE_TRADES = 15;
export const PRICE_DECAY_MIN_HOURS = 24;
export const PRICE_DECAY_MAX_HOURS = 168;

export function invalidRequest(message: string): never {
  throw new CsDealsError({ key: "INVALID_REQUEST", status: 0, message });
}

export function assertPositiveInt(value: unknown, what: string): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    invalidRequest(`${what} must be a positive integer, got ${String(value)}`);
  }
}

export function assertLines(lines: readonly unknown[] | undefined, what: string): void {
  if (!Array.isArray(lines) || lines.length === 0 || lines.length > MAX_LINES_PER_REQUEST) {
    invalidRequest(`${what} must hold 1-${MAX_LINES_PER_REQUEST} entries, got ${Array.isArray(lines) ? lines.length : "none"}`);
  }
}

export function assertRange(value: unknown, min: number, max: number, what: string): asserts value is number {
  assertPositiveInt(value, what);
  if (value < min || value > max) invalidRequest(`${what} must be ${min}-${max}, got ${value}`);
}

export function assertText(value: unknown, min: number, max: number, what: string): asserts value is string {
  if (typeof value !== "string" || value.length < min || value.length > max) {
    invalidRequest(`${what} must be ${min}-${max} characters`);
  }
}

export function assertTwoFactor(token: string | undefined): void {
  if (token === undefined) return;
  if (!/^\d{6}$/.test(token)) invalidRequest("two_factor_auth_token must be 6 digits");
}

export function assertPriceDecay(decay: PriceDecayInput, what: string): void {
  assertPositiveInt(decay?.start_price, `${what}.start_price`);
  assertPositiveInt(decay.end_price, `${what}.end_price`);
  if (decay.end_price >= decay.start_price) invalidRequest(`${what}.end_price must be below start_price`);
  assertRange(decay.total_hours, PRICE_DECAY_MIN_HOURS, PRICE_DECAY_MAX_HOURS, `${what}.total_hours`);
}

/** Exactly one of `price` / `price_decay` for a new listing; at most one on an edit. */
export function assertPricing(
  entry: { price?: number | undefined; price_decay?: PriceDecayInput | undefined },
  what: string,
  required: boolean,
): void {
  const hasPrice = entry.price !== undefined;
  const hasDecay = entry.price_decay !== undefined;
  if (hasPrice && hasDecay) invalidRequest(`${what} takes price or price_decay, not both`);
  if (required && !hasPrice && !hasDecay) invalidRequest(`${what} needs price or price_decay`);
  if (hasPrice) assertPositiveInt(entry.price, `${what}.price`);
  if (hasDecay) assertPriceDecay(entry.price_decay as PriceDecayInput, `${what}.price_decay`);
}

export function assertTokenLines(items: readonly TokenLine[], what: string): void {
  assertLines(items, what);
  items.forEach((line, i) => {
    assertText(line?.token, 1, 4_096, `${what}[${i}].token`);
    assertPositiveInt(line.amount, `${what}[${i}].amount`);
  });
}

export function assertOneOf<T>(value: T | undefined, allowed: readonly T[], what: string): void {
  if (value === undefined) return;
  if (!allowed.includes(value)) invalidRequest(`${what} must be one of ${allowed.join(", ")}, got ${String(value)}`);
}

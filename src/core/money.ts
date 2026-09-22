import { CsDealsError } from "./errors.js";
import type { Cents } from "./types.js";

export function formatUsdCents(cents: Cents): string {
  if (!Number.isSafeInteger(cents)) {
    throw new CsDealsError({ key: "INVALID_REQUEST", status: 0, message: `Not integer cents: ${cents}` });
  }
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** "42.5" / "42.50" / 42.5 -> 4250. Refuses sub-cent precision instead of rounding it away. */
export function parseUsdCents(value: string | number): Cents {
  const text = typeof value === "number" ? String(value) : value.trim();
  const match = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) {
    throw new CsDealsError({ key: "INVALID_REQUEST", status: 0, message: `Not a USD amount: ${value}` });
  }
  const cents = Number(match[2]) * 100 + Number((match[3] ?? "").padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) {
    throw new CsDealsError({ key: "INVALID_REQUEST", status: 0, message: `USD amount out of range: ${value}` });
  }
  return match[1] ? -cents : cents;
}

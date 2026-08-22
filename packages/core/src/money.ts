import { z } from "zod";

/** Largest non-negative value representable by PostgreSQL numeric(14,2). */
export const NUMERIC_14_2_MAX = 999_999_999_999.99;

function hasAtMostTwoDecimalPlaces(value: number): boolean {
  const parts = value.toString().toLowerCase().split("e");
  const coefficient = parts[0] ?? "";
  const exponent = Number.parseInt(parts[1] ?? "0", 10);
  const decimalPoint = coefficient.indexOf(".");
  const fractionalDigits = decimalPoint === -1 ? 0 : coefficient.length - decimalPoint - 1;

  return Math.max(0, fractionalDigits - exponent) <= 2;
}

/**
 * Exact input boundary for non-negative monetary values persisted as
 * PostgreSQL numeric(14,2). Values are rejected instead of silently rounded.
 */
export const monetaryAmountSchema = z
  .number()
  .finite()
  .nonnegative()
  .max(NUMERIC_14_2_MAX)
  .refine(hasAtMostTwoDecimalPlaces, {
    message: "monetary amounts can have at most two decimal places"
  });

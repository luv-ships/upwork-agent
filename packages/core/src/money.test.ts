import { describe, expect, it } from "vitest";

import { monetaryAmountSchema, NUMERIC_14_2_MAX } from "./index.js";

describe("monetaryAmountSchema", () => {
  it("accepts numeric(14,2) boundaries and ordinary decimal amounts", () => {
    expect(monetaryAmountSchema.safeParse(0).success).toBe(true);
    expect(monetaryAmountSchema.safeParse(0.29).success).toBe(true);
    expect(monetaryAmountSchema.safeParse(1e-2).success).toBe(true);
    expect(monetaryAmountSchema.safeParse(NUMERIC_14_2_MAX).success).toBe(true);
  });

  it("rejects values that require rounding or exceed numeric(14,2)", () => {
    expect(monetaryAmountSchema.safeParse(0.001).success).toBe(false);
    expect(monetaryAmountSchema.safeParse(12.345).success).toBe(false);
    expect(monetaryAmountSchema.safeParse(NUMERIC_14_2_MAX + 0.01).success).toBe(false);
    expect(monetaryAmountSchema.safeParse(Number.POSITIVE_INFINITY).success).toBe(false);
  });
});

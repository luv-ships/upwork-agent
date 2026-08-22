import { describe, expect, it } from "vitest";

import {
  nonnegativePostgresIntegerSchema,
  POSTGRES_INTEGER_MAX
} from "./index.js";

describe("nonnegativePostgresIntegerSchema", () => {
  it("accepts the non-negative PostgreSQL integer boundaries", () => {
    expect(nonnegativePostgresIntegerSchema.safeParse(0).success).toBe(true);
    expect(nonnegativePostgresIntegerSchema.safeParse(POSTGRES_INTEGER_MAX).success).toBe(true);
  });

  it("rejects negative, fractional, and overflowing values", () => {
    expect(nonnegativePostgresIntegerSchema.safeParse(-1).success).toBe(false);
    expect(nonnegativePostgresIntegerSchema.safeParse(1.5).success).toBe(false);
    expect(nonnegativePostgresIntegerSchema.safeParse(POSTGRES_INTEGER_MAX + 1).success).toBe(
      false
    );
  });
});

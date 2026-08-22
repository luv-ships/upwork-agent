import { z } from "zod";

export const POSTGRES_INTEGER_MAX = 2_147_483_647;

/** Input boundary for non-negative values persisted in PostgreSQL integer columns. */
export const nonnegativePostgresIntegerSchema = z
  .number()
  .int()
  .nonnegative()
  .max(POSTGRES_INTEGER_MAX);

import { z } from "zod";

import { monetaryAmountSchema } from "./money.js";
import { nonnegativePostgresIntegerSchema } from "./postgres.js";

// Development source IDs are tenant-qualified as `${workspaceId}:${id}` in a
// 300-character database field. A UUID plus separator reserves 37 characters.
export const DEVELOPMENT_SOURCE_JOB_ID_MAX_LENGTH = 263;

const sourceTextSchema = z.string().trim().min(1).max(300);
const developmentSourceJobIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(DEVELOPMENT_SOURCE_JOB_ID_MAX_LENGTH);
const sourceTextListSchema = z.array(z.string().trim().min(1).max(160)).max(100);
const usdRangeSchema = z
  .object({
    currency: z.literal("USD"),
    min: monetaryAmountSchema.optional(),
    max: monetaryAmountSchema.optional()
  })
  .refine((range) => range.min !== undefined || range.max !== undefined, {
    message: "at least one monetary boundary is required"
  })
  .refine(
    (range) => range.min === undefined || range.max === undefined || range.min <= range.max,
    { message: "minimum cannot exceed maximum" }
  );

export const sourceJobInputSchema = z.object({
  sourceJobId: developmentSourceJobIdSchema,
  title: sourceTextSchema,
  description: z.string().trim().min(1).max(20_000),
  postedAt: z.string().datetime({ offset: true }).optional(),
  skills: sourceTextListSchema.default([]),
  categoryIds: sourceTextListSchema.default([]),
  experienceLevel: z.enum(["entry", "intermediate", "expert"]).optional(),
  jobType: z.enum(["hourly", "fixed"]),
  hourlyRate: usdRangeSchema.optional(),
  fixedBudget: usdRangeSchema.optional(),
  proposalCount: nonnegativePostgresIntegerSchema.optional(),
  paymentVerified: z.boolean().optional(),
  client: z
    .object({
      countryCode: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/).optional(),
      timeZone: z.string().trim().min(1).max(100).optional(),
      hireCount: nonnegativePostgresIntegerSchema.optional(),
      hireRatePercent: z.number().int().min(0).max(100).optional()
    })
    .optional(),
  projectLengthBand: z
    .enum(["under_1_month", "one_to_three_months", "three_to_six_months", "over_6_months"])
    .optional(),
  hoursPerWeekBand: z.enum(["under_30", "over_30"]).optional(),
  isContractToHire: z.boolean().optional()
});

// The development endpoint and approved source adapters intentionally share a
// single bounded source contract. The alias keeps the development-only HTTP
// boundary explicit without duplicating normalization semantics.
export const developmentJobInputSchema = sourceJobInputSchema;

export const normalizedJobSchema = z.object({
  title: sourceTextSchema,
  description: z.string().trim().min(1).max(20_000),
  postedAt: z.string().datetime({ offset: true }).optional(),
  skills: sourceTextListSchema,
  categoryIds: sourceTextListSchema,
  experienceLevel: z.enum(["entry", "intermediate", "expert"]).optional(),
  jobType: z.enum(["hourly", "fixed"]),
  hourlyRate: usdRangeSchema.optional(),
  fixedBudget: usdRangeSchema.optional(),
  proposalCount: nonnegativePostgresIntegerSchema.optional(),
  paymentVerified: z.boolean().optional(),
  clientCountryCode: z.string().regex(/^[A-Z]{2}$/).optional(),
  clientTimeZone: z.string().min(1).max(100).optional(),
  clientHireCount: nonnegativePostgresIntegerSchema.optional(),
  clientHireRatePercent: z.number().int().min(0).max(100).optional(),
  projectLengthBand: z
    .enum(["under_1_month", "one_to_three_months", "three_to_six_months", "over_6_months"])
    .optional(),
  hoursPerWeekBand: z.enum(["under_30", "over_30"]).optional(),
  isContractToHire: z.boolean().optional()
});

export type SourceJobInput = z.infer<typeof sourceJobInputSchema>;
export type DevelopmentJobInput = SourceJobInput;
export type NormalizedJob = z.infer<typeof normalizedJobSchema>;

function normalizeList(values: string[]): string[] {
  const unique = new Map<string, string>();
  for (const value of values) {
    const trimmed = value.trim().replace(/\s+/g, " ");
    const key = trimmed.toLocaleLowerCase("en-US");
    if (trimmed.length > 0 && !unique.has(key)) unique.set(key, trimmed);
  }
  return [...unique.values()];
}

export function normalizeSourceJob(input: SourceJobInput): NormalizedJob {
  const parsed = sourceJobInputSchema.parse(input);
  return normalizedJobSchema.parse({
    title: parsed.title.replace(/\s+/g, " "),
    description: parsed.description.replace(/\r\n?/g, "\n").trim(),
    ...(parsed.postedAt === undefined ? {} : { postedAt: parsed.postedAt }),
    skills: normalizeList(parsed.skills),
    categoryIds: normalizeList(parsed.categoryIds),
    jobType: parsed.jobType,
    ...(parsed.experienceLevel === undefined ? {} : { experienceLevel: parsed.experienceLevel }),
    ...(parsed.hourlyRate === undefined ? {} : { hourlyRate: parsed.hourlyRate }),
    ...(parsed.fixedBudget === undefined ? {} : { fixedBudget: parsed.fixedBudget }),
    ...(parsed.proposalCount === undefined ? {} : { proposalCount: parsed.proposalCount }),
    ...(parsed.paymentVerified === undefined ? {} : { paymentVerified: parsed.paymentVerified }),
    ...(parsed.client?.countryCode === undefined ? {} : { clientCountryCode: parsed.client.countryCode }),
    ...(parsed.client?.timeZone === undefined ? {} : { clientTimeZone: parsed.client.timeZone }),
    ...(parsed.client?.hireCount === undefined ? {} : { clientHireCount: parsed.client.hireCount }),
    ...(parsed.client?.hireRatePercent === undefined ? {} : { clientHireRatePercent: parsed.client.hireRatePercent }),
    ...(parsed.projectLengthBand === undefined ? {} : { projectLengthBand: parsed.projectLengthBand }),
    ...(parsed.hoursPerWeekBand === undefined ? {} : { hoursPerWeekBand: parsed.hoursPerWeekBand }),
    ...(parsed.isContractToHire === undefined ? {} : { isContractToHire: parsed.isContractToHire })
  });
}

export const normalizeDevelopmentJob = normalizeSourceJob;

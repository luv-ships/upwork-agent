import { z } from "zod";

import { monetaryAmountSchema } from "./money.js";
import { nonnegativePostgresIntegerSchema } from "./postgres.js";

const boundedText = z.string().trim().min(1).max(160);
const uniqueTextList = z.array(boundedText).max(100).superRefine((values, context) => {
  const normalized = values.map((value) => value.toLocaleLowerCase("en-US"));
  if (new Set(normalized).size !== normalized.length) {
    context.addIssue({ code: "custom", message: "values must be unique" });
  }
});

export const numericRangeSchema = z
  .object({
    min: monetaryAmountSchema.optional(),
    max: monetaryAmountSchema.optional()
  })
  .refine((range) => range.min !== undefined || range.max !== undefined, {
    message: "at least one range boundary is required"
  })
  .refine(
    (range) => range.min === undefined || range.max === undefined || range.min <= range.max,
    { message: "minimum cannot exceed maximum" }
  );

export const campaignScoringWeightsV1Schema = z
  .object({
    version: z.literal(1),
    skills: z.number().int().min(0).max(100).default(30),
    keywords: z.number().int().min(0).max(100).default(20),
    budget: z.number().int().min(0).max(100).default(15),
    competition: z.number().int().min(0).max(100).default(15),
    clientQuality: z.number().int().min(0).max(100).default(10),
    projectFit: z.number().int().min(0).max(100).default(10)
  })
  .refine(
    (weights) =>
      weights.skills +
        weights.keywords +
        weights.budget +
        weights.competition +
        weights.clientQuality +
        weights.projectFit >
      0,
    { message: "at least one scoring weight must be greater than zero" }
  );

export type CampaignScoringWeightsV1 = z.infer<typeof campaignScoringWeightsV1Schema>;

export const defaultCampaignScoringWeightsV1: CampaignScoringWeightsV1 =
  campaignScoringWeightsV1Schema.parse({ version: 1 });

const integerRangeSchema = z
  .object({
    min: nonnegativePostgresIntegerSchema.optional(),
    max: nonnegativePostgresIntegerSchema.optional()
  })
  .refine((range) => range.min !== undefined || range.max !== undefined, {
    message: "at least one range boundary is required"
  })
  .refine(
    (range) => range.min === undefined || range.max === undefined || range.min <= range.max,
    { message: "minimum cannot exceed maximum" }
  );

const clientHireRatePercentRangeSchema = integerRangeSchema.refine(
  (range) =>
    (range.min === undefined || range.min <= 100) &&
    (range.max === undefined || range.max <= 100),
  { message: "client hire rate must be between 0 and 100 percent" },
);

export const campaignFilterV1Schema = z.object({
  version: z.literal(1),
  requiredSkills: uniqueTextList.default([]),
  includeKeywords: uniqueTextList.default([]),
  excludeKeywords: uniqueTextList.default([]),
  categoryIds: uniqueTextList.default([]),
  experienceLevels: z.array(z.enum(["entry", "intermediate", "expert"])).max(3).default([]),
  jobTypes: z.array(z.enum(["hourly", "fixed"])).max(2).default([]),
  hourlyRate: numericRangeSchema.optional(),
  fixedBudget: numericRangeSchema.optional(),
  proposalCount: integerRangeSchema.optional(),
  clientHireRatePercent: clientHireRatePercentRangeSchema.optional(),
  postedWithinMinutes: z.number().int().positive().max(43_200).optional(),
  paymentVerification: z.enum(["any", "only_verified", "only_unverified"]).default("any"),
  clientHireHistory: z.enum(["any", "no_hires", "1_to_9", "10_plus"]).default("any"),
  clientCountryCodes: z.array(z.string().trim().regex(/^[A-Z]{2}$/)).max(250).default([]),
  clientTimeZones: uniqueTextList.default([]),
  projectLengthBands: z
    .array(z.enum(["under_1_month", "one_to_three_months", "three_to_six_months", "over_6_months"]))
    .max(4)
    .default([]),
  hoursPerWeekBands: z.array(z.enum(["under_30", "over_30"])).max(2).default([]),
  contractToHire: z.enum(["any", "only", "exclude"]).default("any"),
  scoringWeights: campaignScoringWeightsV1Schema.optional()
});

export type NumericRange = z.infer<typeof numericRangeSchema>;
export type CampaignFilterV1 = z.infer<typeof campaignFilterV1Schema>;

export const emptyCampaignFilterV1: CampaignFilterV1 = campaignFilterV1Schema.parse({
  version: 1
});

import { describe, expect, it } from "vitest";

import {
  campaignFilterV1Schema,
  emptyCampaignFilterV1,
  numericRangeSchema,
  POSTGRES_INTEGER_MAX
} from "./index.js";

describe("campaignFilterV1Schema", () => {
  it("applies explicit defaults for every optional filter group", () => {
    expect(campaignFilterV1Schema.parse({ version: 1 })).toEqual(emptyCampaignFilterV1);
    expect(emptyCampaignFilterV1).toEqual({
      version: 1,
      requiredSkills: [],
      includeKeywords: [],
      excludeKeywords: [],
      categoryIds: [],
      experienceLevels: [],
      jobTypes: [],
      paymentVerification: "any",
      clientHireHistory: "any",
      clientCountryCodes: [],
      clientTimeZones: [],
      projectLengthBands: [],
      hoursPerWeekBands: [],
      contractToHire: "any"
    });
  });

  it("rejects case-insensitive duplicates in text lists", () => {
    const result = campaignFilterV1Schema.safeParse({
      version: 1,
      requiredSkills: ["OpenAI", " openai "]
    });

    expect(result.success).toBe(false);
  });

  it("requires canonical uppercase country codes", () => {
    expect(
      campaignFilterV1Schema.safeParse({ version: 1, clientCountryCodes: ["us"] }).success
    ).toBe(false);
    expect(
      campaignFilterV1Schema.safeParse({ version: 1, clientCountryCodes: ["US"] }).success
    ).toBe(true);
  });

  it("rejects empty, negative, reversed, and non-finite numeric ranges", () => {
    expect(numericRangeSchema.safeParse({}).success).toBe(false);
    expect(numericRangeSchema.safeParse({ min: -1 }).success).toBe(false);
    expect(numericRangeSchema.safeParse({ min: 101, max: 100 }).success).toBe(false);
    expect(numericRangeSchema.safeParse({ max: Number.POSITIVE_INFINITY }).success).toBe(false);
    expect(numericRangeSchema.safeParse({ min: 0, max: 0 }).success).toBe(true);
  });

  it("rejects filter amounts that numeric(14,2) would round or overflow", () => {
    expect(numericRangeSchema.safeParse({ min: 10.001 }).success).toBe(false);
    expect(numericRangeSchema.safeParse({ max: 1_000_000_000_000 }).success).toBe(false);
    expect(numericRangeSchema.safeParse({ min: 10.01 }).success).toBe(true);
  });

  it("rejects proposal count ranges that overflow PostgreSQL integer", () => {
    expect(
      campaignFilterV1Schema.safeParse({
        version: 1,
        proposalCount: { max: POSTGRES_INTEGER_MAX }
      }).success
    ).toBe(true);
    expect(
      campaignFilterV1Schema.safeParse({
        version: 1,
        proposalCount: { max: POSTGRES_INTEGER_MAX + 1 }
      }).success
    ).toBe(false);
  });

  it("accepts bounded publication-age filters", () => {
    expect(
      campaignFilterV1Schema.parse({ version: 1, postedWithinMinutes: 60 })
        .postedWithinMinutes,
    ).toBe(60);
    expect(
      campaignFilterV1Schema.safeParse({ version: 1, postedWithinMinutes: 43_201 })
        .success,
    ).toBe(false);
  });

  it("accepts bounded client hire-rate percentages", () => {
    expect(
      campaignFilterV1Schema.parse({ version: 1, clientHireRatePercent: { min: 40 } })
        .clientHireRatePercent,
    ).toEqual({ min: 40 });
    expect(
      campaignFilterV1Schema.safeParse({
        version: 1,
        clientHireRatePercent: { max: 101 },
      }).success,
    ).toBe(false);
  });
});

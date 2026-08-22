import { describe, expect, it } from "vitest";

import {
  DEVELOPMENT_SOURCE_JOB_ID_MAX_LENGTH,
  POSTGRES_INTEGER_MAX,
  developmentJobInputSchema,
  normalizeDevelopmentJob,
  normalizedJobSchema
} from "./index.js";

describe("development job contracts", () => {
  it("normalizes text, case-insensitive list duplicates, and nested client fields", () => {
    const normalized = normalizeDevelopmentJob({
      sourceJobId: " source-123 ",
      title: "  Need   an automation expert  ",
      description: "  First line\r\nSecond  line  ",
      skills: [" Make.com ", "make.com", "OpenAI", " API   integration "],
      categoryIds: [" Automation ", "automation", "AI Development"],
      experienceLevel: "expert",
      jobType: "fixed",
      fixedBudget: { currency: "USD", min: 1_500, max: 2_200 },
      proposalCount: 3,
      paymentVerified: true,
      client: {
        countryCode: "us",
        timeZone: "America/New_York",
        hireCount: 14,
        hireRatePercent: 42
      },
      projectLengthBand: "one_to_three_months",
      hoursPerWeekBand: "under_30",
      isContractToHire: false
    });

    expect(normalized).toEqual({
      title: "Need an automation expert",
      description: "First line\nSecond  line",
      skills: ["Make.com", "OpenAI", "API integration"],
      categoryIds: ["Automation", "AI Development"],
      experienceLevel: "expert",
      jobType: "fixed",
      fixedBudget: { currency: "USD", min: 1_500, max: 2_200 },
      proposalCount: 3,
      paymentVerified: true,
      clientCountryCode: "US",
      clientTimeZone: "America/New_York",
      clientHireCount: 14,
      clientHireRatePercent: 42,
      projectLengthBand: "one_to_three_months",
      hoursPerWeekBand: "under_30",
      isContractToHire: false
    });
    expect("sourceJobId" in normalized).toBe(false);
    expect(normalizedJobSchema.safeParse(normalized).success).toBe(true);
  });

  it("supplies empty normalized lists when optional source lists are omitted", () => {
    const normalized = normalizeDevelopmentJob({
      sourceJobId: "source-124",
      title: "Small job",
      description: "A sufficiently clear development job.",
      jobType: "hourly"
    });

    expect(normalized.skills).toEqual([]);
    expect(normalized.categoryIds).toEqual([]);
  });

  it("reserves room for the tenant prefix in the persisted source job ID", () => {
    const baseJob = {
      description: "A sufficiently clear development job.",
      jobType: "fixed" as const,
      title: "Small job"
    };

    expect(
      developmentJobInputSchema.safeParse({
        ...baseJob,
        sourceJobId: "x".repeat(DEVELOPMENT_SOURCE_JOB_ID_MAX_LENGTH)
      }).success
    ).toBe(true);
    expect(
      developmentJobInputSchema.safeParse({
        ...baseJob,
        sourceJobId: "x".repeat(DEVELOPMENT_SOURCE_JOB_ID_MAX_LENGTH + 1)
      }).success
    ).toBe(false);
  });

  it("rejects monetary input that numeric(14,2) cannot preserve exactly", () => {
    const baseJob = {
      description: "A sufficiently clear development job.",
      jobType: "fixed" as const,
      sourceJobId: "source-money",
      title: "Small job"
    };

    expect(
      developmentJobInputSchema.safeParse({
        ...baseJob,
        fixedBudget: { currency: "USD", min: 10.001 }
      }).success
    ).toBe(false);
    expect(
      developmentJobInputSchema.safeParse({
        ...baseJob,
        fixedBudget: { currency: "USD", max: 1_000_000_000_000 }
      }).success
    ).toBe(false);
  });

  it("rejects proposal and client hire counts that overflow PostgreSQL integer", () => {
    const baseJob = {
      description: "A sufficiently clear development job.",
      jobType: "fixed" as const,
      sourceJobId: "source-counts",
      title: "Small job"
    };

    expect(
      developmentJobInputSchema.safeParse({
        ...baseJob,
        client: { hireCount: POSTGRES_INTEGER_MAX },
        proposalCount: POSTGRES_INTEGER_MAX
      }).success
    ).toBe(true);
    expect(
      developmentJobInputSchema.safeParse({
        ...baseJob,
        proposalCount: POSTGRES_INTEGER_MAX + 1
      }).success
    ).toBe(false);
    expect(
      developmentJobInputSchema.safeParse({
        ...baseJob,
        client: { hireCount: POSTGRES_INTEGER_MAX + 1 }
      }).success
    ).toBe(false);
  });

  it.each([
    {
      label: "foreign currency",
      value: {
        sourceJobId: "source-1",
        title: "Title",
        description: "Description",
        jobType: "fixed",
        fixedBudget: { currency: "EUR", min: 10 }
      }
    },
    {
      label: "reversed monetary range",
      value: {
        sourceJobId: "source-2",
        title: "Title",
        description: "Description",
        jobType: "hourly",
        hourlyRate: { currency: "USD", min: 100, max: 50 }
      }
    },
    {
      label: "negative proposal count",
      value: {
        sourceJobId: "source-3",
        title: "Title",
        description: "Description",
        jobType: "fixed",
        proposalCount: -1
      }
    },
    {
      label: "invalid country code",
      value: {
        sourceJobId: "source-4",
        title: "Title",
        description: "Description",
        jobType: "fixed",
        client: { countryCode: "USA" }
      }
    }
  ])("rejects $label", ({ value }) => {
    expect(developmentJobInputSchema.safeParse(value).success).toBe(false);
  });
});

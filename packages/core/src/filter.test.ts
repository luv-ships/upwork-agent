import { describe, expect, it } from "vitest";

import {
  campaignFilterV1Schema,
  evaluateCampaignFilter,
  type CampaignFilterV1,
  type NormalizedJob
} from "./index.js";

const baseJob: NormalizedJob = {
  title: "Need Make.com and OpenAI automation expert",
  description: "Build a reliable webhook workflow and document the handoff.",
  skills: ["Make.com", "OpenAI", "API integration"],
  categoryIds: ["automation", "ai-development"],
  experienceLevel: "expert",
  jobType: "fixed",
  fixedBudget: { currency: "USD", min: 1_500, max: 2_200 },
  proposalCount: 3,
  paymentVerified: true,
  clientCountryCode: "US",
  clientTimeZone: "America/New_York",
  clientHireCount: 14,
  projectLengthBand: "one_to_three_months",
  hoursPerWeekBand: "under_30",
  isContractToHire: false
};

function filter(overrides: Partial<CampaignFilterV1> = {}): CampaignFilterV1 {
  return campaignFilterV1Schema.parse({ version: 1, ...overrides });
}

describe("evaluateCampaignFilter", () => {
  it("matches when no filter group is selected", () => {
    expect(evaluateCampaignFilter(filter(), baseJob)).toEqual({
      matched: true,
      evidence: {
        version: 1,
        checks: [],
        matchedSkills: [],
        matchedKeywords: []
      }
    });
  });

  it("evaluates publication recency against an explicit caller timestamp", () => {
    const asOf = new Date("2026-08-21T10:00:00.000Z");
    const recent = evaluateCampaignFilter(
      filter({ postedWithinMinutes: 60 }),
      { ...baseJob, postedAt: "2026-08-21T09:30:00.000Z" },
      { asOf },
    );
    const old = evaluateCampaignFilter(
      filter({ postedWithinMinutes: 60 }),
      { ...baseJob, postedAt: "2026-08-21T08:59:59.000Z" },
      { asOf },
    );
    const missing = evaluateCampaignFilter(filter({ postedWithinMinutes: 60 }), baseJob, {
      asOf,
    });

    expect(recent.evidence.checks[0]).toMatchObject({
      rule: "posted_within",
      passed: true,
      code: "matched",
    });
    expect(old.matched).toBe(false);
    expect(missing.evidence.checks[0]?.code).toBe("missing_source_data");
  });

  it("matches a client hire-rate range and fails closed when it is unavailable", () => {
    const matched = evaluateCampaignFilter(
      filter({ clientHireRatePercent: { min: 40 } }),
      { ...baseJob, clientHireRatePercent: 42 },
    );
    const missing = evaluateCampaignFilter(filter({ clientHireRatePercent: { min: 40 } }), baseJob);

    expect(matched.evidence.checks[0]).toMatchObject({
      rule: "client_hire_rate_percent",
      passed: true,
      actual: 42,
      code: "matched",
    });
    expect(missing.evidence.checks[0]?.code).toBe("missing_source_data");
  });

  it("uses OR within selected multi-value groups", () => {
    const decision = evaluateCampaignFilter(
      filter({
        requiredSkills: ["make.com", "OPENAI"],
        includeKeywords: ["Shopify", "WEBHOOK"],
        excludeKeywords: ["unpaid trial", "commission only"],
        categoryIds: ["marketing", "AUTOMATION"],
        experienceLevels: ["intermediate", "expert"],
        jobTypes: ["hourly", "fixed"],
        fixedBudget: { min: 1_000, max: 2_500 },
        proposalCount: { max: 5 },
        paymentVerification: "only_verified",
        clientHireHistory: "10_plus",
        clientCountryCodes: ["GB", "US"],
        clientTimeZones: ["Asia/Kolkata", "America/New_York"],
        projectLengthBands: ["under_1_month", "one_to_three_months"],
        hoursPerWeekBands: ["over_30", "under_30"],
        contractToHire: "exclude"
      }),
      baseJob
    );

    expect(decision.matched).toBe(true);
    expect(decision.evidence.checks.every((item) => item.passed)).toBe(true);
    expect(decision.evidence.matchedSkills).toEqual(["make.com", "OPENAI"]);
    expect(decision.evidence.matchedKeywords).toEqual(["WEBHOOK"]);
  });

  it("uses AND across filter groups and retains evidence for every evaluated group", () => {
    const decision = evaluateCampaignFilter(
      filter({
        requiredSkills: ["OpenAI"],
        categoryIds: ["sales"],
        paymentVerification: "only_verified"
      }),
      baseJob
    );

    expect(decision.matched).toBe(false);
    expect(decision.evidence.checks).toEqual([
      expect.objectContaining({ rule: "required_skills", passed: true, code: "matched" }),
      expect.objectContaining({ rule: "category", passed: false, code: "not_matched" }),
      expect.objectContaining({ rule: "payment_verification", passed: true, code: "matched" })
    ]);
  });

  it("requires all explicitly required skills and rejects any excluded keyword", () => {
    const missingSkill = evaluateCampaignFilter(
      filter({ requiredSkills: ["Make.com", "Python"] }),
      baseJob
    );
    const excludedText = evaluateCampaignFilter(
      filter({ excludeKeywords: ["document the handoff"] }),
      baseJob
    );

    expect(missingSkill.matched).toBe(false);
    expect(missingSkill.evidence.matchedSkills).toEqual(["Make.com"]);
    expect(excludedText.matched).toBe(false);
    expect(excludedText.evidence.checks[0]).toEqual(
      expect.objectContaining({
        rule: "exclude_keywords",
        code: "not_matched",
        actual: ["document the handoff"]
      })
    );
  });

  it("marks a selected rule with absent source data as missing and does not match", () => {
    const sparseJob: NormalizedJob = {
      title: "Automation work",
      description: "Build an integration.",
      skills: [],
      categoryIds: [],
      jobType: "fixed"
    };
    const decision = evaluateCampaignFilter(
      filter({
        categoryIds: ["automation"],
        experienceLevels: ["expert"],
        fixedBudget: { min: 100 },
        paymentVerification: "only_verified",
        clientHireHistory: "10_plus",
        clientHireRatePercent: { min: 40 },
        clientCountryCodes: ["US"],
        clientTimeZones: ["America/New_York"],
        projectLengthBands: ["under_1_month"],
        hoursPerWeekBands: ["under_30"],
        contractToHire: "only"
      }),
      sparseJob
    );

    expect(decision.matched).toBe(false);
    expect(decision.evidence.checks).toHaveLength(12);
    expect(decision.evidence.checks.find((item) => item.rule === "job_type")).toEqual(
      expect.objectContaining({ code: "matched", actual: "fixed" })
    );
    expect(
      decision.evidence.checks
        .filter((item) => item.rule !== "job_type")
        .every((item) => item.code === "missing_source_data")
    ).toBe(true);
  });

  it("marks an empty source skills list as missing when skills are required", () => {
    const decision = evaluateCampaignFilter(
      filter({ requiredSkills: ["OpenAI"] }),
      { ...baseJob, skills: [] }
    );

    expect(decision.matched).toBe(false);
    expect(decision.evidence.checks).toEqual([
      expect.objectContaining({
        actual: [],
        code: "missing_source_data",
        passed: false,
        rule: "required_skills"
      })
    ]);
  });

  it("treats inclusive range overlap as a match", () => {
    const decision = evaluateCampaignFilter(
      filter({ fixedBudget: { min: 100, max: 500 } }),
      {
        ...baseJob,
        fixedBudget: { currency: "USD", min: 500, max: 900 }
      }
    );

    expect(decision.matched).toBe(true);
    expect(decision.evidence.checks.find((item) => item.rule === "fixed_budget")).toEqual(
      expect.objectContaining({ rule: "fixed_budget", passed: true, code: "matched" })
    );
  });

  it("rejects disjoint ranges, including one-sided ranges", () => {
    const aboveMaximum = evaluateCampaignFilter(
      filter({ fixedBudget: { max: 499.99 } }),
      {
        ...baseJob,
        fixedBudget: { currency: "USD", min: 500 }
      }
    );
    const belowMinimum = evaluateCampaignFilter(
      filter({ hourlyRate: { min: 75 } }),
      {
        ...baseJob,
        jobType: "hourly",
        fixedBudget: undefined,
        hourlyRate: { currency: "USD", max: 74.99 }
      }
    );

    expect(aboveMaximum.matched).toBe(false);
    expect(
      aboveMaximum.evidence.checks.find((item) => item.rule === "fixed_budget")?.code
    ).toBe("not_matched");
    expect(belowMinimum.matched).toBe(false);
    expect(
      belowMinimum.evidence.checks.find((item) => item.rule === "hourly_rate")?.code
    ).toBe("not_matched");
  });

  it("checks proposal and client-history boundaries inclusively", () => {
    const decision = evaluateCampaignFilter(
      filter({ proposalCount: { min: 3, max: 3 }, clientHireHistory: "10_plus" }),
      { ...baseJob, proposalCount: 3, clientHireCount: 10 }
    );

    expect(decision.matched).toBe(true);
  });

  it("applies only the rate range for the job's selected type", () => {
    const bothTypes = filter({
      jobTypes: ["hourly", "fixed"],
      hourlyRate: { min: 50, max: 100 },
      fixedBudget: { min: 1_000, max: 2_500 }
    });

    expect(evaluateCampaignFilter(bothTypes, baseJob).matched).toBe(true);
    expect(
      evaluateCampaignFilter(bothTypes, {
        ...baseJob,
        jobType: "hourly",
        fixedBudget: undefined,
        hourlyRate: { currency: "USD", min: 75, max: 90 }
      }).matched
    ).toBe(true);
  });

  it("infers a job-type restriction from a lone type-specific range", () => {
    const hourlyOnly = filter({ hourlyRate: { min: 50 } });

    expect(evaluateCampaignFilter(hourlyOnly, baseJob).matched).toBe(false);
    expect(
      evaluateCampaignFilter(hourlyOnly, {
        ...baseJob,
        jobType: "hourly",
        fixedBudget: undefined,
        hourlyRate: { currency: "USD", min: 60 }
      }).matched
    ).toBe(true);
  });
});

import { describe, expect, it } from "vitest";

import {
  campaignFilterV1Schema,
  evaluateCampaignFilter,
  scoreJobPreference,
  type NormalizedJob
} from "./index.js";

const job: NormalizedJob = {
  title: "Make.com and OpenAI automation",
  description: "Build a webhook workflow and an AI assistant.",
  skills: ["Make.com", "OpenAI", "API integration"],
  categoryIds: ["automation"],
  experienceLevel: "expert",
  jobType: "fixed",
  fixedBudget: { currency: "USD", min: 1_500, max: 2_000 },
  proposalCount: 2,
  paymentVerified: true,
  clientHireCount: 18,
  projectLengthBand: "one_to_three_months",
  hoursPerWeekBand: "under_30",
  isContractToHire: false
};

describe("scoreJobPreference", () => {
  it("returns the same transparent result for the same inputs", () => {
    const filter = campaignFilterV1Schema.parse({
      version: 1,
      requiredSkills: ["Make.com", "OpenAI"],
      includeKeywords: ["webhook", "assistant", "Shopify"],
      fixedBudget: { min: 1_000, max: 2_500 },
      proposalCount: { max: 5 },
      paymentVerification: "only_verified",
      clientHireHistory: "10_plus",
      projectLengthBands: ["one_to_three_months"],
      scoringWeights: {
        version: 1,
        skills: 35,
        keywords: 25,
        budget: 15,
        competition: 15,
        clientQuality: 5,
        projectFit: 5
      }
    });
    const decision = evaluateCampaignFilter(filter, job);
    expect(decision.matched).toBe(true);

    const first = scoreJobPreference(filter, job, decision.evidence);
    const second = scoreJobPreference(filter, job, decision.evidence);

    expect(second).toEqual(first);
    expect(first.score).toBeGreaterThanOrEqual(0);
    expect(first.score).toBeLessThanOrEqual(100);
    expect(first.components.map((component) => component.dimension)).toEqual([
      "skills",
      "keywords",
      "budget",
      "competition",
      "client_quality",
      "project_fit"
    ]);
    expect(first.components.find((component) => component.dimension === "keywords")?.score).toBe(67);
  });

  it("includes a configured client hire-rate signal in client quality", () => {
    const filter = campaignFilterV1Schema.parse({
      version: 1,
      clientHireRatePercent: { min: 40 },
      scoringWeights: {
        version: 1,
        skills: 0,
        keywords: 0,
        budget: 0,
        competition: 0,
        clientQuality: 100,
        projectFit: 0,
      },
    });
    const decision = evaluateCampaignFilter(filter, { ...job, clientHireRatePercent: 42 });
    const result = scoreJobPreference(filter, { ...job, clientHireRatePercent: 42 }, decision.evidence);

    expect(result.components).toEqual([
      expect.objectContaining({ dimension: "client_quality", score: 61 }),
    ]);
    expect(result.components[0]?.explanation).toContain("42% client hire rate");
  });

  it("normalizes active weights and ignores dimensions without user criteria", () => {
    const filter = campaignFilterV1Schema.parse({
      version: 1,
      includeKeywords: ["webhook", "missing"],
      scoringWeights: {
        version: 1,
        skills: 100,
        keywords: 25,
        budget: 100,
        competition: 100,
        clientQuality: 100,
        projectFit: 100
      }
    });
    const decision = evaluateCampaignFilter(filter, job);
    const result = scoreJobPreference(filter, job, decision.evidence);

    expect(result.components).toHaveLength(1);
    expect(result.components[0]).toMatchObject({ dimension: "keywords", score: 50, weight: 25 });
    expect(result.score).toBe(50);
  });

  it("uses a neutral, explicit result when no weighted criteria are configured", () => {
    const filter = campaignFilterV1Schema.parse({ version: 1 });
    const decision = evaluateCampaignFilter(filter, job);

    expect(scoreJobPreference(filter, job, decision.evidence)).toEqual({
      version: 1,
      score: 50,
      components: [],
      summary: ["No weighted preference criteria were configured for this job"]
    });
  });

  it("rejects an all-zero scoring profile", () => {
    expect(
      campaignFilterV1Schema.safeParse({
        version: 1,
        scoringWeights: {
          version: 1,
          skills: 0,
          keywords: 0,
          budget: 0,
          competition: 0,
          clientQuality: 0,
          projectFit: 0
        }
      }).success
    ).toBe(false);
  });
});

import { describe, expect, it } from "vitest";

import {
  FakeAIProvider,
  campaignFilterV1Schema,
  evaluateCampaignFilter,
  scoreJobPreference,
  suitabilityInputSchema,
  suitabilityResultSchema,
  type NormalizedJob,
  type SuitabilityInput
} from "./index.js";

const job: NormalizedJob = {
  title: "Make.com automation",
  description: "Connect the OpenAI API to a webhook.",
  skills: ["Make.com", "OpenAI"],
  categoryIds: ["automation"],
  experienceLevel: "expert",
  jobType: "fixed",
  fixedBudget: { currency: "USD", min: 1_000, max: 1_800 },
  paymentVerified: true,
  clientHireCount: 12
};

function suitabilityInput(scoreThreshold: number): SuitabilityInput {
  const filters = campaignFilterV1Schema.parse({
    version: 1,
    requiredSkills: ["Make.com", "OpenAI"],
    fixedBudget: { min: 900 },
    paymentVerification: "only_verified",
    clientHireHistory: "10_plus"
  });
  const deterministicEvidence = evaluateCampaignFilter(filters, job).evidence;
  return suitabilityInputSchema.parse({
    job,
    campaign: {
      filters,
      aiInstructions: "Prefer clearly scoped automation work.",
      scoreThreshold
    },
    deterministicEvidence,
    preferenceScore: scoreJobPreference(filters, job, deterministicEvidence)
  });
}

describe("FakeAIProvider", () => {
  it("returns the same validated result for the same input", async () => {
    const provider = new FakeAIProvider();
    const input = suitabilityInput(75);

    const first = await provider.assessSuitability(input);
    const second = await provider.assessSuitability(input);

    expect(first).toEqual(second);
    expect(suitabilityResultSchema.safeParse(first).success).toBe(true);
    expect(first).toMatchObject({
      recommendation: "apply",
      pricingDirection: "market",
      suggestedBidAmount: 1_800,
      suggestedBidCurrency: "USD"
    });
  });

  it("uses the campaign threshold without making the score nondeterministic", async () => {
    const provider = new FakeAIProvider();
    const accepted = await provider.assessSuitability(suitabilityInput(75));
    const review = await provider.assessSuitability(suitabilityInput(99));

    expect(review.score).toBe(accepted.score);
    expect(accepted.recommendation).toBe("apply");
    expect(review.recommendation).toBe("review");
  });

  it("validates its input at the provider boundary", async () => {
    const invalidInput = {
      ...suitabilityInput(75),
      campaign: { ...suitabilityInput(75).campaign, scoreThreshold: 101 }
    };

    await expect(
      Reflect.apply(FakeAIProvider.prototype.assessSuitability, new FakeAIProvider(), [invalidInput])
    ).rejects.toThrow();
  });
});

describe("suitabilityResultSchema", () => {
  const validResult = {
    score: 85,
    recommendation: "apply",
    reasons: ["Strong fit"],
    risks: [],
    estimatedWinProbability: 0.6,
    pricingDirection: "market"
  } as const;

  it("accepts a bounded structured result", () => {
    expect(suitabilityResultSchema.safeParse(validResult).success).toBe(true);
  });

  it("rejects malformed score, probability, and incomplete suggested-bid pairs", () => {
    expect(suitabilityResultSchema.safeParse({ ...validResult, score: 101 }).success).toBe(false);
    expect(
      suitabilityResultSchema.safeParse({ ...validResult, estimatedWinProbability: -0.01 }).success
    ).toBe(false);
    expect(
      suitabilityResultSchema.safeParse({ ...validResult, suggestedBidAmount: 1_000 }).success
    ).toBe(false);
    expect(
      suitabilityResultSchema.safeParse({ ...validResult, suggestedBidCurrency: "USD" }).success
    ).toBe(false);
  });

  it("rejects suggested bids that numeric(14,2) would round or overflow", () => {
    expect(
      suitabilityResultSchema.safeParse({
        ...validResult,
        suggestedBidAmount: 1_000.001,
        suggestedBidCurrency: "USD"
      }).success
    ).toBe(false);
    expect(
      suitabilityResultSchema.safeParse({
        ...validResult,
        suggestedBidAmount: 1_000_000_000_000,
        suggestedBidCurrency: "USD"
      }).success
    ).toBe(false);
  });
});

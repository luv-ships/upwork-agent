import { describe, expect, it } from "vitest";

import { FakeAIProvider, proposalGenerationInputHash, proposalGenerationInputSchema } from "./index.js";

const input = proposalGenerationInputSchema.parse({
  job: {
    sourceJobId: "source-1",
    title: "Need an automation expert",
    description: "Build a tested workflow.",
    skills: ["Make.com", "OpenAI"],
    categoryIds: [],
    jobType: "fixed",
    fixedBudget: { currency: "USD", min: 1000, max: 1800 },
  },
  campaignName: "AI Automation",
  aiInstructions: "Be concise and specific.",
  suitability: {
    score: 92,
    recommendation: "apply",
    reasons: ["Strong fit"],
    risks: [],
    estimatedWinProbability: 0.6,
    pricingDirection: "market",
    suggestedBidAmount: 1800,
    suggestedBidCurrency: "USD",
  },
  knowledgeChunks: [
    {
      id: "00000000-0000-4000-8000-000000000001",
      title: "Automation case study",
      content: "A relevant case study.",
    },
  ],
});

describe("proposal contracts", () => {
  it("generates a bounded, source-attributed draft deterministically", async () => {
    const provider = new FakeAIProvider();
    const first = await provider.generateProposal(input);
    const second = await provider.generateProposal(input);

    expect(second).toEqual(first);
    expect(first.body).toContain("automation expert");
    expect(first.sourceChunkIds).toEqual(["00000000-0000-4000-8000-000000000001"]);
    expect(first.suggestedBidAmount).toBe(1800);
  });

  it("hashes the full proposal input for idempotent generation", () => {
    expect(proposalGenerationInputHash(input)).toMatch(/^[0-9a-f]{64}$/);
    expect(proposalGenerationInputHash({ ...input, aiInstructions: "Different" })).not.toBe(
      proposalGenerationInputHash(input),
    );
  });
});

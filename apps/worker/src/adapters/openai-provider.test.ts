import {
  EMBEDDING_DIMENSIONS,
  campaignFilterV1Schema,
  evaluateCampaignFilter,
  scoreJobPreference,
  type SuitabilityInput
} from "@upwork-agent/core";
import { describe, expect, it, vi } from "vitest";

import { createOpenAIProvider } from "./openai-provider.js";

const filters = campaignFilterV1Schema.parse({
  version: 1,
  requiredSkills: ["OpenAI"]
});
const job = {
  categoryIds: ["automation"],
  description: "Build an OpenAI workflow.",
  fixedBudget: { currency: "USD" as const, max: 1_800 },
  jobType: "fixed" as const,
  skills: ["OpenAI"],
  title: "Automation specialist"
};
const evidence = evaluateCampaignFilter(filters, job).evidence;
const input: SuitabilityInput = {
  campaign: {
    aiInstructions: "Focus on high-confidence automation work.",
    filters,
    scoreThreshold: 75
  },
  deterministicEvidence: evidence,
  job,
  preferenceScore: scoreJobPreference(filters, job, evidence)
};

function responseWithResult(result: unknown): Response {
  return new Response(
    JSON.stringify({
      status: "completed",
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: JSON.stringify(result) }]
        }
      ]
    }),
    { status: 200, headers: { "content-type": "application/json" } }
  );
}

describe("createOpenAIProvider", () => {
  it("supports optional strict-dimension embeddings without storing provider data", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ data: [{ index: 0, embedding: Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.01) }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const provider = createOpenAIProvider({
      apiKey: "sk-test-this-is-not-a-real-secret",
      embeddingModel: "text-embedding-3-small",
      model: "gpt-5.6-luna",
      fetch: fetchMock,
    });

    const result = await provider.embed({ texts: ["automation"] });
    expect(result.vectors[0]).toHaveLength(EMBEDDING_DIMENSIONS);
    const [url, request] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://api.openai.com/v1/embeddings");
    expect(String(request?.body)).toContain('"dimensions":1536');
  });

  it("uses the Responses API with strict non-stored structured output", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      responseWithResult({
        score: 88,
        recommendation: "apply",
        reasons: ["Strong automation fit"],
        risks: ["Requirements may expand"],
        estimatedWinProbability: 0.55,
        pricingDirection: "market",
        suggestedBidAmount: 1500,
        suggestedBidCurrency: "USD"
      })
    );
    const provider = createOpenAIProvider({
      apiKey: "sk-test-this-is-not-a-real-secret",
      model: "gpt-5.6-luna",
      fetch: fetchMock
    });

    await expect(provider.assessSuitability(input)).resolves.toMatchObject({
      score: 88,
      recommendation: "apply",
      suggestedBidAmount: 1500
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, request] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://api.openai.com/v1/responses");
    const body = JSON.parse(String(request?.body)) as {
      store: boolean;
      text: { format: { strict: boolean; type: string } };
    };
    expect(body.store).toBe(false);
    expect(body.text.format).toMatchObject({ type: "json_schema", strict: true });
  });

  it("normalizes paired null bid fields to omitted optional fields", async () => {
    const provider = createOpenAIProvider({
      apiKey: "sk-test-this-is-not-a-real-secret",
      model: "gpt-5.6-luna",
      fetch: vi.fn<typeof fetch>().mockResolvedValue(
        responseWithResult({
          score: 64,
          recommendation: "review",
          reasons: ["Partial fit"],
          risks: [],
          estimatedWinProbability: 0.3,
          pricingDirection: "market",
          suggestedBidAmount: null,
          suggestedBidCurrency: null
        })
      )
    });

    await expect(provider.assessSuitability(input)).resolves.toEqual({
      score: 64,
      recommendation: "review",
      reasons: ["Partial fit"],
      risks: [],
      estimatedWinProbability: 0.3,
      pricingDirection: "market"
    });
  });

  it("classifies rate limits as retryable without reflecting response content", async () => {
    const provider = createOpenAIProvider({
      apiKey: "sk-test-this-is-not-a-real-secret",
      model: "gpt-5.6-luna",
      fetch: vi.fn<typeof fetch>().mockResolvedValue(
        new Response("sensitive-provider-detail", { status: 429 })
      )
    });

    await expect(provider.assessSuitability(input)).rejects.toMatchObject({
      code: "OPENAI_TEMPORARILY_UNAVAILABLE",
      retryable: true
    });
  });
});

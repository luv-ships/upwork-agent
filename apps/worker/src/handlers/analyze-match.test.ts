import {
  campaignFilterV1Schema,
  evaluateCampaignFilter,
  FakeAIProvider,
  scoreJobPreference,
  type SuitabilityInput,
} from "@upwork-agent/core";
import { describe, expect, it } from "vitest";

import type { PipelineRepository } from "../adapters/database-pipeline.js";
import type { ClaimedTask } from "../runtime/worker.js";
import { handleAnalyzeMatch } from "./analyze-match.js";
import { createPipelineRepositoryStub } from "./test-support.js";

const workspaceId = "00000000-0000-4000-8000-000000000011";
const matchId = "00000000-0000-4000-8000-000000000061";
const inputHash = "b".repeat(64);

const task: ClaimedTask = {
  attemptCount: 1,
  id: "00000000-0000-4000-8000-000000000031",
  kind: "analyze-match",
  maxAttempts: 5,
  payload: { inputHash, matchId },
  schemaVersion: 1,
  workspaceId,
};

describe("handleAnalyzeMatch", () => {
  it("validates and persists deterministic fake-provider scoring metadata", async () => {
    const filters = campaignFilterV1Schema.parse({
      requiredSkills: ["OpenAI"],
      version: 1,
    });
    const job = {
      categoryIds: ["automation"],
      description: "Build an OpenAI workflow.",
      fixedBudget: { currency: "USD" as const, max: 1_800 },
      jobType: "fixed" as const,
      skills: ["OpenAI"],
      title: "Automation specialist",
    };
    const suitabilityInput: SuitabilityInput = {
      campaign: {
        aiInstructions: "Focus on high-confidence automation work.",
        filters,
        scoreThreshold: 75,
      },
      deterministicEvidence: evaluateCampaignFilter(filters, job).evidence,
      job,
      preferenceScore: scoreJobPreference(
        filters,
        job,
        evaluateCampaignFilter(filters, job).evidence,
      ),
    };
    let committed: Parameters<PipelineRepository["commitMatchAnalysis"]>[0] | undefined;
    const repository = createPipelineRepositoryStub({
      loadMatchAnalysisContext: async () => ({
        input: suitabilityInput,
        matchId,
        scoreThreshold: 75,
        status: "ready",
        workspaceId,
      }),
      commitMatchAnalysis: async (input) => {
        committed = input;
        return {
          aiScoreId: "00000000-0000-4000-8000-000000000071",
          pipelineStatus: "qualified",
          status: "committed",
        };
      },
    });

    await handleAnalyzeMatch(
      repository,
      new FakeAIProvider(),
      { model: "fake-suitability-v1", promptVersion: "suitability-v1", proposalPromptVersion: "proposal-v1", provider: "fake" },
      task,
    );

    expect(committed).toMatchObject({
      inputHash,
      matchId,
      model: "fake-suitability-v1",
      promptVersion: "suitability-v1",
      provider: "fake",
      workspaceId,
    });
    expect(committed?.result.score).toBeGreaterThanOrEqual(75);
  });
});

import { describe, expect, it, vi } from "vitest";

import { FakeAIProvider, FakeEmbeddingProvider, type ProposalGenerationInput } from "@upwork-agent/core";

import type { ProposalRepository } from "../adapters/database-proposals.js";
import type { ClaimedTask } from "../runtime/worker.js";
import { handleGenerateProposal } from "./generate-proposal.js";

const task: ClaimedTask = {
  attemptCount: 2,
  id: "00000000-0000-4000-8000-000000000031",
  kind: "generate-proposal",
  maxAttempts: 2,
  payload: {
    generationKey: "b".repeat(64),
    matchId: "00000000-0000-4000-8000-000000000061",
  },
  schemaVersion: 1,
  workspaceId: "00000000-0000-4000-8000-000000000011",
};
const matchId = "00000000-0000-4000-8000-000000000061";

const input: ProposalGenerationInput = {
  aiInstructions: "Be concise.",
  campaignName: "Automation",
  generationNonce: "b".repeat(64),
  job: {
    categoryIds: [],
    description: "Build a workflow.",
    jobType: "fixed",
    skills: ["OpenAI"],
    title: "Automation workflow",
  },
  knowledgeChunks: [],
  suitability: {
    estimatedWinProbability: 0.5,
    pricingDirection: "market",
    reasons: ["Strong fit"],
    recommendation: "apply",
    risks: [],
    score: 90,
  },
};

describe("handleGenerateProposal", () => {
  it("embeds the job query before loading proposal context when embeddings are configured", async () => {
    const loadProposalGenerationContext = vi.fn<ProposalRepository["loadProposalGenerationContext"]>().mockResolvedValue({
      generationInputHash: "c".repeat(64),
      input,
      matchId,
      status: "ready",
      workspaceId: task.workspaceId,
    });
    const commitProposalGeneration = vi.fn<ProposalRepository["commitProposalGeneration"]>().mockResolvedValue({
      status: "committed",
      proposalId: "00000000-0000-4000-8000-000000000071",
      versionId: "00000000-0000-4000-8000-000000000072",
      version: 1,
    });
    const repository: ProposalRepository = {
      commitKnowledgeIndex: vi.fn().mockResolvedValue({ status: "skip", chunkCount: 0 }),
      commitProposalGeneration,
      failKnowledgeIndex: vi.fn().mockResolvedValue(false),
      failProposalGeneration: vi.fn().mockResolvedValue(false),
      loadKnowledgeIndexContext: vi.fn().mockResolvedValue({ status: "skip" }),
      loadProposalGenerationQuery: vi.fn().mockResolvedValue({ status: "ready", text: "automation workflow" }),
      loadProposalGenerationContext,
    };

    await handleGenerateProposal(
      repository,
      new FakeAIProvider(),
      new FakeEmbeddingProvider(),
      {
        model: "fake",
        promptVersion: "suitability-v1",
        proposalPromptVersion: "proposal-v1",
        provider: "fake",
      },
      task,
    );

    expect(loadProposalGenerationContext).toHaveBeenCalledWith({
      generationKey: "b".repeat(64),
      matchId,
      queryEmbedding: expect.arrayContaining([expect.any(Number)]),
      workspaceId: task.workspaceId,
    });
    expect(commitProposalGeneration).toHaveBeenCalledOnce();
  });

  it("marks a proposal failed when its final generation attempt errors", async () => {
    const failProposalGeneration = vi.fn<ProposalRepository["failProposalGeneration"]>().mockResolvedValue(true);
    const provider = {
      ...new FakeAIProvider(),
      generateProposal: vi.fn().mockRejectedValue(new Error("generation failed")),
    };
    const repository: ProposalRepository = {
      commitKnowledgeIndex: vi.fn().mockResolvedValue({ status: "skip", chunkCount: 0 }),
      commitProposalGeneration: vi.fn().mockResolvedValue({ status: "skip" }),
      failKnowledgeIndex: vi.fn().mockResolvedValue(true),
      failProposalGeneration,
      loadKnowledgeIndexContext: vi.fn().mockResolvedValue({ status: "skip" }),
      loadProposalGenerationQuery: vi.fn().mockResolvedValue({ status: "ready", text: "automation workflow" }),
      loadProposalGenerationContext: vi.fn().mockResolvedValue({
        generationInputHash: "c".repeat(64),
        input,
        matchId,
        status: "ready",
        workspaceId: task.workspaceId,
      }),
    };

    await expect(handleGenerateProposal(repository, provider, undefined, {
      model: "fake",
      promptVersion: "suitability-v1",
      proposalPromptVersion: "proposal-v1",
      provider: "fake",
    }, task)).rejects.toThrow("generation failed");
    expect(failProposalGeneration).toHaveBeenCalledWith({
      failureCode: "proposal_generation_failed",
      matchId,
      workspaceId: task.workspaceId,
    });
  });
});

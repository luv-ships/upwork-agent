import { campaignFilterV1Schema } from "@upwork-agent/core";
import { describe, expect, it } from "vitest";

import type { PipelineRepository } from "../adapters/database-pipeline.js";
import type { ClaimedTask } from "../runtime/worker.js";
import { handleMatchJob } from "./match-job.js";
import { createPipelineRepositoryStub } from "./test-support.js";

const workspaceId = "00000000-0000-4000-8000-000000000011";
const jobId = "00000000-0000-4000-8000-000000000021";
const campaignId = "00000000-0000-4000-8000-000000000051";

const task: ClaimedTask = {
  attemptCount: 1,
  id: "00000000-0000-4000-8000-000000000031",
  kind: "match-job",
  maxAttempts: 5,
  payload: { jobId, normalizedRevision: 1 },
  schemaVersion: 1,
  workspaceId,
};

describe("handleMatchJob", () => {
  it("persists only positive deterministic campaign matches", async () => {
    let committed: Parameters<PipelineRepository["commitJobMatches"]>[0] | undefined;
    const matchingFilter = campaignFilterV1Schema.parse({
      requiredSkills: ["OpenAI"],
      version: 1,
    });
    const nonMatchingFilter = campaignFilterV1Schema.parse({
      requiredSkills: ["Rust"],
      version: 1,
    });
    const repository = createPipelineRepositoryStub({
      loadJobMatchContext: async () => ({
        campaigns: [
          {
            aiInstructions: "Prefer automation projects.",
            configVersion: 2,
            filters: matchingFilter,
            id: campaignId,
            name: "Automation",
            scoreThreshold: 75,
            workspaceId,
          },
          {
            aiInstructions: "Prefer systems projects.",
            configVersion: 1,
            filters: nonMatchingFilter,
            id: "00000000-0000-4000-8000-000000000052",
            name: "Systems",
            scoreThreshold: 75,
            workspaceId,
          },
        ],
        job: {
          categoryIds: ["automation"],
          description: "Build a reliable OpenAI workflow.",
          jobType: "fixed",
          skills: ["OpenAI", "Make.com"],
          title: "Automation specialist",
        },
        jobId,
        normalizedRevision: 1,
        status: "ready",
        workspaceId,
      }),
      commitJobMatches: async (input) => {
        committed = input;
        return { matchCount: input.matches.length, status: "committed", taskCount: 1 };
      },
    });

    await handleMatchJob(
      repository,
      {
        model: "fake-suitability-v1",
        promptVersion: "suitability-v1",
        proposalPromptVersion: "proposal-v1",
        provider: "fake",
      },
      task,
    );

    expect(committed?.matches).toHaveLength(1);
    expect(committed?.matches[0]?.campaignId).toBe(campaignId);
    expect(committed?.matches[0]?.deterministicEvidence).toMatchObject({
      matchedSkills: ["OpenAI"],
      version: 1,
    });
    expect(committed?.matches[0]?.analysisInputHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes the analysis hash when the configured provider or model changes", async () => {
    const filters = campaignFilterV1Schema.parse({ version: 1 });
    const hashes: string[] = [];
    const repository = createPipelineRepositoryStub({
      loadJobMatchContext: async () => ({
        campaigns: [
          {
            aiInstructions: "Prefer automation projects.",
            configVersion: 1,
            filters,
            id: campaignId,
            name: "Automation",
            scoreThreshold: 75,
            workspaceId,
          },
        ],
        job: {
          categoryIds: [],
          description: "Build an OpenAI workflow.",
          jobType: "fixed",
          skills: ["OpenAI"],
          title: "Automation specialist",
        },
        jobId,
        normalizedRevision: 1,
        status: "ready",
        workspaceId,
      }),
      commitJobMatches: async (input) => {
        const hash = input.matches[0]?.analysisInputHash;
        if (hash !== undefined) {
          hashes.push(hash);
        }
        return { matchCount: input.matches.length, status: "committed", taskCount: 1 };
      },
    });

    await handleMatchJob(
      repository,
      {
        model: "fake-suitability-v1",
        promptVersion: "suitability-v1",
        proposalPromptVersion: "proposal-v1",
        provider: "fake",
      },
      task,
    );
    await handleMatchJob(
      repository,
      {
        model: "gpt-placeholder",
        promptVersion: "suitability-v1",
        proposalPromptVersion: "proposal-v1",
        provider: "openai",
      },
      task,
    );

    expect(hashes).toHaveLength(2);
    expect(hashes[0]).not.toBe(hashes[1]);
  });
});

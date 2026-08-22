import { describe, expect, it } from "vitest";

import type { PipelineRepository } from "../adapters/database-pipeline.js";
import type { ClaimedTask } from "../runtime/worker.js";
import { handleNormalizeJob } from "./normalize-job.js";
import { createPipelineRepositoryStub } from "./test-support.js";

const workspaceId = "00000000-0000-4000-8000-000000000011";
const jobId = "00000000-0000-4000-8000-000000000021";
const sourcePayloadHash = "a".repeat(64);

const task: ClaimedTask = {
  attemptCount: 1,
  id: "00000000-0000-4000-8000-000000000031",
  kind: "normalize-job",
  maxAttempts: 5,
  payload: { jobId, sourcePayloadHash },
  schemaVersion: 1,
  workspaceId,
};

describe("handleNormalizeJob", () => {
  it("normalizes the stored payload and atomically delegates the next step", async () => {
    let committed: Parameters<PipelineRepository["commitJobNormalization"]>[0] | undefined;
    const repository = createPipelineRepositoryStub({
      loadJobForNormalization: async () => ({
        jobId,
        rawPayload: {
          categoryIds: ["automation", "automation"],
          description: "Build the workflow.\r\nDocument it.",
          fixedBudget: { currency: "USD", max: 1_800, min: 1_200 },
          jobType: "fixed",
          skills: ["OpenAI", "OpenAI", " Make.com "],
          sourceJobId: "source-1",
          title: "  Automation   expert  ",
        },
        sourcePayloadHash,
        status: "ready",
        workspaceId,
      }),
      commitJobNormalization: async (input) => {
        committed = input;
        return {
          matchTaskId: "00000000-0000-4000-8000-000000000041",
          normalizedRevision: 1,
          status: "committed",
        };
      },
    });

    await handleNormalizeJob(repository, task);

    expect(committed?.normalizedJob).toMatchObject({
      categoryIds: ["automation"],
      description: "Build the workflow.\nDocument it.",
      skills: ["OpenAI", "Make.com"],
      title: "Automation expert",
    });
    expect(committed?.normalizedHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("treats a stale or already-complete task as an idempotent no-op", async () => {
    let commitCount = 0;
    const repository = createPipelineRepositoryStub({
      commitJobNormalization: async () => {
        commitCount += 1;
        return { status: "skip" };
      },
    });

    await handleNormalizeJob(repository, task);

    expect(commitCount).toBe(0);
  });
});

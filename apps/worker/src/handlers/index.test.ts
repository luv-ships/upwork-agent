import { FakeAIProvider } from "@upwork-agent/core";
import { describe, expect, it } from "vitest";

import type { ClaimedTask } from "../runtime/worker.js";
import { createTaskProcessor } from "./index.js";
import { createPipelineRepositoryStub, createProposalRepositoryStub } from "./test-support.js";

const baseTask: ClaimedTask = {
  attemptCount: 1,
  id: "00000000-0000-4000-8000-000000000031",
  kind: "future-task",
  maxAttempts: 5,
  payload: {},
  schemaVersion: 1,
  workspaceId: "00000000-0000-4000-8000-000000000011",
};

function createProcessor() {
  return createTaskProcessor({
    provider: new FakeAIProvider(),
    providerMetadata: {
      model: "fake-suitability-v1",
      promptVersion: "suitability-v1",
      proposalPromptVersion: "proposal-v1",
      provider: "fake",
    },
    proposalRepository: createProposalRepositoryStub(),
    repository: createPipelineRepositoryStub(),
    upworkRetentionRepository: {
      purgeExpiredData: async () => ({
        status: "skip",
        deletedJobs: 0,
        deletedMatches: 0,
        deletedAiScores: 0,
        deletedWorkflowTasks: 0,
        deletedAnalyticsEvents: 0,
        nextRunAt: null,
      }),
    },
  });
}

describe("createTaskProcessor", () => {
  it("permanently rejects task kinds this release does not own", async () => {
    await expect(createProcessor()(baseTask)).rejects.toMatchObject({
      code: "UNSUPPORTED_TASK_KIND",
      retryable: false,
    });
  });

  it("permanently rejects unknown task schema versions", async () => {
    await expect(
      createProcessor()({ ...baseTask, kind: "normalize-job", schemaVersion: 2 }),
    ).rejects.toMatchObject({
      code: "UNSUPPORTED_TASK_SCHEMA_VERSION",
      retryable: false,
    });
  });

  it("fails closed when a poll task reaches a worker without an MCP provider", async () => {
    await expect(
      createProcessor()({
        ...baseTask,
        kind: "poll-upwork-monitor",
        payload: {
          monitorId: "00000000-0000-4000-8000-000000000081",
          scheduleVersion: 1,
          runSequence: 1,
        },
      }),
    ).rejects.toMatchObject({
      code: "UPWORK_MONITOR_DISABLED",
      retryable: false,
    });
  });
});

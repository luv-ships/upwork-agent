import { describe, expect, it, vi } from "vitest";

import type { UpworkRetentionRepository } from "../adapters/database-upwork-retention.js";
import type { ClaimedTask } from "../runtime/worker.js";
import { handlePurgeUpworkData } from "./purge-upwork-data.js";

const workspaceId = "00000000-0000-4000-8000-000000000011";
const connectionId = "00000000-0000-4000-8000-000000000091";

const task: ClaimedTask = {
  attemptCount: 1,
  id: "00000000-0000-4000-8000-000000000031",
  kind: "purge-upwork-data",
  maxAttempts: 10,
  payload: { connectionId, scheduleVersion: 2, runSequence: 4 },
  schemaVersion: 1,
  workspaceId,
};

describe("handlePurgeUpworkData", () => {
  it("passes only the task-owned workspace and validated schedule cursor", async () => {
    const purgeExpiredData = vi
      .fn<UpworkRetentionRepository["purgeExpiredData"]>()
      .mockResolvedValue({
        status: "committed",
        deletedJobs: 0,
        deletedMatches: 0,
        deletedAiScores: 0,
        deletedWorkflowTasks: 0,
        deletedAnalyticsEvents: 0,
        nextRunAt: new Date("2026-08-17T00:00:00.000Z"),
      });

    await handlePurgeUpworkData({ purgeExpiredData }, task);

    expect(purgeExpiredData).toHaveBeenCalledWith({
      workspaceId,
      connectionId,
      scheduleVersion: 2,
      runSequence: 4,
    });
  });

  it("rejects malformed retention task payloads before repository access", async () => {
    const purgeExpiredData = vi.fn<UpworkRetentionRepository["purgeExpiredData"]>();

    await expect(
      handlePurgeUpworkData(
        { purgeExpiredData },
        { ...task, payload: { connectionId, scheduleVersion: 0, runSequence: 4 } },
      ),
    ).rejects.toThrow();
    expect(purgeExpiredData).not.toHaveBeenCalled();
  });
});

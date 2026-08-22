import { emptyCampaignFilterV1, type UpworkMcpPort } from "@upwork-agent/core";
import { describe, expect, it, vi } from "vitest";

import type { UpworkMonitorRepository } from "../adapters/database-upwork-monitor.js";
import type { ClaimedTask } from "../runtime/worker.js";
import { handlePollUpworkMonitor } from "./poll-upwork-monitor.js";

const workspaceId = "00000000-0000-4000-8000-000000000011";
const campaignId = "00000000-0000-4000-8000-000000000051";
const monitorId = "00000000-0000-4000-8000-000000000081";
const connectionId = "00000000-0000-4000-8000-000000000091";

const task: ClaimedTask = {
  attemptCount: 1,
  id: "00000000-0000-4000-8000-000000000031",
  kind: "poll-upwork-monitor",
  maxAttempts: 5,
  payload: { monitorId, scheduleVersion: 2, runSequence: 4 },
  schemaVersion: 1,
  workspaceId,
};

describe("handlePollUpworkMonitor", () => {
  it("does not call Upwork for a stale or paused schedule", async () => {
    const searchJobs = vi.fn<UpworkMcpPort["searchJobs"]>();
    const repository: UpworkMonitorRepository = {
      loadPollContext: async () => ({ status: "skip" }),
      commitPoll: vi.fn(),
    };

    await handlePollUpworkMonitor(repository, { searchJobs }, task, 300);

    expect(searchJobs).not.toHaveBeenCalled();
    expect(repository.commitPoll).not.toHaveBeenCalled();
  });

  it("passes only validated monitor context and commits the bounded result", async () => {
    const outcome = { kind: "page" as const, jobs: [] };
    const searchJobs = vi.fn<UpworkMcpPort["searchJobs"]>().mockResolvedValue(outcome);
    const commitPoll = vi.fn<UpworkMonitorRepository["commitPoll"]>().mockResolvedValue({
      status: "committed",
      jobsSeen: 0,
      jobsQueued: 0,
      nextRunAt: new Date("2026-08-15T00:05:00.000Z"),
    });
    const repository: UpworkMonitorRepository = {
      loadPollContext: async () => ({
        status: "ready",
        workspaceId,
        campaignId,
        monitorId,
        connectionId,
        filters: emptyCampaignFilterV1,
        maxResults: 10,
        pollIntervalSeconds: 300,
        retentionDays: 30,
        nextCursor: "cursor-1",
        scheduleVersion: 2,
        runSequence: 4,
        connectionStatus: "fake",
      }),
      commitPoll,
    };

    await handlePollUpworkMonitor(repository, { searchJobs }, task, 300);

    expect(searchJobs).toHaveBeenCalledWith({
      workspaceId,
      campaignId,
      monitorId,
      connectionId,
      cursor: "cursor-1",
      filters: emptyCampaignFilterV1,
      maxResults: 10,
    });
    expect(commitPoll).toHaveBeenCalledWith({
      workspaceId,
      monitorId,
      scheduleVersion: 2,
      runSequence: 4,
      outcome,
    });
  });

  it("fails closed before calling the port when the stored cadence is too fast", async () => {
    const searchJobs = vi.fn<UpworkMcpPort["searchJobs"]>();
    const repository: UpworkMonitorRepository = {
      loadPollContext: async () => ({
        status: "ready",
        workspaceId,
        campaignId,
        monitorId,
        connectionId,
        filters: emptyCampaignFilterV1,
        maxResults: 10,
        pollIntervalSeconds: 60,
        retentionDays: 30,
        nextCursor: null,
        scheduleVersion: 2,
        runSequence: 4,
        connectionStatus: "fake"
      }),
      commitPoll: vi.fn()
    };

    await expect(
      handlePollUpworkMonitor(repository, { searchJobs }, task, 300)
    ).rejects.toMatchObject({
      code: "UPWORK_POLL_INTERVAL_TOO_SHORT",
      retryable: false
    });
    expect(searchJobs).not.toHaveBeenCalled();
  });
});

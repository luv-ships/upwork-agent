import {
  parseWorkflowTaskPayload,
  upworkJobSearchOutcomeSchema,
  upworkMonitorIntervalSecondsSchema,
  type UpworkMcpPort
} from "@upwork-agent/core";

import type { UpworkMonitorRepository } from "../adapters/database-upwork-monitor.js";
import { WorkerError } from "../runtime/errors.js";
import type { ClaimedTask } from "../runtime/worker.js";

export async function handlePollUpworkMonitor(
  repository: UpworkMonitorRepository,
  port: UpworkMcpPort,
  task: ClaimedTask,
  minimumPollIntervalSeconds: number
): Promise<void> {
  const minimumInterval = upworkMonitorIntervalSecondsSchema.parse(
    minimumPollIntervalSeconds
  );
  const payload = parseWorkflowTaskPayload("poll-upwork-monitor", task.payload);
  const context = await repository.loadPollContext({
    workspaceId: task.workspaceId,
    monitorId: payload.monitorId,
    scheduleVersion: payload.scheduleVersion,
    runSequence: payload.runSequence,
    minimumPollIntervalSeconds: minimumInterval
  });
  if (context.status === "skip") return;
  if (context.pollIntervalSeconds < minimumInterval) {
    throw new WorkerError({
      code: "UPWORK_POLL_INTERVAL_TOO_SHORT",
      message: "The stored Upwork monitor cadence is below this worker's approved minimum.",
      retryable: false
    });
  }

  const outcome = upworkJobSearchOutcomeSchema.parse(
    await port.searchJobs({
      workspaceId: context.workspaceId,
      campaignId: context.campaignId,
      monitorId: context.monitorId,
      connectionId: context.connectionId,
      ...(context.nextCursor === null ? {} : { cursor: context.nextCursor }),
      filters: context.filters,
      maxResults: context.maxResults
    })
  );
  await repository.commitPoll({
    workspaceId: context.workspaceId,
    monitorId: context.monitorId,
    scheduleVersion: context.scheduleVersion,
    runSequence: context.runSequence,
    outcome
  });
}

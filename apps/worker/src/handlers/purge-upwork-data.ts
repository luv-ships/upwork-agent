import { parseWorkflowTaskPayload } from "@upwork-agent/core";

import type { UpworkRetentionRepository } from "../adapters/database-upwork-retention.js";
import type { ClaimedTask } from "../runtime/worker.js";

export async function handlePurgeUpworkData(
  repository: UpworkRetentionRepository,
  task: ClaimedTask,
): Promise<void> {
  const payload = parseWorkflowTaskPayload("purge-upwork-data", task.payload);
  await repository.purgeExpiredData({
    workspaceId: task.workspaceId,
    connectionId: payload.connectionId,
    scheduleVersion: payload.scheduleVersion,
    runSequence: payload.runSequence,
  });
}

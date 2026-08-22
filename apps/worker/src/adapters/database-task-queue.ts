import { parseWorkflowTaskPayload, type WorkflowTaskKind } from "@upwork-agent/core";
import {
  claimWorkflowTask,
  completeWorkflowTask,
  failWorkflowTask,
  recoverExpiredWorkflowTasks,
  renewWorkflowTaskLease,
  type Database,
} from "@upwork-agent/db";

import type { ClaimedTask, TaskQueue } from "../runtime/worker.js";

function extractEntityId(kind: WorkflowTaskKind, payload: unknown): string | undefined {
  try {
    switch (kind) {
      case "normalize-job":
        return parseWorkflowTaskPayload(kind, payload).jobId;
      case "match-job":
        return parseWorkflowTaskPayload(kind, payload).jobId;
      case "analyze-match":
        return parseWorkflowTaskPayload(kind, payload).matchId;
      case "poll-upwork-monitor":
        return parseWorkflowTaskPayload(kind, payload).monitorId;
    }
  } catch {
    // The handler will classify and persist the invalid payload. Avoid logging
    // any unvalidated value from it in the meantime.
    return undefined;
  }
}

export function createDatabaseTaskQueue(database: Database): TaskQueue {
  return {
    async claim(input): Promise<ClaimedTask | null> {
      const task = await claimWorkflowTask(database, input);
      if (task === null) {
        return null;
      }

      const entityId = extractEntityId(task.kind, task.payload);
      return {
        attemptCount: task.attemptCount,
        ...(entityId === undefined ? {} : { entityId }),
        id: task.id,
        kind: task.kind,
        maxAttempts: task.maxAttempts,
        payload: task.payload,
        schemaVersion: task.schemaVersion,
        workspaceId: task.workspaceId,
      };
    },

    async complete(input): Promise<boolean> {
      return completeWorkflowTask(database, input);
    },

    async fail(input): Promise<boolean> {
      const outcome = await failWorkflowTask(database, input);
      return outcome !== null;
    },

    async recoverExpiredLeases(): Promise<number> {
      return recoverExpiredWorkflowTasks(database);
    },

    async renew(input): Promise<boolean> {
      return renewWorkflowTaskLease(database, input);
    },
  };
}

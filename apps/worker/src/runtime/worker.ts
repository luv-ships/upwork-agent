import { toWorkerFailure, WorkerError } from "./errors.js";
import type { Logger } from "./logger.js";
import { waitForAbortOrTimeout } from "./wait.js";

export type ClaimedTask = {
  attemptCount: number;
  entityId?: string;
  id: string;
  kind: string;
  maxAttempts: number;
  payload: unknown;
  schemaVersion: number;
  workspaceId: string;
};

export interface TaskQueue {
  claim(input: { leaseDurationMs: number; workerId: string }): Promise<ClaimedTask | null>;
  complete(input: { taskId: string; workerId: string }): Promise<boolean>;
  fail(input: {
    errorCode: string;
    errorMessage: string;
    retryable: boolean;
    taskId: string;
    workerId: string;
  }): Promise<boolean>;
  recoverExpiredLeases(): Promise<number>;
  renew(input: {
    leaseDurationMs: number;
    taskId: string;
    workerId: string;
  }): Promise<boolean>;
}

export type TaskProcessor = (task: ClaimedTask) => Promise<void>;

export type WorkerRuntimeOptions = {
  leaseDurationMs: number;
  logger: Logger;
  pollIntervalMs: number;
  processTask: TaskProcessor;
  reaperIntervalMs: number;
  taskQueue: TaskQueue;
  workerId: string;
};

function taskLogContext(task: ClaimedTask): {
  attemptCount: number;
  entityId?: string;
  handler: string;
  taskId: string;
  taskKind: string;
  taskSchemaVersion: number;
  workspaceId: string;
} {
  return {
    attemptCount: task.attemptCount,
    ...(task.entityId === undefined ? {} : { entityId: task.entityId }),
    handler: task.kind,
    taskId: task.id,
    taskKind: task.kind,
    taskSchemaVersion: task.schemaVersion,
    workspaceId: task.workspaceId,
  };
}

async function recoverLeases(options: WorkerRuntimeOptions): Promise<void> {
  try {
    const recoveredCount = await options.taskQueue.recoverExpiredLeases();
    if (recoveredCount > 0) {
      options.logger.warn("worker.leases_recovered", { recoveredCount });
    }
  } catch {
    options.logger.error("worker.lease_recovery_failed", {
      errorCode: "LEASE_RECOVERY_FAILED",
    });
  }
}

async function claimTask(options: WorkerRuntimeOptions): Promise<ClaimedTask | null> {
  try {
    return await options.taskQueue.claim({
      leaseDurationMs: options.leaseDurationMs,
      workerId: options.workerId,
    });
  } catch {
    options.logger.error("worker.task_claim_failed", {
      errorCode: "TASK_CLAIM_FAILED",
      workerId: options.workerId,
    });
    return null;
  }
}

async function failTask(
  options: WorkerRuntimeOptions,
  task: ClaimedTask,
  failure: ReturnType<typeof toWorkerFailure>,
): Promise<void> {
  try {
    const persisted = await options.taskQueue.fail({
      errorCode: failure.code,
      errorMessage: failure.message,
      retryable: failure.retryable,
      taskId: task.id,
      workerId: options.workerId,
    });
    if (!persisted) {
      options.logger.warn("worker.task_lease_lost", {
        ...taskLogContext(task),
        errorCode: "TASK_LEASE_LOST",
      });
    }
  } catch {
    options.logger.error("worker.task_failure_persist_failed", {
      ...taskLogContext(task),
      errorCode: "TASK_FAILURE_PERSIST_FAILED",
    });
  }
}

async function renewLeaseUntilStopped(
  options: WorkerRuntimeOptions,
  task: ClaimedTask,
  signal: AbortSignal,
): Promise<void> {
  const renewalIntervalMs = Math.max(1_000, Math.floor(options.leaseDurationMs / 3));

  while (!signal.aborted) {
    await waitForAbortOrTimeout(renewalIntervalMs, signal);
    if (signal.aborted) {
      return;
    }

    try {
      const renewed = await options.taskQueue.renew({
        leaseDurationMs: options.leaseDurationMs,
        taskId: task.id,
        workerId: options.workerId,
      });
      if (!renewed) {
        options.logger.warn("worker.task_lease_lost", {
          ...taskLogContext(task),
          errorCode: "TASK_LEASE_LOST",
        });
        return;
      }
    } catch {
      options.logger.error("worker.task_lease_renewal_failed", {
        ...taskLogContext(task),
        errorCode: "TASK_LEASE_RENEWAL_FAILED",
      });
    }
  }
}

async function processClaimedTask(
  options: WorkerRuntimeOptions,
  task: ClaimedTask,
): Promise<void> {
  const context = taskLogContext(task);
  options.logger.info("worker.task_started", context);
  const heartbeatController = new AbortController();
  const heartbeat = renewLeaseUntilStopped(options, task, heartbeatController.signal);

  try {
    await options.processTask(task);
    const completed = await options.taskQueue.complete({
      taskId: task.id,
      workerId: options.workerId,
    });
    if (!completed) {
      throw new WorkerError({
        code: "TASK_LEASE_LOST",
        message: "The task lease was lost before completion.",
        retryable: true,
      });
    }
    options.logger.info("worker.task_succeeded", context);
  } catch (error) {
    const failure = toWorkerFailure(error);
    await failTask(options, task, failure);
    options.logger.error("worker.task_failed", {
      ...context,
      errorCode: failure.code,
      retryable: failure.retryable,
    });
  } finally {
    heartbeatController.abort();
    await heartbeat;
  }
}

export async function runWorker(options: WorkerRuntimeOptions, signal: AbortSignal): Promise<void> {
  options.logger.info("worker.started", {
    concurrency: 1,
    workerId: options.workerId,
  });

  let nextReaperAt = 0;

  while (!signal.aborted) {
    const currentTime = Date.now();
    if (currentTime >= nextReaperAt) {
      await recoverLeases(options);
      nextReaperAt = currentTime + options.reaperIntervalMs;
    }

    const task = await claimTask(options);
    if (task === null) {
      await waitForAbortOrTimeout(options.pollIntervalMs, signal);
      continue;
    }

    await processClaimedTask(options, task);
  }

  options.logger.info("worker.stopped", { workerId: options.workerId });
}

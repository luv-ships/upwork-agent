import { describe, expect, it, vi } from "vitest";

import type { Logger } from "./logger.js";
import { runWorker, type ClaimedTask, type TaskQueue } from "./worker.js";

function silentLogger(): Logger {
  return {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  };
}

describe("runWorker", () => {
  it("completes one claimed task and stops cleanly", async () => {
    const abortController = new AbortController();
    const task: ClaimedTask = {
      attemptCount: 1,
      id: "00000000-0000-4000-8000-000000000001",
      kind: "normalize-job",
      maxAttempts: 5,
      payload: {},
      schemaVersion: 1,
      workspaceId: "00000000-0000-4000-8000-000000000011",
    };
    const queue: TaskQueue = {
      claim: vi.fn().mockResolvedValueOnce(task).mockImplementation(async () => {
        abortController.abort();
        return null;
      }),
      complete: vi.fn().mockResolvedValue(true),
      fail: vi.fn().mockResolvedValue(true),
      recoverExpiredLeases: vi.fn().mockResolvedValue(0),
      renew: vi.fn().mockResolvedValue(true),
    };
    const processTask = vi.fn().mockResolvedValue(undefined);

    await runWorker(
      {
        leaseDurationMs: 60_000,
        logger: silentLogger(),
        pollIntervalMs: 100,
        processTask,
        reaperIntervalMs: 30_000,
        taskQueue: queue,
        workerId: "test-worker",
      },
      abortController.signal,
    );

    expect(processTask).toHaveBeenCalledOnce();
    expect(queue.complete).toHaveBeenCalledWith({
      taskId: task.id,
      workerId: "test-worker",
    });
    expect(queue.fail).not.toHaveBeenCalled();
  });

  it("persists a sanitized failure without completing the task", async () => {
    const abortController = new AbortController();
    const task: ClaimedTask = {
      attemptCount: 1,
      id: "00000000-0000-4000-8000-000000000002",
      kind: "analyze-match",
      maxAttempts: 5,
      payload: {},
      schemaVersion: 1,
      workspaceId: "00000000-0000-4000-8000-000000000011",
    };
    const queue: TaskQueue = {
      claim: vi.fn().mockResolvedValueOnce(task).mockImplementation(async () => {
        abortController.abort();
        return null;
      }),
      complete: vi.fn().mockResolvedValue(true),
      fail: vi.fn().mockResolvedValue(true),
      recoverExpiredLeases: vi.fn().mockResolvedValue(0),
      renew: vi.fn().mockResolvedValue(true),
    };

    await runWorker(
      {
        leaseDurationMs: 60_000,
        logger: silentLogger(),
        pollIntervalMs: 100,
        processTask: vi.fn().mockRejectedValue(new Error("private provider response")),
        reaperIntervalMs: 30_000,
        taskQueue: queue,
        workerId: "test-worker",
      },
      abortController.signal,
    );

    expect(queue.complete).not.toHaveBeenCalled();
    expect(queue.fail).toHaveBeenCalledWith({
      errorCode: "UNEXPECTED_HANDLER_ERROR",
      errorMessage: "The task handler failed unexpectedly.",
      retryable: true,
      taskId: task.id,
      workerId: "test-worker",
    });
  });
});

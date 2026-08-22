import { describe, expect, it } from "vitest";
import { z } from "zod";

import { toWorkerFailure, WorkerError } from "./errors.js";

describe("toWorkerFailure", () => {
  it("preserves only an explicitly sanitized worker error", () => {
    const failure = toWorkerFailure(
      new WorkerError({
        code: "PROVIDER_UNAVAILABLE",
        message: "The configured provider is unavailable.",
        retryable: true,
      }),
    );

    expect(failure).toEqual({
      code: "PROVIDER_UNAVAILABLE",
      message: "The configured provider is unavailable.",
      retryable: true,
    });
  });

  it("does not leak an unexpected provider error message", () => {
    const failure = toWorkerFailure(new Error("request included a private prompt"));

    expect(failure.message).toBe("The task handler failed unexpectedly.");
    expect(failure.message).not.toContain("private prompt");
  });

  it("classifies invalid task payloads as permanent", () => {
    const result = z.string().safeParse(42);
    expect(result.success).toBe(false);

    if (result.success) {
      throw new Error("Expected schema parsing to fail.");
    }

    expect(toWorkerFailure(result.error)).toMatchObject({
      code: "INVALID_TASK_PAYLOAD",
      retryable: false,
    });
  });
});

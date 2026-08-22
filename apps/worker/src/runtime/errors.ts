import { z } from "zod";

export type WorkerFailure = {
  code: string;
  message: string;
  retryable: boolean;
};

export class WorkerError extends Error {
  readonly code: string;
  readonly retryable: boolean;

  constructor(options: { code: string; message: string; retryable: boolean }) {
    super(options.message);
    this.name = "WorkerError";
    this.code = options.code;
    this.retryable = options.retryable;
  }
}

export function toWorkerFailure(error: unknown): WorkerFailure {
  if (error instanceof WorkerError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
    };
  }

  if (error instanceof z.ZodError) {
    return {
      code: "INVALID_TASK_PAYLOAD",
      message: "Task payload did not match its versioned schema.",
      retryable: false,
    };
  }

  return {
    code: "UNEXPECTED_HANDLER_ERROR",
    message: "The task handler failed unexpectedly.",
    retryable: true,
  };
}

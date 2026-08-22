import { describe, expect, it } from "vitest";

import { startWorkerHealthServer, workerHealthPayload } from "./health.js";

describe("worker health server", () => {
  it("can be disabled for local workers", async () => {
    const server = await startWorkerHealthServer({ port: 0, workerId: "test-worker" });
    expect(server.port).toBe(0);
    await expect(server.close()).resolves.toBeUndefined();
  });

  it("keeps the health payload bounded and non-sensitive", () => {
    expect(workerHealthPayload("test-worker")).toEqual({ status: "ok", workerId: "test-worker" });
  });
});

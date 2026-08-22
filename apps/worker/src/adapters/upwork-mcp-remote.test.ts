import { describe, expect, it, vi } from "vitest";

import {
  parseRetryAfter,
  UpworkMcpRemoteFindJobsClient,
  type UpworkMcpFindJobsSessionFactory
} from "./upwork-mcp-remote.js";
import {
  UpworkFindJobsClientError,
  upworkFindJobsSearchParamsSchema
} from "./upwork-mcp.js";

const connectionId = "00000000-0000-4000-8000-000000000091";
const workspaceId = "00000000-0000-4000-8000-000000000011";
const params = upworkFindJobsSearchParamsSchema.parse({ sort: "recency", limit: 1 });

describe("UpworkMcpRemoteFindJobsClient", () => {
  it("resolves one connection and invokes only the fixed find_jobs method", async () => {
    const callFindJobs = vi.fn().mockResolvedValue({ content: [] });
    const close = vi.fn().mockResolvedValue(undefined);
    const open = vi.fn<UpworkMcpFindJobsSessionFactory["open"]>().mockResolvedValue({
      callFindJobs,
      close
    });
    const client = new UpworkMcpRemoteFindJobsClient({
      accessResolver: {
        resolve: async () => ({ accessToken: "server-only-token", orgUid: "1936403733578252377" })
      },
      sessionFactory: { open }
    });

    await expect(client.searchJobs({ workspaceId, connectionId, params })).resolves.toEqual({ content: [] });
    expect(open).toHaveBeenCalledWith({ accessToken: "server-only-token" });
    expect(callFindJobs).toHaveBeenCalledWith({
      orgUid: "1936403733578252377",
      params
    });
    expect(close).toHaveBeenCalledOnce();
  });

  it("fails closed when no encrypted connection material can be resolved", async () => {
    const client = new UpworkMcpRemoteFindJobsClient({
      accessResolver: { resolve: async () => undefined },
      sessionFactory: { open: vi.fn() }
    });

    await expect(client.searchJobs({ workspaceId, connectionId, params })).rejects.toMatchObject({
      kind: "reauthorization_required"
    });
  });

  it("returns a classified rate-limit condition without a raw transport error", async () => {
    const client = new UpworkMcpRemoteFindJobsClient({
      accessResolver: {
        resolve: async () => ({ accessToken: "server-only-token", orgUid: "1936403733578252377" })
      },
      sessionFactory: {
        open: async () => {
          throw new UpworkFindJobsClientError({ kind: "rate_limited" });
        }
      }
    });

    await expect(client.searchJobs({ workspaceId, connectionId, params })).rejects.toMatchObject({
      kind: "rate_limited"
    });
  });
});

describe("parseRetryAfter", () => {
  const now = new Date("2026-08-18T01:00:00.000Z");

  it("accepts bounded delta seconds and HTTP dates", () => {
    expect(parseRetryAfter("120", now)).toBe("2026-08-18T01:02:00.000Z");
    expect(parseRetryAfter("Tue, 18 Aug 2026 01:05:00 GMT", now)).toBe(
      "2026-08-18T01:05:00.000Z"
    );
  });

  it("rejects missing, stale, and unbounded retry guidance", () => {
    expect(parseRetryAfter(null, now)).toBeUndefined();
    expect(parseRetryAfter("Tue, 18 Aug 2026 00:05:00 GMT", now)).toBeUndefined();
    expect(parseRetryAfter("999999", now)).toBeUndefined();
  });
});

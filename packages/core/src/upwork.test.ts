import { describe, expect, it } from "vitest";

import {
  UPWORK_MCP_MAX_JOBS_PER_POLL,
  upworkCandidateToSourceJob,
  upworkJobSearchOutcomeSchema,
  upworkJobSearchRequestSchema,
  upworkMonitorIntervalSecondsSchema
} from "./index.js";

const request = {
  workspaceId: "00000000-0000-4000-8000-000000000001",
  campaignId: "00000000-0000-4000-8000-000000000002",
  monitorId: "00000000-0000-4000-8000-000000000003",
  connectionId: "00000000-0000-4000-8000-000000000004",
  cursor: "cursor-1",
  filters: { version: 1 as const },
  maxResults: 10
};

describe("Upwork MCP discovery contracts", () => {
  it("keeps requests bounded and free of credentials", () => {
    const parsed = upworkJobSearchRequestSchema.parse(request);
    expect(parsed.maxResults).toBe(10);
    expect("accessToken" in parsed).toBe(false);
    expect("refreshToken" in parsed).toBe(false);
    expect(
      upworkJobSearchRequestSchema.safeParse({
        ...request,
        maxResults: UPWORK_MCP_MAX_JOBS_PER_POLL + 1
      }).success
    ).toBe(false);
  });

  it("maps a bounded MCP candidate into the shared source-job contract", () => {
    expect(
      upworkCandidateToSourceJob({
        externalJobId: "~012345",
        canonicalUrl: "https://www.upwork.com/jobs/~012345",
        postedAt: "2026-08-21T00:00:00.000Z",
        title: "Build an OpenAI workflow",
        description: "Connect Make.com to an internal API.",
        skills: ["OpenAI", "Make.com"],
        categoryIds: ["automation"],
        jobType: "fixed",
        fixedBudget: { currency: "USD", min: 750, max: 1_250 }
      })
    ).toEqual({
      sourceJobId: "~012345",
      postedAt: "2026-08-21T00:00:00.000Z",
      title: "Build an OpenAI workflow",
      description: "Connect Make.com to an internal API.",
      skills: ["OpenAI", "Make.com"],
      categoryIds: ["automation"],
      jobType: "fixed",
      fixedBudget: { currency: "USD", min: 750, max: 1_250 }
    });
  });

  it("rejects source links outside an HTTPS Upwork domain", () => {
    expect(
      upworkJobSearchOutcomeSchema.safeParse({
        kind: "page",
        jobs: [
          {
            externalJobId: "~012345",
            canonicalUrl: "https://example.com/phishing",
            title: "Build an OpenAI workflow",
            description: "Connect Make.com to an internal API.",
            skills: [],
            categoryIds: [],
            jobType: "fixed"
          }
        ]
      }).success
    ).toBe(false);
  });

  it("validates retry outcomes and monitor cadence bounds", () => {
    expect(
      upworkJobSearchOutcomeSchema.parse({
        kind: "rate_limited",
        retryAt: "2026-08-15T12:00:00.000Z"
      })
    ).toMatchObject({ kind: "rate_limited" });
    expect(upworkMonitorIntervalSecondsSchema.safeParse(300).success).toBe(true);
    expect(upworkMonitorIntervalSecondsSchema.safeParse(30).success).toBe(false);
  });

  it("accepts a bounded opaque pagination cursor", () => {
    expect(
      upworkJobSearchOutcomeSchema.parse({ kind: "page", jobs: [], nextCursor: "cursor-2" }),
    ).toMatchObject({ nextCursor: "cursor-2" });
  });
});

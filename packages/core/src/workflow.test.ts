import { describe, expect, it } from "vitest";

import { parseWorkflowTaskPayload, workflowTaskPayloadSchemas } from "./index.js";

const jobId = "11111111-1111-4111-8111-111111111111";
const matchId = "22222222-2222-4222-8222-222222222222";
const monitorId = "33333333-3333-4333-8333-333333333333";
const connectionId = "44444444-4444-4444-8444-444444444444";
const campaignId = "55555555-5555-4555-8555-555555555555";
const hash = "a".repeat(64);

describe("workflow task payload schemas", () => {
  it("parses every supported payload kind", () => {
    expect(
      parseWorkflowTaskPayload("normalize-job", { jobId, sourcePayloadHash: hash })
    ).toEqual({ jobId, sourcePayloadHash: hash });
    expect(parseWorkflowTaskPayload("match-job", { jobId, normalizedRevision: 1 })).toEqual({
      jobId,
      normalizedRevision: 1
    });
    expect(
      parseWorkflowTaskPayload("match-job", {
        campaignId,
        jobId,
        normalizedRevision: 1
      })
    ).toEqual({ campaignId, jobId, normalizedRevision: 1 });
    expect(parseWorkflowTaskPayload("analyze-match", { matchId, inputHash: hash })).toEqual({
      matchId,
      inputHash: hash
    });
    expect(
      parseWorkflowTaskPayload("poll-upwork-monitor", {
        monitorId,
        scheduleVersion: 2,
        runSequence: 3
      })
    ).toEqual({ monitorId, scheduleVersion: 2, runSequence: 3 });
    expect(
      parseWorkflowTaskPayload("purge-upwork-data", {
        connectionId,
        scheduleVersion: 4,
        runSequence: 5
      })
    ).toEqual({ connectionId, scheduleVersion: 4, runSequence: 5 });
  });

  it("rejects malformed IDs, hashes, and revisions", () => {
    expect(
      workflowTaskPayloadSchemas["normalize-job"].safeParse({
        jobId: "not-a-uuid",
        sourcePayloadHash: hash
      }).success
    ).toBe(false);
    expect(
      workflowTaskPayloadSchemas["normalize-job"].safeParse({
        jobId,
        sourcePayloadHash: hash.toUpperCase()
      }).success
    ).toBe(false);
    expect(
      workflowTaskPayloadSchemas["match-job"].safeParse({ jobId, normalizedRevision: 0 }).success
    ).toBe(false);
    expect(
      workflowTaskPayloadSchemas["analyze-match"].safeParse({ matchId, inputHash: "short" })
        .success
    ).toBe(false);
    expect(
      workflowTaskPayloadSchemas["purge-upwork-data"].safeParse({
        connectionId,
        scheduleVersion: 1,
        runSequence: 0
      }).success
    ).toBe(false);
  });

  it("does not permit one task kind's payload to satisfy another kind", () => {
    expect(() =>
      parseWorkflowTaskPayload("analyze-match", { jobId, normalizedRevision: 1 })
    ).toThrow();
  });
});

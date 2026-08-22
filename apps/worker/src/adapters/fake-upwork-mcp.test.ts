import { emptyCampaignFilterV1 } from "@upwork-agent/core";
import { describe, expect, it } from "vitest";

import { FakeUpworkMcpPort } from "./fake-upwork-mcp.js";

const request = {
  workspaceId: "00000000-0000-4000-8000-000000000011",
  campaignId: "00000000-0000-4000-8000-000000000051",
  monitorId: "00000000-0000-4000-8000-000000000081",
  connectionId: "00000000-0000-4000-8000-000000000091",
  filters: emptyCampaignFilterV1,
  maxResults: 1,
};

describe("FakeUpworkMcpPort", () => {
  it("returns a bounded, deterministic placeholder listing", async () => {
    const port = new FakeUpworkMcpPort();

    const first = await port.searchJobs(request);
    const second = await port.searchJobs(request);

    expect(first).toEqual(second);
    expect(first.kind).toBe("page");
    if (first.kind === "page") {
      expect(first.jobs).toHaveLength(1);
      expect(first.jobs[0]?.skills).toContain("OpenAI");
    }
  });

  it("supports retry outcomes without making a network request", async () => {
    const port = new FakeUpworkMcpPort(() => ({
      kind: "rate_limited",
      retryAt: "2026-08-15T01:00:00.000Z",
    }));

    await expect(port.searchJobs(request)).resolves.toEqual({
      kind: "rate_limited",
      retryAt: "2026-08-15T01:00:00.000Z",
    });
  });
});

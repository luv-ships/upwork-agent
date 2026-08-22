import { campaignFilterV1Schema } from "@upwork-agent/core";
import { describe, expect, it, vi } from "vitest";

import {
  RemoteUpworkMcpPort,
  UpworkFindJobsClientError,
  type UpworkFindJobsClient
} from "./upwork-mcp.js";

const request = {
  workspaceId: "00000000-0000-4000-8000-000000000011",
  campaignId: "00000000-0000-4000-8000-000000000051",
  monitorId: "00000000-0000-4000-8000-000000000081",
  connectionId: "00000000-0000-4000-8000-000000000091",
  cursor: "1",
  filters: campaignFilterV1Schema.parse({
    version: 1,
    requiredSkills: ["Make.com"],
    includeKeywords: ["OpenAI"],
    experienceLevels: ["intermediate"],
    jobTypes: ["hourly"],
    hourlyRate: { min: 20, max: 80 },
    proposalCount: { min: 0, max: 5 },
    paymentVerification: "only_verified",
    clientHireHistory: "1_to_9",
    clientTimeZones: ["Europe/Paris"]
  }),
  maxResults: 10
};

function textToolResult(value: unknown): unknown {
  return {
    content: [{ type: "text", text: JSON.stringify(value) }]
  };
}

describe("RemoteUpworkMcpPort", () => {
  it("calls only the fixed search operation and maps the captured response shape", async () => {
    const searchJobs = vi.fn<UpworkFindJobsClient["searchJobs"]>().mockResolvedValue(
      textToolResult({
        status: "ok",
        jobs: [
          {
            budget: "0.0",
            client: { country: "France", hire_rate: "42%" },
            created_date: "2026-08-15T16:07:20+0000",
            description_snippet: "Marketplace-provided job text.",
            duration: "Less than 1 month",
            engagement: "Less than 30 hrs/week",
            experience_level: "INTERMEDIATE",
            hourly_budget_type: "no rate stated",
            id: "2088658808609808016",
            job_type: "hourly",
            proposal_count: 8,
            published_date: "2026-08-15T19:09:06+0000",
            skills: ["Make.com", "API Integration"],
            title: "Automation project"
          }
        ],
        next_cursor: "1",
        pageInfo: { endCursor: "1", hasNextPage: true }
      })
    );
    const port = new RemoteUpworkMcpPort({ searchJobs });

    await expect(port.searchJobs(request)).resolves.toEqual({
      kind: "page",
      nextCursor: "1",
      jobs: [
        {
          externalJobId: "2088658808609808016",
          title: "Automation project",
          description: "Marketplace-provided job text.",
          skills: ["Make.com", "API Integration"],
          categoryIds: [],
          experienceLevel: "intermediate",
          jobType: "hourly",
          proposalCount: 8,
          paymentVerified: true,
          projectLengthBand: "under_1_month",
          hoursPerWeekBand: "under_30",
          postedAt: "2026-08-15T19:09:06.000Z",
          client: { hireRatePercent: 42 }
        }
      ]
    });
    expect(searchJobs).toHaveBeenCalledWith({
      workspaceId: request.workspaceId,
      connectionId: request.connectionId,
      params: {
        cursor: "1",
        query: "Make.com OpenAI",
        job_type: "hourly",
        experience_level: "intermediate",
        budget_min: 20,
        budget_max: 80,
        verified_payment_only: true,
        proposals_min: 0,
        proposals_max: 5,
        client_hires_min: 1,
        client_hires_max: 9,
        timezone: "Europe/Paris",
        sort: "recency",
        limit: 10
      }
    });
  });

  it("fails closed to a retryable outcome for an incomplete search listing", async () => {
    const port = new RemoteUpworkMcpPort({
      searchJobs: async () => textToolResult({ jobs: [{ id: "job-1", job_type: "hourly", title: "No snippet" }] })
    });

    await expect(port.searchJobs(request)).resolves.toEqual({ kind: "temporarily_unavailable" });
  });

  it("accepts the standard structured-content MCP result envelope", async () => {
    const port = new RemoteUpworkMcpPort({
      searchJobs: async () => ({
        structuredContent: {
          jobs: [
            {
              description_snippet: "Structured result",
              id: "structured-job-1",
              job_type: "fixed",
              title: "Structured automation job"
            }
          ]
        }
      })
    });

    await expect(port.searchJobs(request)).resolves.toMatchObject({
      kind: "page",
      jobs: [{ externalJobId: "structured-job-1", title: "Structured automation job" }]
    });
  });

  it("maps an explicit fixed budget without guessing hourly rates", async () => {
    const port = new RemoteUpworkMcpPort({
      searchJobs: async () => ({
        structuredContent: {
          jobs: [
            {
              budget: "$1,250.00",
              description_snippet: "Fixed budget result",
              id: "fixed-budget-job-1",
              job_type: "fixed",
              title: "Fixed budget automation job"
            }
          ]
        }
      })
    });

    await expect(port.searchJobs(request)).resolves.toMatchObject({
      kind: "page",
      jobs: [
        {
          externalJobId: "fixed-budget-job-1",
          fixedBudget: { currency: "USD", min: 1_250, max: 1_250 }
        }
      ]
    });
  });

  it("preserves explicit fixed-price ranges", async () => {
    const port = new RemoteUpworkMcpPort({
      searchJobs: async () => ({
        structuredContent: {
          jobs: [{
            budget: "$100 - $500",
            description_snippet: "Fixed range result",
            id: "fixed-range-job-1",
            job_type: "fixed",
            title: "Fixed automation job",
          }],
        },
      }),
    });

    await expect(port.searchJobs(request)).resolves.toMatchObject({
      kind: "page",
      jobs: [{ externalJobId: "fixed-range-job-1", fixedBudget: { currency: "USD", min: 100, max: 500 } }],
    });
  });

  it("maps explicit hourly rate ranges and ignores an unstated rate", async () => {
    const port = new RemoteUpworkMcpPort({
      searchJobs: async () => ({
        structuredContent: {
          jobs: [
            {
              budget: "$20.00 - $40.00/hr",
              description_snippet: "Hourly rate result",
              hourly_budget_type: "hourly",
              id: "hourly-rate-job-1",
              job_type: "hourly",
              title: "Hourly automation job",
            },
            {
              budget: "0.0",
              description_snippet: "No rate result",
              hourly_budget_type: "no rate stated",
              id: "hourly-rate-job-2",
              job_type: "hourly",
              title: "Hourly job without a rate",
            },
          ],
        },
      }),
    });

    const outcome = await port.searchJobs(request);
    expect(outcome).toMatchObject({
      kind: "page",
      jobs: [
        { externalJobId: "hourly-rate-job-1", hourlyRate: { currency: "USD", min: 20, max: 40 } },
        { externalJobId: "hourly-rate-job-2" },
      ],
    });
    if (outcome.kind !== "page") throw new Error("Expected a page outcome");
    expect(outcome.jobs[1]).not.toHaveProperty("hourlyRate");
  });

  it("keeps the newest published listing first even if the provider order drifts", async () => {
    const port = new RemoteUpworkMcpPort({
      searchJobs: async () => ({
        structuredContent: {
          jobs: [
            {
              description_snippet: "Older",
              id: "older-job",
              job_type: "fixed",
              published_date: "2026-08-21T08:00:00Z",
              title: "Older job"
            },
            {
              description_snippet: "Newer",
              id: "newer-job",
              job_type: "fixed",
              published_date: "2026-08-21T09:00:00Z",
              title: "Newer job"
            }
          ]
        }
      })
    });

    await expect(port.searchJobs(request)).resolves.toMatchObject({
      kind: "page",
      jobs: [{ externalJobId: "newer-job" }, { externalJobId: "older-job" }]
    });
  });

  it("maps classified OAuth and rate-limit failures without exposing a transport detail", async () => {
    const rateLimitedPort = new RemoteUpworkMcpPort({
      searchJobs: async () => {
        throw new UpworkFindJobsClientError({
          kind: "rate_limited",
          retryAt: "2026-08-16T12:00:00.000Z"
        });
      }
    });
    const reauthorizationPort = new RemoteUpworkMcpPort({
      searchJobs: async () => {
        throw new UpworkFindJobsClientError({ kind: "reauthorization_required" });
      }
    });

    await expect(rateLimitedPort.searchJobs(request)).resolves.toEqual({
      kind: "rate_limited",
      retryAt: "2026-08-16T12:00:00.000Z"
    });
    await expect(reauthorizationPort.searchJobs(request)).resolves.toEqual({
      kind: "reauthorization_required"
    });
  });

  it("converts an unexpected connector failure into a durable retry outcome", async () => {
    const port = new RemoteUpworkMcpPort({
      searchJobs: async () => {
        throw new Error("unbounded remote detail");
      }
    });

    await expect(port.searchJobs(request)).resolves.toEqual({
      kind: "temporarily_unavailable"
    });
  });
});

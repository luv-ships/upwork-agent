import { z } from "zod";

import { campaignFilterV1Schema } from "./campaign.js";
import {
  DEVELOPMENT_SOURCE_JOB_ID_MAX_LENGTH,
  sourceJobInputSchema,
  type SourceJobInput
} from "./jobs.js";

/**
 * `upwork__find_jobs` permits at most ten listings in one search response.
 * A monitor intentionally makes one bounded read-only search per run. An
 * opaque provider cursor is persisted per monitor and advanced only after a
 * successful page commit.
 */
export const UPWORK_MCP_MAX_JOBS_PER_POLL = 10;
export const UPWORK_MCP_RETENTION_DAYS = 30;

export const upworkMonitorIntervalSecondsSchema = z.number().int().min(60).max(86_400);

const upworkCanonicalUrlSchema = z
  .url()
  .max(2_000)
  .refine((value) => {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      (url.hostname === "upwork.com" || url.hostname.endsWith(".upwork.com"))
    );
  }, "canonical URL must use HTTPS on an Upwork domain");

export const upworkJobCandidateSchema = sourceJobInputSchema
  .omit({ sourceJobId: true })
  .extend({
    externalJobId: z.string().trim().min(1).max(DEVELOPMENT_SOURCE_JOB_ID_MAX_LENGTH),
    canonicalUrl: upworkCanonicalUrlSchema.optional(),
    postedAt: z.string().datetime({ offset: true }).optional()
  });

export const upworkJobSearchRequestSchema = z.object({
  workspaceId: z.uuid(),
  campaignId: z.uuid(),
  monitorId: z.uuid(),
  connectionId: z.uuid(),
  cursor: z.string().trim().min(1).max(10_000).optional(),
  filters: campaignFilterV1Schema,
  maxResults: z.number().int().min(1).max(UPWORK_MCP_MAX_JOBS_PER_POLL)
});

export const upworkJobSearchOutcomeSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("page"),
    jobs: z.array(upworkJobCandidateSchema).max(UPWORK_MCP_MAX_JOBS_PER_POLL),
    nextCursor: z.string().trim().min(1).max(10_000).optional()
  }),
  z.object({
    kind: z.literal("rate_limited"),
    retryAt: z.string().datetime({ offset: true })
  }),
  z.object({
    kind: z.literal("reauthorization_required")
  }),
  z.object({
    kind: z.literal("temporarily_unavailable"),
    retryAt: z.string().datetime({ offset: true }).optional()
  })
]);

export type UpworkJobCandidate = z.infer<typeof upworkJobCandidateSchema>;
export type UpworkJobSearchRequest = z.infer<typeof upworkJobSearchRequestSchema>;
export type UpworkJobSearchOutcome = z.infer<typeof upworkJobSearchOutcomeSchema>;

export interface UpworkMcpPort {
  searchJobs(input: UpworkJobSearchRequest): Promise<UpworkJobSearchOutcome>;
}

export function upworkCandidateToSourceJob(candidateInput: UpworkJobCandidate): SourceJobInput {
  const candidate = upworkJobCandidateSchema.parse(candidateInput);
  return sourceJobInputSchema.parse({ ...candidate, sourceJobId: candidate.externalJobId });
}

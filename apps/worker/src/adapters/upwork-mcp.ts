import {
  upworkJobCandidateSchema,
  upworkJobSearchOutcomeSchema,
  upworkJobSearchRequestSchema,
  type CampaignFilterV1,
  type NumericRange,
  type UpworkJobCandidate,
  type UpworkJobSearchOutcome,
  type UpworkJobSearchRequest,
  type UpworkMcpPort
} from "@upwork-agent/core";
import { z } from "zod";

const MAX_TOOL_TEXT_RESPONSE_LENGTH = 250_000;
const MAX_SEARCH_QUERY_LENGTH = 32_199;

export const upworkFindJobsSearchParamsSchema = z.object({
  query: z.string().trim().min(1).max(MAX_SEARCH_QUERY_LENGTH).optional(),
  cursor: z.string().trim().min(1).max(10_000).optional(),
  job_type: z.enum(["fixed", "hourly"]).optional(),
  experience_level: z.enum(["entry_level", "intermediate", "expert"]).optional(),
  budget_min: z.number().finite().positive().optional(),
  budget_max: z.number().finite().positive().optional(),
  verified_payment_only: z.boolean().optional(),
  proposals_min: z.number().int().nonnegative().optional(),
  proposals_max: z.number().int().nonnegative().optional(),
  client_hires_min: z.number().int().nonnegative().optional(),
  client_hires_max: z.number().int().nonnegative().optional(),
  timezone: z.string().trim().min(1).max(100).optional(),
  sort: z.literal("recency"),
  limit: z.number().int().min(1).max(10)
});

export type UpworkFindJobsSearchParams = z.infer<typeof upworkFindJobsSearchParamsSchema>;

/**
 * This is intentionally a fixed-tool client, not a generic MCP dispatcher.
 * Its eventual implementation owns OAuth material and the fixed
 * `upwork__find_jobs` call for one connected workspace.
 */
export interface UpworkFindJobsClient {
  searchJobs(input: {
    readonly workspaceId: string;
    readonly connectionId: string;
    readonly params: UpworkFindJobsSearchParams;
  }): Promise<unknown>;
}

export class UpworkFindJobsClientError extends Error {
  public readonly kind: "rate_limited" | "reauthorization_required" | "temporarily_unavailable";
  public readonly retryAt: string | undefined;

  public constructor(input: {
    readonly kind: "rate_limited" | "reauthorization_required" | "temporarily_unavailable";
    readonly retryAt?: string;
  }) {
    super(`Upwork find_jobs ${input.kind}`);
    this.name = "UpworkFindJobsClientError";
    this.kind = input.kind;
    this.retryAt = input.retryAt;
  }
}

const rawJobSchema = z.object({
  budget: z.union([z.string().trim().max(100), z.number().finite()]).optional(),
  client: z
    .object({
      country: z.string().trim().max(160).optional(),
      hire_rate: z.union([z.string().trim().max(20), z.number().finite()]).optional()
    })
    .optional(),
  created_date: z.string().trim().max(100).optional(),
  description_snippet: z.string().trim().max(20_000).optional(),
  duration: z.string().trim().max(100).optional(),
  engagement: z.string().trim().max(100).optional(),
  experience_level: z.string().trim().max(100).optional(),
  hourly_budget_type: z.string().trim().max(100).optional(),
  id: z.string().trim().min(1).max(300),
  job_type: z.string().trim().max(100),
  proposal_count: z.number().int().nonnegative().optional(),
  published_date: z.string().trim().max(100).optional(),
  skills: z.array(z.string().trim().min(1).max(160)).max(100).optional(),
  title: z.string().trim().min(1).max(300)
});

const rawFindJobsResponseSchema = z.object({
  jobs: z.array(rawJobSchema).max(10),
  next_cursor: z.string().trim().max(10_000).optional(),
  pageInfo: z
    .object({
      endCursor: z.string().trim().max(10_000).nullable().optional(),
      hasNextPage: z.boolean()
    })
    .optional(),
  status: z.string().trim().max(100).optional()
});

const mcpToolResultSchema = z.object({
  content: z
    .array(
      z.object({
        text: z.string().max(MAX_TOOL_TEXT_RESPONSE_LENGTH),
        type: z.literal("text")
      })
    )
    .optional(),
  structuredContent: z.unknown().optional()
});

function selectedSearchQuery(filters: CampaignFilterV1): string | undefined {
  const uniqueValues = new Map<string, string>();
  for (const value of [...filters.requiredSkills, ...filters.includeKeywords]) {
    const key = value.toLocaleLowerCase("en-US");
    if (!uniqueValues.has(key)) uniqueValues.set(key, value);
  }
  const query = [...uniqueValues.values()].join(" ");
  return query.length > 0 ? query : undefined;
}

function remoteBudgetRange(range: NumericRange | undefined): {
  readonly budget_min?: number;
  readonly budget_max?: number;
} {
  if (range === undefined) return {};
  return {
    ...(range.min === undefined || range.min <= 0 ? {} : { budget_min: range.min }),
    ...(range.max === undefined || range.max <= 0 ? {} : { budget_max: range.max })
  };
}

function remoteHireRange(
  clientHireHistory: CampaignFilterV1["clientHireHistory"]
): { readonly client_hires_min?: number; readonly client_hires_max?: number } {
  switch (clientHireHistory) {
    case "no_hires":
      return { client_hires_min: 0, client_hires_max: 0 };
    case "1_to_9":
      return { client_hires_min: 1, client_hires_max: 9 };
    case "10_plus":
      return { client_hires_min: 10 };
    case "any":
      return {};
  }
}

/** Map only filters whose remote semantics were confirmed by tool help. */
export function toUpworkFindJobsSearchParams(
  inputValue: UpworkJobSearchRequest
): UpworkFindJobsSearchParams {
  const input = upworkJobSearchRequestSchema.parse(inputValue);
  const { filters } = input;
  const jobType = filters.jobTypes.length === 1 ? filters.jobTypes[0] : undefined;
  const query = selectedSearchQuery(filters);
  const budget =
    jobType === "hourly"
      ? remoteBudgetRange(filters.hourlyRate)
      : jobType === "fixed"
        ? remoteBudgetRange(filters.fixedBudget)
        : {};
  const params = {
    ...(query === undefined ? {} : { query }),
    ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
    ...(jobType === undefined ? {} : { job_type: jobType }),
    ...(filters.experienceLevels.length !== 1
      ? {}
      : {
          experience_level:
            filters.experienceLevels[0] === "entry"
              ? "entry_level"
              : filters.experienceLevels[0]
        }),
    ...budget,
    ...(filters.paymentVerification === "only_verified"
      ? { verified_payment_only: true }
      : {}),
    ...(filters.proposalCount?.min === undefined
      ? {}
      : { proposals_min: filters.proposalCount.min }),
    ...(filters.proposalCount?.max === undefined
      ? {}
      : { proposals_max: filters.proposalCount.max }),
    ...remoteHireRange(filters.clientHireHistory),
    ...(filters.clientTimeZones.length === 1 ? { timezone: filters.clientTimeZones[0] } : {}),
    sort: "recency" as const,
    limit: input.maxResults
  };
  return upworkFindJobsSearchParamsSchema.parse(params);
}

function mapExperienceLevel(
  value: string | undefined
): UpworkJobCandidate["experienceLevel"] | undefined {
  switch (value?.toLocaleLowerCase("en-US")) {
    case "entry_level":
    case "entry":
      return "entry";
    case "intermediate":
      return "intermediate";
    case "expert":
      return "expert";
    default:
      return undefined;
  }
}

function mapProjectLength(
  value: string | undefined
): UpworkJobCandidate["projectLengthBand"] | undefined {
  switch (value) {
    case "Less than 1 month":
      return "under_1_month";
    case "1 to 3 months":
      return "one_to_three_months";
    case "3 to 6 months":
      return "three_to_six_months";
    case "More than 6 months":
      return "over_6_months";
    default:
      return undefined;
  }
}

function mapWeeklyHours(
  value: string | undefined
): UpworkJobCandidate["hoursPerWeekBand"] | undefined {
  switch (value) {
    case "Less than 30 hrs/week":
      return "under_30";
    case "More than 30 hrs/week":
      return "over_30";
    default:
      return undefined;
  }
}

function toIsoTimestamp(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? undefined : timestamp.toISOString();
}

function countryCode(value: string | undefined): string | undefined {
  return value !== undefined && /^[A-Z]{2}$/.test(value) ? value : undefined;
}

function hireRatePercent(value: string | number | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = typeof value === "number" ? value : Number(value.replace(/%/g, "").trim());
  return Number.isInteger(parsed) && parsed >= 0 && parsed <= 100 ? parsed : undefined;
}

function fixedBudget(value: string | number | undefined): UpworkJobCandidate["fixedBudget"] | undefined {
  if (value === undefined) return undefined;
  const numbers = typeof value === "number"
    ? [value]
    : [...value.matchAll(/\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?/gu)].map((match) => Number(match[0].replace(/,/gu, "")));
  const valid = numbers.filter((number) => Number.isFinite(number) && number >= 0 && Math.round(number * 100) === number * 100);
  if (valid.length === 0) return undefined;
  return { currency: "USD", min: Math.min(...valid), max: Math.max(...valid) };
}

function hourlyRate(
  value: string | number | undefined,
  budgetType: string | undefined,
): UpworkJobCandidate["hourlyRate"] | undefined {
  if (value === undefined || (budgetType !== undefined && /no\s+rate|not\s+stated/iu.test(budgetType))) {
    return undefined;
  }
  const numbers = typeof value === "number"
    ? [value]
    : [...value.matchAll(/\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?/gu)].map((match) => Number(match[0].replace(/,/gu, "")));
  const valid = numbers.filter((number) => Number.isFinite(number) && number >= 0 && Math.round(number * 100) === number * 100);
  if (valid.length === 0) return undefined;
  const min = Math.min(...valid);
  const max = Math.max(...valid);
  return { currency: "USD", min, max };
}

function mapRawJob(
  job: z.infer<typeof rawJobSchema>,
  params: UpworkFindJobsSearchParams
): UpworkJobCandidate | undefined {
  if (
    job.description_snippet === undefined ||
    (job.job_type !== "hourly" && job.job_type !== "fixed")
  ) {
    return undefined;
  }

  const clientCountryCode = countryCode(job.client?.country);
  const clientHireRatePercent = hireRatePercent(job.client?.hire_rate);
  const fixedBudgetRange = job.job_type === "fixed" ? fixedBudget(job.budget) : undefined;
  const hourlyRateRange = job.job_type === "hourly" ? hourlyRate(job.budget, job.hourly_budget_type) : undefined;

  const candidate = upworkJobCandidateSchema.safeParse({
    externalJobId: job.id,
    title: job.title,
    // Marketplace text is untrusted data, not tool instructions.
    description: job.description_snippet,
    skills: job.skills ?? [],
    categoryIds: [],
    jobType: job.job_type,
    ...(mapExperienceLevel(job.experience_level) === undefined
      ? {}
      : { experienceLevel: mapExperienceLevel(job.experience_level) }),
    ...(job.proposal_count === undefined ? {} : { proposalCount: job.proposal_count }),
    ...(params.verified_payment_only === true ? { paymentVerified: true } : {}),
    ...(hourlyRateRange === undefined ? {} : { hourlyRate: hourlyRateRange }),
    ...(fixedBudgetRange === undefined ? {} : { fixedBudget: fixedBudgetRange }),
    ...(clientCountryCode === undefined && clientHireRatePercent === undefined
      ? {}
      : {
          client: {
            ...(clientCountryCode === undefined ? {} : { countryCode: clientCountryCode }),
            ...(clientHireRatePercent === undefined ? {} : { hireRatePercent: clientHireRatePercent })
          }
        }),
    ...(mapProjectLength(job.duration) === undefined
      ? {}
      : { projectLengthBand: mapProjectLength(job.duration) }),
    ...(mapWeeklyHours(job.engagement) === undefined
      ? {}
      : { hoursPerWeekBand: mapWeeklyHours(job.engagement) }),
    ...(toIsoTimestamp(job.published_date) === undefined
      ? {}
      : { postedAt: toIsoTimestamp(job.published_date) })
  });
  return candidate.success ? candidate.data : undefined;
}

function decodeToolResult(value: unknown): unknown {
  const envelope = mcpToolResultSchema.safeParse(value);
  if (!envelope.success) return value;
  if (envelope.data.structuredContent === undefined && envelope.data.content === undefined) {
    return value;
  }
  if (envelope.data.structuredContent !== undefined) return envelope.data.structuredContent;
  const content = envelope.data.content?.find((item) => item.type === "text");
  if (content === undefined) return undefined;
  try {
    return JSON.parse(content.text) as unknown;
  } catch {
    return undefined;
  }
}

function toTemporaryUnavailable(): UpworkJobSearchOutcome {
  return { kind: "temporarily_unavailable" };
}

function newestFirst(left: UpworkJobCandidate, right: UpworkJobCandidate): number {
  const leftTime = left.postedAt === undefined ? Number.NaN : Date.parse(left.postedAt);
  const rightTime = right.postedAt === undefined ? Number.NaN : Date.parse(right.postedAt);
  if (!Number.isFinite(leftTime) && !Number.isFinite(rightTime)) return 0;
  if (!Number.isFinite(leftTime)) return 1;
  if (!Number.isFinite(rightTime)) return -1;
  return rightTime - leftTime;
}

/**
 * Converts the fixed read-only `upwork__find_jobs` MCP output into the shared
 * source-job contract. OAuth and Streamable HTTP remain in the injected
 * client so this adapter stays deterministic and has no generic tool path.
 */
export class RemoteUpworkMcpPort implements UpworkMcpPort {
  readonly #client: UpworkFindJobsClient;
  readonly #now: () => Date;

  public constructor(client: UpworkFindJobsClient, now: () => Date = () => new Date()) {
    this.#client = client;
    this.#now = now;
  }

  public async searchJobs(inputValue: UpworkJobSearchRequest): Promise<UpworkJobSearchOutcome> {
    const input = upworkJobSearchRequestSchema.parse(inputValue);
    const params = toUpworkFindJobsSearchParams(input);
    let result: unknown;
    try {
      result = await this.#client.searchJobs({
        workspaceId: input.workspaceId,
        connectionId: input.connectionId,
        params
      });
    } catch (error) {
      if (!(error instanceof UpworkFindJobsClientError)) return toTemporaryUnavailable();
      switch (error.kind) {
        case "rate_limited":
          return upworkJobSearchOutcomeSchema.parse({
            kind: "rate_limited",
            retryAt:
              error.retryAt ??
              new Date(this.#now().getTime() + 5 * 60 * 1_000).toISOString()
          });
        case "reauthorization_required":
          return { kind: "reauthorization_required" };
        case "temporarily_unavailable":
          return error.retryAt === undefined
            ? toTemporaryUnavailable()
            : upworkJobSearchOutcomeSchema.parse({
                kind: "temporarily_unavailable",
                retryAt: error.retryAt
              });
      }
    }

    const response = rawFindJobsResponseSchema.safeParse(decodeToolResult(result));
    if (!response.success) return toTemporaryUnavailable();
    const jobs = response.data.jobs.map((job) => mapRawJob(job, params));
    if (jobs.some((job) => job === undefined)) return toTemporaryUnavailable();
    const nextCursor =
      response.data.next_cursor ??
      (response.data.pageInfo?.hasNextPage === true
        ? response.data.pageInfo.endCursor ?? undefined
        : undefined);
    return upworkJobSearchOutcomeSchema.parse({
      kind: "page",
      jobs: jobs
        .filter((job): job is UpworkJobCandidate => job !== undefined)
        .sort(newestFirst),
      ...(nextCursor === undefined ? {} : { nextCursor })
    });
  }
}

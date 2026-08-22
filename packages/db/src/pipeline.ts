import {
  developmentJobInputSchema,
  createInputHash,
  filterEvidenceSchema,
  normalizedJobSchema,
  preferenceScoreResultSchema,
  suitabilityResultSchema,
  type CampaignFilterV1,
  type DevelopmentJobInput,
  type FilterEvidence,
  type NormalizedJob,
  type PreferenceScoreResult,
  type SuitabilityInput,
  type SuitabilityResult,
} from "@upwork-agent/core";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "./database.js";
import {
  aiScores,
  analyticsEvents,
  campaigns,
  campaignJobMatches,
  jobs,
  upworkJobObservations,
  upworkConnections,
  upworkMonitors,
  workflowTasks,
} from "./schema.js";

const uuidSchema = z.uuid();
const hashSchema = z.string().regex(/^[0-9a-f]{64}$/);

function rowToNormalizedJob(row: typeof jobs.$inferSelect): NormalizedJob {
  return normalizedJobSchema.parse({
    title: row.title,
    description: row.description,
    ...(row.postedAt === null ? {} : { postedAt: row.postedAt.toISOString() }),
    skills: row.skills,
    categoryIds: row.categoryIds,
    experienceLevel: row.experienceLevel,
    jobType: row.jobType,
    ...(row.hourlyRateMin === null && row.hourlyRateMax === null
      ? {}
      : {
          hourlyRate: {
            ...(row.hourlyRateMin === null
              ? {}
              : { min: Number(row.hourlyRateMin) }),
            ...(row.hourlyRateMax === null
              ? {}
              : { max: Number(row.hourlyRateMax) }),
            currency: "USD",
          },
        }),
    ...(row.fixedBudgetMin === null && row.fixedBudgetMax === null
      ? {}
      : {
          fixedBudget: {
            ...(row.fixedBudgetMin === null
              ? {}
              : { min: Number(row.fixedBudgetMin) }),
            ...(row.fixedBudgetMax === null
              ? {}
              : { max: Number(row.fixedBudgetMax) }),
            currency: "USD",
          },
        }),
    proposalCount: row.proposalCount ?? undefined,
    paymentVerified: row.paymentVerified ?? undefined,
    clientCountryCode: row.clientCountryCode ?? undefined,
    clientTimeZone: row.clientTimeZone ?? undefined,
    clientHireCount: row.clientHireCount ?? undefined,
    clientHireRatePercent: row.clientHireRatePercent ?? undefined,
    projectLengthBand: row.projectLengthBand ?? undefined,
    hoursPerWeekBand: row.hoursPerWeekBand ?? undefined,
    isContractToHire: row.isContractToHire ?? undefined,
  });
}

export type LoadJobForNormalizationResult =
  | { readonly status: "skip" }
  | {
      readonly status: "ready";
      readonly workspaceId: string;
      readonly jobId: string;
      readonly sourcePayloadHash: string;
      readonly rawPayload: DevelopmentJobInput;
    };

export async function loadJobForNormalization(
  database: Database,
  input: {
    readonly workspaceId: string;
    readonly jobId: string;
    readonly sourcePayloadHash: string;
  },
): Promise<LoadJobForNormalizationResult> {
  const workspaceId = uuidSchema.parse(input.workspaceId);
  const jobId = uuidSchema.parse(input.jobId);
  const sourcePayloadHash = hashSchema.parse(input.sourcePayloadHash);
  return database.transaction(async (transaction) => {
    const rows = await transaction
      .select({
        id: jobs.id,
        rawPayload: jobs.rawPayload,
        sourcePayloadHash: jobs.sourcePayloadHash,
        normalizedHash: jobs.normalizedHash,
        status: jobs.status,
      })
      .from(jobs)
      .where(
        and(
          eq(jobs.id, jobId),
          eq(jobs.workspaceId, workspaceId),
          inArray(jobs.source, ["development", "upwork_mcp"]),
        ),
      )
      .for("update")
      .limit(1);
    const row = rows[0];
    if (
      row === undefined ||
      row.sourcePayloadHash !== sourcePayloadHash ||
      row.status === "rejected" ||
      (row.status === "ready" && row.normalizedHash !== null)
    ) {
      return { status: "skip" };
    }

    if (row.status !== "normalizing") {
      await transaction
        .update(jobs)
        .set({ status: "normalizing", updatedAt: new Date() })
        .where(eq(jobs.id, row.id));
    }
    return {
      status: "ready",
      workspaceId,
      jobId: row.id,
      sourcePayloadHash,
      rawPayload: developmentJobInputSchema.parse(row.rawPayload),
    };
  });
}

export type CommitJobNormalizationResult =
  | { readonly status: "skip" }
  | {
      readonly status: "committed";
      readonly normalizedRevision: number;
      readonly matchTaskId: string;
    };

export async function commitJobNormalization(
  database: Database,
  input: {
    readonly workspaceId: string;
    readonly jobId: string;
    readonly sourcePayloadHash: string;
    readonly normalizedJob: NormalizedJob;
    readonly normalizedHash: string;
  },
): Promise<CommitJobNormalizationResult> {
  const workspaceId = uuidSchema.parse(input.workspaceId);
  const jobId = uuidSchema.parse(input.jobId);
  const sourcePayloadHash = hashSchema.parse(input.sourcePayloadHash);
  const normalizedHash = hashSchema.parse(input.normalizedHash);
  const normalizedJob = normalizedJobSchema.parse(input.normalizedJob);
  if (createInputHash(normalizedJob) !== normalizedHash) {
    throw new Error("normalizedHash does not match the validated normalized job");
  }

  return database.transaction(async (transaction) => {
    const lockedRows = await transaction
      .select()
      .from(jobs)
      .where(
        and(
          eq(jobs.id, jobId),
          eq(jobs.workspaceId, workspaceId),
          inArray(jobs.source, ["development", "upwork_mcp"]),
          eq(jobs.sourcePayloadHash, sourcePayloadHash),
        ),
      )
      .for("update")
      .limit(1);
    const current = lockedRows[0];
    if (current === undefined) {
      return { status: "skip" };
    }

    const changed = current.normalizedHash !== normalizedHash;
    const normalizedRevision = changed ? current.revision + 1 : current.revision;
    if (current.status !== "ready" || changed) {
      await transaction
        .update(jobs)
        .set({
          status: "ready",
          postedAt:
            normalizedJob.postedAt === undefined
              ? null
              : new Date(normalizedJob.postedAt),
          normalizedHash,
          revision: normalizedRevision,
          title: normalizedJob.title,
          description: normalizedJob.description,
          skills: normalizedJob.skills,
          categoryIds: normalizedJob.categoryIds,
          experienceLevel: normalizedJob.experienceLevel,
          jobType: normalizedJob.jobType,
          hourlyRateMin:
            normalizedJob.hourlyRate?.min === undefined
              ? null
              : String(normalizedJob.hourlyRate.min),
          hourlyRateMax:
            normalizedJob.hourlyRate?.max === undefined
              ? null
              : String(normalizedJob.hourlyRate.max),
          fixedBudgetMin:
            normalizedJob.fixedBudget?.min === undefined
              ? null
              : String(normalizedJob.fixedBudget.min),
          fixedBudgetMax:
            normalizedJob.fixedBudget?.max === undefined
              ? null
              : String(normalizedJob.fixedBudget.max),
          proposalCount: normalizedJob.proposalCount ?? null,
          paymentVerified: normalizedJob.paymentVerified ?? null,
          clientCountryCode: normalizedJob.clientCountryCode ?? null,
          clientTimeZone: normalizedJob.clientTimeZone ?? null,
          clientHireCount: normalizedJob.clientHireCount ?? null,
          clientHireRatePercent: normalizedJob.clientHireRatePercent ?? null,
          projectLengthBand: normalizedJob.projectLengthBand ?? null,
          hoursPerWeekBand: normalizedJob.hoursPerWeekBand ?? null,
          isContractToHire: normalizedJob.isContractToHire ?? null,
          updatedAt: new Date(),
        })
        .where(eq(jobs.id, jobId));
    }

    const dedupeKey = `match-job:${workspaceId}:${jobId}:${normalizedRevision}`;
    const payload = { jobId, normalizedRevision };
    const inserted = await transaction
      .insert(workflowTasks)
      .values({
        workspaceId,
        kind: "match-job",
        payload,
        dedupeKey,
      })
      .onConflictDoNothing({
        target: [workflowTasks.kind, workflowTasks.dedupeKey],
      })
      .returning({ id: workflowTasks.id });
    const existing =
      inserted[0] === undefined
        ? await transaction
            .select({ id: workflowTasks.id })
            .from(workflowTasks)
            .where(
              and(
                eq(workflowTasks.kind, "match-job"),
                eq(workflowTasks.dedupeKey, dedupeKey),
                eq(workflowTasks.workspaceId, workspaceId),
              ),
            )
            .limit(1)
        : [];
    const matchTaskId = inserted[0]?.id ?? existing[0]?.id;
    if (matchTaskId === undefined) {
      throw new Error("Match task conflicted but could not be reloaded");
    }
    return { status: "committed", normalizedRevision, matchTaskId };
  });
}

export interface MatchableCampaign {
  readonly id: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly configVersion: number;
  readonly filters: CampaignFilterV1;
  readonly aiInstructions: string;
  readonly scoreThreshold: number;
}

export type LoadJobMatchContextResult =
  | { readonly status: "skip" }
  | {
      readonly status: "ready";
      readonly workspaceId: string;
      readonly jobId: string;
      readonly normalizedRevision: number;
      readonly job: NormalizedJob;
      readonly campaigns: MatchableCampaign[];
    };

export async function loadJobMatchContext(
  database: Database,
  input: {
    readonly workspaceId: string;
    readonly jobId: string;
    readonly normalizedRevision: number;
    readonly campaignId?: string;
  },
): Promise<LoadJobMatchContextResult> {
  const workspaceId = uuidSchema.parse(input.workspaceId);
  const jobId = uuidSchema.parse(input.jobId);
  const normalizedRevision = z.number().int().positive().parse(input.normalizedRevision);
  const campaignId =
    input.campaignId === undefined ? undefined : uuidSchema.parse(input.campaignId);
  const jobRows = await database
    .select()
    .from(jobs)
    .where(
      and(
        eq(jobs.id, jobId),
        eq(jobs.workspaceId, workspaceId),
        inArray(jobs.source, ["development", "upwork_mcp"]),
        eq(jobs.status, "ready"),
        eq(jobs.revision, normalizedRevision),
      ),
    )
    .limit(1);
  const job = jobRows[0];
  if (job === undefined) {
    return { status: "skip" };
  }
  if (job.source === "development" && job.lastMatchedRevision >= normalizedRevision) {
    return { status: "skip" };
  }

  const campaignSelection = {
    id: campaigns.id,
    workspaceId: campaigns.workspaceId,
    name: campaigns.name,
    configVersion: campaigns.configVersion,
    filters: campaigns.filters,
    aiInstructions: campaigns.aiInstructions,
    scoreThreshold: campaigns.scoreThreshold,
  };
  const activeCampaigns =
    job.source === "upwork_mcp"
      ? await database
          .select(campaignSelection)
          .from(campaigns)
          .innerJoin(
            upworkMonitors,
            and(
              eq(upworkMonitors.workspaceId, campaigns.workspaceId),
              eq(upworkMonitors.campaignId, campaigns.id),
            ),
          )
          .innerJoin(
            upworkJobObservations,
            and(
              eq(upworkJobObservations.workspaceId, campaigns.workspaceId),
              eq(upworkJobObservations.monitorId, upworkMonitors.id),
              eq(upworkJobObservations.jobId, jobId),
            ),
          )
          .innerJoin(
            upworkConnections,
            and(
              eq(upworkConnections.workspaceId, upworkMonitors.workspaceId),
              eq(upworkConnections.id, upworkMonitors.connectionId),
            ),
          )
          .where(
            and(
              eq(campaigns.workspaceId, workspaceId),
              eq(campaigns.status, "active"),
              eq(upworkMonitors.status, "active"),
              inArray(upworkConnections.status, ["fake", "connected"]),
              ...(campaignId === undefined ? [] : [eq(campaigns.id, campaignId)]),
            ),
          )
      : await database
          .select(campaignSelection)
          .from(campaigns)
          .where(
            and(
              eq(campaigns.workspaceId, workspaceId),
              eq(campaigns.status, "active"),
            ),
          );
  return {
    status: "ready",
    workspaceId,
    jobId,
    normalizedRevision,
    job: rowToNormalizedJob(job),
    campaigns: activeCampaigns,
  };
}

export interface PositiveJobMatchInput {
  readonly campaignId: string;
  readonly campaignConfigVersion: number;
  readonly filterSnapshot: CampaignFilterV1;
  readonly deterministicEvidence: FilterEvidence;
  readonly preferenceScore: PreferenceScoreResult;
  readonly analysisInputHash: string;
}

export type CommitJobMatchesResult =
  | { readonly status: "skip" }
  | {
      readonly status: "committed";
      readonly matchCount: number;
      readonly taskCount: number;
    };

export async function commitJobMatches(
  database: Database,
  input: {
    readonly workspaceId: string;
    readonly jobId: string;
    readonly normalizedRevision: number;
    readonly matches: readonly PositiveJobMatchInput[];
  },
): Promise<CommitJobMatchesResult> {
  const workspaceId = uuidSchema.parse(input.workspaceId);
  const jobId = uuidSchema.parse(input.jobId);
  const normalizedRevision = z.number().int().positive().parse(input.normalizedRevision);

  return database.transaction(async (transaction) => {
    const currentJobs = await transaction
      .select({
        id: jobs.id,
        source: jobs.source,
        lastMatchedRevision: jobs.lastMatchedRevision,
      })
      .from(jobs)
      .where(
        and(
          eq(jobs.id, jobId),
          eq(jobs.workspaceId, workspaceId),
          eq(jobs.status, "ready"),
          eq(jobs.revision, normalizedRevision),
        ),
      )
      .for("update")
      .limit(1);
    if (currentJobs[0] === undefined) {
      return { status: "skip" };
    }
    if (
      currentJobs[0].source === "development" &&
      currentJobs[0].lastMatchedRevision >= normalizedRevision
    ) {
      return { status: "skip" };
    }

    const campaignIds = input.matches.map((match) => uuidSchema.parse(match.campaignId));
    const currentCampaigns =
      campaignIds.length === 0
        ? []
        : currentJobs[0].source === "upwork_mcp"
          ? await transaction
              .select({
                id: campaigns.id,
                workspaceId: campaigns.workspaceId,
                name: campaigns.name,
                status: campaigns.status,
                filters: campaigns.filters,
                aiInstructions: campaigns.aiInstructions,
                scoreThreshold: campaigns.scoreThreshold,
                configVersion: campaigns.configVersion,
                createdAt: campaigns.createdAt,
                updatedAt: campaigns.updatedAt,
              })
              .from(campaigns)
              .innerJoin(
                upworkMonitors,
                and(
                  eq(upworkMonitors.workspaceId, campaigns.workspaceId),
                  eq(upworkMonitors.campaignId, campaigns.id),
                ),
              )
              .innerJoin(
                upworkJobObservations,
                and(
                  eq(upworkJobObservations.workspaceId, campaigns.workspaceId),
                  eq(upworkJobObservations.monitorId, upworkMonitors.id),
                  eq(upworkJobObservations.jobId, jobId),
                ),
              )
              .innerJoin(
                upworkConnections,
                and(
                  eq(upworkConnections.workspaceId, upworkMonitors.workspaceId),
                  eq(upworkConnections.id, upworkMonitors.connectionId),
                ),
              )
              .where(
                and(
                  eq(campaigns.workspaceId, workspaceId),
                  eq(campaigns.status, "active"),
                  inArray(campaigns.id, campaignIds),
                  eq(upworkMonitors.status, "active"),
                  inArray(upworkConnections.status, ["fake", "connected"]),
                ),
              )
          : await transaction
              .select()
              .from(campaigns)
              .where(
                and(
                  eq(campaigns.workspaceId, workspaceId),
                  eq(campaigns.status, "active"),
                  inArray(campaigns.id, campaignIds),
                ),
              );
    const currentById = new Map(currentCampaigns.map((campaign) => [campaign.id, campaign]));

    let matchCount = 0;
    let taskCount = 0;
    for (const requested of input.matches) {
      const campaign = currentById.get(requested.campaignId);
      if (
        campaign === undefined ||
        campaign.configVersion !== requested.campaignConfigVersion
      ) {
        continue;
      }
      const analysisInputHash = hashSchema.parse(requested.analysisInputHash);
      const deterministicEvidence = filterEvidenceSchema.parse(
        requested.deterministicEvidence,
      );
      const preferenceScore = preferenceScoreResultSchema.parse(
        requested.preferenceScore,
      );
      const insertedMatches = await transaction
        .insert(campaignJobMatches)
        .values({
          workspaceId,
          campaignId: campaign.id,
          jobId,
          campaignConfigVersion: campaign.configVersion,
          jobRevision: normalizedRevision,
          filterSnapshot: campaign.filters,
          aiInstructionsSnapshot: campaign.aiInstructions,
          scoreThresholdSnapshot: campaign.scoreThreshold,
          deterministicEvidence,
          preferenceScore: preferenceScore.score,
          preferenceScoreVersion: preferenceScore.version,
          preferenceScoreEvidence: preferenceScore,
          analysisInputHash,
          pipelineStatus: "analysis_queued",
        })
        .onConflictDoNothing({
          target: [campaignJobMatches.campaignId, campaignJobMatches.jobId],
        })
        .returning({ id: campaignJobMatches.id });
      let matchId = insertedMatches[0]?.id;
      if (matchId === undefined) {
        const existingMatches = await transaction
          .select({
            id: campaignJobMatches.id,
            analysisInputHash: campaignJobMatches.analysisInputHash,
          })
          .from(campaignJobMatches)
          .where(
            and(
              eq(campaignJobMatches.campaignId, campaign.id),
              eq(campaignJobMatches.jobId, jobId),
              eq(campaignJobMatches.workspaceId, workspaceId),
            ),
          )
          .limit(1);
        const existing = existingMatches[0];
        if (
          existing === undefined ||
          existing.analysisInputHash !== analysisInputHash
        ) {
          // Phase 1 does not rematch/backfill an already persisted pair.
          continue;
        }
        matchId = existing.id;
      } else {
        matchCount += 1;
      }

      const taskRows = await transaction
        .insert(workflowTasks)
        .values({
          workspaceId,
          kind: "analyze-match",
          payload: { matchId, inputHash: analysisInputHash },
          dedupeKey: `analyze-match:${workspaceId}:${matchId}:${analysisInputHash}`,
        })
        .onConflictDoNothing({
          target: [workflowTasks.kind, workflowTasks.dedupeKey],
        })
        .returning({ id: workflowTasks.id });
      taskCount += taskRows.length;
    }

    const matchingRevisionFilters = [
      eq(jobs.id, jobId),
      eq(jobs.workspaceId, workspaceId),
      eq(jobs.status, "ready"),
      eq(jobs.revision, normalizedRevision),
      ...(currentJobs[0].source === "development"
        ? [sql`${jobs.lastMatchedRevision} < ${normalizedRevision}`]
        : []),
    ];
    const matchedRevisionRows = await transaction
      .update(jobs)
      .set({ lastMatchedRevision: normalizedRevision, updatedAt: new Date() })
      .where(and(...matchingRevisionFilters))
      .returning({ id: jobs.id });
    if (matchedRevisionRows[0] === undefined) {
      throw new Error("Job matching revision changed before completion");
    }
    return { status: "committed", matchCount, taskCount };
  });
}

export type LoadMatchAnalysisContextResult =
  | { readonly status: "skip" }
  | {
      readonly status: "ready";
      readonly matchId: string;
      readonly workspaceId: string;
      readonly scoreThreshold: number;
      readonly input: SuitabilityInput;
    };

export async function loadMatchAnalysisContext(
  database: Database,
  input: {
    readonly workspaceId: string;
    readonly matchId: string;
    readonly inputHash: string;
  },
): Promise<LoadMatchAnalysisContextResult> {
  const workspaceId = uuidSchema.parse(input.workspaceId);
  const matchId = uuidSchema.parse(input.matchId);
  const inputHash = hashSchema.parse(input.inputHash);
  const rows = await database
    .select({ match: campaignJobMatches, job: jobs, scoreId: aiScores.id })
    .from(campaignJobMatches)
    .innerJoin(
      jobs,
      and(
        eq(campaignJobMatches.jobId, jobs.id),
        eq(campaignJobMatches.workspaceId, jobs.workspaceId),
      ),
    )
    .leftJoin(
      aiScores,
      and(eq(aiScores.matchId, matchId), eq(aiScores.inputHash, inputHash)),
    )
    .where(
      and(
        eq(campaignJobMatches.id, matchId),
        eq(campaignJobMatches.workspaceId, workspaceId),
        eq(campaignJobMatches.analysisInputHash, inputHash),
        inArray(campaignJobMatches.pipelineStatus, [
          "analysis_queued",
          "analyzing",
        ]),
        eq(jobs.status, "ready"),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (row === undefined || row.scoreId !== null) {
    return { status: "skip" };
  }

  const normalizedJob = rowToNormalizedJob(row.job);
  const suitabilityInput: SuitabilityInput = {
    job: normalizedJob,
    campaign: {
      filters: row.match.filterSnapshot,
      aiInstructions: row.match.aiInstructionsSnapshot,
      scoreThreshold: row.match.scoreThresholdSnapshot,
    },
    deterministicEvidence: filterEvidenceSchema.parse(
      row.match.deterministicEvidence,
    ),
    preferenceScore: preferenceScoreResultSchema.parse(
      row.match.preferenceScoreEvidence,
    ),
  };

  await database
    .update(campaignJobMatches)
    .set({ pipelineStatus: "analyzing", updatedAt: new Date() })
    .where(
      and(
        eq(campaignJobMatches.id, matchId),
        eq(campaignJobMatches.workspaceId, workspaceId),
        eq(campaignJobMatches.pipelineStatus, "analysis_queued"),
      ),
    );

  return {
    status: "ready",
    matchId,
    workspaceId,
    scoreThreshold: row.match.scoreThresholdSnapshot,
    input: suitabilityInput,
  };
}

export type CommitMatchAnalysisResult =
  | { readonly status: "skip" }
  | {
      readonly status: "committed";
      readonly aiScoreId: string;
      readonly pipelineStatus: "low_fit" | "qualified" | "proposal_queued" | "ready_for_review";
    };

export async function commitMatchAnalysis(
  database: Database,
  input: {
    readonly workspaceId: string;
    readonly matchId: string;
    readonly inputHash: string;
    readonly result: SuitabilityResult;
    readonly provider: string;
    readonly model: string;
    readonly promptVersion: string;
  },
): Promise<CommitMatchAnalysisResult> {
  const workspaceId = uuidSchema.parse(input.workspaceId);
  const matchId = uuidSchema.parse(input.matchId);
  const inputHash = hashSchema.parse(input.inputHash);
  const result = suitabilityResultSchema.parse(input.result);
  const provider = z.string().trim().min(1).max(100).parse(input.provider);
  const model = z.string().trim().min(1).max(200).parse(input.model);
  const promptVersion = z.string().trim().min(1).max(100).parse(input.promptVersion);
  const providerRequestKey = `${provider}:${matchId}:${inputHash}`;

  return database.transaction(async (transaction) => {
    const matchRows = await transaction
      .select()
      .from(campaignJobMatches)
      .where(
        and(
          eq(campaignJobMatches.id, matchId),
          eq(campaignJobMatches.workspaceId, workspaceId),
          eq(campaignJobMatches.analysisInputHash, inputHash),
        ),
      )
      .for("update")
      .limit(1);
    const match = matchRows[0];
    if (match === undefined) {
      return { status: "skip" };
    }

    const existingScores = await transaction
      .select({ id: aiScores.id })
      .from(aiScores)
      .where(
        and(eq(aiScores.matchId, matchId), eq(aiScores.inputHash, inputHash)),
      )
      .limit(1);
    const existingScore = existingScores[0];
    const isQualified = result.score >= match.scoreThresholdSnapshot;
    const pipelineStatus = isQualified
      ? match.pipelineStatus === "ready_for_review"
        ? ("ready_for_review" as const)
        : ("proposal_queued" as const)
      : ("low_fit" as const);
    if (existingScore !== undefined) {
      if (
        match.pipelineStatus === "analyzing" ||
        match.pipelineStatus === "analysis_queued"
      ) {
        await transaction
          .update(campaignJobMatches)
          .set({ pipelineStatus, updatedAt: new Date() })
          .where(eq(campaignJobMatches.id, matchId));
      }
      if (isQualified && pipelineStatus !== "ready_for_review") {
        const generationKey = createInputHash({ matchId, inputHash });
        await transaction
          .insert(workflowTasks)
          .values({
            workspaceId,
            kind: "generate-proposal",
            payload: { matchId, generationKey },
            dedupeKey: `generate-proposal:${workspaceId}:${matchId}:${generationKey}`,
          })
          .onConflictDoNothing({ target: [workflowTasks.kind, workflowTasks.dedupeKey] });
      }
      return {
        status: "committed",
        aiScoreId: existingScore.id,
        pipelineStatus,
      };
    }

    const scoreRows = await transaction
      .insert(aiScores)
      .values({
        workspaceId,
        matchId,
        inputHash,
        provider,
        model,
        promptVersion,
        providerRequestKey,
        score: result.score,
        recommendation: result.recommendation,
        reasons: result.reasons,
        risks: result.risks,
        estimatedWinProbability: String(result.estimatedWinProbability),
        pricingDirection: result.pricingDirection,
        suggestedBidAmount:
          result.suggestedBidAmount === undefined
            ? null
            : String(result.suggestedBidAmount),
        suggestedBidCurrency: result.suggestedBidCurrency ?? null,
      })
      .onConflictDoNothing({
        target: [aiScores.matchId, aiScores.inputHash],
      })
      .returning({ id: aiScores.id });
    const aiScoreId = scoreRows[0]?.id;
    if (aiScoreId === undefined) {
      throw new Error("AI score conflicted inside a locked match transaction");
    }

    await transaction
      .update(campaignJobMatches)
      .set({
        pipelineStatus,
        failedStep: null,
        failureCode: null,
        updatedAt: new Date(),
      })
      .where(eq(campaignJobMatches.id, matchId));

    if (isQualified) {
      const generationKey = createInputHash({ matchId, inputHash });
      await transaction
        .insert(workflowTasks)
        .values({
          workspaceId,
          kind: "generate-proposal",
          payload: { matchId, generationKey },
          dedupeKey: `generate-proposal:${workspaceId}:${matchId}:${generationKey}`,
        })
        .onConflictDoNothing({ target: [workflowTasks.kind, workflowTasks.dedupeKey] });
    }

    await transaction
      .insert(analyticsEvents)
      .values({
        workspaceId,
        eventName: "ai_score.completed",
        subjectType: "campaign_job_match",
        subjectId: matchId,
        properties: {
          score: result.score,
          pipelineStatus,
        },
        dedupeKey: `ai-score-completed:${matchId}:${inputHash}`,
      })
      .onConflictDoNothing();

    return { status: "committed", aiScoreId, pipelineStatus };
  });
}

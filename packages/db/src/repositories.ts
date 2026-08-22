import {
  campaignFilterV1Schema,
  createInputHash,
  developmentJobInputSchema,
  type CampaignFilterV1,
  type DevelopmentJobInput,
} from "@upwork-agent/core";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "./database.js";
import {
  aiScores,
  analyticsEvents,
  campaigns,
  campaignJobMatches,
  jobs,
  upworkMonitors,
  workflowTasks,
  workspaces,
  type AiScoreRow,
  type CampaignRow,
  type JsonObject,
  type WorkspaceRow,
} from "./schema.js";

const uuidSchema = z.uuid();
const workspaceNameSchema = z.string().trim().min(1).max(120);
const campaignNameSchema = z.string().trim().min(1).max(160);
const aiInstructionsSchema = z.string().max(12_000);
const hashSchema = z.string().regex(/^[0-9a-f]{64}$/);
const scoreThresholdSchema = z.number().int().min(0).max(100);
const campaignStatusSchema = z.enum(["draft", "active", "paused", "archived"]);

export class ConcurrentCampaignUpdateError extends Error {
  public constructor() {
    super("The campaign changed while it was being updated");
    this.name = "ConcurrentCampaignUpdateError";
  }
}

export class InvalidCampaignTransitionError extends Error {
  public constructor(from: CampaignRow["status"], to: CampaignRow["status"]) {
    super(`Campaign status cannot transition from ${from} to ${to}`);
    this.name = "InvalidCampaignTransitionError";
  }
}

export class DevelopmentJobPayloadConflictError extends Error {
  public constructor() {
    super("A development job source ID cannot be reused with different content");
    this.name = "DevelopmentJobPayloadConflictError";
  }
}

function canTransitionCampaign(
  from: CampaignRow["status"],
  to: CampaignRow["status"],
): boolean {
  if (from === to) {
    return true;
  }
  switch (from) {
    case "draft":
      return to === "active" || to === "archived";
    case "active":
      return to === "paused" || to === "archived";
    case "paused":
      return to === "active" || to === "archived";
    case "archived":
      return false;
  }
}

export async function ensureWorkspaceForUser(
  database: Database,
  input: { readonly ownerUserId: string; readonly name: string },
): Promise<WorkspaceRow> {
  const ownerUserId = uuidSchema.parse(input.ownerUserId);
  const name = workspaceNameSchema.parse(input.name);
  const inserted = await database
    .insert(workspaces)
    .values({ ownerUserId, name })
    .onConflictDoNothing({ target: workspaces.ownerUserId })
    .returning();
  const created = inserted[0];
  if (created !== undefined) {
    return created;
  }

  const existing = await getWorkspaceForOwner(database, { ownerUserId });
  if (existing === null) {
    throw new Error("Workspace conflicted but could not be reloaded");
  }
  return existing;
}

export async function getWorkspaceForOwner(
  database: Database,
  input: { readonly ownerUserId: string },
): Promise<WorkspaceRow | null> {
  const ownerUserId = uuidSchema.parse(input.ownerUserId);
  const rows = await database
    .select()
    .from(workspaces)
    .where(eq(workspaces.ownerUserId, ownerUserId))
    .limit(1);
  return rows[0] ?? null;
}

export async function listCampaigns(
  database: Database,
  input: { readonly ownerUserId: string },
): Promise<CampaignRow[]> {
  const ownerUserId = uuidSchema.parse(input.ownerUserId);
  return database
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
    .innerJoin(workspaces, eq(campaigns.workspaceId, workspaces.id))
    .where(eq(workspaces.ownerUserId, ownerUserId))
    .orderBy(desc(campaigns.updatedAt));
}

export async function getCampaign(
  database: Database,
  input: { readonly ownerUserId: string; readonly campaignId: string },
): Promise<CampaignRow | null> {
  const ownerUserId = uuidSchema.parse(input.ownerUserId);
  const campaignId = uuidSchema.parse(input.campaignId);
  const rows = await database
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
    .innerJoin(workspaces, eq(campaigns.workspaceId, workspaces.id))
    .where(
      and(
        eq(campaigns.id, campaignId),
        eq(workspaces.ownerUserId, ownerUserId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

export interface CreateCampaignInput {
  readonly ownerUserId: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly filters: CampaignFilterV1;
  readonly aiInstructions: string;
  readonly scoreThreshold?: number;
  readonly status?: CampaignRow["status"];
}

export async function createCampaign(
  database: Database,
  input: CreateCampaignInput,
): Promise<CampaignRow | null> {
  const ownerUserId = uuidSchema.parse(input.ownerUserId);
  const workspaceId = uuidSchema.parse(input.workspaceId);
  const name = campaignNameSchema.parse(input.name);
  const filters = campaignFilterV1Schema.parse(input.filters);
  const aiInstructions = aiInstructionsSchema.parse(input.aiInstructions);
  const scoreThreshold = scoreThresholdSchema.parse(input.scoreThreshold ?? 75);
  const status = campaignStatusSchema.parse(input.status ?? "draft");

  const rows = await database
    .insert(campaigns)
    .select(
      database
        .select({
          workspaceId: workspaces.id,
          name: sql<string>`${name}`.as("name"),
          status: sql<CampaignRow["status"]>`${status}::public.campaign_status`.as(
            "status",
          ),
          filters: sql<CampaignFilterV1>`${JSON.stringify(filters)}::jsonb`.as(
            "filters",
          ),
          aiInstructions: sql<string>`${aiInstructions}`.as("ai_instructions"),
          scoreThreshold: sql<number>`${scoreThreshold}`.as("score_threshold"),
        })
        .from(workspaces)
        .where(
          and(
            eq(workspaces.id, workspaceId),
            eq(workspaces.ownerUserId, ownerUserId),
          ),
        ),
    )
    .returning();
  return rows[0] ?? null;
}

export interface UpdateCampaignInput {
  readonly ownerUserId: string;
  readonly campaignId: string;
  readonly name?: string;
  readonly filters?: CampaignFilterV1;
  readonly aiInstructions?: string;
  readonly scoreThreshold?: number;
  readonly status?: CampaignRow["status"];
  readonly expectedConfigVersion?: number;
}

export async function updateCampaign(
  database: Database,
  input: UpdateCampaignInput,
): Promise<CampaignRow | null> {
  const ownerUserId = uuidSchema.parse(input.ownerUserId);
  const campaignId = uuidSchema.parse(input.campaignId);

  return database.transaction(async (transaction) => {
    const currentRows = await transaction
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
      .innerJoin(workspaces, eq(campaigns.workspaceId, workspaces.id))
      .where(
        and(
          eq(campaigns.id, campaignId),
          eq(workspaces.ownerUserId, ownerUserId),
        ),
      )
      .for("update")
      .limit(1);
    const current = currentRows[0];
    if (current === undefined) {
      return null;
    }
    if (
      input.expectedConfigVersion !== undefined &&
      input.expectedConfigVersion !== current.configVersion
    ) {
      throw new ConcurrentCampaignUpdateError();
    }
    if (current.status === "archived") {
      const attemptsToChangeArchivedCampaign =
        (input.status !== undefined && input.status !== "archived") ||
        input.name !== undefined ||
        input.filters !== undefined ||
        input.aiInstructions !== undefined ||
        input.scoreThreshold !== undefined;
      if (attemptsToChangeArchivedCampaign) {
        throw new InvalidCampaignTransitionError(
          "archived",
          input.status ?? "archived",
        );
      }
      return current;
    }

    const nextStatus = campaignStatusSchema.parse(input.status ?? current.status);
    if (!canTransitionCampaign(current.status, nextStatus)) {
      throw new InvalidCampaignTransitionError(current.status, nextStatus);
    }

    const name = campaignNameSchema.parse(input.name ?? current.name);
    const filters = campaignFilterV1Schema.parse(input.filters ?? current.filters);
    const aiInstructions = aiInstructionsSchema.parse(
      input.aiInstructions ?? current.aiInstructions,
    );
    const scoreThreshold = scoreThresholdSchema.parse(
      input.scoreThreshold ?? current.scoreThreshold,
    );
    const changesMatchingConfiguration =
      (input.filters !== undefined &&
        createInputHash(filters) !== createInputHash(current.filters)) ||
      (input.aiInstructions !== undefined &&
        aiInstructions !== current.aiInstructions) ||
      (input.scoreThreshold !== undefined &&
        scoreThreshold !== current.scoreThreshold);
    const configVersion = changesMatchingConfiguration
      ? current.configVersion + 1
      : current.configVersion;

    const updatedAt = new Date();
    const rows = await transaction
      .update(campaigns)
      .set({
        name,
        filters,
        aiInstructions,
        scoreThreshold,
        status: nextStatus,
        configVersion,
        updatedAt,
      })
      .where(
        and(
          eq(campaigns.id, campaignId),
          eq(campaigns.configVersion, current.configVersion),
        ),
      )
      .returning();
    const updated = rows[0];
    if (updated === undefined) {
      throw new ConcurrentCampaignUpdateError();
    }

    if (nextStatus !== "active") {
      await transaction
        .update(upworkMonitors)
        .set({
          status: "paused",
          nextRunAt: null,
          scheduleVersion: sql`${upworkMonitors.scheduleVersion} + 1`,
          updatedAt,
        })
        .where(
          and(
            eq(upworkMonitors.campaignId, campaignId),
            eq(upworkMonitors.status, "active"),
          ),
        );
    }
    return updated;
  });
}

export async function archiveCampaign(
  database: Database,
  input: { readonly ownerUserId: string; readonly campaignId: string },
): Promise<CampaignRow | null> {
  return updateCampaign(database, { ...input, status: "archived" });
}

export interface IngestDevelopmentJobInput {
  readonly ownerUserId: string;
  readonly workspaceId: string;
  readonly input: DevelopmentJobInput;
  readonly sourcePayloadHash: string;
}

export interface IngestDevelopmentJobResult {
  readonly jobId: string;
  readonly taskId: string;
  readonly duplicate: boolean;
}

export async function ingestDevelopmentJob(
  database: Database,
  input: IngestDevelopmentJobInput,
): Promise<IngestDevelopmentJobResult | null> {
  const ownerUserId = uuidSchema.parse(input.ownerUserId);
  const workspaceId = uuidSchema.parse(input.workspaceId);
  const developmentJob = developmentJobInputSchema.parse(input.input);
  const sourcePayloadHash = hashSchema.parse(input.sourcePayloadHash);
  if (createInputHash(developmentJob) !== sourcePayloadHash) {
    throw new Error("sourcePayloadHash does not match the validated job input");
  }

  return database.transaction(async (transaction) => {
    const ownedWorkspace = await transaction
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(
        and(
          eq(workspaces.id, workspaceId),
          eq(workspaces.ownerUserId, ownerUserId),
        ),
      )
      .limit(1);
    if (ownedWorkspace[0] === undefined) {
      return null;
    }

    // Development IDs are user-controlled, so qualify them by workspace. This
    // preserves the documented global source-key constraint without allowing
    // one tenant's test fixture to overwrite another tenant's source record.
    const sourceJobId = `${workspaceId}:${developmentJob.sourceJobId}`;
    const previousRows = await transaction
      .select({ id: jobs.id, sourcePayloadHash: jobs.sourcePayloadHash })
      .from(jobs)
      .where(
        and(
          eq(jobs.workspaceId, workspaceId),
          eq(jobs.source, "development"),
          eq(jobs.sourceJobId, sourceJobId),
        ),
      )
      .for("update")
      .limit(1);
    const previous = previousRows[0];
    if (previous !== undefined && previous.sourcePayloadHash !== sourcePayloadHash) {
      throw new DevelopmentJobPayloadConflictError();
    }
    const now = new Date();

    const jobRows = await transaction
      .insert(jobs)
      .values({
        workspaceId,
        source: "development",
        sourceJobId,
        rawPayload: developmentJob,
        sourcePayloadHash,
        status: "received",
        lastSeenAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [jobs.source, jobs.sourceJobId],
        set: {
          lastSeenAt: now,
          updatedAt: now,
        },
      })
      .returning({ id: jobs.id });
    const job = jobRows[0];
    if (job === undefined) {
      throw new Error("Job upsert returned no row");
    }

    const dedupeKey = `normalize-job:${workspaceId}:${job.id}:${sourcePayloadHash}`;
    const taskRows = await transaction
      .insert(workflowTasks)
      .values({
        workspaceId,
        kind: "normalize-job",
        payload: { jobId: job.id, sourcePayloadHash },
        dedupeKey,
      })
      .onConflictDoNothing({
        target: [workflowTasks.kind, workflowTasks.dedupeKey],
      })
      .returning({ id: workflowTasks.id });
    const insertedTask = taskRows[0];
    const existingTaskRows =
      insertedTask === undefined
        ? await transaction
            .select({ id: workflowTasks.id })
            .from(workflowTasks)
            .where(
              and(
                eq(workflowTasks.kind, "normalize-job"),
                eq(workflowTasks.dedupeKey, dedupeKey),
                eq(workflowTasks.workspaceId, workspaceId),
              ),
            )
            .limit(1)
        : [];
    const taskId = insertedTask?.id ?? existingTaskRows[0]?.id;
    if (taskId === undefined) {
      throw new Error("Normalize task conflicted but could not be reloaded");
    }

    return {
      jobId: job.id,
      taskId,
      duplicate: previous !== undefined,
    };
  });
}

export interface CampaignMatchView {
  readonly match: Pick<
    typeof campaignJobMatches.$inferSelect,
    | "id"
    | "workspaceId"
    | "campaignId"
    | "jobId"
    | "campaignConfigVersion"
    | "jobRevision"
    | "deterministicEvidence"
    | "preferenceScore"
    | "preferenceScoreVersion"
    | "preferenceScoreEvidence"
    | "pipelineStatus"
    | "failedStep"
    | "failureCode"
    | "createdAt"
    | "updatedAt"
  >;
  readonly job: Pick<
    typeof jobs.$inferSelect,
    | "id"
    | "source"
    | "canonicalUrl"
    | "postedAt"
    | "status"
    | "title"
    | "description"
    | "skills"
    | "categoryIds"
    | "experienceLevel"
    | "jobType"
    | "hourlyRateMin"
    | "hourlyRateMax"
    | "fixedBudgetMin"
    | "fixedBudgetMax"
    | "proposalCount"
    | "paymentVerified"
    | "clientCountryCode"
    | "clientTimeZone"
    | "clientHireCount"
    | "clientHireRatePercent"
    | "projectLengthBand"
    | "hoursPerWeekBand"
    | "isContractToHire"
    | "lastSeenAt"
  >;
  readonly score: Pick<
    AiScoreRow,
    | "id"
    | "matchId"
    | "score"
    | "recommendation"
    | "reasons"
    | "risks"
    | "estimatedWinProbability"
    | "pricingDirection"
    | "suggestedBidAmount"
    | "suggestedBidCurrency"
    | "createdAt"
  > | null;
  readonly analysisTaskStatus:
    | "queued"
    | "running"
    | "retry_wait"
    | "succeeded"
    | "dead"
    | "cancelled"
    | null;
  readonly analysisNextAttemptAt: Date | null;
}

export async function listCampaignMatchViews(
  database: Database,
  input: { readonly ownerUserId: string; readonly campaignId: string },
): Promise<CampaignMatchView[]> {
  const ownerUserId = uuidSchema.parse(input.ownerUserId);
  const campaignId = uuidSchema.parse(input.campaignId);
  const rows = await database
    .select({
      match: {
        id: campaignJobMatches.id,
        workspaceId: campaignJobMatches.workspaceId,
        campaignId: campaignJobMatches.campaignId,
        jobId: campaignJobMatches.jobId,
        campaignConfigVersion: campaignJobMatches.campaignConfigVersion,
        jobRevision: campaignJobMatches.jobRevision,
        deterministicEvidence: campaignJobMatches.deterministicEvidence,
        preferenceScore: campaignJobMatches.preferenceScore,
        preferenceScoreVersion: campaignJobMatches.preferenceScoreVersion,
        preferenceScoreEvidence: campaignJobMatches.preferenceScoreEvidence,
        pipelineStatus: campaignJobMatches.pipelineStatus,
        failedStep: campaignJobMatches.failedStep,
        failureCode: campaignJobMatches.failureCode,
        createdAt: campaignJobMatches.createdAt,
        updatedAt: campaignJobMatches.updatedAt,
      },
      job: {
        id: jobs.id,
        source: jobs.source,
        canonicalUrl: jobs.canonicalUrl,
        postedAt: jobs.postedAt,
        status: jobs.status,
        title: jobs.title,
        description: jobs.description,
        skills: jobs.skills,
        categoryIds: jobs.categoryIds,
        experienceLevel: jobs.experienceLevel,
        jobType: jobs.jobType,
        hourlyRateMin: jobs.hourlyRateMin,
        hourlyRateMax: jobs.hourlyRateMax,
        fixedBudgetMin: jobs.fixedBudgetMin,
        fixedBudgetMax: jobs.fixedBudgetMax,
        proposalCount: jobs.proposalCount,
        paymentVerified: jobs.paymentVerified,
        clientCountryCode: jobs.clientCountryCode,
        clientTimeZone: jobs.clientTimeZone,
      clientHireCount: jobs.clientHireCount,
      clientHireRatePercent: jobs.clientHireRatePercent,
        projectLengthBand: jobs.projectLengthBand,
        hoursPerWeekBand: jobs.hoursPerWeekBand,
        isContractToHire: jobs.isContractToHire,
        lastSeenAt: jobs.lastSeenAt,
      },
      score: {
        id: aiScores.id,
        matchId: aiScores.matchId,
        score: aiScores.score,
        recommendation: aiScores.recommendation,
        reasons: aiScores.reasons,
        risks: aiScores.risks,
        estimatedWinProbability: aiScores.estimatedWinProbability,
        pricingDirection: aiScores.pricingDirection,
        suggestedBidAmount: aiScores.suggestedBidAmount,
        suggestedBidCurrency: aiScores.suggestedBidCurrency,
        createdAt: aiScores.createdAt,
      },
      analysisTaskStatus: workflowTasks.status,
      analysisNextAttemptAt:
        sql<Date | null>`case when ${workflowTasks.status} = 'retry_wait' then ${workflowTasks.runAt} else null end`.as(
          "analysis_next_attempt_at",
        ),
    })
    .from(campaignJobMatches)
    .innerJoin(campaigns, eq(campaignJobMatches.campaignId, campaigns.id))
    .innerJoin(workspaces, eq(campaignJobMatches.workspaceId, workspaces.id))
    .innerJoin(
      jobs,
      and(
        eq(campaignJobMatches.jobId, jobs.id),
        eq(campaignJobMatches.workspaceId, jobs.workspaceId),
      ),
    )
    .leftJoin(
      aiScores,
      and(
        eq(aiScores.matchId, campaignJobMatches.id),
        eq(aiScores.inputHash, campaignJobMatches.analysisInputHash),
      ),
    )
    .leftJoin(
      workflowTasks,
      and(
        eq(workflowTasks.workspaceId, campaignJobMatches.workspaceId),
        eq(workflowTasks.kind, "analyze-match"),
        sql`${workflowTasks.payload} ->> 'matchId' = ${campaignJobMatches.id}::text`,
        sql`${workflowTasks.payload} ->> 'inputHash' = ${campaignJobMatches.analysisInputHash}`,
      ),
    )
    .where(
      and(
        eq(campaignJobMatches.campaignId, campaignId),
        eq(workspaces.ownerUserId, ownerUserId),
      ),
    )
    .orderBy(
      desc(campaignJobMatches.preferenceScore),
      desc(campaignJobMatches.createdAt),
    );
  return rows;
}

export interface CampaignDetailView {
  readonly campaign: CampaignRow;
  readonly matches: CampaignMatchView[];
  readonly upstreamWork: CampaignUpstreamWorkView;
}

export interface CampaignUpstreamWorkView {
  /** True while a normalize-job or match-job task can still make progress. */
  readonly hasActiveTasks: boolean;
  /**
   * True only when no upstream task is active and the most recently updated
   * upstream task exhausted its retries. Historical failures do not mask a
   * newer successful ingest.
   */
  readonly hasLatestFailure: boolean;
  readonly latestTaskStatus:
    | "queued"
    | "running"
    | "retry_wait"
    | "succeeded"
    | "dead"
    | "cancelled"
    | null;
}

async function getCampaignUpstreamWork(
  database: Database,
  input: { readonly ownerUserId: string; readonly workspaceId: string },
): Promise<CampaignUpstreamWorkView> {
  const ownerUserId = uuidSchema.parse(input.ownerUserId);
  const workspaceId = uuidSchema.parse(input.workspaceId);
  const upstreamKinds = ["normalize-job", "match-job"] as const;

  const [activeRows, latestRows] = await Promise.all([
    database
      .select({ id: workflowTasks.id })
      .from(workflowTasks)
      .innerJoin(workspaces, eq(workflowTasks.workspaceId, workspaces.id))
      .where(
        and(
          eq(workflowTasks.workspaceId, workspaceId),
          eq(workspaces.ownerUserId, ownerUserId),
          inArray(workflowTasks.kind, upstreamKinds),
          inArray(workflowTasks.status, ["queued", "running", "retry_wait"]),
        ),
      )
      .limit(1),
    database
      .select({ status: workflowTasks.status })
      .from(workflowTasks)
      .innerJoin(workspaces, eq(workflowTasks.workspaceId, workspaces.id))
      .where(
        and(
          eq(workflowTasks.workspaceId, workspaceId),
          eq(workspaces.ownerUserId, ownerUserId),
          inArray(workflowTasks.kind, upstreamKinds),
        ),
      )
      .orderBy(desc(workflowTasks.updatedAt), desc(workflowTasks.createdAt))
      .limit(1),
  ]);
  const hasActiveTasks = activeRows.length > 0;
  const latestTaskStatus = latestRows[0]?.status ?? null;
  return {
    hasActiveTasks,
    hasLatestFailure: !hasActiveTasks && latestTaskStatus === "dead",
    latestTaskStatus,
  };
}

export async function getCampaignDetailView(
  database: Database,
  input: { readonly ownerUserId: string; readonly campaignId: string },
): Promise<CampaignDetailView | null> {
  const campaign = await getCampaign(database, input);
  if (campaign === null) {
    return null;
  }
  const [matches, upstreamWork] = await Promise.all([
    listCampaignMatchViews(database, input),
    getCampaignUpstreamWork(database, {
      ownerUserId: input.ownerUserId,
      workspaceId: campaign.workspaceId,
    }),
  ]);
  return { campaign, matches, upstreamWork };
}

export async function appendAnalyticsEvent(
  database: Database,
  input: {
    readonly workspaceId: string;
    readonly actorUserId?: string;
    readonly eventName: string;
    readonly subjectType: string;
    readonly subjectId: string;
    readonly properties?: JsonObject;
    readonly dedupeKey?: string;
    readonly occurredAt?: Date;
  },
): Promise<boolean> {
  const rows = await database
    .insert(analyticsEvents)
    .values({
      workspaceId: uuidSchema.parse(input.workspaceId),
      actorUserId:
        input.actorUserId === undefined
          ? null
          : uuidSchema.parse(input.actorUserId),
      eventName: input.eventName,
      subjectType: input.subjectType,
      subjectId: uuidSchema.parse(input.subjectId),
      properties: input.properties ?? {},
      ...(input.dedupeKey === undefined ? {} : { dedupeKey: input.dedupeKey }),
      ...(input.occurredAt === undefined ? {} : { occurredAt: input.occurredAt }),
    })
    .onConflictDoNothing()
    .returning({ id: analyticsEvents.id });
  return rows.length === 1;
}

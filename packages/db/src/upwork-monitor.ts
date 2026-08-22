import {
  createInputHash,
  sourceJobInputSchema,
  UPWORK_MCP_RETENTION_DAYS,
  upworkCandidateToSourceJob,
  upworkJobSearchOutcomeSchema,
  upworkMonitorIntervalSecondsSchema,
  type CampaignFilterV1,
  type UpworkJobSearchOutcome
} from "@upwork-agent/core";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "./database.js";
import {
  campaigns,
  jobs,
  upworkJobObservations,
  upworkConnections,
  upworkMonitors,
  workflowTasks,
  workspaces,
  type UpworkMonitorRow
} from "./schema.js";

const uuidSchema = z.uuid();
const approvalReferenceSchema = z.string().trim().min(1).max(500);
const retentionDaysSchema = z.literal(UPWORK_MCP_RETENTION_DAYS);
const sequenceSchema = z.number().int().positive();

export class UpworkMonitorConfigurationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "UpworkMonitorConfigurationError";
  }
}

export interface CampaignMonitorView {
  readonly id: string;
  readonly status: UpworkMonitorRow["status"];
  readonly pollIntervalSeconds: number;
  readonly retentionDays: number;
  readonly scheduleVersion: number;
  readonly nextRunSequence: number;
  readonly nextRunAt: Date | null;
  readonly lastSuccessAt: Date | null;
  readonly lastErrorCode: string | null;
  readonly consecutiveFailureCount: number;
  readonly connectionStatus:
    | "fake"
    | "authorizing"
    | "connected"
    | "reconnect_required"
    | "disabled";
}

export async function getCampaignMonitorView(
  database: Database,
  input: { readonly ownerUserId: string; readonly campaignId: string }
): Promise<CampaignMonitorView | null> {
  const ownerUserId = uuidSchema.parse(input.ownerUserId);
  const campaignId = uuidSchema.parse(input.campaignId);
  const rows = await database
    .select({
      id: upworkMonitors.id,
      status: upworkMonitors.status,
      pollIntervalSeconds: upworkMonitors.pollIntervalSeconds,
      retentionDays: upworkMonitors.retentionDays,
      scheduleVersion: upworkMonitors.scheduleVersion,
      nextRunSequence: upworkMonitors.nextRunSequence,
      nextRunAt: upworkMonitors.nextRunAt,
      lastSuccessAt: upworkMonitors.lastSuccessAt,
      lastErrorCode: upworkMonitors.lastErrorCode,
      consecutiveFailureCount: upworkMonitors.consecutiveFailureCount,
      connectionStatus: upworkConnections.status
    })
    .from(upworkMonitors)
    .innerJoin(workspaces, eq(upworkMonitors.workspaceId, workspaces.id))
    .innerJoin(
      upworkConnections,
      and(
        eq(upworkConnections.id, upworkMonitors.connectionId),
        eq(upworkConnections.workspaceId, upworkMonitors.workspaceId)
      )
    )
    .where(
      and(
        eq(upworkMonitors.campaignId, campaignId),
        eq(workspaces.ownerUserId, ownerUserId)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

type EnableUpworkMonitorInput = {
  readonly ownerUserId: string;
  readonly campaignId: string;
  readonly pollIntervalSeconds: number;
  readonly minimumPollIntervalSeconds: number;
  readonly retentionDays?: number;
  readonly approvalReference: string;
  readonly now?: Date;
};

async function enableUpworkMonitorForProvider(
  database: Database,
  input: EnableUpworkMonitorInput,
  provider: "fake" | "connected"
): Promise<CampaignMonitorView | null> {
  const ownerUserId = uuidSchema.parse(input.ownerUserId);
  const campaignId = uuidSchema.parse(input.campaignId);
  const interval = upworkMonitorIntervalSecondsSchema.parse(input.pollIntervalSeconds);
  const minimumInterval = upworkMonitorIntervalSecondsSchema.parse(
    input.minimumPollIntervalSeconds
  );
  if (interval < minimumInterval) {
    throw new UpworkMonitorConfigurationError(
      `Poll interval must be at least ${minimumInterval} seconds`
    );
  }
  const retentionDays = retentionDaysSchema.parse(
    input.retentionDays ?? UPWORK_MCP_RETENTION_DAYS
  );
  const approvalReference = approvalReferenceSchema.parse(input.approvalReference);
  const now = input.now ?? new Date();

  const monitorId = await database.transaction(async (transaction) => {
    const campaignRows = await transaction
      .select({
        campaignId: campaigns.id,
        campaignStatus: campaigns.status,
        workspaceId: campaigns.workspaceId
      })
      .from(campaigns)
      .innerJoin(workspaces, eq(campaigns.workspaceId, workspaces.id))
      .where(
        and(
          eq(campaigns.id, campaignId),
          eq(workspaces.ownerUserId, ownerUserId)
        )
      )
      .for("update")
      .limit(1);
    const campaign = campaignRows[0];
    if (campaign === undefined) return null;
    if (campaign.campaignStatus !== "active") {
      throw new UpworkMonitorConfigurationError(
        "Only an active campaign can run an Upwork monitor"
      );
    }

    const existingConnections = await transaction
      .select()
      .from(upworkConnections)
      .where(eq(upworkConnections.workspaceId, campaign.workspaceId))
      .for("update")
      .limit(1);
    const existingConnection = existingConnections[0];
    let connection:
      | Pick<
          typeof upworkConnections.$inferSelect,
          "id" | "purgeScheduleVersion" | "nextPurgeSequence" | "nextPurgeAt"
        >
      | undefined;
    if (provider === "connected") {
      if (
        existingConnection?.status !== "connected" ||
        existingConnection.accountId === null ||
        existingConnection.credentialRef === null
      ) {
        throw new UpworkMonitorConfigurationError(
          "Connect an Upwork account before enabling live monitoring"
        );
      }
      connection = existingConnection;
    } else if (
      existingConnection !== undefined &&
      !["fake", "disabled"].includes(existingConnection.status)
    ) {
      throw new UpworkMonitorConfigurationError(
        "A non-fake Upwork connection already exists for this workspace"
      );
    } else if (existingConnection === undefined) {
      const connectionRows = await transaction
        .insert(upworkConnections)
        .values({
          workspaceId: campaign.workspaceId,
          status: "fake",
          approvalReference,
          nextPurgeAt: now
        })
        .returning({
          id: upworkConnections.id,
          purgeScheduleVersion: upworkConnections.purgeScheduleVersion,
          nextPurgeSequence: upworkConnections.nextPurgeSequence,
          nextPurgeAt: upworkConnections.nextPurgeAt
        });
      connection = connectionRows[0];
    } else {
      const connectionRows = await transaction
        .update(upworkConnections)
        .set({
          status: "fake",
          credentialRef: null,
          approvalReference,
          updatedAt: now
        })
        .where(eq(upworkConnections.id, existingConnection.id))
        .returning({
          id: upworkConnections.id,
          purgeScheduleVersion: upworkConnections.purgeScheduleVersion,
          nextPurgeSequence: upworkConnections.nextPurgeSequence,
          nextPurgeAt: upworkConnections.nextPurgeAt
        });
      connection = connectionRows[0];
    }
    if (connection === undefined) {
      throw new Error("Upwork connection insert returned no row");
    }
    const connectionId = connection.id;

    const purgePayload = {
      connectionId,
      scheduleVersion: connection.purgeScheduleVersion,
      runSequence: connection.nextPurgeSequence
    };
    await transaction
      .insert(workflowTasks)
      .values({
        workspaceId: campaign.workspaceId,
        kind: "purge-upwork-data",
        payload: purgePayload,
        dedupeKey: `purge-upwork-data:${campaign.workspaceId}:${connectionId}:${connection.purgeScheduleVersion}:${connection.nextPurgeSequence}`,
        priority: 100,
        runAt: connection.nextPurgeAt,
        maxAttempts: 10
      })
      .onConflictDoNothing({
        target: [workflowTasks.kind, workflowTasks.dedupeKey]
      });

    const existingMonitors = await transaction
      .select()
      .from(upworkMonitors)
      .where(eq(upworkMonitors.campaignId, campaignId))
      .for("update")
      .limit(1);
    const existingMonitor = existingMonitors[0];
    let monitor: Pick<UpworkMonitorRow, "id" | "scheduleVersion" | "nextRunSequence">;
    if (existingMonitor === undefined) {
      const monitorRows = await transaction
        .insert(upworkMonitors)
        .values({
          workspaceId: campaign.workspaceId,
          campaignId,
          connectionId,
          status: "active",
          pollIntervalSeconds: interval,
          retentionDays,
          scheduleVersion: 1,
          nextRunSequence: 1,
          nextRunAt: now
        })
        .returning({
          id: upworkMonitors.id,
          scheduleVersion: upworkMonitors.scheduleVersion,
          nextRunSequence: upworkMonitors.nextRunSequence
        });
      const createdMonitor = monitorRows[0];
      if (createdMonitor === undefined) {
        throw new Error("Upwork monitor insert returned no row");
      }
      monitor = createdMonitor;
    } else {
      const scheduleVersion = existingMonitor.scheduleVersion + 1;
      const updatedRows = await transaction
        .update(upworkMonitors)
        .set({
          connectionId,
          status: "active",
          pollIntervalSeconds: interval,
          retentionDays,
          scheduleVersion,
          nextRunSequence: 1,
          nextRunAt: now,
          lastErrorCode: null,
          consecutiveFailureCount: 0,
          updatedAt: now
        })
        .where(eq(upworkMonitors.id, existingMonitor.id))
        .returning({
          id: upworkMonitors.id,
          scheduleVersion: upworkMonitors.scheduleVersion,
          nextRunSequence: upworkMonitors.nextRunSequence
        });
      const updatedMonitor = updatedRows[0];
      if (updatedMonitor === undefined) {
        throw new Error("Upwork monitor update returned no row");
      }
      monitor = updatedMonitor;
    }

    const payload = {
      monitorId: monitor.id,
      scheduleVersion: monitor.scheduleVersion,
      runSequence: monitor.nextRunSequence
    };
    await transaction
      .insert(workflowTasks)
      .values({
        workspaceId: campaign.workspaceId,
        kind: "poll-upwork-monitor",
        payload,
        dedupeKey: `poll-upwork-monitor:${campaign.workspaceId}:${monitor.id}:${monitor.scheduleVersion}:${monitor.nextRunSequence}`,
        runAt: now,
        maxAttempts: 5
      })
      .onConflictDoNothing({
        target: [workflowTasks.kind, workflowTasks.dedupeKey]
      });
    return monitor.id;
  });

  if (monitorId === null) return null;
  return getCampaignMonitorView(database, { ownerUserId, campaignId });
}

export function enableFakeUpworkMonitor(
  database: Database,
  input: EnableUpworkMonitorInput
): Promise<CampaignMonitorView | null> {
  return enableUpworkMonitorForProvider(database, input, "fake");
}

export function enableConnectedUpworkMonitor(
  database: Database,
  input: EnableUpworkMonitorInput
): Promise<CampaignMonitorView | null> {
  return enableUpworkMonitorForProvider(database, input, "connected");
}

export async function pauseUpworkMonitor(
  database: Database,
  input: {
    readonly ownerUserId: string;
    readonly campaignId: string;
    readonly now?: Date;
  }
): Promise<CampaignMonitorView | null> {
  const ownerUserId = uuidSchema.parse(input.ownerUserId);
  const campaignId = uuidSchema.parse(input.campaignId);
  const now = input.now ?? new Date();
  const updated = await database.transaction(async (transaction) => {
    const rows = await transaction
      .select({
        id: upworkMonitors.id,
        scheduleVersion: upworkMonitors.scheduleVersion
      })
      .from(upworkMonitors)
      .innerJoin(workspaces, eq(upworkMonitors.workspaceId, workspaces.id))
      .where(
        and(
          eq(upworkMonitors.campaignId, campaignId),
          eq(workspaces.ownerUserId, ownerUserId)
        )
      )
      .for("update")
      .limit(1);
    const monitor = rows[0];
    if (monitor === undefined) return false;
    await transaction
      .update(upworkMonitors)
      .set({
        status: "paused",
        nextRunAt: null,
        scheduleVersion: monitor.scheduleVersion + 1,
        updatedAt: now
      })
      .where(eq(upworkMonitors.id, monitor.id));
    return true;
  });
  if (!updated) return null;
  return getCampaignMonitorView(database, { ownerUserId, campaignId });
}

export type LoadUpworkMonitorPollContextResult =
  | { readonly status: "skip" }
  | {
      readonly status: "ready";
      readonly workspaceId: string;
      readonly monitorId: string;
      readonly campaignId: string;
      readonly connectionId: string;
      readonly filters: CampaignFilterV1;
      readonly maxResults: number;
      readonly pollIntervalSeconds: number;
      readonly retentionDays: number;
      readonly nextCursor: string | null;
      readonly scheduleVersion: number;
      readonly runSequence: number;
      readonly connectionStatus: "fake" | "connected";
    };

export async function loadUpworkMonitorPollContext(
  database: Database,
  input: {
    readonly workspaceId: string;
    readonly monitorId: string;
    readonly scheduleVersion: number;
    readonly runSequence: number;
    readonly minimumPollIntervalSeconds: number;
    readonly now?: Date;
  }
): Promise<LoadUpworkMonitorPollContextResult> {
  const workspaceId = uuidSchema.parse(input.workspaceId);
  const monitorId = uuidSchema.parse(input.monitorId);
  const scheduleVersion = sequenceSchema.parse(input.scheduleVersion);
  const runSequence = sequenceSchema.parse(input.runSequence);
  const minimumPollIntervalSeconds = upworkMonitorIntervalSecondsSchema.parse(
    input.minimumPollIntervalSeconds
  );
  const now = input.now ?? new Date();

  return database.transaction(async (transaction) => {
    const rows = await transaction
      .select({
        monitorId: upworkMonitors.id,
        campaignId: upworkMonitors.campaignId,
        connectionId: upworkMonitors.connectionId,
        filters: campaigns.filters,
        pollIntervalSeconds: upworkMonitors.pollIntervalSeconds,
        retentionDays: upworkMonitors.retentionDays,
        scheduleVersion: upworkMonitors.scheduleVersion,
        runSequence: upworkMonitors.nextRunSequence,
        nextCursor: upworkMonitors.nextCursor,
        connectionStatus: upworkConnections.status,
        nextRequestAt: upworkConnections.nextRequestAt
      })
      .from(upworkMonitors)
      .innerJoin(
        campaigns,
        and(
          eq(campaigns.id, upworkMonitors.campaignId),
          eq(campaigns.workspaceId, upworkMonitors.workspaceId)
        )
      )
      .innerJoin(
        upworkConnections,
        and(
          eq(upworkConnections.id, upworkMonitors.connectionId),
          eq(upworkConnections.workspaceId, upworkMonitors.workspaceId)
        )
      )
      .where(
        and(
          eq(upworkMonitors.id, monitorId),
          eq(upworkMonitors.workspaceId, workspaceId),
          eq(upworkMonitors.status, "active"),
          eq(upworkMonitors.scheduleVersion, scheduleVersion),
          eq(upworkMonitors.nextRunSequence, runSequence),
          eq(campaigns.status, "active")
        )
      )
      .for("update")
      .limit(1);
    const row = rows[0];
    if (
      row === undefined ||
      (row.connectionStatus !== "fake" && row.connectionStatus !== "connected")
    ) {
      return { status: "skip" };
    }

    if (
      row.connectionStatus === "connected" &&
      row.nextRequestAt !== null &&
      row.nextRequestAt.getTime() > now.getTime()
    ) {
      const nextRunSequence = row.runSequence + 1;
      await transaction
        .update(upworkMonitors)
        .set({ nextRunSequence, nextRunAt: row.nextRequestAt, updatedAt: now })
        .where(eq(upworkMonitors.id, row.monitorId));
      await transaction
        .insert(workflowTasks)
        .values({
          workspaceId,
          kind: "poll-upwork-monitor",
          payload: {
            monitorId: row.monitorId,
            scheduleVersion: row.scheduleVersion,
            runSequence: nextRunSequence
          },
          dedupeKey: `poll-upwork-monitor:${workspaceId}:${row.monitorId}:${row.scheduleVersion}:${nextRunSequence}`,
          runAt: row.nextRequestAt,
          maxAttempts: 5
        })
        .onConflictDoNothing({
          target: [workflowTasks.kind, workflowTasks.dedupeKey]
        });
      return { status: "skip" };
    }

    if (row.connectionStatus === "connected") {
      await transaction
        .update(upworkConnections)
        .set({
          nextRequestAt: new Date(
            now.getTime() + minimumPollIntervalSeconds * 1_000
          ),
          updatedAt: now
        })
        .where(
          and(
            eq(upworkConnections.workspaceId, workspaceId),
            eq(upworkConnections.id, row.connectionId)
          )
        );
    }

    return {
      status: "ready",
      workspaceId,
      monitorId: row.monitorId,
      campaignId: row.campaignId,
      connectionId: row.connectionId,
      filters: row.filters,
      maxResults: 10,
      pollIntervalSeconds: row.pollIntervalSeconds,
      retentionDays: row.retentionDays,
      nextCursor: row.nextCursor,
      scheduleVersion: row.scheduleVersion,
      runSequence: row.runSequence,
      connectionStatus: row.connectionStatus
    };
  });
}

export interface CommitUpworkMonitorPollResult {
  readonly status: "skip" | "committed" | "reauthorization_required";
  readonly jobsSeen: number;
  readonly jobsQueued: number;
  readonly nextRunAt: Date | null;
}

function retryDate(value: string | undefined, fallback: Date): Date {
  if (value === undefined) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

export async function commitUpworkMonitorPoll(
  database: Database,
  input: {
    readonly workspaceId: string;
    readonly monitorId: string;
    readonly scheduleVersion: number;
    readonly runSequence: number;
    readonly outcome: UpworkJobSearchOutcome;
    readonly now?: Date;
  }
): Promise<CommitUpworkMonitorPollResult> {
  const workspaceId = uuidSchema.parse(input.workspaceId);
  const monitorId = uuidSchema.parse(input.monitorId);
  const scheduleVersion = sequenceSchema.parse(input.scheduleVersion);
  const runSequence = sequenceSchema.parse(input.runSequence);
  const outcome = upworkJobSearchOutcomeSchema.parse(input.outcome);
  const now = input.now ?? new Date();

  return database.transaction(async (transaction) => {
    const monitorRows = await transaction
      .select()
      .from(upworkMonitors)
      .where(
        and(
          eq(upworkMonitors.id, monitorId),
          eq(upworkMonitors.workspaceId, workspaceId),
          eq(upworkMonitors.status, "active"),
          eq(upworkMonitors.scheduleVersion, scheduleVersion),
          eq(upworkMonitors.nextRunSequence, runSequence)
        )
      )
      .for("update")
      .limit(1);
    const monitor = monitorRows[0];
    if (monitor === undefined) {
      return { status: "skip", jobsSeen: 0, jobsQueued: 0, nextRunAt: null };
    }

    if (outcome.kind === "reauthorization_required") {
      await transaction
        .update(upworkConnections)
        .set({ status: "reconnect_required", nextRequestAt: null, updatedAt: now })
        .where(
          and(
            eq(upworkConnections.id, monitor.connectionId),
            eq(upworkConnections.workspaceId, workspaceId)
          )
        );
      await transaction
        .update(upworkMonitors)
        .set({
          status: "error",
          nextRunAt: null,
          lastErrorCode: "upwork_reauthorization_required",
          consecutiveFailureCount: monitor.consecutiveFailureCount + 1,
          updatedAt: now
        })
        .where(eq(upworkMonitors.id, monitor.id));
      return {
        status: "reauthorization_required",
        jobsSeen: 0,
        jobsQueued: 0,
        nextRunAt: null
      };
    }

    let jobsQueued = 0;
    if (outcome.kind === "page") {
      for (const candidate of outcome.jobs) {
        const sourceJob = sourceJobInputSchema.parse(upworkCandidateToSourceJob(candidate));
        const sourcePayloadHash = createInputHash(sourceJob);
        const tenantSourceJobId = `${workspaceId}:${candidate.externalJobId}`;
        const existingRows = await transaction
          .select({
            id: jobs.id,
            sourcePayloadHash: jobs.sourcePayloadHash,
            status: jobs.status,
            revision: jobs.revision,
          })
          .from(jobs)
          .where(
            and(
              eq(jobs.source, "upwork_mcp"),
              eq(jobs.workspaceId, workspaceId),
              eq(jobs.sourceJobId, tenantSourceJobId)
            )
          )
          .for("update")
          .limit(1);
        const existing = existingRows[0];
        let jobId = existing?.id;
        const changed = existing === undefined || existing.sourcePayloadHash !== sourcePayloadHash;
        if (existing === undefined) {
          const inserted = await transaction
            .insert(jobs)
            .values({
              workspaceId,
              source: "upwork_mcp",
              sourceJobId: tenantSourceJobId,
              canonicalUrl: candidate.canonicalUrl ?? null,
              postedAt:
                candidate.postedAt === undefined ? null : new Date(candidate.postedAt),
              rawPayload: sourceJob,
              sourcePayloadHash,
              status: "received",
              lastSeenAt: now,
              updatedAt: now
            })
            .returning({ id: jobs.id });
          jobId = inserted[0]?.id;
        } else if (changed) {
          await transaction
            .update(jobs)
            .set({
              canonicalUrl: candidate.canonicalUrl ?? null,
              postedAt:
                candidate.postedAt === undefined ? null : new Date(candidate.postedAt),
              rawPayload: sourceJob,
              sourcePayloadHash,
              status: "received",
              lastSeenAt: now,
              updatedAt: now
            })
            .where(eq(jobs.id, existing.id));
        } else {
          await transaction
            .update(jobs)
            .set({ lastSeenAt: now, updatedAt: now })
            .where(eq(jobs.id, existing.id));
        }
        if (jobId === undefined) {
          throw new Error("Upwork job upsert returned no row");
        }

        const observationInserted = await transaction
          .insert(upworkJobObservations)
          .values({
            workspaceId,
            monitorId: monitor.id,
            jobId,
            firstSeenAt: now,
            lastSeenAt: now,
          })
          .onConflictDoNothing()
          .returning({ jobId: upworkJobObservations.jobId });
        if (observationInserted.length === 0) {
          await transaction
            .update(upworkJobObservations)
            .set({ lastSeenAt: now })
            .where(
              and(
                eq(upworkJobObservations.workspaceId, workspaceId),
                eq(upworkJobObservations.monitorId, monitor.id),
                eq(upworkJobObservations.jobId, jobId),
              ),
            );
        } else if (
          existing !== undefined &&
          !changed &&
          existing.status === "ready" &&
          existing.revision > 0
        ) {
          const campaignMatchTask = await transaction
            .insert(workflowTasks)
            .values({
              workspaceId,
              kind: "match-job",
              payload: {
                jobId,
                normalizedRevision: existing.revision,
                campaignId: monitor.campaignId,
              },
              dedupeKey: `match-job:${workspaceId}:${jobId}:${existing.revision}:${monitor.campaignId}`,
            })
            .onConflictDoNothing({
              target: [workflowTasks.kind, workflowTasks.dedupeKey],
            })
            .returning({ id: workflowTasks.id });
          jobsQueued += campaignMatchTask.length;
        }
        if (changed) {
          const dedupeKey = `normalize-job:${workspaceId}:${jobId}:${sourcePayloadHash}`;
          const taskRows = await transaction
            .insert(workflowTasks)
            .values({
              workspaceId,
              kind: "normalize-job",
              payload: { jobId, sourcePayloadHash },
              dedupeKey
            })
            .onConflictDoNothing({
              target: [workflowTasks.kind, workflowTasks.dedupeKey]
            })
            .returning({ id: workflowTasks.id });
          jobsQueued += taskRows.length;
        }
      }
    }

    const normalNextRun = new Date(now.getTime() + monitor.pollIntervalSeconds * 1_000);
    const failureCount =
      outcome.kind === "page" ? 0 : monitor.consecutiveFailureCount + 1;
    let nextRunAt = normalNextRun;
    let lastErrorCode: string | null = null;
    if (outcome.kind === "rate_limited") {
      nextRunAt = new Date(
        Math.max(normalNextRun.getTime(), retryDate(outcome.retryAt, normalNextRun).getTime())
      );
      lastErrorCode = "upwork_rate_limited";
    } else if (outcome.kind === "temporarily_unavailable") {
      const backoffSeconds = Math.min(
        21_600,
        monitor.pollIntervalSeconds * 2 ** Math.min(6, failureCount)
      );
      const fallback = new Date(now.getTime() + backoffSeconds * 1_000);
      nextRunAt = retryDate(outcome.retryAt, fallback);
      lastErrorCode = "upwork_temporarily_unavailable";
    }

    if (outcome.kind === "rate_limited") {
      await transaction
        .update(upworkConnections)
        .set({
          nextRequestAt: sql`greatest(coalesce(${upworkConnections.nextRequestAt}, ${nextRunAt}), ${nextRunAt})`,
          updatedAt: now
        })
        .where(
          and(
            eq(upworkConnections.workspaceId, workspaceId),
            eq(upworkConnections.id, monitor.connectionId)
          )
        );
    }

    const nextRunSequence = monitor.nextRunSequence + 1;
    await transaction
      .update(upworkMonitors)
      .set({
        nextRunSequence,
        nextRunAt,
        ...(outcome.kind === "page" ? { nextCursor: outcome.nextCursor ?? null } : {}),
        lastSuccessAt: outcome.kind === "page" ? now : monitor.lastSuccessAt,
        lastErrorCode,
        consecutiveFailureCount: failureCount,
        updatedAt: now
      })
      .where(eq(upworkMonitors.id, monitor.id));
    const successorPayload = {
      monitorId: monitor.id,
      scheduleVersion: monitor.scheduleVersion,
      runSequence: nextRunSequence
    };
    await transaction
      .insert(workflowTasks)
      .values({
        workspaceId,
        kind: "poll-upwork-monitor",
        payload: successorPayload,
        dedupeKey: `poll-upwork-monitor:${workspaceId}:${monitor.id}:${monitor.scheduleVersion}:${nextRunSequence}`,
        runAt: nextRunAt,
        maxAttempts: 5
      })
      .onConflictDoNothing({
        target: [workflowTasks.kind, workflowTasks.dedupeKey]
      });

    return {
      status: "committed",
      jobsSeen: outcome.kind === "page" ? outcome.jobs.length : 0,
      jobsQueued,
      nextRunAt
    };
  });
}

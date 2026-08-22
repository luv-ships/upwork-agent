import { UPWORK_MCP_RETENTION_DAYS } from "@upwork-agent/core";
import { and, eq, inArray, lte, sql } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "./database.js";
import {
  aiScores,
  analyticsEvents,
  campaignJobMatches,
  jobs,
  upworkConnections,
  workflowTasks,
} from "./schema.js";

const uuidSchema = z.uuid();
const sequenceSchema = z.number().int().positive();
const DAY_MILLISECONDS = 24 * 60 * 60 * 1_000;
const RETENTION_MILLISECONDS = UPWORK_MCP_RETENTION_DAYS * DAY_MILLISECONDS;
const PURGE_MAINTENANCE_INTERVAL_MILLISECONDS = DAY_MILLISECONDS;

export interface PurgeExpiredUpworkDataResult {
  readonly status: "skip" | "committed";
  readonly deletedJobs: number;
  readonly deletedMatches: number;
  readonly deletedAiScores: number;
  readonly deletedWorkflowTasks: number;
  readonly deletedAnalyticsEvents: number;
  readonly nextRunAt: Date | null;
}

function skippedPurge(): PurgeExpiredUpworkDataResult {
  return {
    status: "skip",
    deletedJobs: 0,
    deletedMatches: 0,
    deletedAiScores: 0,
    deletedWorkflowTasks: 0,
    deletedAnalyticsEvents: 0,
    nextRunAt: null,
  };
}

export async function purgeExpiredUpworkData(
  database: Database,
  input: {
    readonly workspaceId: string;
    readonly connectionId: string;
    readonly scheduleVersion: number;
    readonly runSequence: number;
    readonly now?: Date;
  },
): Promise<PurgeExpiredUpworkDataResult> {
  const workspaceId = uuidSchema.parse(input.workspaceId);
  const connectionId = uuidSchema.parse(input.connectionId);
  const scheduleVersion = sequenceSchema.parse(input.scheduleVersion);
  const runSequence = sequenceSchema.parse(input.runSequence);
  const now = z.date().parse(input.now ?? new Date());
  const cutoff = new Date(now.getTime() - RETENTION_MILLISECONDS);

  return database.transaction(async (transaction) => {
    const connectionRows = await transaction
      .select()
      .from(upworkConnections)
      .where(
        and(
          eq(upworkConnections.id, connectionId),
          eq(upworkConnections.workspaceId, workspaceId),
          eq(upworkConnections.purgeScheduleVersion, scheduleVersion),
          eq(upworkConnections.nextPurgeSequence, runSequence),
        ),
      )
      .for("update")
      .limit(1);
    const connection = connectionRows[0];
    if (connection === undefined) {
      return skippedPurge();
    }

    const expiredJobRows = await transaction
      .select({ id: jobs.id })
      .from(jobs)
      .where(
        and(
          eq(jobs.workspaceId, workspaceId),
          eq(jobs.source, "upwork_mcp"),
          lte(jobs.lastSeenAt, cutoff),
        ),
      )
      .for("update");
    const expiredJobIds = expiredJobRows.map((row) => row.id);

    const matchRows =
      expiredJobIds.length === 0
        ? []
        : await transaction
            .select({ id: campaignJobMatches.id })
            .from(campaignJobMatches)
            .where(
              and(
                eq(campaignJobMatches.workspaceId, workspaceId),
                inArray(campaignJobMatches.jobId, expiredJobIds),
              ),
            );
    const matchIds = matchRows.map((row) => row.id);

    const scoreRows =
      matchIds.length === 0
        ? []
        : await transaction
            .select({ id: aiScores.id })
            .from(aiScores)
            .where(
              and(
                eq(aiScores.workspaceId, workspaceId),
                inArray(aiScores.matchId, matchIds),
              ),
            );
    const scoreIds = scoreRows.map((row) => row.id);

    let deletedAnalyticsEvents = 0;
    if (expiredJobIds.length > 0) {
      const deleted = await transaction
        .delete(analyticsEvents)
        .where(
          and(
            eq(analyticsEvents.workspaceId, workspaceId),
            eq(analyticsEvents.subjectType, "job"),
            inArray(analyticsEvents.subjectId, expiredJobIds),
          ),
        )
        .returning({ id: analyticsEvents.id });
      deletedAnalyticsEvents += deleted.length;
    }
    if (matchIds.length > 0) {
      const deleted = await transaction
        .delete(analyticsEvents)
        .where(
          and(
            eq(analyticsEvents.workspaceId, workspaceId),
            eq(analyticsEvents.subjectType, "campaign_job_match"),
            inArray(analyticsEvents.subjectId, matchIds),
          ),
        )
        .returning({ id: analyticsEvents.id });
      deletedAnalyticsEvents += deleted.length;
    }
    if (scoreIds.length > 0) {
      const deleted = await transaction
        .delete(analyticsEvents)
        .where(
          and(
            eq(analyticsEvents.workspaceId, workspaceId),
            eq(analyticsEvents.subjectType, "ai_score"),
            inArray(analyticsEvents.subjectId, scoreIds),
          ),
        )
        .returning({ id: analyticsEvents.id });
      deletedAnalyticsEvents += deleted.length;
    }

    let deletedWorkflowTasks = 0;
    if (expiredJobIds.length > 0) {
      for (const kind of ["normalize-job", "match-job"] as const) {
        const deleted = await transaction
          .delete(workflowTasks)
          .where(
            and(
              eq(workflowTasks.workspaceId, workspaceId),
              eq(workflowTasks.kind, kind),
              inArray(sql<string>`${workflowTasks.payload} ->> 'jobId'`, expiredJobIds),
            ),
          )
          .returning({ id: workflowTasks.id });
        deletedWorkflowTasks += deleted.length;
      }
    }
    if (matchIds.length > 0) {
      const deleted = await transaction
        .delete(workflowTasks)
        .where(
          and(
            eq(workflowTasks.workspaceId, workspaceId),
            eq(workflowTasks.kind, "analyze-match"),
            inArray(sql<string>`${workflowTasks.payload} ->> 'matchId'`, matchIds),
          ),
        )
        .returning({ id: workflowTasks.id });
      deletedWorkflowTasks += deleted.length;
    }

    const deletedJobRows =
      expiredJobIds.length === 0
        ? []
        : await transaction
            .delete(jobs)
            .where(
              and(
                eq(jobs.workspaceId, workspaceId),
                eq(jobs.source, "upwork_mcp"),
                inArray(jobs.id, expiredJobIds),
              ),
            )
            .returning({ id: jobs.id });

    const earliestRetainedRows = await transaction
      .select({ lastSeenAt: jobs.lastSeenAt })
      .from(jobs)
      .where(
        and(eq(jobs.workspaceId, workspaceId), eq(jobs.source, "upwork_mcp")),
      )
      .orderBy(jobs.lastSeenAt)
      .limit(1);
    const maintenanceRunAt = new Date(
      now.getTime() + PURGE_MAINTENANCE_INTERVAL_MILLISECONDS,
    );
    const earliestExpiryAt =
      earliestRetainedRows[0] === undefined
        ? maintenanceRunAt
        : new Date(earliestRetainedRows[0].lastSeenAt.getTime() + RETENTION_MILLISECONDS);
    const nextRunAt =
      earliestExpiryAt.getTime() < maintenanceRunAt.getTime()
        ? earliestExpiryAt
        : maintenanceRunAt;
    const nextRunSequence = connection.nextPurgeSequence + 1;

    await transaction
      .update(upworkConnections)
      .set({
        nextPurgeSequence: nextRunSequence,
        nextPurgeAt: nextRunAt,
        updatedAt: now,
      })
      .where(
        and(
          eq(upworkConnections.id, connection.id),
          eq(upworkConnections.workspaceId, workspaceId),
          eq(upworkConnections.purgeScheduleVersion, scheduleVersion),
          eq(upworkConnections.nextPurgeSequence, runSequence),
        ),
      );

    const successorPayload = {
      connectionId: connection.id,
      scheduleVersion: connection.purgeScheduleVersion,
      runSequence: nextRunSequence,
    };
    await transaction
      .insert(workflowTasks)
      .values({
        workspaceId,
        kind: "purge-upwork-data",
        payload: successorPayload,
        dedupeKey: `purge-upwork-data:${workspaceId}:${connection.id}:${connection.purgeScheduleVersion}:${nextRunSequence}`,
        priority: 100,
        runAt: nextRunAt,
        maxAttempts: 10,
      })
      .onConflictDoNothing({
        target: [workflowTasks.kind, workflowTasks.dedupeKey],
      });

    return {
      status: "committed",
      deletedJobs: deletedJobRows.length,
      deletedMatches: matchIds.length,
      deletedAiScores: scoreIds.length,
      deletedWorkflowTasks,
      deletedAnalyticsEvents,
      nextRunAt,
    };
  });
}

import {
  parseWorkflowTaskPayload,
  type WorkflowTaskKind,
} from "@upwork-agent/core";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "./database.js";
import {
  aiScores,
  campaignJobMatches,
  jobs,
  upworkMonitors,
  workflowTasks,
  type JsonObject,
  type WorkflowTaskRow,
} from "./schema.js";

const taskPayloadSchema = z.record(z.string(), z.json());
const uuidSchema = z.uuid();
const workflowTaskKindSchema = z.enum([
  "normalize-job",
  "match-job",
  "analyze-match",
  "poll-upwork-monitor",
  "purge-upwork-data",
  "index-knowledge-doc",
  "generate-proposal",
]);

const claimedTaskRowSchema = z.object({
  id: z.uuid(),
  workspaceId: z.uuid(),
  kind: z.enum([
    "normalize-job",
    "match-job",
    "analyze-match",
    "poll-upwork-monitor",
    "purge-upwork-data",
    "index-knowledge-doc",
    "generate-proposal",
  ]),
  schemaVersion: z.number().int().positive(),
  payload: taskPayloadSchema,
  dedupeKey: z.string().min(1),
  attemptCount: z.number().int().positive(),
  maxAttempts: z.number().int().positive(),
  leaseExpiresAt: z.date(),
});

export interface ClaimedWorkflowTask {
  readonly id: string;
  readonly workspaceId: string;
  readonly kind: WorkflowTaskKind;
  readonly schemaVersion: number;
  readonly payload: JsonObject;
  readonly dedupeKey: string;
  readonly attemptCount: number;
  readonly maxAttempts: number;
  readonly leaseExpiresAt: Date;
}

export interface EnqueueWorkflowTaskInput {
  readonly workspaceId: string;
  readonly kind: WorkflowTaskKind;
  readonly payload: unknown;
  readonly dedupeKey: string;
  readonly schemaVersion?: number;
  readonly priority?: number;
  readonly runAt?: Date;
  readonly maxAttempts?: number;
}

export interface EnqueueWorkflowTaskResult {
  readonly task: WorkflowTaskRow;
  readonly created: boolean;
}

function validateDuration(durationMs: number): number {
  if (!Number.isInteger(durationMs) || durationMs < 1_000 || durationMs > 3_600_000) {
    throw new RangeError("leaseDurationMs must be an integer from 1,000 to 3,600,000");
  }
  return durationMs;
}

function validateWorkerId(workerId: string): string {
  const normalized = workerId.trim();
  if (normalized.length < 1 || normalized.length > 128) {
    throw new RangeError("workerId must contain 1 to 128 characters");
  }
  return normalized;
}

function sanitizeFailureCode(errorCode: string): string {
  const normalized = errorCode.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9_.-]{0,79}$/.test(normalized)
    ? normalized
    : "worker_failure";
}

function sanitizeFailureMessage(errorMessage: string): string {
  return errorMessage.replace(/[\r\n\t]+/g, " ").trim().slice(0, 500);
}

export async function enqueueWorkflowTask(
  database: Database,
  input: EnqueueWorkflowTaskInput,
): Promise<EnqueueWorkflowTaskResult> {
  const workspaceId = uuidSchema.parse(input.workspaceId);
  const kind = workflowTaskKindSchema.parse(input.kind);
  const payload = taskPayloadSchema.parse(
    parseWorkflowTaskPayload(kind, input.payload),
  );
  const dedupeKey = z.string().trim().min(1).max(500).parse(input.dedupeKey);
  const schemaVersion = z.literal(1).parse(input.schemaVersion ?? 1);
  const priority = z.number().int().min(-32_768).max(32_767).parse(
    input.priority ?? 0,
  );
  const maxAttempts = z.number().int().min(1).max(20).parse(
    input.maxAttempts ?? 5,
  );
  const runAt = z.date().parse(input.runAt ?? new Date());
  const rows = await database
    .insert(workflowTasks)
    .values({
      workspaceId,
      kind,
      payload,
      dedupeKey,
      schemaVersion,
      priority,
      runAt,
      maxAttempts,
    })
    .onConflictDoNothing({
      target: [workflowTasks.kind, workflowTasks.dedupeKey],
    })
    .returning();

  const createdTask = rows[0];
  if (createdTask !== undefined) {
    return { task: createdTask, created: true };
  }

  const existing = await database
    .select()
    .from(workflowTasks)
    .where(
      and(
        eq(workflowTasks.kind, kind),
        eq(workflowTasks.dedupeKey, dedupeKey),
      ),
    )
    .limit(1);
  const task = existing[0];
  if (task === undefined) {
    throw new Error("Workflow task conflicted but could not be reloaded");
  }
  if (task.workspaceId !== workspaceId) {
    throw new Error("Workflow task dedupe key crossed a workspace boundary");
  }
  return { task, created: false };
}

export async function claimWorkflowTask(
  database: Database,
  input: {
    readonly workerId: string;
    readonly leaseDurationMs: number;
    readonly now?: Date;
  },
): Promise<ClaimedWorkflowTask | null> {
  const workerId = validateWorkerId(input.workerId);
  const leaseDurationMs = validateDuration(input.leaseDurationMs);
  const now = input.now ?? new Date();

  const rows = await database.execute(sql`
    with candidate as (
      select id
      from ${workflowTasks}
      where status in ('queued', 'retry_wait')
        and run_at <= ${now}
        and attempt_count < max_attempts
      order by priority desc, run_at asc, created_at asc
      for update skip locked
      limit 1
    )
    update ${workflowTasks} as task
    set status = 'running',
        attempt_count = task.attempt_count + 1,
        locked_by = ${workerId},
        locked_at = ${now},
        lease_expires_at = ${now} + (${leaseDurationMs} * interval '1 millisecond'),
        last_error_code = null,
        last_error_message = null,
        completed_at = null,
        updated_at = ${now}
    from candidate
    where task.id = candidate.id
    returning
      task.id,
      task.workspace_id as "workspaceId",
      task.kind,
      task.schema_version as "schemaVersion",
      task.payload,
      task.dedupe_key as "dedupeKey",
      task.attempt_count as "attemptCount",
      task.max_attempts as "maxAttempts",
      task.lease_expires_at as "leaseExpiresAt"
  `);

  const row = rows[0];
  return row === undefined ? null : claimedTaskRowSchema.parse(row);
}

export async function renewWorkflowTaskLease(
  database: Database,
  input: {
    readonly taskId: string;
    readonly workerId: string;
    readonly leaseDurationMs: number;
    readonly now?: Date;
  },
): Promise<boolean> {
  const workerId = validateWorkerId(input.workerId);
  const taskId = uuidSchema.parse(input.taskId);
  const leaseDurationMs = validateDuration(input.leaseDurationMs);
  const now = input.now ?? new Date();
  const rows = await database.execute(sql`
    update ${workflowTasks}
    set lease_expires_at = ${now} + (${leaseDurationMs} * interval '1 millisecond'),
        updated_at = ${now}
    where id = ${taskId}
      and status = 'running'
      and locked_by = ${workerId}
      and lease_expires_at > ${now}
    returning id
  `);
  return rows.length === 1;
}

export async function completeWorkflowTask(
  database: Database,
  input: {
    readonly taskId: string;
    readonly workerId: string;
    readonly now?: Date;
  },
): Promise<boolean> {
  const workerId = validateWorkerId(input.workerId);
  const taskId = uuidSchema.parse(input.taskId);
  const now = input.now ?? new Date();
  const rows = await database.execute(sql`
    update ${workflowTasks}
    set status = 'succeeded',
        locked_by = null,
        locked_at = null,
        lease_expires_at = null,
        completed_at = ${now},
        updated_at = ${now}
    where id = ${taskId}
      and status = 'running'
      and locked_by = ${workerId}
      and lease_expires_at > ${now}
    returning id
  `);
  return rows.length === 1;
}

export interface FailWorkflowTaskResult {
  readonly status: "retry_wait" | "succeeded" | "dead";
  readonly runAt: Date | null;
}

const failedTaskRowSchema = z.object({
  status: z.enum(["retry_wait", "succeeded", "dead"]),
  runAt: z.date().nullable(),
});

export async function failWorkflowTask(
  database: Database,
  input: {
    readonly taskId: string;
    readonly workerId: string;
    readonly errorCode: string;
    readonly errorMessage: string;
    readonly retryable: boolean;
    readonly now?: Date;
  },
): Promise<FailWorkflowTaskResult | null> {
  const workerId = validateWorkerId(input.workerId);
  const taskId = uuidSchema.parse(input.taskId);
  const errorCode = sanitizeFailureCode(input.errorCode);
  const errorMessage = sanitizeFailureMessage(input.errorMessage);
  const now = input.now ?? new Date();
  const rows = await database.execute(sql`
    with failed_task as (
    update ${workflowTasks}
    set status = case
          when ${input.retryable} and attempt_count < max_attempts
            then 'retry_wait'::public.workflow_task_status
          else 'dead'::public.workflow_task_status
        end,
        run_at = case
          when ${input.retryable} and attempt_count < max_attempts
            then ${now} + (
              least(300, power(2, greatest(attempt_count - 1, 0)))
              * interval '1 second'
            )
          else run_at
        end,
        locked_by = null,
        locked_at = null,
        lease_expires_at = null,
        last_error_code = ${errorCode},
        last_error_message = ${errorMessage},
        completed_at = case
          when ${input.retryable} and attempt_count < max_attempts then null
          else ${now}
        end,
        updated_at = ${now}
    where id = ${taskId}
      and status = 'running'
      and locked_by = ${workerId}
      and lease_expires_at > ${now}
    returning status, run_at, kind, payload, workspace_id
    ), failed_match as (
      update ${campaignJobMatches} as match
      set pipeline_status = 'failed',
          failed_step = 'analyze-match',
          failure_code = ${errorCode},
          updated_at = ${now}
      from failed_task
      where failed_task.status = 'dead'
        and failed_task.kind = 'analyze-match'
        and match.workspace_id = failed_task.workspace_id
        and match.id::text = failed_task.payload ->> 'matchId'
        and match.analysis_input_hash = failed_task.payload ->> 'inputHash'
      returning match.id
    ), rejected_job as (
      update ${jobs} as job
      set status = 'rejected', updated_at = ${now}
      from failed_task
      where failed_task.status = 'dead'
        and failed_task.kind = 'normalize-job'
        and job.id::text = failed_task.payload ->> 'jobId'
        and job.source_payload_hash = failed_task.payload ->> 'sourcePayloadHash'
        and job.workspace_id = failed_task.workspace_id
      returning job.id
    ), failed_monitor as (
      update ${upworkMonitors} as monitor
      set status = 'error',
          next_run_at = null,
          last_error_code = ${errorCode},
          consecutive_failure_count = monitor.consecutive_failure_count + 1,
          updated_at = ${now}
      from failed_task
      where failed_task.status = 'dead'
        and failed_task.kind = 'poll-upwork-monitor'
        and monitor.workspace_id = failed_task.workspace_id
        and monitor.id::text = failed_task.payload ->> 'monitorId'
        and monitor.schedule_version::text = failed_task.payload ->> 'scheduleVersion'
        and monitor.next_run_sequence::text = failed_task.payload ->> 'runSequence'
      returning monitor.id
    )
    select
      status,
      case when status = 'retry_wait' then run_at else null end as "runAt"
    from failed_task
  `);

  const row = rows[0];
  return row === undefined ? null : failedTaskRowSchema.parse(row);
}

export async function recoverExpiredWorkflowTasks(
  database: Database,
  input: { readonly now?: Date } = {},
): Promise<number> {
  const now = input.now ?? new Date();
  const rows = await database.execute(sql`
    with recovered_task as (
    update ${workflowTasks}
    set status = case
          when attempt_count < max_attempts then 'retry_wait'::public.workflow_task_status
          else 'dead'::public.workflow_task_status
        end,
        run_at = case
          when attempt_count < max_attempts
            then ${now} + (
              least(300, power(2, greatest(attempt_count - 1, 0)))
              * interval '1 second'
            )
          else run_at
        end,
        locked_by = null,
        locked_at = null,
        lease_expires_at = null,
        last_error_code = 'lease_expired',
        last_error_message = 'The previous worker lease expired before completion.',
        completed_at = case when attempt_count < max_attempts then null else ${now} end,
        updated_at = ${now}
    where status = 'running'
      and lease_expires_at <= ${now}
    returning id, status, kind, payload, workspace_id
    ), failed_match as (
      update ${campaignJobMatches} as match
      set pipeline_status = 'failed',
          failed_step = 'analyze-match',
          failure_code = 'lease_expired',
          updated_at = ${now}
      from recovered_task
      where recovered_task.status = 'dead'
        and recovered_task.kind = 'analyze-match'
        and match.workspace_id = recovered_task.workspace_id
        and match.id::text = recovered_task.payload ->> 'matchId'
        and match.analysis_input_hash = recovered_task.payload ->> 'inputHash'
      returning match.id
    ), rejected_job as (
      update ${jobs} as job
      set status = 'rejected', updated_at = ${now}
      from recovered_task
      where recovered_task.status = 'dead'
        and recovered_task.kind = 'normalize-job'
        and job.id::text = recovered_task.payload ->> 'jobId'
        and job.source_payload_hash = recovered_task.payload ->> 'sourcePayloadHash'
        and job.workspace_id = recovered_task.workspace_id
      returning job.id
    ), failed_monitor as (
      update ${upworkMonitors} as monitor
      set status = 'error',
          next_run_at = null,
          last_error_code = 'lease_expired',
          consecutive_failure_count = monitor.consecutive_failure_count + 1,
          updated_at = ${now}
      from recovered_task
      where recovered_task.status = 'dead'
        and recovered_task.kind = 'poll-upwork-monitor'
        and monitor.workspace_id = recovered_task.workspace_id
        and monitor.id::text = recovered_task.payload ->> 'monitorId'
        and monitor.schedule_version::text = recovered_task.payload ->> 'scheduleVersion'
        and monitor.next_run_sequence::text = recovered_task.payload ->> 'runSequence'
      returning monitor.id
    )
    select id from recovered_task
  `);
  return rows.length;
}

/**
 * Explicit operator retry for a dead task. This is intentionally not called
 * by ingestion or the worker's automatic retry path. It resets the matching
 * domain failure state in the same statement as the durable task intent.
 */
export async function retryDeadWorkflowTask(
  database: Database,
  input: {
    readonly workspaceId: string;
    readonly taskId: string;
    readonly now?: Date;
  },
): Promise<boolean> {
  const now = input.now ?? new Date();
  const workspaceId = uuidSchema.parse(input.workspaceId);
  const taskId = uuidSchema.parse(input.taskId);
  const rows = await database.execute(sql`
    with retried_task as (
      update ${workflowTasks}
      set status = 'queued',
          run_at = ${now},
          attempt_count = 0,
          locked_by = null,
          locked_at = null,
          lease_expires_at = null,
          last_error_code = null,
          last_error_message = null,
          completed_at = null,
          updated_at = ${now}
      where id = ${taskId}
        and workspace_id = ${workspaceId}
        and status = 'dead'
      returning id, kind, payload, workspace_id
    ), reset_match as (
      update ${campaignJobMatches} as match
      set pipeline_status = 'analysis_queued',
          failed_step = null,
          failure_code = null,
          updated_at = ${now}
      from retried_task
      where retried_task.kind = 'analyze-match'
        and match.workspace_id = retried_task.workspace_id
        and match.id::text = retried_task.payload ->> 'matchId'
        and match.analysis_input_hash = retried_task.payload ->> 'inputHash'
        and match.pipeline_status = 'failed'
      returning match.id
    ), reset_job as (
      update ${jobs} as job
      set status = 'received', updated_at = ${now}
      from retried_task
      where retried_task.kind = 'normalize-job'
        and job.id::text = retried_task.payload ->> 'jobId'
        and job.source_payload_hash = retried_task.payload ->> 'sourcePayloadHash'
        and job.workspace_id = retried_task.workspace_id
        and job.status = 'rejected'
      returning job.id
    ), reset_monitor as (
      update ${upworkMonitors} as monitor
      set status = 'active',
          next_run_at = ${now},
          last_error_code = null,
          updated_at = ${now}
      from retried_task
      where retried_task.kind = 'poll-upwork-monitor'
        and monitor.workspace_id = retried_task.workspace_id
        and monitor.id::text = retried_task.payload ->> 'monitorId'
        and monitor.schedule_version::text = retried_task.payload ->> 'scheduleVersion'
        and monitor.next_run_sequence::text = retried_task.payload ->> 'runSequence'
        and monitor.status = 'error'
      returning monitor.id
    )
    select id from retried_task
  `);
  return rows.length === 1;
}

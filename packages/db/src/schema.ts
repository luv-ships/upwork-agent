import type {
  CampaignFilterV1,
  DevelopmentJobInput,
  FilterEvidence,
  PreferenceScoreResult,
} from "@upwork-agent/core";
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

export type JsonPrimitive = boolean | number | string | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { readonly [key: string]: JsonValue };

const createdAt = timestamp("created_at", {
  withTimezone: true,
  mode: "date",
})
  .notNull()
  .defaultNow();

const updatedAt = timestamp("updated_at", {
  withTimezone: true,
  mode: "date",
})
  .notNull()
  .defaultNow();

export const campaignStatusEnum = pgEnum("campaign_status", [
  "draft",
  "active",
  "paused",
  "archived",
]);

export const jobStatusEnum = pgEnum("job_status", [
  "received",
  "normalizing",
  "ready",
  "rejected",
]);

export const experienceLevelEnum = pgEnum("job_experience_level", [
  "entry",
  "intermediate",
  "expert",
]);

export const jobTypeEnum = pgEnum("job_type", ["hourly", "fixed"]);

export const projectLengthBandEnum = pgEnum("project_length_band", [
  "under_1_month",
  "one_to_three_months",
  "three_to_six_months",
  "over_6_months",
]);

export const hoursPerWeekBandEnum = pgEnum("hours_per_week_band", [
  "under_30",
  "over_30",
]);

export const matchPipelineStatusEnum = pgEnum("match_pipeline_status", [
  "matched",
  "analysis_queued",
  "analyzing",
  "low_fit",
  "qualified",
  "proposal_queued",
  "generating_proposal",
  "ready_for_review",
  "failed",
  "dismissed",
  "expired",
]);

export const suitabilityRecommendationEnum = pgEnum(
  "suitability_recommendation",
  ["apply", "review", "skip"],
);

export const pricingDirectionEnum = pgEnum("pricing_direction", [
  "below_market",
  "market",
  "premium",
  "hourly",
]);

export const workflowTaskKindEnum = pgEnum("workflow_task_kind", [
  "normalize-job",
  "match-job",
  "analyze-match",
  "poll-upwork-monitor",
  "purge-upwork-data",
  "index-knowledge-doc",
  "generate-proposal",
]);

export const knowledgeDocumentStatusEnum = pgEnum("knowledge_document_status", [
  "pending",
  "ready",
  "failed",
]);

export const proposalStatusEnum = pgEnum("proposal_status", [
  "queued",
  "generating",
  "ready_for_review",
  "approved",
  "rejected",
  "failed",
]);

export const upworkConnectionStatusEnum = pgEnum("upwork_connection_status", [
  "fake",
  "authorizing",
  "connected",
  "reconnect_required",
  "disabled",
]);

export const upworkMonitorStatusEnum = pgEnum("upwork_monitor_status", [
  "active",
  "paused",
  "error",
]);

export const workflowTaskStatusEnum = pgEnum("workflow_task_status", [
  "queued",
  "running",
  "retry_wait",
  "succeeded",
  "dead",
  "cancelled",
]);

export const workspaces = pgTable(
  "workspaces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // The reviewed SQL migration owns this cross-schema FK to auth.users.
    // Keeping auth.users out of the Drizzle export prevents schema generation
    // from ever attempting to create or alter Supabase's canonical auth table.
    ownerUserId: uuid("owner_user_id").notNull(),
    name: text("name").notNull(),
    createdAt,
    updatedAt,
  },
  (table) => [
    unique("workspaces_owner_user_id_key").on(table.ownerUserId),
    unique("workspaces_id_owner_user_id_key").on(table.id, table.ownerUserId),
    check(
      "workspaces_name_length_check",
      sql`char_length(btrim(${table.name})) between 1 and 120`,
    ),
  ],
);

export const campaigns = pgTable(
  "campaigns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    status: campaignStatusEnum("status").notNull().default("draft"),
    filters: jsonb("filters").$type<CampaignFilterV1>().notNull(),
    aiInstructions: text("ai_instructions").notNull().default(""),
    scoreThreshold: smallint("score_threshold").notNull().default(75),
    configVersion: integer("config_version").notNull().default(1),
    createdAt,
    updatedAt,
  },
  (table) => [
    unique("campaigns_workspace_id_id_key").on(table.workspaceId, table.id),
    index("campaigns_workspace_status_idx").on(table.workspaceId, table.status),
    index("campaigns_active_workspace_idx")
      .on(table.workspaceId, table.updatedAt)
      .where(sql`${table.status} = 'active'`),
    check(
      "campaigns_name_length_check",
      sql`char_length(btrim(${table.name})) between 1 and 160`,
    ),
    check(
      "campaigns_filters_object_check",
      sql`jsonb_typeof(${table.filters}) = 'object'`,
    ),
    check(
      "campaigns_score_threshold_check",
      sql`${table.scoreThreshold} between 0 and 100`,
    ),
    check(
      "campaigns_config_version_check",
      sql`${table.configVersion} >= 1`,
    ),
  ],
);

export const upworkConnections = pgTable(
  "upwork_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    status: upworkConnectionStatusEnum("status").notNull().default("disabled"),
    accountId: text("account_id"),
    credentialRef: text("credential_ref"),
    approvalReference: text("approval_reference"),
    nextRequestAt: timestamp("next_request_at", {
      withTimezone: true,
      mode: "date",
    }),
    purgeScheduleVersion: integer("purge_schedule_version").notNull().default(1),
    nextPurgeSequence: integer("next_purge_sequence").notNull().default(1),
    nextPurgeAt: timestamp("next_purge_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
    createdAt,
    updatedAt,
  },
  (table) => [
    unique("upwork_connections_workspace_id_key").on(table.workspaceId),
    unique("upwork_connections_workspace_id_id_key").on(
      table.workspaceId,
      table.id,
    ),
    check(
      "upwork_connections_account_id_length_check",
      sql`${table.accountId} is null or char_length(btrim(${table.accountId})) between 1 and 200`,
    ),
    check(
      "upwork_connections_credential_ref_length_check",
      sql`${table.credentialRef} is null or char_length(btrim(${table.credentialRef})) between 1 and 500`,
    ),
    check(
      "upwork_connections_approval_reference_length_check",
      sql`${table.approvalReference} is null or char_length(btrim(${table.approvalReference})) between 1 and 500`,
    ),
    check(
      "upwork_connections_fake_has_no_credential_check",
      sql`${table.status} <> 'fake' or ${table.credentialRef} is null`,
    ),
    check(
      "upwork_connections_purge_schedule_version_check",
      sql`${table.purgeScheduleVersion} >= 1`,
    ),
    check(
      "upwork_connections_purge_sequence_check",
      sql`${table.nextPurgeSequence} >= 1`,
    ),
  ],
);

/**
 * Ciphertext only. OAuth access/refresh tokens and dynamic-client material are
 * never represented as database columns or browser-readable data.
 */
export const upworkOAuthCredentials = pgTable(
  "upwork_oauth_credentials",
  {
    connectionId: uuid("connection_id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    encryptedPayload: text("encrypted_payload").notNull(),
    keyVersion: smallint("key_version").notNull().default(1),
    createdAt,
    updatedAt,
  },
  (table) => [
    foreignKey({
      name: "upwork_oauth_credentials_workspace_connection_fk",
      columns: [table.workspaceId, table.connectionId],
      foreignColumns: [upworkConnections.workspaceId, upworkConnections.id],
    }).onDelete("cascade"),
    check(
      "upwork_oauth_credentials_encrypted_payload_length_check",
      sql`char_length(${table.encryptedPayload}) between 1 and 100000`,
    ),
    check(
      "upwork_oauth_credentials_key_version_check",
      sql`${table.keyVersion} = 1`,
    ),
  ],
);

/**
 * One durable, encrypted OAuth browser-flow session per workspace connection.
 * The lookup key is a hash of the OAuth state; state, PKCE verifier, dynamic
 * client information, and discovery metadata remain ciphertext only.
 */
export const upworkOAuthAuthorizations = pgTable(
  "upwork_oauth_authorizations",
  {
    connectionId: uuid("connection_id").primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    stateHash: text("state_hash"),
    encryptedPayload: text("encrypted_payload").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
    consumedAt: timestamp("consumed_at", { withTimezone: true, mode: "date" }),
    createdAt,
    updatedAt,
  },
  (table) => [
    foreignKey({
      name: "upwork_oauth_authorizations_workspace_connection_fk",
      columns: [table.workspaceId, table.connectionId],
      foreignColumns: [upworkConnections.workspaceId, upworkConnections.id],
    }).onDelete("cascade"),
    uniqueIndex("upwork_oauth_authorizations_active_state_hash_key")
      .on(table.stateHash)
      .where(sql`${table.stateHash} is not null`),
    check(
      "upwork_oauth_authorizations_state_hash_length_check",
      sql`${table.stateHash} is null or char_length(${table.stateHash}) = 43`,
    ),
    check(
      "upwork_oauth_authorizations_encrypted_payload_length_check",
      sql`char_length(${table.encryptedPayload}) between 1 and 100000`,
    ),
  ],
);

export const upworkMonitors = pgTable(
  "upwork_monitors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id").notNull(),
    connectionId: uuid("connection_id").notNull(),
    status: upworkMonitorStatusEnum("status").notNull().default("paused"),
    pollIntervalSeconds: integer("poll_interval_seconds").notNull().default(300),
    retentionDays: smallint("retention_days").notNull().default(30),
    scheduleVersion: integer("schedule_version").notNull().default(1),
    nextRunSequence: integer("next_run_sequence").notNull().default(1),
    nextCursor: text("next_cursor"),
    nextRunAt: timestamp("next_run_at", {
      withTimezone: true,
      mode: "date",
    }),
    lastSuccessAt: timestamp("last_success_at", {
      withTimezone: true,
      mode: "date",
    }),
    lastErrorCode: text("last_error_code"),
    consecutiveFailureCount: integer("consecutive_failure_count").notNull().default(0),
    createdAt,
    updatedAt,
  },
  (table) => [
    foreignKey({
      name: "upwork_monitors_workspace_campaign_fk",
      columns: [table.workspaceId, table.campaignId],
      foreignColumns: [campaigns.workspaceId, campaigns.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "upwork_monitors_workspace_connection_fk",
      columns: [table.workspaceId, table.connectionId],
      foreignColumns: [upworkConnections.workspaceId, upworkConnections.id],
    }).onDelete("cascade"),
    unique("upwork_monitors_campaign_id_key").on(table.campaignId),
    unique("upwork_monitors_workspace_id_id_key").on(table.workspaceId, table.id),
    index("upwork_monitors_due_idx")
      .on(table.nextRunAt)
      .where(sql`${table.status} = 'active'`),
    check(
      "upwork_monitors_poll_interval_check",
      sql`${table.pollIntervalSeconds} between 60 and 86400`,
    ),
    check(
      "upwork_monitors_retention_days_check",
      sql`${table.retentionDays} = 30`,
    ),
    check(
      "upwork_monitors_schedule_version_check",
      sql`${table.scheduleVersion} >= 1`,
    ),
    check(
      "upwork_monitors_run_sequence_check",
      sql`${table.nextRunSequence} >= 1`,
    ),
    check(
      "upwork_monitors_next_cursor_length_check",
      sql`${table.nextCursor} is null or char_length(${table.nextCursor}) between 1 and 10000`,
    ),
    check(
      "upwork_monitors_failure_count_check",
      sql`${table.consecutiveFailureCount} >= 0`,
    ),
    check(
      "upwork_monitors_active_schedule_check",
      sql`(${table.status} = 'active') = (${table.nextRunAt} is not null)`,
    ),
  ],
);

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").notNull(),
    source: text("source").notNull(),
    sourceJobId: text("source_job_id").notNull(),
    canonicalUrl: text("canonical_url"),
    postedAt: timestamp("posted_at", {
      withTimezone: true,
      mode: "date",
    }),
    rawPayload: jsonb("raw_payload").$type<DevelopmentJobInput>().notNull(),
    sourcePayloadHash: text("source_payload_hash").notNull(),
    normalizedHash: text("normalized_hash"),
    revision: integer("revision").notNull().default(0),
    lastMatchedRevision: integer("last_matched_revision").notNull().default(0),
    status: jobStatusEnum("status").notNull().default("received"),
    title: text("title"),
    description: text("description"),
    skills: jsonb("skills").$type<string[]>(),
    categoryIds: jsonb("category_ids").$type<string[]>(),
    experienceLevel: experienceLevelEnum("experience_level"),
    jobType: jobTypeEnum("job_type"),
    hourlyRateMin: numeric("hourly_rate_min", { precision: 14, scale: 2 }),
    hourlyRateMax: numeric("hourly_rate_max", { precision: 14, scale: 2 }),
    fixedBudgetMin: numeric("fixed_budget_min", { precision: 14, scale: 2 }),
    fixedBudgetMax: numeric("fixed_budget_max", { precision: 14, scale: 2 }),
    proposalCount: integer("proposal_count"),
    paymentVerified: boolean("payment_verified"),
    clientCountryCode: text("client_country_code"),
    clientTimeZone: text("client_time_zone"),
    clientHireCount: integer("client_hire_count"),
    clientHireRatePercent: smallint("client_hire_rate_percent"),
    projectLengthBand: projectLengthBandEnum("project_length_band"),
    hoursPerWeekBand: hoursPerWeekBandEnum("hours_per_week_band"),
    isContractToHire: boolean("is_contract_to_hire"),
    lastSeenAt: timestamp("last_seen_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
    createdAt,
    updatedAt,
  },
  (table) => [
    foreignKey({
      name: "jobs_workspace_fk",
      columns: [table.workspaceId],
      foreignColumns: [workspaces.id],
    }).onDelete("cascade"),
    unique("jobs_workspace_id_id_key").on(table.workspaceId, table.id),
    unique("jobs_source_source_job_id_key").on(table.source, table.sourceJobId),
    index("jobs_workspace_source_last_seen_idx").on(
      table.workspaceId,
      table.source,
      table.lastSeenAt,
    ),
    index("jobs_workspace_source_posted_idx").on(
      table.workspaceId,
      table.source,
      table.postedAt.desc(),
    ),
    index("jobs_last_seen_at_idx").on(table.lastSeenAt.desc()),
    check(
      "jobs_source_length_check",
      sql`char_length(btrim(${table.source})) between 1 and 80`,
    ),
    check(
      "jobs_source_job_id_length_check",
      sql`char_length(btrim(${table.sourceJobId})) between 1 and 300`,
    ),
    check(
      "jobs_raw_payload_object_check",
      sql`jsonb_typeof(${table.rawPayload}) = 'object'`,
    ),
    check(
      "jobs_source_payload_hash_check",
      sql`${table.sourcePayloadHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "jobs_normalized_hash_check",
      sql`${table.normalizedHash} is null or ${table.normalizedHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      "jobs_ready_shape_check",
      sql`${table.status} <> 'ready' or (${table.normalizedHash} is not null and ${table.revision} >= 1 and ${table.title} is not null and char_length(btrim(${table.title})) between 1 and 300 and ${table.description} is not null and char_length(btrim(${table.description})) >= 1 and ${table.skills} is not null and jsonb_typeof(${table.skills}) = 'array' and ${table.categoryIds} is not null and jsonb_typeof(${table.categoryIds}) = 'array' and ${table.jobType} is not null)`,
    ),
    check("jobs_revision_check", sql`${table.revision} >= 0`),
    check(
      "jobs_last_matched_revision_check",
      sql`${table.lastMatchedRevision} between 0 and ${table.revision}`,
    ),
    check(
      "jobs_skills_array_check",
      sql`${table.skills} is null or jsonb_typeof(${table.skills}) = 'array'`,
    ),
    check(
      "jobs_category_ids_array_check",
      sql`${table.categoryIds} is null or jsonb_typeof(${table.categoryIds}) = 'array'`,
    ),
    check(
      "jobs_hourly_range_check",
      sql`${table.hourlyRateMin} is null or ${table.hourlyRateMax} is null or ${table.hourlyRateMin} <= ${table.hourlyRateMax}`,
    ),
    check(
      "jobs_fixed_range_check",
      sql`${table.fixedBudgetMin} is null or ${table.fixedBudgetMax} is null or ${table.fixedBudgetMin} <= ${table.fixedBudgetMax}`,
    ),
    check(
      "jobs_nonnegative_values_check",
      sql`coalesce(${table.hourlyRateMin}, 0) >= 0 and coalesce(${table.hourlyRateMax}, 0) >= 0 and coalesce(${table.fixedBudgetMin}, 0) >= 0 and coalesce(${table.fixedBudgetMax}, 0) >= 0 and coalesce(${table.proposalCount}, 0) >= 0 and coalesce(${table.clientHireCount}, 0) >= 0`,
    ),
    check(
      "jobs_client_hire_rate_percent_check",
      sql`${table.clientHireRatePercent} is null or ${table.clientHireRatePercent} between 0 and 100`,
    ),
    check(
      "jobs_client_country_code_check",
      sql`${table.clientCountryCode} is null or ${table.clientCountryCode} ~ '^[A-Z]{2}$'`,
    ),
  ],
);

/**
 * Records which monitor actually discovered an Upwork job. A job row is
 * intentionally de-duplicated at workspace scope, but matching must remain
 * campaign-scoped so one monitor cannot grant another campaign an unrelated
 * discovery.
 */
export const upworkJobObservations = pgTable(
  "upwork_job_observations",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    monitorId: uuid("monitor_id").notNull(),
    jobId: uuid("job_id").notNull(),
    firstSeenAt: timestamp("first_seen_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
    lastSeenAt: timestamp("last_seen_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({
      name: "upwork_job_observations_workspace_monitor_job_pk",
      columns: [table.workspaceId, table.monitorId, table.jobId],
    }),
    foreignKey({
      name: "upwork_job_observations_workspace_monitor_fk",
      columns: [table.workspaceId, table.monitorId],
      foreignColumns: [upworkMonitors.workspaceId, upworkMonitors.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "upwork_job_observations_workspace_job_fk",
      columns: [table.workspaceId, table.jobId],
      foreignColumns: [jobs.workspaceId, jobs.id],
    }).onDelete("cascade"),
    index("upwork_job_observations_workspace_job_idx").on(
      table.workspaceId,
      table.jobId,
      table.lastSeenAt.desc(),
    ),
    index("upwork_job_observations_workspace_monitor_idx").on(
      table.workspaceId,
      table.monitorId,
      table.lastSeenAt.desc(),
    ),
  ],
);

export const campaignJobMatches = pgTable(
  "campaign_job_matches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id").notNull(),
    jobId: uuid("job_id").notNull(),
    campaignConfigVersion: integer("campaign_config_version").notNull(),
    jobRevision: integer("job_revision").notNull(),
    filterSnapshot: jsonb("filter_snapshot")
      .$type<CampaignFilterV1>()
      .notNull(),
    aiInstructionsSnapshot: text("ai_instructions_snapshot").notNull(),
    scoreThresholdSnapshot: smallint("score_threshold_snapshot").notNull(),
    deterministicEvidence: jsonb("deterministic_evidence")
      .$type<FilterEvidence>()
      .notNull(),
    preferenceScore: smallint("preference_score").notNull(),
    preferenceScoreVersion: integer("preference_score_version").notNull().default(1),
    preferenceScoreEvidence: jsonb("preference_score_evidence")
      .$type<PreferenceScoreResult>()
      .notNull(),
    analysisInputHash: text("analysis_input_hash").notNull(),
    pipelineStatus: matchPipelineStatusEnum("pipeline_status")
      .notNull()
      .default("matched"),
    failedStep: text("failed_step"),
    failureCode: text("failure_code"),
    createdAt,
    updatedAt,
  },
  (table) => [
    foreignKey({
      name: "campaign_job_matches_workspace_campaign_fk",
      columns: [table.workspaceId, table.campaignId],
      foreignColumns: [campaigns.workspaceId, campaigns.id],
    }).onDelete("cascade"),
    foreignKey({
      name: "campaign_job_matches_workspace_job_fk",
      columns: [table.workspaceId, table.jobId],
      foreignColumns: [jobs.workspaceId, jobs.id],
    }).onDelete("cascade"),
    unique("campaign_job_matches_workspace_id_id_key").on(
      table.workspaceId,
      table.id,
    ),
    unique("campaign_job_matches_campaign_id_job_id_key").on(
      table.campaignId,
      table.jobId,
    ),
    index("campaign_job_matches_workspace_status_created_idx").on(
      table.workspaceId,
      table.pipelineStatus,
      table.createdAt.desc(),
    ),
    check(
      "campaign_job_matches_config_version_check",
      sql`${table.campaignConfigVersion} >= 1`,
    ),
    check(
      "campaign_job_matches_job_revision_check",
      sql`${table.jobRevision} >= 1`,
    ),
    check(
      "campaign_job_matches_filter_snapshot_object_check",
      sql`jsonb_typeof(${table.filterSnapshot}) = 'object'`,
    ),
    check(
      "campaign_job_matches_evidence_object_check",
      sql`jsonb_typeof(${table.deterministicEvidence}) = 'object'`,
    ),
    check(
      "campaign_job_matches_preference_score_check",
      sql`${table.preferenceScore} between 0 and 100`,
    ),
    check(
      "campaign_job_matches_preference_score_version_check",
      sql`${table.preferenceScoreVersion} = 1`,
    ),
    check(
      "campaign_job_matches_preference_evidence_object_check",
      sql`jsonb_typeof(${table.preferenceScoreEvidence}) = 'object'`,
    ),
    check(
      "campaign_job_matches_score_threshold_check",
      sql`${table.scoreThresholdSnapshot} between 0 and 100`,
    ),
    check(
      "campaign_job_matches_analysis_input_hash_check",
      sql`${table.analysisInputHash} ~ '^[0-9a-f]{64}$'`,
    ),
  ],
);

export const aiScores = pgTable(
  "ai_scores",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    matchId: uuid("match_id").notNull(),
    inputHash: text("input_hash").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    providerRequestKey: text("provider_request_key").notNull(),
    score: smallint("score").notNull(),
    recommendation: suitabilityRecommendationEnum("recommendation").notNull(),
    reasons: jsonb("reasons").$type<string[]>().notNull(),
    risks: jsonb("risks").$type<string[]>().notNull(),
    estimatedWinProbability: numeric("estimated_win_probability", {
      precision: 5,
      scale: 4,
    }).notNull(),
    pricingDirection: pricingDirectionEnum("pricing_direction").notNull(),
    suggestedBidAmount: numeric("suggested_bid_amount", {
      precision: 14,
      scale: 2,
    }),
    suggestedBidCurrency: text("suggested_bid_currency"),
    createdAt,
  },
  (table) => [
    foreignKey({
      name: "ai_scores_workspace_match_fk",
      columns: [table.workspaceId, table.matchId],
      foreignColumns: [
        campaignJobMatches.workspaceId,
        campaignJobMatches.id,
      ],
    }).onDelete("cascade"),
    unique("ai_scores_match_id_input_hash_key").on(
      table.matchId,
      table.inputHash,
    ),
    unique("ai_scores_provider_request_key_key").on(table.providerRequestKey),
    index("ai_scores_match_created_idx").on(
      table.matchId,
      table.createdAt.desc(),
    ),
    check(
      "ai_scores_input_hash_check",
      sql`${table.inputHash} ~ '^[0-9a-f]{64}$'`,
    ),
    check("ai_scores_score_check", sql`${table.score} between 0 and 100`),
    check(
      "ai_scores_reasons_array_check",
      sql`jsonb_typeof(${table.reasons}) = 'array'`,
    ),
    check(
      "ai_scores_risks_array_check",
      sql`jsonb_typeof(${table.risks}) = 'array'`,
    ),
    check(
      "ai_scores_probability_check",
      sql`${table.estimatedWinProbability} between 0 and 1`,
    ),
    check(
      "ai_scores_currency_check",
      sql`${table.suggestedBidCurrency} is null or ${table.suggestedBidCurrency} ~ '^[A-Z]{3}$'`,
    ),
    check(
      "ai_scores_bid_pair_check",
      sql`(${table.suggestedBidAmount} is null) = (${table.suggestedBidCurrency} is null)`,
    ),
    check(
      "ai_scores_nonnegative_bid_check",
      sql`${table.suggestedBidAmount} is null or ${table.suggestedBidAmount} >= 0`,
    ),
  ],
);

export const knowledgeDocuments = pgTable(
  "knowledge_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    content: text("content").notNull(),
    contentHash: text("content_hash").notNull(),
    status: knowledgeDocumentStatusEnum("status").notNull().default("pending"),
    failureCode: text("failure_code"),
    createdAt,
    updatedAt,
  },
  (table) => [
    unique("knowledge_documents_workspace_id_id_key").on(table.workspaceId, table.id),
    unique("knowledge_documents_workspace_hash_key").on(table.workspaceId, table.contentHash),
    index("knowledge_documents_workspace_status_idx").on(table.workspaceId, table.status),
    check("knowledge_documents_title_length_check", sql`char_length(btrim(${table.title})) between 1 and 200`),
    check("knowledge_documents_content_length_check", sql`char_length(${table.content}) between 1 and 200000`),
    check("knowledge_documents_hash_check", sql`${table.contentHash} ~ '^[0-9a-f]{64}$'`),
  ],
);

export const knowledgeChunks = pgTable(
  "knowledge_chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    documentId: uuid("document_id").notNull(),
    ordinal: integer("ordinal").notNull(),
    content: text("content").notNull(),
    contentHash: text("content_hash").notNull(),
    embedding: vector("embedding", { dimensions: 1536 }),
    embeddingModel: text("embedding_model"),
    createdAt,
  },
  (table) => [
    foreignKey({
      name: "knowledge_chunks_workspace_document_fk",
      columns: [table.workspaceId, table.documentId],
      foreignColumns: [knowledgeDocuments.workspaceId, knowledgeDocuments.id],
    }).onDelete("cascade"),
    unique("knowledge_chunks_workspace_id_id_key").on(table.workspaceId, table.id),
    unique("knowledge_chunks_document_ordinal_key").on(table.documentId, table.ordinal),
    index("knowledge_chunks_workspace_document_idx").on(table.workspaceId, table.documentId, table.ordinal),
    check("knowledge_chunks_ordinal_check", sql`${table.ordinal} >= 0`),
    check("knowledge_chunks_content_length_check", sql`char_length(${table.content}) between 1 and 4000`),
    check("knowledge_chunks_hash_check", sql`${table.contentHash} ~ '^[0-9a-f]{64}$'`),
    check("knowledge_chunks_embedding_pair_check", sql`(${table.embedding} is null) = (${table.embeddingModel} is null)`),
  ],
);

export const proposals = pgTable(
  "proposals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    matchId: uuid("match_id").notNull(),
    status: proposalStatusEnum("status").notNull().default("queued"),
    currentVersion: integer("current_version").notNull().default(0),
    failureCode: text("failure_code"),
    createdAt,
    updatedAt,
  },
  (table) => [
    foreignKey({
      name: "proposals_workspace_match_fk",
      columns: [table.workspaceId, table.matchId],
      foreignColumns: [campaignJobMatches.workspaceId, campaignJobMatches.id],
    }).onDelete("cascade"),
    unique("proposals_workspace_id_id_key").on(table.workspaceId, table.id),
    unique("proposals_workspace_match_key").on(table.workspaceId, table.matchId),
    check("proposals_current_version_check", sql`${table.currentVersion} >= 0`),
  ],
);

export const proposalVersions = pgTable(
  "proposal_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    proposalId: uuid("proposal_id").notNull(),
    version: integer("version").notNull(),
    body: text("body").notNull(),
    sourceChunkIds: jsonb("source_chunk_ids").$type<string[]>().notNull().default([]),
    generationInputHash: text("generation_input_hash").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    promptVersion: text("prompt_version").notNull(),
    suggestedBidAmount: numeric("suggested_bid_amount", { precision: 14, scale: 2 }),
    suggestedBidCurrency: text("suggested_bid_currency"),
    createdAt,
  },
  (table) => [
    foreignKey({
      name: "proposal_versions_workspace_proposal_fk",
      columns: [table.workspaceId, table.proposalId],
      foreignColumns: [proposals.workspaceId, proposals.id],
    }).onDelete("cascade"),
    unique("proposal_versions_workspace_id_id_key").on(table.workspaceId, table.id),
    unique("proposal_versions_proposal_version_key").on(table.proposalId, table.version),
    unique("proposal_versions_generation_input_hash_key").on(table.proposalId, table.generationInputHash),
    index("proposal_versions_workspace_created_idx").on(table.workspaceId, table.createdAt.desc()),
    check("proposal_versions_version_check", sql`${table.version} >= 1`),
    check("proposal_versions_body_length_check", sql`char_length(btrim(${table.body})) between 1 and 12000`),
    check("proposal_versions_hash_check", sql`${table.generationInputHash} ~ '^[0-9a-f]{64}$'`),
    check("proposal_versions_source_chunks_array_check", sql`jsonb_typeof(${table.sourceChunkIds}) = 'array'`),
    check("proposal_versions_currency_check", sql`${table.suggestedBidCurrency} is null or ${table.suggestedBidCurrency} ~ '^[A-Z]{3}$'`),
    check("proposal_versions_bid_pair_check", sql`(${table.suggestedBidAmount} is null) = (${table.suggestedBidCurrency} is null)`),
  ],
);

export const workflowTasks = pgTable(
  "workflow_tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    kind: workflowTaskKindEnum("kind").notNull(),
    schemaVersion: smallint("schema_version").notNull().default(1),
    payload: jsonb("payload").$type<JsonObject>().notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    status: workflowTaskStatusEnum("status").notNull().default("queued"),
    priority: smallint("priority").notNull().default(0),
    runAt: timestamp("run_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    attemptCount: integer("attempt_count").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    lockedBy: text("locked_by"),
    lockedAt: timestamp("locked_at", { withTimezone: true, mode: "date" }),
    leaseExpiresAt: timestamp("lease_expires_at", {
      withTimezone: true,
      mode: "date",
    }),
    lastErrorCode: text("last_error_code"),
    lastErrorMessage: text("last_error_message"),
    completedAt: timestamp("completed_at", {
      withTimezone: true,
      mode: "date",
    }),
    createdAt,
    updatedAt,
  },
  (table) => [
    unique("workflow_tasks_kind_dedupe_key_key").on(
      table.kind,
      table.dedupeKey,
    ),
    index("workflow_tasks_claim_idx")
      .on(table.priority.desc(), table.runAt, table.createdAt)
      .where(sql`${table.status} in ('queued', 'retry_wait')`),
    index("workflow_tasks_lease_expiry_idx")
      .on(table.leaseExpiresAt)
      .where(sql`${table.status} = 'running'`),
    index("workflow_tasks_workspace_status_idx").on(
      table.workspaceId,
      table.status,
    ),
    check(
      "workflow_tasks_payload_object_check",
      sql`jsonb_typeof(${table.payload}) = 'object'`,
    ),
    check(
      "workflow_tasks_schema_version_check",
      sql`${table.schemaVersion} = 1`,
    ),
    check(
      "workflow_tasks_attempts_check",
      sql`${table.attemptCount} >= 0 and ${table.maxAttempts} >= 1`,
    ),
    check(
      "workflow_tasks_lock_consistency_check",
      sql`(${table.status} = 'running' and ${table.lockedBy} is not null and ${table.lockedAt} is not null and ${table.leaseExpiresAt} is not null) or (${table.status} <> 'running' and ${table.lockedBy} is null and ${table.lockedAt} is null and ${table.leaseExpiresAt} is null)`,
    ),
    check(
      "workflow_tasks_completion_consistency_check",
      sql`(${table.status} in ('succeeded', 'dead', 'cancelled')) = (${table.completedAt} is not null)`,
    ),
  ],
);

export const analyticsEvents = pgTable(
  "analytics_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    // The reviewed SQL migration owns this cross-schema FK to auth.users.
    actorUserId: uuid("actor_user_id"),
    eventName: text("event_name").notNull(),
    subjectType: text("subject_type").notNull(),
    subjectId: uuid("subject_id").notNull(),
    properties: jsonb("properties").$type<JsonObject>().notNull().default({}),
    occurredAt: timestamp("occurred_at", {
      withTimezone: true,
      mode: "date",
    })
      .notNull()
      .defaultNow(),
    dedupeKey: text("dedupe_key"),
    createdAt,
  },
  (table) => [
    foreignKey({
      name: "analytics_events_workspace_actor_fk",
      columns: [table.workspaceId, table.actorUserId],
      foreignColumns: [workspaces.id, workspaces.ownerUserId],
    }),
    index("analytics_events_workspace_occurred_idx").on(
      table.workspaceId,
      table.occurredAt.desc(),
    ),
    uniqueIndex("analytics_events_workspace_dedupe_key_idx")
      .on(table.workspaceId, table.dedupeKey)
      .where(sql`${table.dedupeKey} is not null`),
    check(
      "analytics_events_properties_object_check",
      sql`jsonb_typeof(${table.properties}) = 'object'`,
    ),
    check(
      "analytics_events_event_name_check",
      sql`${table.eventName} ~ '^[a-z][a-z0-9_.-]{0,99}$'`,
    ),
    check(
      "analytics_events_subject_type_check",
      sql`${table.subjectType} ~ '^[a-z][a-z0-9_-]{0,49}$'`,
    ),
  ],
);

export type WorkspaceRow = typeof workspaces.$inferSelect;
export type CampaignRow = typeof campaigns.$inferSelect;
export type UpworkConnectionRow = typeof upworkConnections.$inferSelect;
export type UpworkOAuthAuthorizationRow = typeof upworkOAuthAuthorizations.$inferSelect;
export type UpworkOAuthCredentialRow = typeof upworkOAuthCredentials.$inferSelect;
export type UpworkMonitorRow = typeof upworkMonitors.$inferSelect;
export type JobRow = typeof jobs.$inferSelect;
export type UpworkJobObservationRow = typeof upworkJobObservations.$inferSelect;
export type CampaignJobMatchRow = typeof campaignJobMatches.$inferSelect;
export type KnowledgeDocumentRow = typeof knowledgeDocuments.$inferSelect;
export type KnowledgeChunkRow = typeof knowledgeChunks.$inferSelect;
export type ProposalRow = typeof proposals.$inferSelect;
export type ProposalVersionRow = typeof proposalVersions.$inferSelect;
export type AiScoreRow = typeof aiScores.$inferSelect;
export type WorkflowTaskRow = typeof workflowTasks.$inferSelect;
export type AnalyticsEventRow = typeof analyticsEvents.$inferSelect;

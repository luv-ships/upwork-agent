import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  campaignJobMatches,
  campaigns,
  jobs,
  upworkConnections,
  upworkOAuthAuthorizations,
  upworkOAuthCredentials,
  upworkJobObservations,
  upworkMonitors,
  knowledgeDocuments,
  knowledgeChunks,
  proposals,
  proposalVersions,
  workflowTasks,
} from "../src/schema.js";

const migrationPath = fileURLToPath(
  new URL(
    "../../../supabase/migrations/202608120001_phase1_score_loop.sql",
    import.meta.url,
  ),
);
const monitorMigrationPath = fileURLToPath(
  new URL(
    "../../../supabase/migrations/202608150001_phase2_upwork_monitor.sql",
    import.meta.url,
  ),
);
const retentionMigrationPath = fileURLToPath(
  new URL(
    "../../../supabase/migrations/202608160001_upwork_retention.sql",
    import.meta.url,
  ),
);
const retentionSeedMigrationPath = fileURLToPath(
  new URL(
    "../../../supabase/migrations/202608160002_seed_upwork_retention_tasks.sql",
    import.meta.url,
  ),
);
const oauthCredentialMigrationPath = fileURLToPath(
  new URL(
    "../../../supabase/migrations/202608160003_upwork_oauth_credentials.sql",
    import.meta.url,
  ),
);
const oauthAuthorizationMigrationPath = fileURLToPath(
  new URL(
    "../../../supabase/migrations/202608170001_upwork_oauth_authorizations.sql",
    import.meta.url,
  ),
);
const observationMigrationPath = fileURLToPath(
  new URL(
    "../../../supabase/migrations/202608180001_upwork_job_observations.sql",
    import.meta.url,
  ),
);
const postedAtMigrationPath = fileURLToPath(
  new URL(
    "../../../supabase/migrations/202608180002_upwork_job_posted_at.sql",
    import.meta.url,
  ),
);
const cursorMigrationPath = fileURLToPath(
  new URL(
    "../../../supabase/migrations/202608180003_upwork_monitor_cursor.sql",
    import.meta.url,
  ),
);
const hireRateMigrationPath = fileURLToPath(
  new URL(
    "../../../supabase/migrations/202608180004_upwork_client_hire_rate.sql",
    import.meta.url,
  ),
);
const proposalMigrationPath = fileURLToPath(
  new URL(
    "../../../supabase/migrations/202608180005_phase1_proposals.sql",
    import.meta.url,
  ),
);
const embeddingMigrationPath = fileURLToPath(
  new URL(
    "../../../supabase/migrations/202608210001_knowledge_embeddings.sql",
    import.meta.url,
  ),
);

describe("Phase 1 persistence contracts", () => {
  it("keeps the Drizzle workflow vocabulary aligned with the core contract", () => {
    expect(workflowTasks.kind.enumValues).toEqual([
      "normalize-job",
      "match-job",
      "analyze-match",
      "poll-upwork-monitor",
      "purge-upwork-data",
      "index-knowledge-doc",
      "generate-proposal",
    ]);
    expect(workflowTasks.status.enumValues).toEqual([
      "queued",
      "running",
      "retry_wait",
      "succeeded",
      "dead",
      "cancelled",
    ]);
    expect(campaigns.status.enumValues).toEqual([
      "draft",
      "active",
      "paused",
      "archived",
    ]);
    expect(jobs.status.enumValues).toEqual([
      "received",
      "normalizing",
      "ready",
      "rejected",
    ]);
    expect(campaignJobMatches.pipelineStatus.enumValues).toContain("low_fit");
    expect(campaignJobMatches.pipelineStatus.enumValues).toContain(
      "qualified",
    );
  });

  it("keeps Upwork monitoring tenant-owned and fail-closed", async () => {
    const migration = await readFile(monitorMigrationPath, "utf8");

    expect(upworkConnections.status.enumValues).toEqual([
      "fake",
      "authorizing",
      "connected",
      "reconnect_required",
      "disabled",
    ]);
    expect(upworkMonitors.status.enumValues).toEqual([
      "active",
      "paused",
      "error",
    ]);
    expect(migration).toContain("constraint upwork_connections_workspace_id_key unique");
    expect(migration).toContain("constraint upwork_monitors_workspace_campaign_fk");
    expect(migration).toContain("constraint upwork_monitors_active_schedule_check");
    expect(migration).toContain("upwork_monitors_due_idx");
    expect(migration).toContain(
      "alter table public.upwork_connections enable row level security;",
    );
    expect(migration).toContain(
      "alter table public.upwork_monitors enable row level security;",
    );
    expect(migration).toContain(
      "revoke all on table public.upwork_connections from anon, authenticated;",
    );
    expect(migration).toContain(
      "revoke all on table public.upwork_monitors from anon, authenticated;",
    );
    expect(migration).not.toMatch(/access_token|refresh_token|browser_cookie/i);
    expect(migration).not.toMatch(/create\s+policy/i);
  });

  it("persists versioned preference scores with bounded evidence", async () => {
    const migration = await readFile(monitorMigrationPath, "utf8");

    expect(migration).toContain("preference_score smallint");
    expect(migration).toContain("preference_score_version integer");
    expect(migration).toContain("preference_score_evidence jsonb");
    expect(migration).toContain("campaign_job_matches_preference_score_check");
    expect(migration).toContain(
      "campaign_job_matches_preference_evidence_object_check",
    );
  });

  it("adds enforceable tenant ownership and a durable retention schedule", async () => {
    const migration = await readFile(retentionMigrationPath, "utf8");
    const seedMigration = await readFile(retentionSeedMigrationPath, "utf8");

    expect(migration).toContain("add column workspace_id uuid");
    expect(migration).toContain("constraint jobs_workspace_fk");
    expect(migration).toContain("constraint jobs_workspace_id_id_key unique");
    expect(migration).toContain("campaign_job_matches_workspace_job_fk");
    expect(migration).toContain("drop constraint campaign_job_matches_job_id_fkey");
    expect(migration).toContain("jobs_workspace_source_last_seen_idx");
    expect(migration).toContain("purge_schedule_version integer");
    expect(migration).toContain("next_purge_sequence integer");
    expect(migration).toContain("next_purge_at timestamptz");
    expect(migration).toContain("check (retention_days = 30)");
    expect(seedMigration).toContain(
      "'purge-upwork-data'::public.workflow_task_kind",
    );
    expect(seedMigration).toContain("from public.upwork_connections as connection");
    expect(migration).not.toContain("'purge-upwork-data'::public.workflow_task_kind");
  });

  it("stores Upwork OAuth material only as server-side ciphertext", async () => {
    const migration = await readFile(oauthCredentialMigrationPath, "utf8");

    expect(upworkOAuthCredentials.connectionId.primary).toBe(true);
    expect(upworkOAuthCredentials.workspaceId.notNull).toBe(true);
    expect(upworkOAuthCredentials.encryptedPayload.notNull).toBe(true);
    expect(migration).toContain("upwork_oauth_credentials_workspace_connection_fk");
    expect(migration).toContain("alter table public.upwork_oauth_credentials enable row level security;");
    expect(migration).toContain(
      "revoke all on table public.upwork_oauth_credentials from anon, authenticated;",
    );
    expect(migration).not.toMatch(/access_token|refresh_token|browser_cookie/i);
  });

  it("persists the OAuth browser round-trip as encrypted, single-use state", async () => {
    const migration = await readFile(oauthAuthorizationMigrationPath, "utf8");

    expect(upworkOAuthAuthorizations.connectionId.primary).toBe(true);
    expect(upworkOAuthAuthorizations.workspaceId.notNull).toBe(true);
    expect(upworkOAuthAuthorizations.encryptedPayload.notNull).toBe(true);
    expect(migration).toContain("add value if not exists 'authorizing'");
    expect(migration).toContain("upwork_oauth_authorizations_active_state_hash_key");
    expect(migration).toContain("upwork_oauth_authorizations_workspace_connection_fk");
    expect(migration).toContain(
      "alter table public.upwork_oauth_authorizations enable row level security;",
    );
    expect(migration).toContain(
      "revoke all on table public.upwork_oauth_authorizations from anon, authenticated;",
    );
    expect(migration).not.toMatch(/code_verifier|client_secret|access_token|refresh_token/i);
  });

  it("keeps the migration within the approved compliance boundary", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).not.toMatch(/create\s+table\s+(?:public\.)?applications\b/i);
    expect(migration).not.toMatch(/create\s+table\s+(?:public\.)?proposals\b/i);
    expect(migration).not.toMatch(/create\s+table\s+(?:public\.)?knowledge_/i);
    expect(migration).not.toMatch(/upwork[_-]?(?:cookie|token|credential)/i);
  });

  it("enables RLS and leaves server-only product tables without browser policies", async () => {
    const migration = await readFile(migrationPath, "utf8");
    const tables = [
      "workspaces",
      "campaigns",
      "jobs",
      "campaign_job_matches",
      "ai_scores",
      "workflow_tasks",
      "analytics_events",
    ];

    for (const table of tables) {
      expect(migration).toContain(
        `alter table public.${table} enable row level security;`,
      );
    }
    expect(migration).not.toMatch(
      /create\s+policy\s+\w+\s+on\s+public\.(?:jobs|campaign_job_matches|ai_scores|workflow_tasks|analytics_events)/i,
    );
    expect(migration).not.toMatch(
      /grant\s+\w+\s+on\s+table\s+public\.(?:jobs|campaign_job_matches|ai_scores|workflow_tasks|analytics_events)\s+to\s+(?:anon|authenticated)/i,
    );
  });

  it("includes tenant and idempotency constraints in reviewed SQL", async () => {
    const migration = await readFile(migrationPath, "utf8");

    expect(migration).toContain("constraint workspaces_owner_user_id_key unique");
    expect(migration).toContain("constraint jobs_source_source_job_id_key unique");
    expect(migration).toContain("constraint jobs_ready_shape_check");
    expect(migration).toContain(
      "constraint campaign_job_matches_campaign_id_job_id_key unique",
    );
    expect(migration).toContain(
      "constraint ai_scores_match_id_input_hash_key unique",
    );
    expect(migration).toContain(
      "constraint workflow_tasks_kind_dedupe_key_key unique",
    );
    expect(migration).toContain("workflow_tasks_claim_idx");
    expect(migration).toContain("workflow_tasks_lease_expiry_idx");
  });

  it("keeps live job provenance tenant-safe and server-only", async () => {
    const migration = await readFile(observationMigrationPath, "utf8");

    expect(upworkJobObservations.workspaceId.notNull).toBe(true);
    expect(upworkJobObservations.monitorId.notNull).toBe(true);
    expect(upworkJobObservations.jobId.notNull).toBe(true);
    expect(migration).toContain(
      "upwork_job_observations_workspace_monitor_job_pk",
    );
    expect(migration).toContain(
      "upwork_job_observations_workspace_monitor_fk",
    );
    expect(migration).toContain("upwork_job_observations_workspace_job_fk");
    expect(migration).toContain(
      "alter table public.upwork_job_observations enable row level security;",
    );
    expect(migration).toContain(
      "revoke all on table public.upwork_job_observations from anon, authenticated;",
    );
  });

  it("preserves provider publication timestamps without inventing recency", async () => {
    const migration = await readFile(postedAtMigrationPath, "utf8");

    expect(jobs.postedAt.notNull).toBe(false);
    expect(migration).toContain("add column posted_at timestamptz");
    expect(migration).toContain("jobs_workspace_source_posted_idx");
  });

  it("persists the opaque find_jobs cursor per monitor", async () => {
    const migration = await readFile(cursorMigrationPath, "utf8");

    expect(upworkMonitors.nextCursor.notNull).toBe(false);
    expect(migration).toContain("add column next_cursor text");
    expect(migration).toContain("upwork_monitors_next_cursor_length_check");
    expect(migration).toContain("successful page response");
  });

  it("stores an optional client hire-rate percentage without inventing missing data", async () => {
    const migration = await readFile(hireRateMigrationPath, "utf8");

    expect(jobs.clientHireRatePercent.notNull).toBe(false);
    expect(migration).toContain("add column client_hire_rate_percent smallint");
    expect(migration).toContain("jobs_client_hire_rate_percent_check");
    expect(migration).toContain("null means unavailable");
  });

  it("keeps knowledge and proposal versions private, immutable, and tenant-owned", async () => {
    const migration = await readFile(proposalMigrationPath, "utf8");

    expect(knowledgeDocuments.workspaceId.notNull).toBe(true);
    expect(knowledgeChunks.workspaceId.notNull).toBe(true);
    expect(proposals.workspaceId.notNull).toBe(true);
    expect(proposalVersions.workspaceId.notNull).toBe(true);
    expect(migration).toContain("create table public.knowledge_documents");
    expect(migration).toContain("create table public.knowledge_chunks");
    expect(migration).toContain("create table public.proposals");
    expect(migration).toContain("create table public.proposal_versions");
    expect(migration).toContain("proposal_versions_generation_input_hash_key");
    expect(migration).toContain("revoke all on table public.proposal_versions from anon, authenticated;");
    expect(migration).not.toMatch(/create\s+table\s+public\.applications\b/i);
  });

  it("keeps pgvector embeddings optional and paired with model metadata", async () => {
    const migration = await readFile(embeddingMigrationPath, "utf8");
    expect(migration).toContain("add column embedding extensions.vector(1536)");
    expect(migration).toContain("add column embedding_model text");
    expect(migration).toContain("knowledge_chunks_embedding_pair_check");
  });
});

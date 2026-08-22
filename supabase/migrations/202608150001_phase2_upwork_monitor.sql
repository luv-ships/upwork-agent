-- Phase 2 foundation: transparent preference scoring plus an approved-source,
-- worker-only Upwork MCP monitor. This migration stores no OAuth token or MCP
-- response body. The first runnable adapter is deterministic and fake-only.

alter type public.workflow_task_kind
  add value if not exists 'poll-upwork-monitor';

create type public.upwork_connection_status as enum (
  'fake',
  'connected',
  'reconnect_required',
  'disabled'
);

create type public.upwork_monitor_status as enum (
  'active',
  'paused',
  'error'
);

alter table public.campaign_job_matches
  add column preference_score smallint,
  add column preference_score_version integer,
  add column preference_score_evidence jsonb;

-- Existing Phase 1 matches predate preference scoring. Preserve them with an
-- explicit neutral marker instead of silently recalculating from mutable data.
update public.campaign_job_matches
set preference_score = 50,
    preference_score_version = 1,
    preference_score_evidence = jsonb_build_object(
      'version', 1,
      'score', 50,
      'components', jsonb_build_array(),
      'summary', jsonb_build_array('Preference scoring was introduced after this match')
    )
where preference_score is null;

alter table public.campaign_job_matches
  alter column preference_score set not null,
  alter column preference_score_version set not null,
  alter column preference_score_version set default 1,
  alter column preference_score_evidence set not null,
  add constraint campaign_job_matches_preference_score_check
    check (preference_score between 0 and 100),
  add constraint campaign_job_matches_preference_score_version_check
    check (preference_score_version = 1),
  add constraint campaign_job_matches_preference_evidence_object_check
    check (jsonb_typeof(preference_score_evidence) = 'object');

create table public.upwork_connections (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  status public.upwork_connection_status not null default 'disabled',
  account_id text,
  credential_ref text,
  approval_reference text,
  next_request_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint upwork_connections_workspace_id_key unique (workspace_id),
  constraint upwork_connections_workspace_id_id_key unique (workspace_id, id),
  constraint upwork_connections_account_id_length_check
    check (account_id is null or char_length(btrim(account_id)) between 1 and 200),
  constraint upwork_connections_credential_ref_length_check
    check (credential_ref is null or char_length(btrim(credential_ref)) between 1 and 500),
  constraint upwork_connections_approval_reference_length_check
    check (approval_reference is null or char_length(btrim(approval_reference)) between 1 and 500),
  constraint upwork_connections_fake_has_no_credential_check
    check (status <> 'fake' or credential_ref is null)
);

create table public.upwork_monitors (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  campaign_id uuid not null,
  connection_id uuid not null,
  status public.upwork_monitor_status not null default 'paused',
  poll_interval_seconds integer not null default 300,
  retention_days smallint not null default 30,
  schedule_version integer not null default 1,
  next_run_sequence integer not null default 1,
  next_run_at timestamptz,
  last_success_at timestamptz,
  last_error_code text,
  consecutive_failure_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint upwork_monitors_workspace_campaign_fk
    foreign key (workspace_id, campaign_id)
    references public.campaigns (workspace_id, id)
    on delete cascade,
  constraint upwork_monitors_workspace_connection_fk
    foreign key (workspace_id, connection_id)
    references public.upwork_connections (workspace_id, id)
    on delete cascade,
  constraint upwork_monitors_campaign_id_key unique (campaign_id),
  constraint upwork_monitors_workspace_id_id_key unique (workspace_id, id),
  constraint upwork_monitors_poll_interval_check
    check (poll_interval_seconds between 60 and 86400),
  constraint upwork_monitors_retention_days_check
    check (retention_days between 1 and 30),
  constraint upwork_monitors_schedule_version_check check (schedule_version >= 1),
  constraint upwork_monitors_run_sequence_check check (next_run_sequence >= 1),
  constraint upwork_monitors_failure_count_check
    check (consecutive_failure_count >= 0),
  constraint upwork_monitors_active_schedule_check
    check ((status = 'active') = (next_run_at is not null))
);

create index upwork_monitors_due_idx
  on public.upwork_monitors (next_run_at)
  where status = 'active';

comment on table public.upwork_connections is
  'Server-only Upwork connection metadata. credential_ref is an opaque vault reference, never a token.';
comment on table public.upwork_monitors is
  'Durable per-campaign MCP polling schedule. Successor intent is stored in workflow_tasks.';

alter table public.upwork_connections enable row level security;
alter table public.upwork_monitors enable row level security;

-- As with jobs and workflow tasks, browser roles receive no table privileges.
-- Authorized Next.js commands use the server database connection and still
-- verify workspace ownership before every mutation.
revoke all on table public.upwork_connections from anon, authenticated;
revoke all on table public.upwork_monitors from anon, authenticated;

-- Phase 1, Checkpoints 0-1: one-owner workspaces, campaigns, development jobs,
-- deterministic matches, immutable AI scores, durable workflow tasks, and
-- append-only analytics events. Proposal/KB/application tables are deliberately
-- deferred to their approved milestones.

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;
create extension if not exists vector with schema extensions;

create type public.campaign_status as enum (
  'draft',
  'active',
  'paused',
  'archived'
);

create type public.job_status as enum (
  'received',
  'normalizing',
  'ready',
  'rejected'
);

create type public.job_experience_level as enum (
  'entry',
  'intermediate',
  'expert'
);

create type public.job_type as enum ('hourly', 'fixed');

create type public.project_length_band as enum (
  'under_1_month',
  'one_to_three_months',
  'three_to_six_months',
  'over_6_months'
);

create type public.hours_per_week_band as enum ('under_30', 'over_30');

create type public.match_pipeline_status as enum (
  'matched',
  'analysis_queued',
  'analyzing',
  'low_fit',
  'qualified',
  'proposal_queued',
  'generating_proposal',
  'ready_for_review',
  'failed',
  'dismissed',
  'expired'
);

create type public.suitability_recommendation as enum (
  'apply',
  'review',
  'skip'
);

create type public.pricing_direction as enum (
  'below_market',
  'market',
  'premium',
  'hourly'
);

create type public.workflow_task_kind as enum (
  'normalize-job',
  'match-job',
  'analyze-match'
);

create type public.workflow_task_status as enum (
  'queued',
  'running',
  'retry_wait',
  'succeeded',
  'dead',
  'cancelled'
);

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspaces_owner_user_id_key unique (owner_user_id),
  constraint workspaces_id_owner_user_id_key unique (id, owner_user_id),
  constraint workspaces_name_length_check
    check (char_length(btrim(name)) between 1 and 120)
);

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  status public.campaign_status not null default 'draft',
  filters jsonb not null,
  ai_instructions text not null default '',
  score_threshold smallint not null default 75,
  config_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint campaigns_workspace_id_id_key unique (workspace_id, id),
  constraint campaigns_name_length_check
    check (char_length(btrim(name)) between 1 and 160),
  constraint campaigns_filters_object_check
    check (jsonb_typeof(filters) = 'object'),
  constraint campaigns_score_threshold_check
    check (score_threshold between 0 and 100),
  constraint campaigns_config_version_check check (config_version >= 1)
);

create index campaigns_workspace_status_idx
  on public.campaigns (workspace_id, status);

create index campaigns_active_workspace_idx
  on public.campaigns (workspace_id, updated_at)
  where status = 'active';

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  source_job_id text not null,
  canonical_url text,
  raw_payload jsonb not null,
  source_payload_hash text not null,
  normalized_hash text,
  revision integer not null default 0,
  last_matched_revision integer not null default 0,
  status public.job_status not null default 'received',
  title text,
  description text,
  skills jsonb,
  category_ids jsonb,
  experience_level public.job_experience_level,
  job_type public.job_type,
  hourly_rate_min numeric(14, 2),
  hourly_rate_max numeric(14, 2),
  fixed_budget_min numeric(14, 2),
  fixed_budget_max numeric(14, 2),
  proposal_count integer,
  payment_verified boolean,
  client_country_code text,
  client_time_zone text,
  client_hire_count integer,
  project_length_band public.project_length_band,
  hours_per_week_band public.hours_per_week_band,
  is_contract_to_hire boolean,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint jobs_source_source_job_id_key unique (source, source_job_id),
  constraint jobs_source_length_check
    check (char_length(btrim(source)) between 1 and 80),
  constraint jobs_source_job_id_length_check
    check (char_length(btrim(source_job_id)) between 1 and 300),
  constraint jobs_raw_payload_object_check
    check (jsonb_typeof(raw_payload) = 'object'),
  constraint jobs_source_payload_hash_check
    check (source_payload_hash ~ '^[0-9a-f]{64}$'),
  constraint jobs_normalized_hash_check
    check (normalized_hash is null or normalized_hash ~ '^[0-9a-f]{64}$'),
  constraint jobs_ready_shape_check check (
    status <> 'ready'
    or (
      normalized_hash is not null
      and revision >= 1
      and title is not null
      and char_length(btrim(title)) between 1 and 300
      and description is not null
      and char_length(btrim(description)) >= 1
      and skills is not null
      and jsonb_typeof(skills) = 'array'
      and category_ids is not null
      and jsonb_typeof(category_ids) = 'array'
      and job_type is not null
    )
  ),
  constraint jobs_revision_check check (revision >= 0),
  constraint jobs_last_matched_revision_check
    check (last_matched_revision between 0 and revision),
  constraint jobs_skills_array_check
    check (skills is null or jsonb_typeof(skills) = 'array'),
  constraint jobs_category_ids_array_check
    check (category_ids is null or jsonb_typeof(category_ids) = 'array'),
  constraint jobs_hourly_range_check
    check (hourly_rate_min is null or hourly_rate_max is null or hourly_rate_min <= hourly_rate_max),
  constraint jobs_fixed_range_check
    check (fixed_budget_min is null or fixed_budget_max is null or fixed_budget_min <= fixed_budget_max),
  constraint jobs_nonnegative_values_check check (
    coalesce(hourly_rate_min, 0) >= 0
    and coalesce(hourly_rate_max, 0) >= 0
    and coalesce(fixed_budget_min, 0) >= 0
    and coalesce(fixed_budget_max, 0) >= 0
    and coalesce(proposal_count, 0) >= 0
    and coalesce(client_hire_count, 0) >= 0
  ),
  constraint jobs_client_country_code_check
    check (client_country_code is null or client_country_code ~ '^[A-Z]{2}$')
);

create index jobs_last_seen_at_idx on public.jobs (last_seen_at desc);

create table public.campaign_job_matches (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  campaign_id uuid not null,
  job_id uuid not null references public.jobs (id) on delete cascade,
  campaign_config_version integer not null,
  job_revision integer not null,
  filter_snapshot jsonb not null,
  ai_instructions_snapshot text not null,
  score_threshold_snapshot smallint not null,
  deterministic_evidence jsonb not null,
  analysis_input_hash text not null,
  pipeline_status public.match_pipeline_status not null default 'matched',
  failed_step text,
  failure_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint campaign_job_matches_workspace_campaign_fk
    foreign key (workspace_id, campaign_id)
    references public.campaigns (workspace_id, id)
    on delete cascade,
  constraint campaign_job_matches_workspace_id_id_key unique (workspace_id, id),
  constraint campaign_job_matches_campaign_id_job_id_key unique (campaign_id, job_id),
  constraint campaign_job_matches_config_version_check
    check (campaign_config_version >= 1),
  constraint campaign_job_matches_job_revision_check check (job_revision >= 1),
  constraint campaign_job_matches_filter_snapshot_object_check
    check (jsonb_typeof(filter_snapshot) = 'object'),
  constraint campaign_job_matches_evidence_object_check
    check (jsonb_typeof(deterministic_evidence) = 'object'),
  constraint campaign_job_matches_score_threshold_check
    check (score_threshold_snapshot between 0 and 100),
  constraint campaign_job_matches_analysis_input_hash_check
    check (analysis_input_hash ~ '^[0-9a-f]{64}$')
);

create index campaign_job_matches_workspace_status_created_idx
  on public.campaign_job_matches (workspace_id, pipeline_status, created_at desc);

create table public.ai_scores (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  match_id uuid not null,
  input_hash text not null,
  provider text not null,
  model text not null,
  prompt_version text not null,
  provider_request_key text not null,
  score smallint not null,
  recommendation public.suitability_recommendation not null,
  reasons jsonb not null,
  risks jsonb not null,
  estimated_win_probability numeric(5, 4) not null,
  pricing_direction public.pricing_direction not null,
  suggested_bid_amount numeric(14, 2),
  suggested_bid_currency text,
  created_at timestamptz not null default now(),
  constraint ai_scores_workspace_match_fk
    foreign key (workspace_id, match_id)
    references public.campaign_job_matches (workspace_id, id)
    on delete cascade,
  constraint ai_scores_match_id_input_hash_key unique (match_id, input_hash),
  constraint ai_scores_provider_request_key_key unique (provider_request_key),
  constraint ai_scores_input_hash_check check (input_hash ~ '^[0-9a-f]{64}$'),
  constraint ai_scores_score_check check (score between 0 and 100),
  constraint ai_scores_reasons_array_check check (jsonb_typeof(reasons) = 'array'),
  constraint ai_scores_risks_array_check check (jsonb_typeof(risks) = 'array'),
  constraint ai_scores_probability_check
    check (estimated_win_probability between 0 and 1),
  constraint ai_scores_currency_check
    check (suggested_bid_currency is null or suggested_bid_currency ~ '^[A-Z]{3}$'),
  constraint ai_scores_bid_pair_check
    check ((suggested_bid_amount is null) = (suggested_bid_currency is null)),
  constraint ai_scores_nonnegative_bid_check
    check (suggested_bid_amount is null or suggested_bid_amount >= 0)
);

create index ai_scores_match_created_idx
  on public.ai_scores (match_id, created_at desc);

create table public.workflow_tasks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  kind public.workflow_task_kind not null,
  schema_version smallint not null default 1,
  payload jsonb not null,
  dedupe_key text not null,
  status public.workflow_task_status not null default 'queued',
  priority smallint not null default 0,
  run_at timestamptz not null default now(),
  attempt_count integer not null default 0,
  max_attempts integer not null default 5,
  locked_by text,
  locked_at timestamptz,
  lease_expires_at timestamptz,
  last_error_code text,
  last_error_message text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workflow_tasks_kind_dedupe_key_key unique (kind, dedupe_key),
  constraint workflow_tasks_payload_object_check
    check (jsonb_typeof(payload) = 'object'),
  constraint workflow_tasks_schema_version_check check (schema_version = 1),
  constraint workflow_tasks_attempts_check
    check (attempt_count >= 0 and max_attempts >= 1),
  constraint workflow_tasks_lock_consistency_check check (
    (
      status = 'running'
      and locked_by is not null
      and locked_at is not null
      and lease_expires_at is not null
    )
    or
    (
      status <> 'running'
      and locked_by is null
      and locked_at is null
      and lease_expires_at is null
    )
  ),
  constraint workflow_tasks_completion_consistency_check check (
    (status in ('succeeded', 'dead', 'cancelled')) = (completed_at is not null)
  )
);

create index workflow_tasks_claim_idx
  on public.workflow_tasks (priority desc, run_at, created_at)
  where status in ('queued', 'retry_wait');

create index workflow_tasks_lease_expiry_idx
  on public.workflow_tasks (lease_expires_at)
  where status = 'running';

create index workflow_tasks_workspace_status_idx
  on public.workflow_tasks (workspace_id, status);

create table public.analytics_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  actor_user_id uuid references auth.users (id) on delete set null,
  event_name text not null,
  subject_type text not null,
  subject_id uuid not null,
  properties jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  dedupe_key text,
  created_at timestamptz not null default now(),
  constraint analytics_events_workspace_actor_fk
    foreign key (workspace_id, actor_user_id)
    references public.workspaces (id, owner_user_id),
  constraint analytics_events_properties_object_check
    check (jsonb_typeof(properties) = 'object'),
  constraint analytics_events_event_name_check
    check (event_name ~ '^[a-z][a-z0-9_.-]{0,99}$'),
  constraint analytics_events_subject_type_check
    check (subject_type ~ '^[a-z][a-z0-9_-]{0,49}$')
);

create index analytics_events_workspace_occurred_idx
  on public.analytics_events (workspace_id, occurred_at desc);

create unique index analytics_events_workspace_dedupe_key_idx
  on public.analytics_events (workspace_id, dedupe_key)
  where dedupe_key is not null;

comment on table public.jobs is
  'Server-only source records. Phase 1 accepts development injection only.';
comment on table public.workflow_tasks is
  'Durable workflow source of truth; Redis notifications are best effort only.';
comment on table public.ai_scores is
  'Immutable successful suitability results; repository code only inserts.';
comment on table public.analytics_events is
  'Append-only audit/instrumentation context, never workflow state.';

alter table public.workspaces enable row level security;
alter table public.campaigns enable row level security;
alter table public.jobs enable row level security;
alter table public.campaign_job_matches enable row level security;
alter table public.ai_scores enable row level security;
alter table public.workflow_tasks enable row level security;
alter table public.analytics_events enable row level security;

-- Owner-select policies provide a row-level backstop for server code that
-- deliberately adopts the authenticated role. Table privileges below remain
-- revoked because Phase 1 browser clients use Supabase only for authentication;
-- product reads and all writes go through authorized server commands.
create policy workspaces_owner_select
  on public.workspaces
  for select
  to authenticated
  using (owner_user_id = (select auth.uid()));

create policy campaigns_owner_select
  on public.campaigns
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.workspaces
      where workspaces.id = campaigns.workspace_id
        and workspaces.owner_user_id = (select auth.uid())
    )
  );

revoke all on table public.workspaces from anon, authenticated;
revoke all on table public.campaigns from anon, authenticated;
revoke all on table public.jobs from anon, authenticated;
revoke all on table public.campaign_job_matches from anon, authenticated;
revoke all on table public.ai_scores from anon, authenticated;
revoke all on table public.workflow_tasks from anon, authenticated;
revoke all on table public.analytics_events from anon, authenticated;

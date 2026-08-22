-- Keep Upwork discovery provenance at monitor scope while retaining the
-- workspace-wide jobs de-duplication key. This prevents a job found by one
-- campaign from being matched by every other active campaign in the tenant.

create table public.upwork_job_observations (
  workspace_id uuid not null,
  monitor_id uuid not null,
  job_id uuid not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  constraint upwork_job_observations_workspace_monitor_job_pk
    primary key (workspace_id, monitor_id, job_id),
  constraint upwork_job_observations_workspace_monitor_fk
    foreign key (workspace_id, monitor_id)
    references public.upwork_monitors (workspace_id, id)
    on delete cascade,
  constraint upwork_job_observations_workspace_job_fk
    foreign key (workspace_id, job_id)
    references public.jobs (workspace_id, id)
    on delete cascade
);

create index upwork_job_observations_workspace_job_idx
  on public.upwork_job_observations (workspace_id, job_id, last_seen_at desc);

create index upwork_job_observations_workspace_monitor_idx
  on public.upwork_job_observations (workspace_id, monitor_id, last_seen_at desc);

alter table public.upwork_job_observations enable row level security;
revoke all on table public.upwork_job_observations from anon, authenticated;

comment on table public.upwork_job_observations is
  'Server-only provenance linking an Upwork MCP job to the monitor that discovered it.';

-- Tenant-own every retained job and make the approved 30-day Upwork MCP
-- retention limit executable through a durable, connection-scoped schedule.

alter type public.workflow_task_kind
  add value if not exists 'purge-upwork-data';

alter table public.jobs
  add column workspace_id uuid;

-- Phase 1 and the fake MCP foundation both qualified source IDs with the
-- owning workspace UUID. Join through the real workspace table rather than
-- casting untrusted source text during the compatibility backfill.
update public.jobs as job
set workspace_id = workspace.id
from public.workspaces as workspace
where job.workspace_id is null
  and job.source_job_id like (workspace.id::text || ':%');

do $$
begin
  if exists (select 1 from public.jobs where workspace_id is null) then
    raise exception 'Cannot tenant-backfill every existing jobs row';
  end if;
end
$$;

alter table public.jobs
  alter column workspace_id set not null,
  add constraint jobs_workspace_fk
    foreign key (workspace_id)
    references public.workspaces (id)
    on delete cascade,
  add constraint jobs_workspace_id_id_key unique (workspace_id, id);

create index jobs_workspace_source_last_seen_idx
  on public.jobs (workspace_id, source, last_seen_at);

alter table public.campaign_job_matches
  drop constraint campaign_job_matches_job_id_fkey,
  add constraint campaign_job_matches_workspace_job_fk
    foreign key (workspace_id, job_id)
    references public.jobs (workspace_id, id)
    on delete cascade;

alter table public.upwork_connections
  add column purge_schedule_version integer not null default 1,
  add column next_purge_sequence integer not null default 1,
  add column next_purge_at timestamptz not null default now(),
  add constraint upwork_connections_purge_schedule_version_check
    check (purge_schedule_version >= 1),
  add constraint upwork_connections_purge_sequence_check
    check (next_purge_sequence >= 1);

update public.upwork_monitors
set retention_days = 30
where retention_days <> 30;

alter table public.upwork_monitors
  drop constraint upwork_monitors_retention_days_check,
  add constraint upwork_monitors_retention_days_check
    check (retention_days = 30);

comment on column public.jobs.workspace_id is
  'Owning tenant for source data, enforced independently of source_job_id formatting.';
comment on column public.upwork_connections.next_purge_at is
  'Durable schedule cursor for workspace Upwork MCP retention cleanup.';

-- Preserve the publication timestamp returned by the approved Upwork MCP
-- response mapping. It is source metadata, not an inferred recency value.

alter table public.jobs
  add column posted_at timestamptz;

create index jobs_workspace_source_posted_idx
  on public.jobs (workspace_id, source, posted_at desc);

comment on column public.jobs.posted_at is
  'Provider publication timestamp when the source supplies one; nullable when absent.';

-- Preserve the optional client hire-rate percentage when the approved MCP
-- response supplies it. Filters fail closed when the provider omits it.

alter table public.jobs
  add column client_hire_rate_percent smallint,
  add constraint jobs_client_hire_rate_percent_check
    check (client_hire_rate_percent is null or client_hire_rate_percent between 0 and 100);

comment on column public.jobs.client_hire_rate_percent is
  'Optional provider-reported client hire rate percentage; null means unavailable.';

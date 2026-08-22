-- Persist the bounded find_jobs cursor so a long-running monitor can advance
-- through pages without re-reading only the first page on every run.

alter table public.upwork_monitors
  add column next_cursor text,
  add constraint upwork_monitors_next_cursor_length_check
    check (next_cursor is null or char_length(next_cursor) between 1 and 10000);

comment on column public.upwork_monitors.next_cursor is
  'Opaque Upwork MCP find_jobs cursor; server-owned and replaced only by a successful page response.';

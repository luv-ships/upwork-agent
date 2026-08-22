-- OAuth material is stored only as an application-encrypted opaque payload.
-- This table deliberately has no access-token, refresh-token, or browser-session
-- column, and no browser role can query it.

create table public.upwork_oauth_credentials (
  connection_id uuid primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  encrypted_payload text not null,
  key_version smallint not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint upwork_oauth_credentials_workspace_connection_fk
    foreign key (workspace_id, connection_id)
    references public.upwork_connections (workspace_id, id)
    on delete cascade,
  constraint upwork_oauth_credentials_encrypted_payload_length_check
    check (char_length(encrypted_payload) between 1 and 100000),
  constraint upwork_oauth_credentials_key_version_check
    check (key_version = 1)
);

alter table public.upwork_oauth_credentials enable row level security;
revoke all on table public.upwork_oauth_credentials from anon, authenticated;

comment on table public.upwork_oauth_credentials is
  'Application-encrypted OAuth material for one Upwork MCP connection; never browser-readable.';

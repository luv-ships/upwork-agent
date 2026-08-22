-- Durable, application-encrypted state for the OAuth browser round-trip.
-- OAuth state, PKCE verifier, dynamic client registration, and discovery
-- metadata are contained only in encrypted_payload.

alter type public.upwork_connection_status add value if not exists 'authorizing';

create table public.upwork_oauth_authorizations (
  connection_id uuid primary key,
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  state_hash text,
  encrypted_payload text not null,
  expires_at timestamptz,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint upwork_oauth_authorizations_workspace_connection_fk
    foreign key (workspace_id, connection_id)
    references public.upwork_connections (workspace_id, id)
    on delete cascade,
  constraint upwork_oauth_authorizations_state_hash_length_check
    check (state_hash is null or char_length(state_hash) = 43),
  constraint upwork_oauth_authorizations_encrypted_payload_length_check
    check (char_length(encrypted_payload) between 1 and 100000)
);

create unique index upwork_oauth_authorizations_active_state_hash_key
  on public.upwork_oauth_authorizations (state_hash)
  where state_hash is not null;

alter table public.upwork_oauth_authorizations enable row level security;
revoke all on table public.upwork_oauth_authorizations from anon, authenticated;

comment on table public.upwork_oauth_authorizations is
  'Application-encrypted PKCE and dynamic-client state for one Upwork MCP connection; never browser-readable.';

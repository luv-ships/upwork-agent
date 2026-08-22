-- Phase 1 Checkpoint 2: private workspace knowledge and immutable manual-review
-- proposal versions. No application or Upwork write action is created here.

alter type public.workflow_task_kind add value if not exists 'index-knowledge-doc';
alter type public.workflow_task_kind add value if not exists 'generate-proposal';

create type public.knowledge_document_status as enum ('pending', 'ready', 'failed');
create type public.proposal_status as enum (
  'queued',
  'generating',
  'ready_for_review',
  'approved',
  'rejected',
  'failed'
);

create table public.knowledge_documents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  title text not null,
  content text not null,
  content_hash text not null,
  status public.knowledge_document_status not null default 'pending',
  failure_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint knowledge_documents_workspace_id_id_key unique (workspace_id, id),
  constraint knowledge_documents_workspace_hash_key unique (workspace_id, content_hash),
  constraint knowledge_documents_title_length_check check (char_length(btrim(title)) between 1 and 200),
  constraint knowledge_documents_content_length_check check (char_length(content) between 1 and 200000),
  constraint knowledge_documents_hash_check check (content_hash ~ '^[0-9a-f]{64}$')
);

create index knowledge_documents_workspace_status_idx
  on public.knowledge_documents (workspace_id, status);

create table public.knowledge_chunks (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  document_id uuid not null,
  ordinal integer not null,
  content text not null,
  content_hash text not null,
  created_at timestamptz not null default now(),
  constraint knowledge_chunks_workspace_document_fk
    foreign key (workspace_id, document_id)
    references public.knowledge_documents (workspace_id, id)
    on delete cascade,
  constraint knowledge_chunks_workspace_id_id_key unique (workspace_id, id),
  constraint knowledge_chunks_document_ordinal_key unique (document_id, ordinal),
  constraint knowledge_chunks_ordinal_check check (ordinal >= 0),
  constraint knowledge_chunks_content_length_check check (char_length(content) between 1 and 4000),
  constraint knowledge_chunks_hash_check check (content_hash ~ '^[0-9a-f]{64}$')
);

create index knowledge_chunks_workspace_document_idx
  on public.knowledge_chunks (workspace_id, document_id, ordinal);

create table public.proposals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  match_id uuid not null,
  status public.proposal_status not null default 'queued',
  current_version integer not null default 0,
  failure_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint proposals_workspace_match_fk
    foreign key (workspace_id, match_id)
    references public.campaign_job_matches (workspace_id, id)
    on delete cascade,
  constraint proposals_workspace_id_id_key unique (workspace_id, id),
  constraint proposals_workspace_match_key unique (workspace_id, match_id),
  constraint proposals_current_version_check check (current_version >= 0)
);

create table public.proposal_versions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  proposal_id uuid not null,
  version integer not null,
  body text not null,
  source_chunk_ids jsonb not null default '[]'::jsonb,
  generation_input_hash text not null,
  provider text not null,
  model text not null,
  prompt_version text not null,
  suggested_bid_amount numeric(14,2),
  suggested_bid_currency text,
  created_at timestamptz not null default now(),
  constraint proposal_versions_workspace_proposal_fk
    foreign key (workspace_id, proposal_id)
    references public.proposals (workspace_id, id)
    on delete cascade,
  constraint proposal_versions_workspace_id_id_key unique (workspace_id, id),
  constraint proposal_versions_proposal_version_key unique (proposal_id, version),
  constraint proposal_versions_generation_input_hash_key unique (proposal_id, generation_input_hash),
  constraint proposal_versions_version_check check (version >= 1),
  constraint proposal_versions_body_length_check check (char_length(btrim(body)) between 1 and 12000),
  constraint proposal_versions_hash_check check (generation_input_hash ~ '^[0-9a-f]{64}$'),
  constraint proposal_versions_source_chunks_array_check check (jsonb_typeof(source_chunk_ids) = 'array'),
  constraint proposal_versions_currency_check check (suggested_bid_currency is null or suggested_bid_currency ~ '^[A-Z]{3}$'),
  constraint proposal_versions_bid_pair_check check ((suggested_bid_amount is null) = (suggested_bid_currency is null))
);

create index proposal_versions_workspace_created_idx
  on public.proposal_versions (workspace_id, created_at desc);

alter table public.knowledge_documents enable row level security;
alter table public.knowledge_chunks enable row level security;
alter table public.proposals enable row level security;
alter table public.proposal_versions enable row level security;
revoke all on table public.knowledge_documents from anon, authenticated;
revoke all on table public.knowledge_chunks from anon, authenticated;
revoke all on table public.proposals from anon, authenticated;
revoke all on table public.proposal_versions from anon, authenticated;

comment on table public.knowledge_documents is
  'Server-only workspace knowledge source; raw content never reaches browser read models.';
comment on table public.proposal_versions is
  'Immutable generated proposal text for manual review; approval has no submission side effect.';

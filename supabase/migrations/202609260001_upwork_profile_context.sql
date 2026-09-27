-- Profile-context expansion. Existing workspace-owned data belongs to the
-- generated General Profile so historical scores and proposals stay intact.

create table public.upwork_profiles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null,
  title text not null default '',
  professional_summary text not null default '',
  core_services jsonb not null default '[]'::jsonb,
  tools jsonb not null default '[]'::jsonb,
  ideal_customer_profile text not null default '',
  preferred_projects text not null default '',
  projects_to_avoid text not null default '',
  languages jsonb not null default '[]'::jsonb,
  additional_ai_instructions text not null default '',
  is_default boolean not null default false,
  config_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint upwork_profiles_workspace_id_id_key unique (workspace_id, id),
  constraint upwork_profiles_workspace_name_key unique (workspace_id, name),
  constraint upwork_profiles_name_length_check check (char_length(btrim(name)) between 1 and 120),
  constraint upwork_profiles_title_length_check check (char_length(title) <= 160),
  constraint upwork_profiles_config_version_check check (config_version >= 1),
  constraint upwork_profiles_core_services_array_check check (jsonb_typeof(core_services) = 'array'),
  constraint upwork_profiles_tools_array_check check (jsonb_typeof(tools) = 'array'),
  constraint upwork_profiles_languages_array_check check (jsonb_typeof(languages) = 'array')
);

create unique index upwork_profiles_one_default_per_workspace_idx
  on public.upwork_profiles (workspace_id) where is_default;
create index upwork_profiles_workspace_updated_idx
  on public.upwork_profiles (workspace_id, updated_at desc);

insert into public.upwork_profiles (workspace_id, name, title, is_default)
select id, 'General Profile', 'Default BidWork context', true
from public.workspaces
on conflict (workspace_id, name) do nothing;

alter table public.campaigns add column profile_id uuid;
alter table public.knowledge_documents add column profile_id uuid;
alter table public.campaign_job_matches add column profile_id uuid;
alter table public.ai_scores add column profile_id uuid;
alter table public.proposals add column profile_id uuid;
alter table public.proposal_versions add column profile_id uuid;

update public.campaigns c set profile_id = p.id from public.upwork_profiles p where p.workspace_id = c.workspace_id and p.is_default;
update public.knowledge_documents d set profile_id = p.id from public.upwork_profiles p where p.workspace_id = d.workspace_id and p.is_default;
update public.campaign_job_matches m set profile_id = c.profile_id from public.campaigns c where c.id = m.campaign_id and c.workspace_id = m.workspace_id;
update public.ai_scores s set profile_id = m.profile_id from public.campaign_job_matches m where m.id = s.match_id and m.workspace_id = s.workspace_id;
update public.proposals p set profile_id = m.profile_id from public.campaign_job_matches m where m.id = p.match_id and m.workspace_id = p.workspace_id;
update public.proposal_versions v set profile_id = p.profile_id from public.proposals p where p.id = v.proposal_id and p.workspace_id = v.workspace_id;

alter table public.campaigns alter column profile_id set not null;
alter table public.knowledge_documents alter column profile_id set not null;
alter table public.campaign_job_matches alter column profile_id set not null;
alter table public.ai_scores alter column profile_id set not null;
alter table public.proposals alter column profile_id set not null;
alter table public.proposal_versions alter column profile_id set not null;

alter table public.campaigns add constraint campaigns_workspace_profile_fk foreign key (workspace_id, profile_id) references public.upwork_profiles (workspace_id, id) on delete restrict;
alter table public.knowledge_documents add constraint knowledge_documents_workspace_profile_fk foreign key (workspace_id, profile_id) references public.upwork_profiles (workspace_id, id) on delete restrict;
alter table public.campaign_job_matches add constraint campaign_job_matches_workspace_profile_fk foreign key (workspace_id, profile_id) references public.upwork_profiles (workspace_id, id) on delete restrict;
alter table public.ai_scores add constraint ai_scores_workspace_profile_fk foreign key (workspace_id, profile_id) references public.upwork_profiles (workspace_id, id) on delete restrict;
alter table public.proposals add constraint proposals_workspace_profile_fk foreign key (workspace_id, profile_id) references public.upwork_profiles (workspace_id, id) on delete restrict;
alter table public.proposal_versions add constraint proposal_versions_workspace_profile_fk foreign key (workspace_id, profile_id) references public.upwork_profiles (workspace_id, id) on delete restrict;

alter table public.knowledge_documents drop constraint knowledge_documents_workspace_hash_key;
alter table public.knowledge_documents add constraint knowledge_documents_workspace_profile_hash_key unique (workspace_id, profile_id, content_hash);
drop index if exists public.knowledge_documents_workspace_status_idx;
create index knowledge_documents_workspace_profile_status_idx on public.knowledge_documents (workspace_id, profile_id, status);
drop index if exists public.campaigns_workspace_status_idx;
create index campaigns_workspace_profile_status_idx on public.campaigns (workspace_id, profile_id, status);

alter table public.upwork_profiles enable row level security;
revoke all on table public.upwork_profiles from anon, authenticated;

comment on table public.upwork_profiles is 'Server-owned profile-specific context for campaigns, knowledge, scores, and proposals.';

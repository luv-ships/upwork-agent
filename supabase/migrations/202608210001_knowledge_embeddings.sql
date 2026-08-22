-- Optional pgvector storage for knowledge chunks. Lexical retrieval remains the
-- safe fallback when no embedding model is configured.
alter table public.knowledge_chunks
  add column embedding extensions.vector(1536),
  add column embedding_model text;

alter table public.knowledge_chunks
  add constraint knowledge_chunks_embedding_pair_check
  check ((embedding is null) = (embedding_model is null));

comment on column public.knowledge_chunks.embedding is
  'Optional workspace-scoped embedding; nullable for deterministic/offline mode.';

# Engineering rules

## Current scope

This repository begins as a Phase 1 architecture-only foundation. Before
implementing features, read `docs/ARCHITECTURE.md` and `docs/PHASE_1.md`. Build
only the approved vertical slice; do not casually add discovery, CRM, inbox,
analytics dashboards, application automation, browser automation, teams,
multi-account support, Kubernetes, or generic workflow infrastructure.

If a request would expand the approved scope, document the trade-off and ask
for approval rather than hiding the change inside a refactor.

## Repository boundaries

- `apps/web` owns Next.js UI, authenticated commands, and read models.
- `apps/worker` is a separately deployable persistent Node process. It owns
  retries, AI calls, document indexing, and all pipeline work.
- `packages/core` contains framework-free domain types, Zod schemas,
  deterministic filters, input hashes, state guards, and ports.
- `packages/db` owns Drizzle schema, migrations, explicit SQL, and repositories.
- Code in web routes/server actions must not import worker handlers or launch
  long-running work. They persist state plus durable task intent and return.
- Do not introduce a new package, service, queue, or abstraction without a
  concrete approved use case.

## TypeScript and validation

- Use TypeScript `strict` mode. Do not introduce `any`, broad type assertions,
  or ignored TypeScript errors to make a build pass.
- Validate every untrusted boundary with Zod: HTTP bodies/query params, task
  payloads, environment variables, Supabase auth metadata used by the app, and
  AI provider output.
- Keep deterministic matching pure: no database calls, wall clock, randomness,
  or AI call inside the filter evaluator.
- Prefer named domain types and small functions over generic JSON pass-through.
  JSONB must have a Zod schema and a documented owner/version.

## Database and tenancy

- Use Drizzle plus reviewed SQL migrations. Never mutate production schema by
  relying on runtime `push`/synchronize behavior.
- Supabase `auth.users` is the canonical user identity. Do not duplicate users
  unless application-owned profile data is actually required.
- Every tenant-owned record has `workspace_id`; every server command verifies
  workspace ownership before querying or mutating it.
- Keep RLS enabled and policies deliberate. Browser code must not expose raw
  jobs, worker tasks, provider metadata, or private KB document data.
- Put correctness in constraints: source-key job uniqueness, match uniqueness,
  input-hash idempotency, immutable proposal version numbers, and task dedupe
  keys. Do not rely on an application-level pre-check alone.
- Use `numeric` for currency/rates, `timestamptz` for time, and UUIDs for IDs.
  Avoid blanket soft deletes; use an explicit archived/status state when audit
  history matters.
- Treat schema changes as compatibility changes. Add a migration, indexes,
  tests, and a forward/backfill plan before changing persistent semantics.

## Background work and idempotency

- Postgres `workflow_tasks` is the durable workflow source of truth. Redis or
  Upstash can signal work/rate-limit, but it must never be the only durable
  record of work.
- Every handler must be safe for at-least-once execution: claim a lease,
  validate payload, re-check current state in a transaction, write its domain
  result and next task atomically, then mark success.
- Use a semantic dedupe key and input hash for every task that can make a
  visible artifact. Repeating a task must not duplicate matches, scores,
  proposal versions, or future applications.
- Handle lease expiry, capped exponential retries, and sanitized dead-letter
  diagnostics. Do not swallow a failure, spin indefinitely, or retry all
  errors identically.
- Never call AI, run a browser, or perform task polling from a Next.js request
  lifecycle. Do not build or assume a Playwright/website-automation worker for
  Upwork; any future approved API adapter must be separately deployable.

## AI and knowledge base

- All AI access goes through the text-generation/embedding provider ports in
  `packages/core`; OpenAI code belongs in a worker adapter, never in a React
  component or route.
- Parse model output with Zod before persistence. Store model/provider/prompt
  version/input hash with successful outputs.
- Use `FakeAIProvider` for unit, integration, and Playwright tests by default.
  Tests must not need a real API key or public network.
- Scope KB retrieval by `workspace_id` in SQL, not only in prompt wording.
  Store original KB files privately; do not log their complete content or raw
  prompts by default.
- A repeated provider call after a crash is possible. Make the database outcome
  idempotent and observable; do not claim impossible exactly-once AI delivery.

## Security and configuration

- Never commit secrets, tokens, cookies, database URLs with credentials, raw
  customer documents, or production dumps. Use `.env` locally and deployment
  secret stores in hosted environments.
- `.env.example` may contain names, comments, and blank/non-secret placeholders
  only. `NEXT_PUBLIC_` variables must be safe for the browser by design.
- Keep service-role credentials worker/server-only. Do not trust a client-side
  workspace ID, actor ID, task kind, score, or proposal body.
- Google OAuth is identity-only in Phase 1: request only `openid`, `email`, and
  `profile`; keep Google client configuration in Google Cloud/Supabase secrets,
  never in browser source or `NEXT_PUBLIC_` variables.
- The internal development-job endpoint is authenticated and explicitly gated;
  it must be disabled in production and must not become an undocumented public
  ingestion API.
- Sanitize errors exposed to users. Logs may contain correlation IDs and error
  codes, never credentials or unbounded private inputs.

## Upwork compliance gate

- Do not add scraping, background polling, browser session cookies, browser
  extensions, Playwright/RPA, or direct website endpoints for Upwork.
- Before adding any real Upwork discovery or submission capability, require a
  documented approved API scope that states permitted endpoints/actions, rate
  limits, consent, retention, and human-review requirements. An authenticated
  browser session is not approval.
- If the approved scope does not allow an action, provide a manual handoff;
  never work around the restriction with automation.

## Tests and verification

- Add/adjust Vitest tests for every pure rule, state transition, and bug fix.
- Add database/worker integration tests when changing leases, constraints,
  idempotency, migrations, RLS, or tenant scoping.
- Add Playwright coverage for a user-visible workflow change. Use local
  Supabase/Redis and the fake AI provider.
- Before handoff, run the narrowest relevant checks and report what actually
  ran. Do not claim tests passed if a required service or credential was not
  available.
- Keep UI state truthful: processing, retrying, low-fit, and failed are
  distinct from a completed result.

## Dependency and operational discipline

- Prefer the existing stack: Next.js, TypeScript, Tailwind, shadcn/ui,
  Supabase/Postgres/pgvector, Drizzle, Zod, Vitest, Playwright, and the narrow
  Redis port. Explain any new production dependency in the PR/hand-off.
- Do not add Prisma, a second ORM, a second vector database, a job broker,
  websocket infrastructure, a telemetry SaaS, or a component library alongside
  shadcn/ui without explicit approval.
- Keep worker concurrency at one until measurements prove a higher setting is
  safe. Preserve logs with task/entity/workspace correlation IDs.
- Favor additive, reversible migrations and small commits. Do not rewrite or
  discard user changes in a dirty working tree.

## Documentation

- Update `docs/ARCHITECTURE.md` for a material boundary, persistence, queue,
  provider, or deployment decision.
- Update `docs/PHASE_1.md` when scope, acceptance criteria, or milestone order
  changes.
- Record unresolved product/compliance questions rather than inventing a
  policy, especially before real Upwork discovery or submission work.

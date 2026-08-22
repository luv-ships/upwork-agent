# SignalFound

SignalFound qualifies job opportunities, ranks deterministic matches, and
prepares them for human review. It deliberately does not scrape Upwork,
automate a browser, or submit applications.

## What works in this checkpoint

- Google OAuth through Supabase, using identity-only scopes.
- One owner-scoped workspace per authenticated user.
- Campaign filters covering category, experience, job type, budget/rate,
  proposals, client signals, location/time zone, duration, weekly hours, and
  contract-to-hire preferences.
- A guarded development-only job injection endpoint.
- A Postgres-backed worker pipeline with leases, retries, deduplication, and a
  deterministic fake AI provider.
- A durable worker-only Upwork monitor seam with a deterministic fake adapter.
- Separate transparent preference scores and AI suitability evidence for
  manual review.
- Private knowledge indexing and a workspace-scoped proposal queue with
  immutable versions and manual review actions. Proposal text is never
  submitted to Upwork by this Phase 1 product.

The fake provider is the default, so no OpenAI key is needed to build or test
the local score loop. A real provider must remain disabled until its server-side
credentials are configured.

After a qualifying match is scored, the worker queues proposal generation. Use
`/app/knowledge` to add private text sources and `/app/proposals` to review the
resulting immutable drafts. Approve/reject actions are audit-only handoffs and
do not submit applications.

The Upwork monitor is disabled by default. To exercise the complete local
placeholder flow, set `UPWORK_MONITOR_PROVIDER=fake` for both the web and worker
processes, keep `UPWORK_MCP_MIN_POLL_INTERVAL_SECONDS=300`, apply migrations,
and enable the monitor from an active campaign. The fake adapter performs no
network request and needs no Upwork credential. For a hosted deployment, use
the two Docker targets and follow [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Prerequisites

- Node.js 22 or newer
- pnpm (the pinned version is available through Corepack)
- Docker Desktop
- Supabase CLI

## Local setup

1. Run `corepack pnpm install`.
2. Copy `.env.example` to `.env` and fill the local Supabase values.
3. Start Supabase with `supabase start`.
4. Apply the local migration with `pnpm db:migrate`.
5. Optionally start Redis with `pnpm services:up`. PostgreSQL polling remains
   correct when Redis is disabled.
6. Run the web and worker together with `pnpm dev`.

To exercise development job injection, explicitly set
`DEV_INGESTION_ENABLED=true` and create a private `DEV_INGEST_TOKEN` containing
at least 16 characters. Never enable that endpoint in production.

Google OAuth also requires a Google Web OAuth client configured in both Google
Cloud and Supabase. Only `openid`, `email`, and `profile` scopes are requested.
For local Google setup, authorize
`http://127.0.0.1:54321/auth/v1/callback` in Google, then put the client ID and
secret in the two `SUPABASE_AUTH_EXTERNAL_GOOGLE_*` variables. The application
callback itself is `http://localhost:3000/auth/callback`.

## Verification

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Integration and browser checks additionally require the local Supabase stack.
Tests use `AI_PROVIDER=fake` and never need public network access or an Upwork
account.

To run the checked-in score-loop browser scenario, first install Chromium with
`pnpm exec playwright install chromium`. In `.env`, enable both development
gates, supply strong local-only tokens, a confirmed E2E email/password, and the
local Supabase service-role key. Then run:

The checked-in scenario also exercises the monitor controls, so set
`UPWORK_MONITOR_PROVIDER=fake` before starting it.

```sh
RUN_E2E=true corepack pnpm test:e2e
```

The setup refuses a non-local Supabase URL, and the test-session endpoint is
hard-disabled in production. It exists only to avoid automating Google during
repeatable local tests.

## Compliance boundary

The product owner reports written confirmation from `mcp-support@upwork.com`
for recurring MCP discovery and internal user-preference scoring. Upwork
identified its hosted MCP endpoint, OAuth 2.1 dynamic registration,
`upwork__find_jobs`, the standard API rate ceiling, and a 30-day retention
limit. Live traffic is opt-in and fail-closed until the migrations are applied
in the target project and one bounded read-only connection test is completed.
Submission remains a manual handoff, and browser automation is still excluded.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and
[docs/UPWORK_MCP_SCOPE.md](docs/UPWORK_MCP_SCOPE.md) for the full decisions and
operational gate.

# Phase 1: Foundation and First Vertical Slice

## Status

**Checkpoints 1 and 2 are implemented as of 2026-08-21.** The key-free
fake-provider score loop, private knowledge indexing, workspace-scoped
retrieval, immutable proposal versions, authenticated review queue, and
Playwright scenario are in the repository. Unit/type/build checks pass.
Applying the migration and running the browser scenario still require local
Supabase/Docker plus the placeholder credentials described in the README; those
service-backed checks were not available in this environment.

The approved Upwork MCP monitor amendment is implemented as a separate,
worker-only read-only discovery slice. Proposal submission, browser
automation, and all other deferred features remain outside the approved scope.

**Phase 2 amendment (2026-08-15):** the product owner subsequently reported
written support approval for recurring Upwork MCP discovery and internal
preference scoring. The worker-only monitor, fixed `upwork__find_jobs` adapter,
encrypted OAuth lifecycle, automatic refresh, connection throttling,
campaign-safe job provenance, and 30-day cleanup are implemented. Live traffic
is still opt-in and requires deployment secrets plus one bounded read-only
smoke test. Application submission remains out of scope.

## Phase 1 outcome

A signed-in user can create an active campaign, inject a development job, and
watch an asynchronous pipeline produce a structured fit score and a proposal
for manual review.

The target screen must make this concrete:

```text
Campaign: AI Automation Projects                         ACTIVE

New job: Need Make.com + OpenAI automation expert
Fit score: 93

Why:
  - Strong technology match
  - Budget fits
  - Client characteristics fit
  - Relevant case studies found

Suggested bid: $1,800

[Generated Proposal]

Approve   Reject   Regenerate
```

The numbers and text above are an example, not a hard-coded fixture. The UI
must show processing, low-fit, and failed states honestly rather than implying
that an AI result exists before it has been stored.

## Scope boundary

### In scope

- Supabase Google OAuth authentication and one-owner workspace bootstrap.
- Campaign create/read/update/archive/delete with the approved `CampaignFilterV1`, AI
  instructions, and a campaign-specific score threshold. The form includes the
  supplied category, experience, job-type, rate/budget, proposal-count, client,
  location/time-zone, project-length, hours, and contract-to-hire filters;
  `My previous clients` remains unavailable until a trusted identity source
  exists.
- Authenticated, explicitly development-only job injection.
- Asynchronous normalization, source-key deduplication, and deterministic
  campaign matching.
- Background AI suitability scoring with a Zod-validated structured result.
- Knowledge-document upload/indexing, workspace-scoped retrieval, and
  proposal generation after a qualifying score.
- Proposal queue with immutable versions and manual Approve, Reject, and
  Regenerate actions.
- Postgres-backed leases/retries/idempotency, structured logs, basic
  `analytics_events`, Vitest, and Playwright coverage.

### Explicitly not in scope

- Real Upwork APIs/scraping, browser-driven discovery, or application
  automation. The separately approved worker-only MCP discovery amendment is
  documented in `docs/UPWORK_MCP_SCOPE.md` and remains opt-in at deployment.
- Application creation/submission, browser automation, Playwright against
  Upwork, credentials/cookies, or autonomous application policy.
- CRM, unified inbox, notifications, billing, teams/invites, multiple accounts,
  deployment automation, advanced analytics, dashboards, and data exports.
- Kubernetes, an event bus, a workflow engine, a second vector database, model
  routing, or user-configurable provider selection.

Approval of a proposal in Phase 1 records a human decision only. It must never
submit, queue, or simulate an Upwork application.

## Build sequence

The vertical slice is intentionally divided into two short checkpoints. Each
one produces a working system and lowers the risk of combining auth, queues,
AI, RAG, and UI debugging at once.

### Checkpoint 0 — repository/runtime foundation

Create the planned pnpm workspace, TypeScript/Tailwind/shadcn setup, Next.js
web app, worker entry point, Drizzle migrations, Supabase local configuration
including Google OAuth, Redis compose file, test configuration, and CI-quality
scripts. This is a small scaffold, not feature work.

Exit criteria:

- `pnpm lint`, `pnpm typecheck`, and `pnpm test` run locally.
- Local Supabase and Redis start without production credentials.
- Web and worker start as separate processes.
- A migration can be applied to an empty local database and rolled forward.

### Checkpoint 1 — score loop (first demonstrable slice)

Implement:

1. Google OAuth through Supabase Auth, SSR callback handling, and automatic
   one-owner workspace creation.
2. Campaign CRUD with the approved `CampaignFilterV1` JSON contract.
3. `POST /api/internal/dev/jobs`, guarded by authentication, workspace
   ownership, `DEV_INGESTION_ENABLED`, and `DEV_INGEST_TOKEN`.
4. `workflow_tasks` leasing/retry loop and `normalize-job`, `match-job`, and
   `analyze-match` handlers.
5. A deterministic filter evaluator shared by web validation/tests and worker.
6. A fake AI provider for local/e2e use plus a server-only OpenAI Responses
   adapter. The OpenAI path requires an explicitly configured key/model and
   validates strict structured output behind the same contract.
7. Campaign detail and proposal-queue UI that shows `processing`, `low fit`,
   score, reasons, risks, and suggested pricing.

Exit criteria:

- An injected job returns quickly with `202 Accepted` and a job reference; it
  does not call AI in the request.
- Repeating the identical injection produces no duplicate job, match, task, or
  score.
- A matching active campaign reaches an AI score; a below-threshold score ends
  at `LOW_FIT` and creates no proposal task.
- A retry or worker restart never creates duplicate visible score records.
- A Playwright test can sign in, create a campaign, inject a deterministic test
  job, and see a completed score using `AI_PROVIDER=fake`.

Implementation note: the Playwright scenario is checked in and uses a
double-gated, non-production test-session route so it never automates Google.
It has not been executed here because a local Supabase/Postgres stack and
Playwright Chromium binary were unavailable. Database integration tests are
likewise present and skip explicitly without `TEST_DATABASE_URL`.

This checkpoint corresponds to the first practical 3–4 hour objective:

```text
User -> Campaign -> Test Job -> Filter -> AI Score
```

### Checkpoint 2 — proposal loop (complete Phase 1 vertical slice; implemented)

Implement:

1. Private knowledge-document storage plus bounded text extraction/chunking and
   idempotent indexing tasks. Configured embedding providers persist validated
   `vector(1536)` values; deterministic token-overlap retrieval remains the
   offline fallback.
2. Workspace-scoped top-k retrieval for qualifying campaign/job matches.
3. `generate-proposal` task handler and immutable proposal-version storage.
4. Proposal queue UI with current version, provenance-aware status, and manual
   Approve, Reject, and Regenerate commands.
5. Audit/analytics events for score completion, proposal generation, and human
   review actions.

Exit criteria:

- A score at or above the campaign threshold queues exactly one logical
  proposal generation operation.
- The generated proposal references only knowledge chunks from its workspace.
- A regeneration produces a new immutable `ProposalVersion`; it does not
  overwrite or duplicate the Proposal aggregate.
- Approve and Reject are authorized, auditable, idempotent UI actions and have
  no application/submission side effect.
- The worker and web routes are wired for the complete campaign-to-proposal
  queue scenario with the fake provider. Vitest covers the pure contracts and
  migration shape; the browser/database scenarios remain service-dependent.

## Proposed user-facing routes

These routes are intentionally few. Names may be refined with the UI, but
their authority boundaries should remain stable.

| Surface | Purpose |
| --- | --- |
| `/sign-in` | Supabase Auth entry and callback handling. |
| `/auth/callback` | Server-side OAuth code exchange and safe post-login redirect. |
| `/app/campaigns` | Campaign list and create action. |
| `/app/campaigns/[campaignId]` | Campaign settings, matching jobs, processing state, and queue link. |
| `/app/knowledge` | Workspace-private text knowledge sources for proposal grounding. |
| `/app/proposals` | Workspace-scoped manual proposal review queue. |
| `POST /api/internal/dev/jobs` | Development-only test ingestion; never an Upwork integration endpoint. |

Browser clients do not call worker handlers or access job raw payloads. Server
commands validate input with Zod and enforce workspace ownership before writing
domain state and tasks.

## API and task contract sketch

### Development job injection

The endpoint should accept a small validated shape such as:

```ts
{
  workspaceId: string;
  sourceJobId: string;
  title: string;
  description: string;
  skills: string[];
  categoryIds?: string[];
  experienceLevel?: "entry" | "intermediate" | "expert";
  jobType: "hourly" | "fixed";
  hourlyRate?: { min?: number; max?: number; currency: "USD" };
  fixedBudget?: { min?: number; max?: number; currency: "USD" };
  proposalCount?: number;
  paymentVerified?: boolean;
  client?: {
    countryCode?: string;
    timeZone?: string;
    hireCount?: number;
  };
  projectLengthBand?: "under_1_month" | "one_to_three_months" |
    "three_to_six_months" | "over_6_months";
  hoursPerWeekBand?: "under_30" | "over_30";
  isContractToHire?: boolean;
}
```

The final implementation may preserve a bounded raw source payload internally,
but the injection schema must be stable, validated, and safe to repeat. All
money in the development endpoint is USD; it must not silently invent foreign
exchange conversions. The live availability counts in the supplied search UI
are intentionally not accepted—they require a future approved discovery
source.

### Initial task kinds

```text
normalize-job          payload: job id + source payload hash
match-job              payload: job id + normalized revision
analyze-match          payload: match id + deterministic input hash
index-knowledge-doc    payload: document id + content hash
generate-proposal      payload: match id + proposal input/generation key
```

Each task type has a Zod payload schema, a max retry policy, a deterministic
dedupe key, and a testable handler. The task table—not the client, Redis, or
analytics event—is the source of execution truth.

## State ownership

| State | Owning aggregate | How it changes |
| --- | --- | --- |
| Campaign lifecycle | `Campaign` | User command after ownership/filter validation. |
| Job normalization | `Job` | `normalize-job` worker task. |
| Match pipeline | `CampaignJobMatch` | Worker handlers conditionally advance it. |
| AI result | `AIScore` | Worker inserts validated, immutable result. |
| Knowledge availability | `KnowledgeDocument` | Indexing handler writes chunks then marks it ready. |
| Proposal review | `Proposal` / `ProposalVersion` | Worker creates versions; user changes manual review status. |
| Retry/lease | `WorkflowTask` | Worker runtime only. |

No analytics event, UI state, or Redis key is permitted to become the source of
truth for one of these state machines.

## Qualification threshold

The AI suitability score answers one operational question: **should this match
consume proposal-generation time and AI budget?** Each campaign stores its own
threshold from 0–100. The initial default is **75**:

- score `75–100`: generate a proposal and show it for manual review;
- score `0–74`: retain the score/reasons in the campaign history but mark the
  match `LOW_FIT`; do not generate a proposal.

This is not a permanent business rule or an automatic application decision. A
lower threshold creates more proposal candidates, including more weak ones; a
higher threshold creates fewer candidates but can miss jobs that a person
would have wanted to review. Starting at 75 biases the launch toward avoiding
wasted proposal work. The campaign owner can tune it after seeing real results.

## Testing strategy

| Layer | Tool | Required coverage |
| --- | --- | --- |
| Pure domain | Vitest | Zod schemas, filter decisions/evidence, threshold behavior, state transition guards, input hashes. |
| Database/worker integration | Vitest + local Supabase Postgres | migrations, unique constraints, row leasing, lease recovery, retries, tenant scoping, dedupe, proposal versions. |
| Web workflow | Playwright | Auth, campaign create, test-job injection, progress polling, score display, proposal review actions. |
| AI | Fake provider by default | Deterministic test outputs. One separately configured adapter contract test may run only with a real credential. |

Do not make Playwright tests depend on a real OpenAI call, a public network,
Upwork, timeouts intended to hide race conditions, or a developer's existing
session.

## Operational rules for Phase 1

- Mutating HTTP commands either complete a small database operation or enqueue
  a task and return; they do not synchronously run an AI workflow.
- Worker handlers are at-least-once safe. They claim a lease, re-check state,
  write the result plus next task transactionally, and only then mark work
  successful.
- Logs contain task ID, entity ID, workspace ID, retry count, handler, and
  sanitized failure code. They never contain API keys, session tokens, raw
  private documents, or full unredacted prompts by default.
- UI uses short polling for status in Phase 1; no WebSocket/realtime
  architecture is added.
- Campaign edits apply to new ingests only. There is no automatic rematch or
  rescore/backfill until users explicitly need that behavior.

## Definition of done

Phase 1 is done only when all of the following are true:

- The full happy path works locally with the fake provider and persists through
  a web/worker restart.
- The OpenAI path is optional and uses a server-side environment variable; no
  key, model output schema, or secret is hard-coded into source.
- Every implemented Phase 1 persistent entity has a migration, ownership
  boundary, validation point, and meaningful index/constraint. `Application`
  remains a documented future schema until its worker milestone is approved.
- A duplicate request/task and a simulated worker crash do not create duplicate
  user-visible artifacts.
- A user can inspect why a job matched, why it scored as it did, and the exact
  proposal version they approve or reject.
- No code paths initiate discovery, application submission, or browser
  automation.

## Deferred milestone map

```text
Phase 1: manual vertical slice
  Auth -> Campaign -> Dev Job -> Match -> AI -> KB -> Proposal review

Phase 2: approved discovery foundation (fake-backed; live adapter still gated)
  Approved MCP seam -> durable poll -> Normalize/Dedupe -> Match -> Preference + AI

Phase 3: application path only if explicitly allowed by that approved API scope
  Approved immutable proposal -> permitted API adapter -> submit -> verify
  Otherwise: manual copy/open handoff; never browser automation
```

The product-level Phase 2 approval is recorded. The worker boundary now owns a
durable poll schedule. Support has supplied the hosted endpoint, OAuth
protocol, discovery tool name, standard rate ceiling, and retention limit. The
authenticated schema and one bounded response are captured, and the fixed
worker mapping adapter, fixed remote transport, automatic refresh/disconnect,
rate handling, campaign-safe provenance, and retention schedule are tested.
Hosted activation still requires migrations and one bounded read-only smoke
test. Phase 3 needs separate explicit approval. No phase authorizes
Chromium, scraping, browser cookies, or direct website automation.

## Decisions to obtain before implementation

The following decisions are now recorded:

1. **Auth:** Google OAuth through Supabase; no email magic-link setup in the
   initial slice.
2. **Filters:** implement the documented `CampaignFilterV1`; keep `My previous
   clients` disabled until a trusted client-history data source exists.
3. **Qualification:** default campaign threshold is 75, campaign-configurable.
4. **Deployment default:** Railway Hobby plus Supabase Singapore, with Fly
   Mumbai plus Supabase Mumbai as the deliberate alternative for an India-first
   customer/data-location requirement.

The supplied non-secret operational facts are recorded in
`UPWORK_MCP_SCOPE.md`. Apply the migrations and complete the hosted read-only
verification gate there before live Phase 2 traffic. Phase 3 submission
behavior remains a separate gate. Do not infer permission from a browser login
or use Playwright as a substitute.

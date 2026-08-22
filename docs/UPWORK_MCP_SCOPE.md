# Upwork MCP approval and implementation scope

## Recorded decision

On 2026-08-15, the product owner reported receiving written confirmation from
`mcp-support@upwork.com` to build the two requested features:

1. unattended recurring job discovery through Upwork MCP; and
2. internal ranking of discovered jobs against each user's explicit campaign
   filters and scoring weights.

This record authorizes the narrow product direction. It does not place the
private email, OAuth credentials, or tokens in the repository.

## Confirmed technical values

On 2026-08-16, the product owner supplied the following implementation details
from the same Upwork support exchange:

| Field | Confirmed value | Engineering interpretation |
| --- | --- | --- |
| Remote server | `https://mcp.upwork.com/mcp` | Hosted Streamable HTTP MCP server; no local Upwork process or browser automation. |
| Authorization | OAuth 2.1 with dynamic client registration | Every workspace owner must complete Upwork's browser consent flow. This product must persist only encrypted, server-side OAuth material or an opaque secret-store reference and must support refresh, reconnect, and disconnect. |
| Approved discovery tool | `upwork__find_jobs` | The live adapter may expose this read operation through `UpworkMcpPort.searchJobs`; the other listed Upwork tools remain unavailable to application code. |
| Ranking/scoring | Approved | Scoring remains deterministic, based on explicit campaign filters and user-selected weights, versioned, and visibly separate from any Upwork ranking. |
| Retention | 30 days | Upwork-derived job content and dependent artifacts are hard-deleted at the 30-day `last_seen_at` boundary by a durable connection-scoped cleanup task. |
| Sandbox | None | Development uses fake fixtures by default. Any live verification must be read-only, explicitly authorized, low-volume, and performed against a deliberately chosen Upwork account. |

Support also quoted the standard API ceiling as 10 requests per second or up
to 300 requests per minute per IP address. That is recorded as a ceiling, not
as permission or a recommendation to poll at that frequency, and it was not
identified as an MCP-specific per-user cadence. The launch default therefore
remains one search per active campaign every five minutes, with server-provided
rate-limit/retry guidance taking precedence and exponential backoff on
temporary failures.

The authenticated MCP `tools/list` response and read-only
`upwork__get_tool_help({ tool_name: "find_jobs" })` response were inspected on
2026-08-16. The authenticated client exposes `upwork__find_jobs`; its `search`
action requires the account `org_uid`, accepts a cursor-based page of one to ten
jobs, and supports the documented query, job-type, experience, budget,
proposal-count, verified-payment, client-hire, time-zone, location, and recency
parameters. It has no posted-after parameter. The first bounded read-only call
returned the expected text-content MCP envelope, a `jobs` list, `pageInfo`,
`next_cursor`, and listing fields including ID, title, description snippet,
skills, type, experience, proposal count, duration, engagement, client country,
and publication timestamps.

The worker now freezes that observed shape in a Zod-validated, fixed-tool
adapter. It accepts only a connection ID and a `find_jobs` search request—there
is no generic `callTool(name, payload)` route. Its short-lived Streamable HTTP
transport uses the official MCP TypeScript client and invokes exactly
`upwork__find_jobs`; it takes a server-side access-token/org-UID resolver rather
than a browser session. The encrypted AES-256-GCM vault,
workspace/connection-bound resolver, and a user-directed PKCE/DCR
connect/callback flow are implemented. The flow stores only ciphertext and
does not invoke any discovery tool. Runtime discovery is enabled only when the
deployment explicitly sets `UPWORK_MONITOR_PROVIDER=mcp` and supplies the
required encrypted credential key, HTTPS callback, and non-placeholder
approval reference.

`upwork__find_jobs` requires an `org_uid`. The connection flow deliberately
does not call another tool to discover accounts, because no tool other than
`find_jobs` is exposed to application code in this scope. Until the owner has
an approved, explicit account-selection source, the worker resolver fails
closed for a connected credential with no stored `org_uid`.

## Public-terms baseline

The [Upwork API & MCP Terms, version 2.3](https://www.upwork.com/legal#api),
effective 2026-08-13, are the default boundary for anything the support email
does not expressly change. In particular, the public terms distinguish a
specific user-directed search from continuous corpus monitoring and distinguish
principal-specified filters from agent-determined ranking criteria. They also
limit retention of MCP output to the time reasonably needed for the user's
task, never more than 30 days absent separate written consent.

Upwork's terms allow it to modify licensed rights through written notice to a
specific developer. Accordingly, production activation requires the retained
support response to expressly cover recurring per-user discovery and internal
scoring; the fact that a score is visible only inside this product is not, by
itself, the permission. This document is an engineering gate, not legal advice.

## Current executable boundary

The checked-in implementation is deliberately fail-closed:

- `UPWORK_MONITOR_PROVIDER=disabled` is the default and `fake` is rejected in
  production;
- `mcp` is a fixed, read-only `upwork__find_jobs` provider. It uses the
  encrypted OAuth credential vault, automatic refresh, server retry guidance,
  and connection-scoped serialization; there is no generic tool caller;
- OAuth reconnect and disconnect are explicit user-directed controls. Disconnect
  pauses monitors and erases the encrypted credential and authorization rows;
- the web process owns only short, user-directed OAuth consent/callback
  exchanges. Only the worker owns `UpworkMcpPort` discovery calls and durable
  schedules;
- every discovered MCP job is reduced immediately to a bounded Zod contract;
  only that bounded source payload is stored for the approved retention window;
- every job has an enforced `workspace_id`, and each MCP job also has a
  server-only monitor observation. MCP jobs can match only the active campaign
  whose monitor actually observed that job;
- a durable cleanup schedule runs independently of monitor pause/reauthorization
  and removes expired MCP jobs plus dependent matches, scores, task references,
  and analytics references;
- the score is deterministic, versioned, and explained component by component;
  AI suitability remains a separate artifact.

## Live-traffic readiness

The support response resolves the product-level approval and identifies the
server, authorization protocol, discovery tool, scoring permission, and
retention ceiling. The implementation gates are now checked in:

| Field | Status before `UPWORK_MONITOR_PROVIDER=mcp` may be enabled |
| --- | --- |
| Permitted MCP tool/action | Complete: `upwork__find_jobs` / read-only `search` is the only callable operation. |
| Cadence and rate handling | Complete in code: five-minute conservative default, per-connection serialization, bounded `Retry-After`, and capped backoff. |
| User consent | Complete in code: user-directed connect/callback, reconnect state, disconnect control, and tenant-scoped credential erasure. |
| Retention | Complete in code/migrations: 30-day hard deletion and durable cleanup successor; run against the target Postgres before production traffic. |
| Human review | Discovery is read-only. No write tools are in this scope. |
| OAuth/credential storage | Complete in code: AES-256-GCM credential and browser-state vault, OAuth 2.1 PKCE/DCR, automatic refresh with rotation, and fail-closed reconnect behavior. |
| Approval reference | Store only a non-secret internal reference to the retained email/decision. |
| Live verification | External launch gate: execute one bounded read-only smoke test after the owner connects a deliberately chosen test/development account in this deployment. |

The live adapter must expose only approved discovery through the narrow port.
It must not introduce a generic `callTool(name, payload)` escape hatch.

### Captured discovery contract and remaining live gate

The worker makes at most one `search` call per monitor run, uses
`sort=recency`, and requests no more than ten listings. When the response
contains an opaque `next_cursor`, it is persisted on that monitor and sent on
the next run; a successful terminal page clears it. Provider failures retain
the previous cursor, so retries do not silently restart traversal. This keeps
each run bounded while allowing a 24/7 monitor to advance through pages.
The adapter maps only filters whose remote semantics were confirmed by tool
help. It derives a query from user-selected required skills and include
keywords, and maps these single-valued campaign filters to the remote request
when selected: job type, experience, the matching type's positive budget range,
proposal count, verified payment, client-hire range, and client time zone.
Multi-value filters and all other rules remain local deterministic checks.
The campaign UI also supports a local publication-age guard (last hour, six
hours, or 24 hours); the worker evaluates it against the poll's explicit
timestamp and fails closed when the provider omitted `published_date`.

The live response currently supports source mapping for ID, title, description
snippet (always treated as untrusted marketplace content), skills, job type,
experience level, proposal count, project duration, weekly-hours band, and
publication timestamp (stored as nullable `jobs.posted_at`). `verified_payment_only=true` is represented as verified
only because the upstream query itself imposed that condition. A two-letter
client country code is accepted if the server provides one; the captured full
country name is deliberately not guessed. Categories, client time zone/hire
values (including the client's percentage hire rate requested in the
exploratory search), contract-to-hire, explicit rate ranges, and fixed budget
fields are not invented from incomplete output. The campaign now exposes a
client-hire-rate range and maps it when the provider supplies a bounded
percentage; the captured response did not provide that field, so a selected
rate filter correctly fails closed until further approved response evidence is
captured. An explicit fixed-price `budget` value is preserved as a single-point
USD range (including explicit ranges); an explicit hourly `budget` plus a rate-stated
`hourly_budget_type` is parsed as a validated USD range, while values such as
`no rate stated` remain unset.

Before setting `UPWORK_MONITOR_PROVIDER=mcp` in a hosted environment, apply all
listed migrations, run the service-backed retention/provenance tests, set the
final HTTPS callback URL, and perform one bounded read-only smoke test. Keep
real monitors paused until that deployment check is complete.

## Explicitly excluded

- proposal submission, offer acceptance, milestones, payments, or other
  binding actions;
- scraping, browser automation, session-cookie reuse, or extensions;
- hidden scoring criteria or a score presented as an Upwork-generated ranking;
- autonomous actions outside the exact written scope.

Any future submission capability is a separate scope decision and remains a
manual handoff unless explicitly approved and implemented with Upwork's
confirmation requirements.

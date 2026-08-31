# Deployment

The first production shape is two services plus one Supabase project:

| Service | Runtime | Purpose |
| --- | --- | --- |
| Web | Railway service using `deploy/web.Dockerfile` | Next.js UI, auth, commands, and the user-directed OAuth callback |
| Worker | Railway service using `deploy/worker.Dockerfile` | Persistent Postgres task worker, read-only Upwork MCP polling, normalization, matching, and scoring |
| Data/auth | Supabase project in the same region | Postgres, Auth, Storage, backups, and RLS |

Railway checks `/api/health`; it performs bounded database and schema probes
for the core workflow, Upwork, proposal, and embedding tables and returns HTTP
503 when the web process cannot reach Postgres or migrations are incomplete.

Railway is the recommended low-operations starting point. Create two Railway
services from the same repository and select the matching JSON template under
`deploy/`. Keep the worker at one replica and `WORKER_CONCURRENCY=1`. Use a
Supabase region close to the customer base; Singapore is the default recorded
in the architecture decision, with Mumbai as the India-first alternative.

## Required web variables

Set these as Railway secrets/variables; do not commit them:

```text
APP_URL=https://<final-app-domain>
NEXT_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<supabase-anon-key>
DATABASE_URL=<supabase-pooled-connection-string>
UPWORK_MONITOR_PROVIDER=mcp
UPWORK_MCP_CREDENTIAL_ENCRYPTION_KEY=<base64-32-byte-secret>
UPWORK_MCP_OAUTH_REDIRECT_URL=https://<final-app-domain>/api/upwork/oauth/callback
UPWORK_MCP_APPROVAL_REFERENCE=<internal-ticket-or-email-reference>
DEV_INGESTION_ENABLED=false
E2E_AUTH_ENABLED=false
```

`APP_URL` and `UPWORK_MCP_OAUTH_REDIRECT_URL` must use the final HTTPS domain.
Never set `APP_URL` to Railway's internal listener (`0.0.0.0`), localhost, or a
container hostname; browser-facing auth and sign-out redirects are built from
this canonical URL, and production validation rejects loopback hosts. The
callback URL must also be registered with the Upwork MCP OAuth client
configuration. The encryption secret is a server-only 32-byte key encoded as
base64; generate it locally and enter it directly into Railway's secret store.

## Required worker variables

```text
DATABASE_URL=<supabase-pooled-connection-string>
DIRECT_DATABASE_URL=<supabase-direct-connection-string>
AI_PROVIDER=openai
OPENAI_API_KEY=<server-side-openai-key>
OPENAI_TEXT_MODEL=<approved-model-id>
OPENAI_EMBEDDING_MODEL=<optional-embedding-model-id>
UPWORK_MONITOR_PROVIDER=mcp
UPWORK_MCP_CREDENTIAL_ENCRYPTION_KEY=<same-base64-32-byte-secret>
UPWORK_MCP_OAUTH_REDIRECT_URL=https://<final-app-domain>/api/upwork/oauth/callback
WORKER_CONCURRENCY=1
WORKER_HEALTH_PORT=8080
WORKER_POLL_INTERVAL_MS=3000
```

The web and worker must use the same encryption secret and the same database.
`SUPABASE_SERVICE_ROLE_KEY` is not required by the production runtime; keep it
only in a local E2E/admin environment if needed. Never put `OPENAI_API_KEY`,
`OPENAI_EMBEDDING_MODEL`, or the encryption key in a `NEXT_PUBLIC_` variable.
The worker health service listens on `/health` at `WORKER_HEALTH_PORT`; Railway
should use that path as the worker service health check.

## Release sequence

1. Run the local release gate before pushing an image:

   ```sh
   pnpm release:check
   ```

   In the deployment environment, run the secret-safe production preflight
   before the first deploy. It reports only missing variable names and never
   prints secret values:

   ```sh
   pnpm preflight:production
   ```

2. Create the Supabase project and configure Google identity-only OAuth
   (`openid email profile`) in Supabase Auth.
3. Apply every SQL migration in `supabase/migrations/` to the target project
   (`pnpm db:push` / `supabase db push` from a configured Supabase CLI project,
   or your reviewed migration runner). Do not use runtime schema
   synchronization.
4. Deploy the web and worker services from the matching Railway templates.
5. Open the app, sign in, enter the Upwork organization UID, and complete the
   user-directed OAuth consent flow.
6. Run one bounded read-only `find_jobs` smoke test on the deliberately chosen
   account. Confirm one page, no write tools, and the expected next durable
   poll task before enabling the monitor.

### Railway/Supabase handoff checklist

The repository is deployment-ready, but the final hosted environment cannot be
created from source control alone. The owner must create (or invite the
deployment operator to) one Supabase project and one Railway project. In
Railway, create two services from this repository: select `deploy/railway-web.json`
for the web service and `deploy/railway-worker.json` for the worker service.
Attach the same repository revision and set the variables listed above on each
service; copy the shared database URL and encryption secret exactly, while
keeping the worker's service-role and OpenAI variables worker-only. Generate the
public web domain first, then set `APP_URL` and the OAuth callback to that final
origin before connecting Upwork.

Do not paste any secret into an issue, chat, commit, or build log. The only
values safe to share with an operator are the Supabase project URL, Railway
service names, final public domain, and a non-secret approval-reference label.

The product does not use browser automation or Upwork cookies. The only browser
step is the user's OAuth consent page; all recurring discovery runs in the
worker through the approved remote MCP tool.

## Rollback and pause

To stop discovery without deleting data, set `UPWORK_MONITOR_PROVIDER=disabled`
and redeploy, or pause monitors in the app. To remove a connected account,
use Disconnect in the app; this pauses its monitors and erases the encrypted
OAuth rows. Keep the durable retention worker running so the 30-day cleanup
continues for previously retrieved MCP data.

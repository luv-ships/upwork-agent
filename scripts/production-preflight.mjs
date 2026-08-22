import { existsSync } from "node:fs";

const errors = [];

function required(name) {
  if (typeof process.env[name] !== "string" || process.env[name].trim() === "") {
    errors.push(`${name} is required`);
  }
}

function assertHttps(name) {
  const value = process.env[name];
  if (typeof value !== "string" || value.trim() === "") return;
  try {
    if (new URL(value).protocol !== "https:") errors.push(`${name} must use HTTPS`);
  } catch {
    errors.push(`${name} must be a valid URL`);
  }
}

function assertSameOrigin(leftName, rightName) {
  const left = process.env[leftName];
  const right = process.env[rightName];
  if (typeof left !== "string" || typeof right !== "string") return;
  try {
    if (new URL(left).origin !== new URL(right).origin) {
      errors.push(`${leftName} and ${rightName} must use the same origin`);
    }
  } catch {
    // The individual URL checks report the useful validation error.
  }
}

function assertBase64Bytes(name, byteLength) {
  const value = process.env[name];
  if (typeof value !== "string" || value.trim() === "") return;
  try {
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) {
      errors.push(`${name} must be valid base64`);
      return;
    }
    if (Buffer.from(value, "base64").length !== byteLength) {
      errors.push(`${name} must decode to exactly ${byteLength} bytes`);
    }
  } catch {
    errors.push(`${name} must be valid base64`);
  }
}

const requiredProductionValues = [
  "APP_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "DATABASE_URL",
  "DIRECT_DATABASE_URL",
  "OPENAI_API_KEY",
  "OPENAI_TEXT_MODEL",
  "UPWORK_MCP_CREDENTIAL_ENCRYPTION_KEY",
  "UPWORK_MCP_OAUTH_REDIRECT_URL",
  "UPWORK_MCP_APPROVAL_REFERENCE",
];

for (const name of requiredProductionValues) required(name);

if (process.env.NODE_ENV !== "production") errors.push("NODE_ENV must be production");
if (process.env.AI_PROVIDER !== "openai") errors.push("AI_PROVIDER must be openai");
if (process.env.UPWORK_MONITOR_PROVIDER !== "mcp") {
  errors.push("UPWORK_MONITOR_PROVIDER must be mcp");
}
const productionPollInterval = Number(process.env.UPWORK_MCP_MIN_POLL_INTERVAL_SECONDS ?? "300");
if (!Number.isInteger(productionPollInterval) || productionPollInterval < 300 || productionPollInterval > 86_400) {
  errors.push("UPWORK_MCP_MIN_POLL_INTERVAL_SECONDS must be an integer from 300 to 86400 in production");
}
if (process.env.UPWORK_MCP_APPROVAL_REFERENCE === "local-fake") {
  errors.push("UPWORK_MCP_APPROVAL_REFERENCE must be a real internal approval reference");
}
if (process.env.DEV_INGESTION_ENABLED === "true") {
  errors.push("DEV_INGESTION_ENABLED must not be true");
}
if (process.env.E2E_AUTH_ENABLED === "true") errors.push("E2E_AUTH_ENABLED must not be true");
if (process.env.WORKER_CONCURRENCY !== undefined && process.env.WORKER_CONCURRENCY !== "1") {
  errors.push("WORKER_CONCURRENCY must be 1");
}

assertHttps("APP_URL");
assertHttps("NEXT_PUBLIC_SUPABASE_URL");
assertHttps("UPWORK_MCP_OAUTH_REDIRECT_URL");
assertSameOrigin("APP_URL", "UPWORK_MCP_OAUTH_REDIRECT_URL");
assertBase64Bytes("UPWORK_MCP_CREDENTIAL_ENCRYPTION_KEY", 32);

if (typeof process.env.UPWORK_MCP_OAUTH_REDIRECT_URL === "string") {
  try {
    if (new URL(process.env.UPWORK_MCP_OAUTH_REDIRECT_URL).pathname !== "/api/upwork/oauth/callback") {
      errors.push("UPWORK_MCP_OAUTH_REDIRECT_URL must end in /api/upwork/oauth/callback");
    }
  } catch {
    // The URL validator above reports malformed values.
  }
}

for (const name of [
  "OPENAI_API_KEY",
  "DATABASE_URL",
  "DIRECT_DATABASE_URL",
  "UPWORK_MCP_CREDENTIAL_ENCRYPTION_KEY",
]) {
  if (process.env[`NEXT_PUBLIC_${name}`] !== undefined) {
    errors.push(`${name} must not have a NEXT_PUBLIC_ variant`);
  }
}

for (const migration of [
  "202608120001_phase1_score_loop.sql",
  "202608150001_phase2_upwork_monitor.sql",
  "202608160001_upwork_retention.sql",
  "202608160003_upwork_oauth_credentials.sql",
  "202608170001_upwork_oauth_authorizations.sql",
  "202608180001_upwork_job_observations.sql",
  "202608180002_upwork_job_posted_at.sql",
  "202608180003_upwork_monitor_cursor.sql",
  "202608180004_upwork_client_hire_rate.sql",
  "202608180005_phase1_proposals.sql",
  "202608210001_knowledge_embeddings.sql",
  "202608160002_seed_upwork_retention_tasks.sql",
]) {
  if (!existsSync(`supabase/migrations/${migration}`)) {
    errors.push(`missing migration ${migration}`);
  }
}

if (errors.length > 0) {
  console.error("Production preflight failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log("Production preflight passed: required configuration and reviewed migrations are present.");
}

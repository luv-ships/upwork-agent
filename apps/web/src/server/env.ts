import { z } from "zod";

const optionalSecret = z.preprocess(
  (value) => (typeof value === "string" && value.trim().length === 0 ? undefined : value),
  z.string().min(16).optional()
);
const optionalEmail = z.preprocess(
  (value) => (typeof value === "string" && value.trim().length === 0 ? undefined : value),
  z.email().optional()
);
const optionalHttpsUrl = z.preprocess(
  (value) => (typeof value === "string" && value.trim().length === 0 ? undefined : value),
  z
    .url()
    .max(2_000)
    .refine((value) => new URL(value).protocol === "https:", "must use https")
    .optional()
);

const optionalEncryptionKey = z.preprocess(
  (value) => (typeof value === "string" && value.trim().length === 0 ? undefined : value),
  z
    .string()
    .refine(
      (value) =>
        /^[A-Za-z0-9+/]+={0,2}$/.test(value) &&
        value.length % 4 === 0 &&
        Buffer.from(value, "base64").length === 32,
      "must be a base64-encoded 32-byte value",
    )
    .optional(),
);

const publicEnvironmentSchema = z.object({
  APP_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development")
});

const serverEnvironmentSchema = publicEnvironmentSchema.extend({
  DATABASE_URL: z.string().min(1),
  E2E_AUTH_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  E2E_AUTH_EMAIL: optionalEmail,
  E2E_AUTH_TOKEN: optionalSecret,
  DEV_INGESTION_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  DEV_INGEST_TOKEN: optionalSecret,
  UPWORK_MONITOR_PROVIDER: z.enum(["disabled", "fake", "mcp"]).default("disabled"),
  UPWORK_MCP_CREDENTIAL_ENCRYPTION_KEY: optionalEncryptionKey,
  UPWORK_MCP_MIN_POLL_INTERVAL_SECONDS: z.coerce
    .number()
    .int()
    .min(60)
    .max(86_400)
    .default(300),
  UPWORK_MCP_OAUTH_REDIRECT_URL: optionalHttpsUrl,
  UPWORK_MCP_APPROVAL_REFERENCE: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .default("local-fake")
});

export type ServerEnvironment = z.infer<typeof serverEnvironmentSchema>;

export function getPublicEnvironment() {
  const environment = publicEnvironmentSchema.parse({
    APP_URL: process.env.APP_URL,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NODE_ENV: process.env.NODE_ENV
  });

  assertPublicApplicationUrl(environment.APP_URL, environment.NODE_ENV);
  return environment;
}

export function getServerEnvironment(): ServerEnvironment {
  const environment = serverEnvironmentSchema.parse({
    APP_URL: process.env.APP_URL,
    DATABASE_URL: process.env.DATABASE_URL,
    NODE_ENV: process.env.NODE_ENV,
    DEV_INGESTION_ENABLED: process.env.DEV_INGESTION_ENABLED,
    DEV_INGEST_TOKEN: process.env.DEV_INGEST_TOKEN,
    E2E_AUTH_ENABLED: process.env.E2E_AUTH_ENABLED,
    E2E_AUTH_EMAIL: process.env.E2E_AUTH_EMAIL,
    E2E_AUTH_TOKEN: process.env.E2E_AUTH_TOKEN,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    UPWORK_MONITOR_PROVIDER: process.env.UPWORK_MONITOR_PROVIDER,
    UPWORK_MCP_CREDENTIAL_ENCRYPTION_KEY:
      process.env.UPWORK_MCP_CREDENTIAL_ENCRYPTION_KEY,
    UPWORK_MCP_MIN_POLL_INTERVAL_SECONDS:
      process.env.UPWORK_MCP_MIN_POLL_INTERVAL_SECONDS,
    UPWORK_MCP_OAUTH_REDIRECT_URL: process.env.UPWORK_MCP_OAUTH_REDIRECT_URL,
    UPWORK_MCP_APPROVAL_REFERENCE: process.env.UPWORK_MCP_APPROVAL_REFERENCE
  });

  if (environment.DEV_INGESTION_ENABLED && !environment.DEV_INGEST_TOKEN) {
    throw new Error(
      "DEV_INGEST_TOKEN is required when DEV_INGESTION_ENABLED is true."
    );
  }

  assertPublicApplicationUrl(environment.APP_URL, environment.NODE_ENV);

  if (environment.NODE_ENV === "production" && environment.DEV_INGESTION_ENABLED) {
    throw new Error("Development job ingestion cannot be enabled in production.");
  }

  if (
    environment.NODE_ENV === "production" &&
    environment.UPWORK_MONITOR_PROVIDER === "fake"
  ) {
    throw new Error("The fake Upwork monitor cannot be enabled in production.");
  }

  if (environment.UPWORK_MONITOR_PROVIDER === "mcp") {
    if (environment.NODE_ENV === "production" && environment.UPWORK_MCP_MIN_POLL_INTERVAL_SECONDS < 300) {
      throw new Error("Production MCP monitoring requires a poll interval of at least 300 seconds.");
    }
    if (
      environment.UPWORK_MCP_CREDENTIAL_ENCRYPTION_KEY === undefined ||
      environment.UPWORK_MCP_OAUTH_REDIRECT_URL === undefined
    ) {
      throw new Error(
        "Live Upwork monitoring requires the encryption key and HTTPS OAuth callback."
      );
    }
    if (environment.UPWORK_MCP_APPROVAL_REFERENCE === "local-fake") {
      throw new Error(
        "Live Upwork monitoring requires a non-placeholder approval reference."
      );
    }
    if (
      new URL(environment.UPWORK_MCP_OAUTH_REDIRECT_URL).origin !==
      new URL(environment.APP_URL).origin
    ) {
      throw new Error("Upwork OAuth callback must use the APP_URL origin.");
    }
  }

  if (
    environment.E2E_AUTH_ENABLED &&
    (!environment.E2E_AUTH_TOKEN || !environment.E2E_AUTH_EMAIL)
  ) {
    throw new Error("E2E auth requires E2E_AUTH_TOKEN and E2E_AUTH_EMAIL.");
  }

  if (environment.NODE_ENV === "production" && environment.E2E_AUTH_ENABLED) {
    throw new Error("E2E auth cannot be enabled in production.");
  }

  return environment;
}

function assertPublicApplicationUrl(appUrl: string, nodeEnvironment: ServerEnvironment["NODE_ENV"]): void {
  if (nodeEnvironment !== "production") return;

  const url = new URL(appUrl);
  if (url.protocol !== "https:") {
    throw new Error("APP_URL must use HTTPS in production.");
  }

  if (["0.0.0.0", "127.0.0.1", "::1", "[::1]", "localhost"].includes(url.hostname)) {
    throw new Error("APP_URL must use the public application hostname in production.");
  }
}

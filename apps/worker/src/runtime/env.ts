import { z } from "zod";

const optionalNonEmptyString = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().min(1).optional(),
);

const optionalHttpsUrl = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z
    .url()
    .max(2_000)
    .refine((value) => new URL(value).protocol === "https:", "must use https")
    .optional(),
);

const optionalEncryptionKey = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
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

const workerEnvSchema = z
  .object({
    AI_PROVIDER: z.enum(["fake", "openai"]).default("fake"),
    DATABASE_URL: z.string().min(1),
    DIRECT_DATABASE_URL: optionalNonEmptyString,
    LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    OPENAI_API_KEY: optionalNonEmptyString,
    OPENAI_EMBEDDING_MODEL: optionalNonEmptyString,
    OPENAI_TEXT_MODEL: optionalNonEmptyString,
    UPWORK_MONITOR_PROVIDER: z.enum(["disabled", "fake", "mcp"]).default("disabled"),
    UPWORK_MCP_CREDENTIAL_ENCRYPTION_KEY: optionalEncryptionKey,
    UPWORK_MCP_MIN_POLL_INTERVAL_SECONDS: z.coerce
      .number()
      .int()
      .min(60)
      .max(86_400)
      .default(300),
    UPWORK_MCP_OAUTH_REDIRECT_URL: optionalHttpsUrl,
    WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(1).default(1),
    WORKER_HEALTH_PORT: z.coerce.number().int().min(0).max(65_535).default(0),
    WORKER_ID: z.string().trim().min(1).max(128).default("local-worker-1"),
    WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(100).max(60_000).default(3_000),
  })
  .superRefine((value, context) => {
    if (value.NODE_ENV === "production" && value.UPWORK_MONITOR_PROVIDER === "fake") {
      context.addIssue({
        code: "custom",
        message: "cannot be fake in production",
        path: ["UPWORK_MONITOR_PROVIDER"],
      });
    }
    if (
      value.UPWORK_MONITOR_PROVIDER === "mcp" &&
      value.UPWORK_MCP_CREDENTIAL_ENCRYPTION_KEY === undefined
    ) {
      context.addIssue({
        code: "custom",
        message: "is required when UPWORK_MONITOR_PROVIDER=mcp",
        path: ["UPWORK_MCP_CREDENTIAL_ENCRYPTION_KEY"],
      });
    }
    if (value.NODE_ENV === "production" && value.UPWORK_MONITOR_PROVIDER === "mcp" && value.UPWORK_MCP_MIN_POLL_INTERVAL_SECONDS < 300) {
      context.addIssue({
        code: "custom",
        message: "production MCP monitoring requires at least 300 seconds",
        path: ["UPWORK_MCP_MIN_POLL_INTERVAL_SECONDS"],
      });
    }
    if (value.AI_PROVIDER !== "openai") {
      return;
    }

    if (value.OPENAI_API_KEY === undefined) {
      context.addIssue({
        code: "custom",
        message: "is required when AI_PROVIDER=openai",
        path: ["OPENAI_API_KEY"],
      });
    }

    if (value.OPENAI_TEXT_MODEL === undefined) {
      context.addIssue({
        code: "custom",
        message: "is required when AI_PROVIDER=openai",
        path: ["OPENAI_TEXT_MODEL"],
      });
    }
  });

export type WorkerConfig = {
  aiProvider: "fake" | "openai";
  databaseUrl: string;
  logLevel: "debug" | "info" | "warn" | "error";
  nodeEnv: "development" | "test" | "production";
  openAiApiKey?: string;
  openAiEmbeddingModel?: string;
  openAiTextModel?: string;
  upworkMcpCredentialEncryptionKey?: string;
  upworkMonitorProvider: "disabled" | "fake" | "mcp";
  upworkMcpMinPollIntervalSeconds: number;
  upworkMcpOauthRedirectUrl?: string;
  workerConcurrency: 1;
  workerHealthPort: number;
  workerId: string;
  workerPollIntervalMs: number;
};

export function parseWorkerConfig(environment: NodeJS.ProcessEnv): WorkerConfig {
  const parsed = workerEnvSchema.parse(environment);

  return {
    aiProvider: parsed.AI_PROVIDER,
    databaseUrl: parsed.DIRECT_DATABASE_URL ?? parsed.DATABASE_URL,
    logLevel: parsed.LOG_LEVEL,
    nodeEnv: parsed.NODE_ENV,
    ...(parsed.OPENAI_API_KEY === undefined ? {} : { openAiApiKey: parsed.OPENAI_API_KEY }),
    ...(parsed.OPENAI_EMBEDDING_MODEL === undefined ? {} : { openAiEmbeddingModel: parsed.OPENAI_EMBEDDING_MODEL }),
    ...(parsed.OPENAI_TEXT_MODEL === undefined
      ? {}
      : { openAiTextModel: parsed.OPENAI_TEXT_MODEL }),
    ...(parsed.UPWORK_MCP_CREDENTIAL_ENCRYPTION_KEY === undefined
      ? {}
      : { upworkMcpCredentialEncryptionKey: parsed.UPWORK_MCP_CREDENTIAL_ENCRYPTION_KEY }),
    upworkMonitorProvider: parsed.UPWORK_MONITOR_PROVIDER,
    upworkMcpMinPollIntervalSeconds: parsed.UPWORK_MCP_MIN_POLL_INTERVAL_SECONDS,
    ...(parsed.UPWORK_MCP_OAUTH_REDIRECT_URL === undefined
      ? {}
      : { upworkMcpOauthRedirectUrl: parsed.UPWORK_MCP_OAUTH_REDIRECT_URL }),
    workerConcurrency: 1,
    workerHealthPort: parsed.WORKER_HEALTH_PORT,
    workerId: parsed.WORKER_ID,
    workerPollIntervalMs: parsed.WORKER_POLL_INTERVAL_MS,
  };
}

export function formatEnvironmentError(error: unknown): string[] {
  if (!(error instanceof z.ZodError)) {
    return ["worker configuration is invalid"];
  }

  return error.issues.map((issue) => {
    const path = issue.path.length === 0 ? "environment" : issue.path.join(".");
    return `${path}: ${issue.message}`;
  });
}

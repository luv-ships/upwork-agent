import { describe, expect, it } from "vitest";

import { formatEnvironmentError, parseWorkerConfig } from "./env.js";

const validEncryptionKey = Buffer.alloc(32, 7).toString("base64");

describe("parseWorkerConfig", () => {
  it("starts in deterministic fake-provider mode without an API key", () => {
    const config = parseWorkerConfig({
      DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    });

    expect(config.aiProvider).toBe("fake");
    expect(config.openAiApiKey).toBeUndefined();
    expect(config.upworkMonitorProvider).toBe("disabled");
    expect(config.upworkMcpMinPollIntervalSeconds).toBe(300);
    expect(config.workerConcurrency).toBe(1);
    expect(config.workerHealthPort).toBe(0);
  });

  it("accepts an explicit worker health port", () => {
    const config = parseWorkerConfig({
      DATABASE_URL: "postgresql://direct/database",
      WORKER_HEALTH_PORT: "8080",
    });

    expect(config.workerHealthPort).toBe(8080);
  });

  it("prefers a direct database URL for the persistent worker", () => {
    const config = parseWorkerConfig({
      DATABASE_URL: "postgresql://pooler/database",
      DIRECT_DATABASE_URL: "postgresql://direct/database",
    });

    expect(config.databaseUrl).toBe("postgresql://direct/database");
  });

  it("requires server-only OpenAI settings when that provider is selected", () => {
    expect(() =>
      parseWorkerConfig({
        AI_PROVIDER: "openai",
        DATABASE_URL: "postgresql://direct/database",
      }),
    ).toThrow();
  });

  it("rejects worker concurrency above one", () => {
    expect(() =>
      parseWorkerConfig({
        DATABASE_URL: "postgresql://direct/database",
        WORKER_CONCURRENCY: "2",
      }),
    ).toThrow();
  });

  it("allows the fake monitor locally and rejects it in production", () => {
    expect(
      parseWorkerConfig({
        DATABASE_URL: "postgresql://direct/database",
        UPWORK_MONITOR_PROVIDER: "fake",
      }).upworkMonitorProvider,
    ).toBe("fake");

    expect(() =>
      parseWorkerConfig({
        DATABASE_URL: "postgresql://direct/database",
        NODE_ENV: "production",
        UPWORK_MONITOR_PROVIDER: "fake",
      }),
    ).toThrow();
  });

  it("keeps the Upwork encryption key and final callback URL server-only", () => {
    const config = parseWorkerConfig({
      DATABASE_URL: "postgresql://direct/database",
      UPWORK_MCP_CREDENTIAL_ENCRYPTION_KEY: validEncryptionKey,
      UPWORK_MCP_OAUTH_REDIRECT_URL: "https://app.example.test/api/upwork/oauth/callback",
    });

    expect(config.upworkMcpCredentialEncryptionKey).toBe(validEncryptionKey);
    expect(config.upworkMcpOauthRedirectUrl).toBe(
      "https://app.example.test/api/upwork/oauth/callback",
    );
    expect(() =>
      parseWorkerConfig({
        DATABASE_URL: "postgresql://direct/database",
        UPWORK_MCP_OAUTH_REDIRECT_URL: "http://app.example.test/api/upwork/oauth/callback",
      }),
    ).toThrow();
  });

  it("enables the live MCP worker only with its server encryption key", () => {
    expect(() =>
      parseWorkerConfig({
        DATABASE_URL: "postgresql://direct/database",
        UPWORK_MONITOR_PROVIDER: "mcp"
      })
    ).toThrow();

    expect(
      parseWorkerConfig({
        DATABASE_URL: "postgresql://direct/database",
        UPWORK_MONITOR_PROVIDER: "mcp",
        UPWORK_MCP_CREDENTIAL_ENCRYPTION_KEY: validEncryptionKey
      }).upworkMonitorProvider
    ).toBe("mcp");
  });

  it("rejects encryption material that is not exactly 32 decoded bytes", () => {
    expect(() =>
      parseWorkerConfig({
        DATABASE_URL: "postgresql://direct/database",
        UPWORK_MONITOR_PROVIDER: "mcp",
        UPWORK_MCP_CREDENTIAL_ENCRYPTION_KEY: "not-a-32-byte-key",
      }),
    ).toThrow("32-byte");
  });

  it("keeps production MCP polling at the conservative five-minute floor", () => {
    expect(() => parseWorkerConfig({
      DATABASE_URL: "postgresql://direct/database",
      NODE_ENV: "production",
      OPENAI_API_KEY: "sk-test-this-is-not-a-real-secret",
      OPENAI_TEXT_MODEL: "test-model",
      UPWORK_MONITOR_PROVIDER: "mcp",
      UPWORK_MCP_CREDENTIAL_ENCRYPTION_KEY: validEncryptionKey,
      UPWORK_MCP_MIN_POLL_INTERVAL_SECONDS: "60",
    })).toThrow("at least 300 seconds");
  });
});

describe("formatEnvironmentError", () => {
  it("reports invalid variable names without reflecting their values", () => {
    let capturedError: unknown;

    try {
      parseWorkerConfig({
        DATABASE_URL: "secret-database-value",
        WORKER_CONCURRENCY: "9",
      });
    } catch (error) {
      capturedError = error;
    }

    const message = formatEnvironmentError(capturedError).join(" ");

    expect(message).toContain("WORKER_CONCURRENCY");
    expect(message).not.toContain("secret-database-value");
  });
});

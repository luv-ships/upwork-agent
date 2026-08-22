import { afterEach, describe, expect, it, vi } from "vitest";

import { getServerEnvironment } from "./env";

const validEncryptionKey = Buffer.alloc(32, 7).toString("base64");

function validEnvironment(): void {
  vi.stubEnv("APP_URL", "http://localhost:3000");
  vi.stubEnv("DATABASE_URL", "postgresql://local:local@127.0.0.1:54322/postgres");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:54321");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "publishable-local-key");
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("DEV_INGESTION_ENABLED", "false");
  vi.stubEnv("DEV_INGEST_TOKEN", "");
  vi.stubEnv("E2E_AUTH_ENABLED", "false");
  vi.stubEnv("E2E_AUTH_EMAIL", "");
  vi.stubEnv("E2E_AUTH_TOKEN", "");
  vi.stubEnv("UPWORK_MONITOR_PROVIDER", "disabled");
  vi.stubEnv("UPWORK_MCP_CREDENTIAL_ENCRYPTION_KEY", "");
  vi.stubEnv("UPWORK_MCP_MIN_POLL_INTERVAL_SECONDS", "300");
  vi.stubEnv("UPWORK_MCP_OAUTH_REDIRECT_URL", "");
  vi.stubEnv("UPWORK_MCP_APPROVAL_REFERENCE", "local-fake");
}

afterEach(() => vi.unstubAllEnvs());

describe("web environment", () => {
  it("defaults to a disabled development endpoint", () => {
    validEnvironment();
    expect(getServerEnvironment().DEV_INGESTION_ENABLED).toBe(false);
  });

  it("requires a strong placeholder token when development ingestion is enabled", () => {
    validEnvironment();
    vi.stubEnv("DEV_INGESTION_ENABLED", "true");
    expect(() => getServerEnvironment()).toThrow();

    vi.stubEnv("DEV_INGEST_TOKEN", "local-test-token-1234");
    expect(getServerEnvironment().DEV_INGEST_TOKEN).toBe("local-test-token-1234");
  });

  it("refuses the development endpoint in production", () => {
    validEnvironment();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_URL", "https://app.example.test");
    vi.stubEnv("DEV_INGESTION_ENABLED", "true");
    vi.stubEnv("DEV_INGEST_TOKEN", "local-test-token-1234");
    expect(() => getServerEnvironment()).toThrow(
      "Development job ingestion cannot be enabled in production."
    );
  });

  it("allows fake monitoring only outside production", () => {
    validEnvironment();
    vi.stubEnv("UPWORK_MONITOR_PROVIDER", "fake");
    expect(getServerEnvironment().UPWORK_MONITOR_PROVIDER).toBe("fake");

    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_URL", "https://app.example.test");
    expect(() => getServerEnvironment()).toThrow(
      "The fake Upwork monitor cannot be enabled in production."
    );
  });

  it("keeps Upwork OAuth settings server-only and requires an HTTPS callback", () => {
    validEnvironment();
    vi.stubEnv("UPWORK_MCP_CREDENTIAL_ENCRYPTION_KEY", validEncryptionKey);
    vi.stubEnv(
      "UPWORK_MCP_OAUTH_REDIRECT_URL",
      "https://app.example.test/api/upwork/oauth/callback",
    );

    expect(getServerEnvironment().UPWORK_MCP_CREDENTIAL_ENCRYPTION_KEY).toBe(
      validEncryptionKey,
    );

    vi.stubEnv(
      "UPWORK_MCP_OAUTH_REDIRECT_URL",
      "http://app.example.test/api/upwork/oauth/callback",
    );
    expect(() => getServerEnvironment()).toThrow();
  });

  it("requires complete live MCP OAuth and approval configuration", () => {
    validEnvironment();
    vi.stubEnv("APP_URL", "https://app.example.test");
    vi.stubEnv("UPWORK_MONITOR_PROVIDER", "mcp");
    expect(() => getServerEnvironment()).toThrow("requires the encryption key");

    vi.stubEnv("UPWORK_MCP_CREDENTIAL_ENCRYPTION_KEY", validEncryptionKey);
    vi.stubEnv(
      "UPWORK_MCP_OAUTH_REDIRECT_URL",
      "https://app.example.test/api/upwork/oauth/callback"
    );
    expect(() => getServerEnvironment()).toThrow("approval reference");

    vi.stubEnv("UPWORK_MCP_APPROVAL_REFERENCE", "email-approval-2026-08-18");
    expect(getServerEnvironment().UPWORK_MONITOR_PROVIDER).toBe("mcp");

    vi.stubEnv(
      "UPWORK_MCP_OAUTH_REDIRECT_URL",
      "https://other.example.test/api/upwork/oauth/callback",
    );
    expect(() => getServerEnvironment()).toThrow("APP_URL origin");
  });

  it("rejects encryption material that is not exactly 32 decoded bytes", () => {
    validEnvironment();
    vi.stubEnv("APP_URL", "https://app.example.test");
    vi.stubEnv("UPWORK_MONITOR_PROVIDER", "mcp");
    vi.stubEnv("UPWORK_MCP_CREDENTIAL_ENCRYPTION_KEY", "not-a-32-byte-key");
    vi.stubEnv(
      "UPWORK_MCP_OAUTH_REDIRECT_URL",
      "https://app.example.test/api/upwork/oauth/callback",
    );
    expect(() => getServerEnvironment()).toThrow("32-byte");
  });

  it("requires an HTTPS app URL in production", () => {
    validEnvironment();
    vi.stubEnv("NODE_ENV", "production");
    expect(() => getServerEnvironment()).toThrow("APP_URL must use HTTPS");
  });

  it("keeps production MCP polling at the conservative five-minute floor", () => {
    validEnvironment();
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("APP_URL", "https://app.example.test");
    vi.stubEnv("UPWORK_MONITOR_PROVIDER", "mcp");
    vi.stubEnv("UPWORK_MCP_CREDENTIAL_ENCRYPTION_KEY", validEncryptionKey);
    vi.stubEnv("UPWORK_MCP_OAUTH_REDIRECT_URL", "https://app.example.test/api/upwork/oauth/callback");
    vi.stubEnv("UPWORK_MCP_APPROVAL_REFERENCE", "email-approval-2026-08-18");
    vi.stubEnv("UPWORK_MCP_MIN_POLL_INTERVAL_SECONDS", "60");
    expect(() => getServerEnvironment()).toThrow("at least 300 seconds");
  });
});

import { describe, expect, it } from "vitest";

import { getUpworkMcpOAuthSettings } from "./upwork-oauth.js";

describe("getUpworkMcpOAuthSettings", () => {
  const appUrl = "https://app.example.test";
  const redirectUrl = "https://app.example.test/api/upwork/oauth/callback";

  it("requires the server encryption key and exact public callback URL", () => {
    expect(() =>
      getUpworkMcpOAuthSettings({
        appUrl,
        encryptionKey: undefined,
        redirectUrl
      })
    ).toThrow("UPWORK_MCP_CREDENTIAL_ENCRYPTION_KEY");

    expect(() =>
      getUpworkMcpOAuthSettings({
        appUrl,
        encryptionKey: "server-only-key-material",
        redirectUrl: "https://other.example.test/api/upwork/oauth/callback"
      })
    ).toThrow("must exactly match");
  });

  it("accepts the server-only key and exact HTTPS callback", () => {
    expect(
      getUpworkMcpOAuthSettings({
        appUrl,
        encryptionKey: "server-only-key-material",
        redirectUrl
      })
    ).toEqual({ encryptionKey: "server-only-key-material", redirectUrl });
  });
});

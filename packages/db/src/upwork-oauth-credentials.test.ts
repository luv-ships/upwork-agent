import { Buffer } from "node:buffer";

import { describe, expect, it } from "vitest";

import {
  UpworkOAuthCredentialCipher,
  UpworkOAuthCredentialConfigurationError,
  UpworkOAuthCredentialDecryptionError
} from "./upwork-oauth-credentials.js";
import { hashUpworkOAuthState } from "./upwork-oauth-authorizations.js";

const workspaceId = "00000000-0000-4000-8000-000000000011";
const connectionId = "00000000-0000-4000-8000-000000000091";
const encryptionKey = Buffer.alloc(32, 7).toString("base64");

describe("UpworkOAuthCredentialCipher", () => {
  it("round-trips a token payload without retaining plaintext in the envelope", () => {
    const cipher = new UpworkOAuthCredentialCipher(encryptionKey);
    const encryptedPayload = cipher.encrypt({
      workspaceId,
      connectionId,
      payload: {
        version: 1,
        accessToken: "test-access-token",
        refreshToken: "test-refresh-token",
        accessTokenExpiresAt: "2026-08-16T12:00:00.000Z",
        orgUid: "1936403733578252377",
        authorizationServerIssuer: "https://auth.example.test"
      }
    });

    expect(encryptedPayload).not.toContain("test-access-token");
    expect(encryptedPayload).not.toContain("test-refresh-token");
    expect(
      cipher.decrypt({ workspaceId, connectionId, encryptedPayload })
    ).toEqual({
      version: 1,
      accessToken: "test-access-token",
      refreshToken: "test-refresh-token",
      accessTokenExpiresAt: "2026-08-16T12:00:00.000Z",
      orgUid: "1936403733578252377",
      authorizationServerIssuer: "https://auth.example.test"
    });
  });

  it("rejects a payload copied to a different workspace or connection", () => {
    const cipher = new UpworkOAuthCredentialCipher(encryptionKey);
    const encryptedPayload = cipher.encrypt({
      workspaceId,
      connectionId,
      payload: { version: 1, accessToken: "test-access-token", orgUid: "org-1" }
    });

    expect(() =>
      cipher.decrypt({
        workspaceId: "00000000-0000-4000-8000-000000000012",
        connectionId,
        encryptedPayload
      })
    ).toThrow(UpworkOAuthCredentialDecryptionError);
  });

  it("requires exactly 32 decoded bytes of server-only key material", () => {
    expect(() => new UpworkOAuthCredentialCipher("not-a-32-byte-key")).toThrow(
      UpworkOAuthCredentialConfigurationError
    );
  });

  it("keeps PKCE authorization state distinct from stored token material", () => {
    const cipher = new UpworkOAuthCredentialCipher(encryptionKey);
    const encryptedPayload = cipher.encryptAuthorization({
      workspaceId,
      connectionId,
      payload: {
        version: 1,
        orgUid: "1936403733578252377",
        state: "o2XUebcvB1v4GiLKvKfXjgYQOoEpaa1JH3JfuIOXCGM",
        codeVerifier: "2QsNmj1-yFDhHiO_GQbtsuU51sQRL1p6a4MXM1MYq6Kh7LRJxxJG3rEgaL8tibKk",
        clientInformation: {
          clientId: "test-client-id",
          clientSecret: "test-client-secret",
          issuer: "https://auth.example.test"
        }
      }
    });

    expect(encryptedPayload).not.toContain("test-client-secret");
    expect(() =>
      cipher.decrypt({ workspaceId, connectionId, encryptedPayload })
    ).toThrow(UpworkOAuthCredentialDecryptionError);
    expect(cipher.decryptAuthorization({ workspaceId, connectionId, encryptedPayload })).toMatchObject({
      state: "o2XUebcvB1v4GiLKvKfXjgYQOoEpaa1JH3JfuIOXCGM",
      clientInformation: { clientId: "test-client-id" }
    });
  });
});

describe("hashUpworkOAuthState", () => {
  it("creates a fixed-size opaque callback lookup key", () => {
    const state = "o2XUebcvB1v4GiLKvKfXjgYQOoEpaa1JH3JfuIOXCGM";

    expect(hashUpworkOAuthState(state)).toHaveLength(43);
    expect(hashUpworkOAuthState(state)).toBe(hashUpworkOAuthState(state));
    expect(hashUpworkOAuthState(state)).not.toBe(state);
  });
});

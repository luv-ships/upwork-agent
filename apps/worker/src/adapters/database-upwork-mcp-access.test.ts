import { describe, expect, it, vi } from "vitest";

import { createDatabaseUpworkMcpConnectionAccessResolver } from "./database-upwork-mcp-access.js";

const workspaceId = "00000000-0000-4000-8000-000000000011";
const connectionId = "00000000-0000-4000-8000-000000000091";

describe("createDatabaseUpworkMcpConnectionAccessResolver", () => {
  it("passes the exact workspace/connection pair to the encrypted vault", async () => {
    const calls: unknown[] = [];
    const resolver = createDatabaseUpworkMcpConnectionAccessResolver({
      save: async () => undefined,
      remove: async () => undefined,
      load: async (input) => {
        calls.push(input);
        return {
          version: 1,
          accessToken: "server-only-token",
          orgUid: "1936403733578252377"
        };
      }
    });

    await expect(resolver.resolve({ workspaceId, connectionId })).resolves.toEqual({
      accessToken: "server-only-token",
      orgUid: "1936403733578252377"
    });
    expect(calls).toEqual([{ workspaceId, connectionId }]);
  });

  it("fails closed until an authorized account identifier is available", async () => {
    const resolver = createDatabaseUpworkMcpConnectionAccessResolver({
      save: async () => undefined,
      remove: async () => undefined,
      load: async () => ({ version: 1, accessToken: "server-only-token" })
    });

    await expect(resolver.resolve({ workspaceId, connectionId })).resolves.toBeUndefined();
  });

  it("refreshes an expiring token once and persists rotated OAuth material", async () => {
    const saved: unknown[] = [];
    const refresh = vi.fn().mockResolvedValue({
      access_token: "refreshed-access-token",
      refresh_token: "rotated-refresh-token",
      token_type: "Bearer",
      expires_in: 3600,
      scope: "jobs:read"
    });
    const resolver = createDatabaseUpworkMcpConnectionAccessResolver(
      {
        save: async (value) => {
          saved.push(value);
        },
        remove: async () => undefined,
        load: async () => ({
          version: 1,
          accessToken: "expired-access-token",
          refreshToken: "original-refresh-token",
          accessTokenExpiresAt: "2026-08-18T00:00:00.000Z",
          orgUid: "1936403733578252377",
          clientInformation: { clientId: "dynamic-client-id" },
          discovery: {
            authorizationServerUrl: "https://auth.example.test",
            authorizationServerMetadata: {
              issuer: "https://auth.example.test",
              authorizationEndpoint: "https://auth.example.test/authorize",
              tokenEndpoint: "https://auth.example.test/token",
              responseTypesSupported: ["code"],
              tokenEndpointAuthMethodsSupported: ["none"]
            },
            resourceMetadata: { resource: "https://mcp.upwork.com/mcp" }
          }
        })
      },
      {
        now: () => new Date("2026-08-18T01:00:00.000Z"),
        refresh
      }
    );

    const [first, second] = await Promise.all([
      resolver.resolve({ workspaceId, connectionId }),
      resolver.resolve({ workspaceId, connectionId })
    ]);

    expect(first).toEqual({
      accessToken: "refreshed-access-token",
      orgUid: "1936403733578252377"
    });
    expect(second).toEqual(first);
    expect(refresh).toHaveBeenCalledOnce();
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      workspaceId,
      connectionId,
      payload: {
        accessToken: "refreshed-access-token",
        refreshToken: "rotated-refresh-token",
        accessTokenExpiresAt: "2026-08-18T02:00:00.000Z",
        orgUid: "1936403733578252377",
        scope: "jobs:read"
      }
    });
  });

  it("requires browser reconnection after a terminal refresh grant failure", async () => {
    const resolver = createDatabaseUpworkMcpConnectionAccessResolver(
      {
        save: async () => undefined,
        remove: async () => undefined,
        load: async () => ({
          version: 1,
          refreshToken: "revoked-refresh-token",
          orgUid: "1936403733578252377",
          clientInformation: { clientId: "dynamic-client-id" },
          discovery: { authorizationServerUrl: "https://auth.example.test" }
        })
      },
      {
        refresh: async () => {
          throw { code: "invalid_grant" };
        }
      }
    );

    await expect(resolver.resolve({ workspaceId, connectionId })).resolves.toBeUndefined();
  });
});

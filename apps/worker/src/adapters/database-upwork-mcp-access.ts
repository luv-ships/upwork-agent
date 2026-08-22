import {
  refreshAuthorization,
  type AuthorizationServerMetadata,
  type OAuthTokens,
  type StoredOAuthClientInformation
} from "@modelcontextprotocol/client";
import {
  type UpworkOAuthCredentialPayload,
  type UpworkOAuthCredentialVault
} from "@upwork-agent/db";
import { z } from "zod";

import {
  type UpworkMcpConnectionAccess,
  type UpworkMcpConnectionAccessResolver
} from "./upwork-mcp-remote.js";
import { UpworkFindJobsClientError } from "./upwork-mcp.js";

const REFRESH_SKEW_MS = 60_000;
const oauthErrorSchema = z.object({ code: z.string().trim().min(1).max(200) });

type RefreshAuthorization = typeof refreshAuthorization;

function storedClientInformation(
  credential: UpworkOAuthCredentialPayload
): StoredOAuthClientInformation | undefined {
  const information = credential.clientInformation;
  if (information === undefined) return undefined;
  return {
    client_id: information.clientId,
    ...(information.clientSecret === undefined
      ? {}
      : { client_secret: information.clientSecret }),
    ...(information.clientIdIssuedAt === undefined
      ? {}
      : { client_id_issued_at: information.clientIdIssuedAt }),
    ...(information.clientSecretExpiresAt === undefined
      ? {}
      : { client_secret_expires_at: information.clientSecretExpiresAt }),
    ...(information.issuer === undefined ? {} : { issuer: information.issuer })
  };
}

function authorizationServerMetadata(
  credential: UpworkOAuthCredentialPayload
): AuthorizationServerMetadata | undefined {
  const metadata = credential.discovery?.authorizationServerMetadata;
  if (metadata === undefined) return undefined;
  return {
    issuer: metadata.issuer,
    authorization_endpoint: metadata.authorizationEndpoint,
    token_endpoint: metadata.tokenEndpoint,
    response_types_supported: metadata.responseTypesSupported,
    ...(metadata.registrationEndpoint === undefined
      ? {}
      : { registration_endpoint: metadata.registrationEndpoint }),
    ...(metadata.scopesSupported === undefined
      ? {}
      : { scopes_supported: metadata.scopesSupported }),
    ...(metadata.grantTypesSupported === undefined
      ? {}
      : { grant_types_supported: metadata.grantTypesSupported }),
    ...(metadata.tokenEndpointAuthMethodsSupported === undefined
      ? {}
      : {
          token_endpoint_auth_methods_supported:
            metadata.tokenEndpointAuthMethodsSupported
        }),
    ...(metadata.codeChallengeMethodsSupported === undefined
      ? {}
      : { code_challenge_methods_supported: metadata.codeChallengeMethodsSupported }),
    ...(metadata.authorizationResponseIssParameterSupported === undefined
      ? {}
      : {
          authorization_response_iss_parameter_supported:
            metadata.authorizationResponseIssParameterSupported
        })
  };
}

function tokenStillValid(credential: UpworkOAuthCredentialPayload, now: Date): boolean {
  if (credential.accessToken === undefined) return false;
  if (credential.accessTokenExpiresAt === undefined) return true;
  const expiresAt = new Date(credential.accessTokenExpiresAt);
  return (
    !Number.isNaN(expiresAt.getTime()) &&
    expiresAt.getTime() > now.getTime() + REFRESH_SKEW_MS
  );
}

function accessFromCredential(
  credential: UpworkOAuthCredentialPayload
): UpworkMcpConnectionAccess | undefined {
  if (credential.accessToken === undefined || credential.orgUid === undefined) {
    return undefined;
  }
  return { accessToken: credential.accessToken, orgUid: credential.orgUid };
}

function refreshedCredential(
  previous: UpworkOAuthCredentialPayload,
  tokens: OAuthTokens,
  now: Date
): UpworkOAuthCredentialPayload {
  const expiresAt =
    tokens.expires_in === undefined || !Number.isFinite(tokens.expires_in)
      ? undefined
      : new Date(now.getTime() + tokens.expires_in * 1_000).toISOString();
  return {
    ...previous,
    version: 1,
    accessToken: tokens.access_token,
    ...(tokens.refresh_token === undefined && previous.refreshToken === undefined
      ? { refreshToken: undefined }
      : { refreshToken: tokens.refresh_token ?? previous.refreshToken }),
    ...(expiresAt === undefined
      ? { accessTokenExpiresAt: undefined }
      : { accessTokenExpiresAt: expiresAt }),
    ...(tokens.scope === undefined ? {} : { scope: tokens.scope })
  };
}

function isTerminalOAuthRefreshError(error: unknown): boolean {
  const parsed = oauthErrorSchema.safeParse(error);
  return (
    parsed.success &&
    ["invalid_client", "invalid_grant", "unauthorized_client"].includes(parsed.data.code)
  );
}

/**
 * Resolves decrypted access material only for the task's exact workspace and
 * refreshes expiring credentials with the official MCP OAuth implementation.
 */
export function createDatabaseUpworkMcpConnectionAccessResolver(
  vault: UpworkOAuthCredentialVault,
  options: {
    readonly now?: () => Date;
    readonly refresh?: RefreshAuthorization;
  } = {}
): UpworkMcpConnectionAccessResolver {
  const now = options.now ?? (() => new Date());
  const refresh = options.refresh ?? refreshAuthorization;
  const inFlight = new Map<string, Promise<UpworkMcpConnectionAccess | undefined>>();

  async function resolveFresh(input: {
    readonly workspaceId: string;
    readonly connectionId: string;
  }): Promise<UpworkMcpConnectionAccess | undefined> {
    const credential = await vault.load(input);
    if (credential === undefined || credential.orgUid === undefined) return undefined;
    const currentTime = now();
    if (tokenStillValid(credential, currentTime)) return accessFromCredential(credential);

    const refreshToken = credential.refreshToken;
    const clientInformation = storedClientInformation(credential);
    const discovery = credential.discovery;
    if (
      refreshToken === undefined ||
      clientInformation === undefined ||
      discovery === undefined
    ) {
      return undefined;
    }

    try {
      const metadata = authorizationServerMetadata(credential);
      const tokens = await refresh(discovery.authorizationServerUrl, {
        ...(metadata === undefined ? {} : { metadata }),
        clientInformation,
        refreshToken,
        ...(discovery.resourceMetadata?.resource === undefined
          ? {}
          : { resource: new URL(discovery.resourceMetadata.resource) })
      });
      const updated = refreshedCredential(credential, tokens, currentTime);
      await vault.save({ ...input, payload: updated, now: currentTime });
      return accessFromCredential(updated);
    } catch (error) {
      if (isTerminalOAuthRefreshError(error)) return undefined;
      throw new UpworkFindJobsClientError({ kind: "temporarily_unavailable" });
    }
  }

  return {
    async resolve(input): Promise<UpworkMcpConnectionAccess | undefined> {
      const key = `${input.workspaceId}:${input.connectionId}`;
      const existing = inFlight.get(key);
      if (existing !== undefined) return existing;
      const pending = resolveFresh(input).finally(() => inFlight.delete(key));
      inFlight.set(key, pending);
      return pending;
    }
  };
}

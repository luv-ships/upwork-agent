import { randomBytes } from "node:crypto";

import {
  Client,
  StreamableHTTPClientTransport,
  UnauthorizedError,
  type AuthorizationServerMetadata,
  type OAuthClientInformationContext,
  type OAuthClientProvider,
  type OAuthDiscoveryState,
  type StoredOAuthClientInformation,
  type StoredOAuthTokens
} from "@modelcontextprotocol/client";
import {
  beginUpworkOAuthConnection,
  completeUpworkOAuthConnection,
  createDatabaseUpworkOAuthAuthorizationVault,
  createDatabaseUpworkOAuthCredentialVault,
  ensureWorkspaceForUser,
  requireUpworkOAuthReconnect,
  UpworkOAuthCredentialCipher,
  type Database,
  type UpworkOAuthAuthorizationPayload,
  type UpworkOAuthAuthorizationVault,
  type UpworkOAuthCredentialPayload,
  type UpworkOAuthCredentialVault
} from "@upwork-agent/db";
import { z } from "zod";

export const UPWORK_MCP_SERVER_URL = "https://mcp.upwork.com/mcp";

const httpsUrlSchema = z
  .url()
  .max(2_000)
  .refine((value) => new URL(value).protocol === "https:", "must use https");
const callbackStateSchema = z.string().regex(/^[A-Za-z0-9_-]{32,200}$/);
const callbackCodeSchema = z.string().trim().min(1).max(20_000);

export class UpworkOAuthConfigurationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "UpworkOAuthConfigurationError";
  }
}

export class UpworkOAuthCallbackError extends Error {
  public constructor() {
    super("Upwork authorization could not be completed");
    this.name = "UpworkOAuthCallbackError";
  }
}

function cleanCallbackUrl(value: string): string {
  return httpsUrlSchema.parse(value);
}

export function getUpworkMcpOAuthSettings(input: {
  readonly appUrl: string;
  readonly encryptionKey: string | undefined;
  readonly redirectUrl: string | undefined;
}): { readonly encryptionKey: string; readonly redirectUrl: string } {
  if (input.encryptionKey === undefined) {
    throw new UpworkOAuthConfigurationError(
      "UPWORK_MCP_CREDENTIAL_ENCRYPTION_KEY is required before connecting Upwork"
    );
  }
  if (input.redirectUrl === undefined) {
    throw new UpworkOAuthConfigurationError(
      "UPWORK_MCP_OAUTH_REDIRECT_URL is required before connecting Upwork"
    );
  }
  const expected = new URL("/api/upwork/oauth/callback", input.appUrl).toString();
  const redirectUrl = cleanCallbackUrl(input.redirectUrl);
  if (redirectUrl !== expected) {
    throw new UpworkOAuthConfigurationError(
      "UPWORK_MCP_OAUTH_REDIRECT_URL must exactly match the application callback URL"
    );
  }
  return { encryptionKey: input.encryptionKey, redirectUrl };
}

function accessTokenExpiresAt(tokens: StoredOAuthTokens, now: Date): string | undefined {
  if (tokens.expires_in === undefined || !Number.isFinite(tokens.expires_in)) return undefined;
  return new Date(now.getTime() + tokens.expires_in * 1_000).toISOString();
}

function storedTokensFromCredential(
  credential: UpworkOAuthCredentialPayload | undefined,
  now: Date
): StoredOAuthTokens | undefined {
  if (credential?.accessToken === undefined) return undefined;
  const expiresAt = credential.accessTokenExpiresAt === undefined
    ? undefined
    : new Date(credential.accessTokenExpiresAt);
  const expiresIn = expiresAt === undefined || Number.isNaN(expiresAt.getTime())
    ? undefined
    : Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1_000));
  return {
    access_token: credential.accessToken,
    token_type: "Bearer",
    ...(credential.refreshToken === undefined ? {} : { refresh_token: credential.refreshToken }),
    ...(expiresIn === undefined ? {} : { expires_in: expiresIn }),
    ...(credential.scope === undefined ? {} : { scope: credential.scope }),
    ...(credential.authorizationServerIssuer === undefined
      ? {}
      : { issuer: credential.authorizationServerIssuer })
  };
}

function toStoredClientInformation(
  information: NonNullable<UpworkOAuthAuthorizationPayload["clientInformation"]>
): StoredOAuthClientInformation {
  return {
    client_id: information.clientId,
    ...(information.clientSecret === undefined ? {} : { client_secret: information.clientSecret }),
    ...(information.clientIdIssuedAt === undefined
      ? {}
      : { client_id_issued_at: information.clientIdIssuedAt }),
    ...(information.clientSecretExpiresAt === undefined
      ? {}
      : { client_secret_expires_at: information.clientSecretExpiresAt }),
    ...(information.issuer === undefined ? {} : { issuer: information.issuer })
  };
}

function persistableClientInformation(
  information: StoredOAuthClientInformation,
  context: OAuthClientInformationContext | undefined
): NonNullable<UpworkOAuthAuthorizationPayload["clientInformation"]> {
  return {
    clientId: information.client_id,
    ...(information.client_secret === undefined ? {} : { clientSecret: information.client_secret }),
    ...(information.client_id_issued_at === undefined
      ? {}
      : { clientIdIssuedAt: information.client_id_issued_at }),
    ...(information.client_secret_expires_at === undefined
      ? {}
      : { clientSecretExpiresAt: information.client_secret_expires_at }),
    ...(context?.issuer === undefined ? {} : { issuer: context.issuer })
  };
}

function persistableDiscoveryState(
  state: OAuthDiscoveryState
): NonNullable<UpworkOAuthAuthorizationPayload["discovery"]> {
  const metadata = state.authorizationServerMetadata;
  const resource = state.resourceMetadata;
  return {
    authorizationServerUrl: state.authorizationServerUrl,
    ...(metadata === undefined
      ? {}
      : {
          authorizationServerMetadata: {
            issuer: metadata.issuer,
            authorizationEndpoint: metadata.authorization_endpoint.toString(),
            tokenEndpoint: metadata.token_endpoint.toString(),
            responseTypesSupported: metadata.response_types_supported,
            ...(metadata.registration_endpoint === undefined
              ? {}
              : { registrationEndpoint: metadata.registration_endpoint.toString() }),
            ...(metadata.scopes_supported === undefined
              ? {}
              : { scopesSupported: metadata.scopes_supported }),
            ...(metadata.grant_types_supported === undefined
              ? {}
              : { grantTypesSupported: metadata.grant_types_supported }),
            ...(metadata.token_endpoint_auth_methods_supported === undefined
              ? {}
              : {
                  tokenEndpointAuthMethodsSupported:
                    metadata.token_endpoint_auth_methods_supported
                }),
            ...(metadata.code_challenge_methods_supported === undefined
              ? {}
              : { codeChallengeMethodsSupported: metadata.code_challenge_methods_supported }),
            ...(metadata.authorization_response_iss_parameter_supported === undefined
              ? {}
              : {
                  authorizationResponseIssParameterSupported:
                    metadata.authorization_response_iss_parameter_supported
                })
          }
        }),
    ...(resource === undefined
      ? {}
      : {
          resourceMetadata: {
            resource: resource.resource,
            ...(resource.authorization_servers === undefined
              ? {}
              : { authorizationServers: resource.authorization_servers.map(String) }),
            ...(resource.scopes_supported === undefined
              ? {}
              : { scopesSupported: resource.scopes_supported })
          }
        }),
    ...(state.resourceMetadataUrl === undefined
      ? {}
      : { resourceMetadataUrl: state.resourceMetadataUrl })
  };
}

function restoredDiscoveryState(
  persisted: NonNullable<UpworkOAuthAuthorizationPayload["discovery"]>
): OAuthDiscoveryState {
  const metadata = persisted.authorizationServerMetadata;
  const resource = persisted.resourceMetadata;
  const restoredMetadata: AuthorizationServerMetadata | undefined = metadata === undefined
    ? undefined
    : {
        issuer: metadata.issuer,
        authorization_endpoint: metadata.authorizationEndpoint,
        token_endpoint: metadata.tokenEndpoint,
        response_types_supported: metadata.responseTypesSupported,
        ...(metadata.registrationEndpoint === undefined
          ? {}
          : { registration_endpoint: metadata.registrationEndpoint }),
        ...(metadata.scopesSupported === undefined ? {} : { scopes_supported: metadata.scopesSupported }),
        ...(metadata.grantTypesSupported === undefined
          ? {}
          : { grant_types_supported: metadata.grantTypesSupported }),
        ...(metadata.tokenEndpointAuthMethodsSupported === undefined
          ? {}
          : {
              token_endpoint_auth_methods_supported: metadata.tokenEndpointAuthMethodsSupported
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
  return {
    authorizationServerUrl: persisted.authorizationServerUrl,
    ...(restoredMetadata === undefined ? {} : { authorizationServerMetadata: restoredMetadata }),
    ...(resource === undefined
      ? {}
      : {
          resourceMetadata: {
            resource: resource.resource,
            ...(resource.authorizationServers === undefined
              ? {}
              : { authorization_servers: resource.authorizationServers }),
            ...(resource.scopesSupported === undefined ? {} : { scopes_supported: resource.scopesSupported })
          }
        }),
    ...(persisted.resourceMetadataUrl === undefined
      ? {}
      : { resourceMetadataUrl: persisted.resourceMetadataUrl })
  };
}

class DatabaseUpworkOAuthClientProvider implements OAuthClientProvider {
  readonly #authorizationVault: UpworkOAuthAuthorizationVault;
  readonly #credentialVault: UpworkOAuthCredentialVault;
  readonly #workspaceId: string;
  readonly #connectionId: string;
  readonly #redirectUrl: string;
  #payload: UpworkOAuthAuthorizationPayload;
  #authorizationUrl: URL | undefined;
  #authorizationExpiresAt: Date | undefined;

  public constructor(input: {
    readonly authorizationVault: UpworkOAuthAuthorizationVault;
    readonly credentialVault: UpworkOAuthCredentialVault;
    readonly workspaceId: string;
    readonly connectionId: string;
    readonly redirectUrl: string;
    readonly payload: UpworkOAuthAuthorizationPayload;
  }) {
    this.#authorizationVault = input.authorizationVault;
    this.#credentialVault = input.credentialVault;
    this.#workspaceId = input.workspaceId;
    this.#connectionId = input.connectionId;
    this.#redirectUrl = cleanCallbackUrl(input.redirectUrl);
    this.#payload = input.payload;
  }

  public get redirectUrl(): string {
    return this.#redirectUrl;
  }

  public get clientMetadata() {
    return {
      redirect_uris: [this.#redirectUrl],
      application_type: "web",
      client_name: "Upwork Agent"
    };
  }

  public get authorizationUrl(): URL | undefined {
    return this.#authorizationUrl;
  }

  public async state(): Promise<string> {
    if (this.#payload.state !== undefined) return this.#payload.state;
    const state = randomBytes(32).toString("base64url");
    this.#payload = { ...this.#payload, state };
    this.#authorizationExpiresAt = new Date(Date.now() + 10 * 60 * 1_000);
    await this.#save();
    return state;
  }

  public async clientInformation(): Promise<StoredOAuthClientInformation | undefined> {
    return this.#payload.clientInformation === undefined
      ? undefined
      : toStoredClientInformation(this.#payload.clientInformation);
  }

  public async saveClientInformation(
    information: StoredOAuthClientInformation,
    context?: OAuthClientInformationContext
  ): Promise<void> {
    this.#payload = {
      ...this.#payload,
      clientInformation: persistableClientInformation(information, context)
    };
    await this.#save();
  }

  public async tokens(): Promise<StoredOAuthTokens | undefined> {
    const credential = await this.#credentialVault.load({
      workspaceId: this.#workspaceId,
      connectionId: this.#connectionId
    });
    return storedTokensFromCredential(credential, new Date());
  }

  public async saveTokens(tokens: StoredOAuthTokens): Promise<void> {
    const previous = await this.#credentialVault.load({
      workspaceId: this.#workspaceId,
      connectionId: this.#connectionId
    });
    const expiresAt = accessTokenExpiresAt(tokens, new Date());
    await this.#credentialVault.save({
      workspaceId: this.#workspaceId,
      connectionId: this.#connectionId,
      payload: {
        version: 1,
        accessToken: tokens.access_token,
        ...(tokens.refresh_token === undefined && previous?.refreshToken === undefined
          ? {}
          : { refreshToken: tokens.refresh_token ?? previous?.refreshToken }),
        ...(expiresAt === undefined
          ? {}
          : { accessTokenExpiresAt: expiresAt }),
        ...(tokens.scope === undefined ? {} : { scope: tokens.scope }),
        orgUid: this.#payload.orgUid,
        ...(tokens.issuer === undefined &&
        this.#payload.discovery?.authorizationServerMetadata?.issuer === undefined
          ? {}
          : {
              authorizationServerIssuer:
                tokens.issuer ??
                this.#payload.discovery?.authorizationServerMetadata?.issuer
            }),
        ...(this.#payload.clientInformation === undefined
          ? {}
          : { clientInformation: this.#payload.clientInformation }),
        ...(this.#payload.discovery === undefined
          ? {}
          : { discovery: this.#payload.discovery })
      }
    });
  }

  public async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    this.#authorizationUrl = new URL(authorizationUrl);
  }

  public async saveCodeVerifier(codeVerifier: string): Promise<void> {
    this.#payload = { ...this.#payload, codeVerifier };
    await this.#save();
  }

  public codeVerifier(): string {
    if (this.#payload.codeVerifier === undefined) {
      throw new UpworkOAuthCallbackError();
    }
    return this.#payload.codeVerifier;
  }

  public async saveDiscoveryState(state: OAuthDiscoveryState): Promise<void> {
    this.#payload = { ...this.#payload, discovery: persistableDiscoveryState(state) };
    await this.#save();
  }

  public discoveryState(): OAuthDiscoveryState | undefined {
    return this.#payload.discovery === undefined
      ? undefined
      : restoredDiscoveryState(this.#payload.discovery);
  }

  async #save(): Promise<void> {
    await this.#authorizationVault.save({
      workspaceId: this.#workspaceId,
      connectionId: this.#connectionId,
      payload: this.#payload,
      ...(this.#authorizationExpiresAt === undefined
        ? {}
        : { expiresAt: this.#authorizationExpiresAt })
    });
  }
}

export interface UpworkMcpOAuthDriver {
  start(provider: OAuthClientProvider): Promise<URL>;
  finish(provider: OAuthClientProvider, callbackParameters: URLSearchParams): Promise<void>;
}

export const upworkMcpOAuthDriver: UpworkMcpOAuthDriver = {
  async start(provider) {
    const client = new Client({ name: "upwork-agent-web", version: "0.1.0" });
    const transport = new StreamableHTTPClientTransport(new URL(UPWORK_MCP_SERVER_URL), {
      authProvider: provider
    });
    try {
      await client.connect(transport);
    } catch (error) {
      if (!(error instanceof UnauthorizedError) || !(provider instanceof DatabaseUpworkOAuthClientProvider)) {
        throw error;
      }
      const authorizationUrl = provider.authorizationUrl;
      if (authorizationUrl === undefined) throw new UpworkOAuthConfigurationError("Upwork did not provide an authorization URL");
      return authorizationUrl;
    } finally {
      await client.close().catch(() => undefined);
    }
    throw new UpworkOAuthConfigurationError("Upwork did not require authorization");
  },

  async finish(provider, callbackParameters) {
    const completionTransport = new StreamableHTTPClientTransport(
      new URL(UPWORK_MCP_SERVER_URL),
      { authProvider: provider }
    );
    await completionTransport.finishAuth(callbackParameters);
    const client = new Client({ name: "upwork-agent-web", version: "0.1.0" });
    const verificationTransport = new StreamableHTTPClientTransport(
      new URL(UPWORK_MCP_SERVER_URL),
      { authProvider: provider }
    );
    try {
      await client.connect(verificationTransport);
    } finally {
      await client.close().catch(() => undefined);
    }
  }
};

function createProvider(input: {
  readonly authorizationVault: UpworkOAuthAuthorizationVault;
  readonly credentialVault: UpworkOAuthCredentialVault;
  readonly workspaceId: string;
  readonly connectionId: string;
  readonly redirectUrl: string;
  readonly payload: UpworkOAuthAuthorizationPayload;
}): DatabaseUpworkOAuthClientProvider {
  return new DatabaseUpworkOAuthClientProvider(input);
}

function createVaults(database: Database, encryptionKey: string) {
  const cipher = new UpworkOAuthCredentialCipher(encryptionKey);
  return {
    authorizationVault: createDatabaseUpworkOAuthAuthorizationVault(database, cipher),
    credentialVault: createDatabaseUpworkOAuthCredentialVault(database, cipher)
  };
}

export async function startUpworkMcpOAuthAuthorization(input: {
  readonly database: Database;
  readonly ownerUserId: string;
  readonly orgUid: string;
  readonly approvalReference: string;
  readonly encryptionKey: string;
  readonly redirectUrl: string;
  readonly driver?: UpworkMcpOAuthDriver;
}): Promise<URL> {
  const orgUid = z.string().trim().min(1).max(200).parse(input.orgUid);
  const workspace = await ensureWorkspaceForUser(input.database, {
    ownerUserId: input.ownerUserId,
    name: "My workspace"
  });
  const connection = await beginUpworkOAuthConnection(input.database, {
    ownerUserId: input.ownerUserId,
    workspaceId: workspace.id,
    approvalReference: input.approvalReference
  });
  if (connection === null) throw new UpworkOAuthConfigurationError("Workspace was not found");

  const vaults = createVaults(input.database, input.encryptionKey);
  const persisted = await vaults.authorizationVault.loadForConnection({
    workspaceId: workspace.id,
    connectionId: connection.id
  });
  const payload: UpworkOAuthAuthorizationPayload = {
    version: 1,
    orgUid,
    ...(persisted?.clientInformation === undefined
      ? {}
      : { clientInformation: persisted.clientInformation }),
    ...(persisted?.discovery === undefined ? {} : { discovery: persisted.discovery })
  };
  const provider = createProvider({
    ...vaults,
    workspaceId: workspace.id,
    connectionId: connection.id,
    redirectUrl: input.redirectUrl,
    payload
  });
  try {
    return await (input.driver ?? upworkMcpOAuthDriver).start(provider);
  } catch (error) {
    await requireUpworkOAuthReconnect(input.database, {
      workspaceId: workspace.id,
      connectionId: connection.id
    });
    throw error;
  }
}

export async function completeUpworkMcpOAuthAuthorization(input: {
  readonly database: Database;
  readonly ownerUserId: string;
  readonly encryptionKey: string;
  readonly redirectUrl: string;
  readonly state: string;
  readonly code: string;
  readonly issuer?: string;
  readonly driver?: UpworkMcpOAuthDriver;
}): Promise<void> {
  const state = callbackStateSchema.parse(input.state);
  const code = callbackCodeSchema.parse(input.code);
  const vaults = createVaults(input.database, input.encryptionKey);
  const authorization = await vaults.authorizationVault.consume({
    state,
    ownerUserId: input.ownerUserId
  });
  const provider = createProvider({
    ...vaults,
    workspaceId: authorization.workspaceId,
    connectionId: authorization.connectionId,
    redirectUrl: input.redirectUrl,
    payload: authorization.payload
  });
  const callbackParameters = new URLSearchParams({ code, state });
  if (input.issuer !== undefined) callbackParameters.set("iss", input.issuer);
  try {
    await (input.driver ?? upworkMcpOAuthDriver).finish(provider, callbackParameters);
    await completeUpworkOAuthConnection(input.database, {
      ...authorization,
      accountId: authorization.payload.orgUid
    });
  } catch (error) {
    await requireUpworkOAuthReconnect(input.database, authorization);
    throw error;
  }
}

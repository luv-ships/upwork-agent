import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "./database.js";
import { upworkConnections, upworkOAuthCredentials } from "./schema.js";

const uuidSchema = z.uuid();
const base64ValueSchema = z
  .string()
  .min(1)
  .max(100_000)
  .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/);
const encryptionKeyMaterialSchema = z
  .string()
  .trim()
  .min(1)
  .max(1_000)
  .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/);

const httpsUrlSchema = z
  .url()
  .max(2_000)
  .refine((value) => new URL(value).protocol === "https:", "must use https");

export const upworkOAuthClientInformationSchema = z.object({
  clientId: z.string().trim().min(1).max(2_000),
  clientSecret: z.string().trim().min(1).max(20_000).optional(),
  clientIdIssuedAt: z.number().int().nonnegative().optional(),
  clientSecretExpiresAt: z.number().int().nonnegative().optional(),
  issuer: httpsUrlSchema.optional()
});

const upworkOAuthAuthorizationServerMetadataSchema = z.object({
  issuer: httpsUrlSchema,
  authorizationEndpoint: httpsUrlSchema,
  tokenEndpoint: httpsUrlSchema,
  responseTypesSupported: z.array(z.string().trim().min(1).max(200)).min(1).max(100),
  registrationEndpoint: httpsUrlSchema.optional(),
  scopesSupported: z.array(z.string().trim().min(1).max(200)).max(100).optional(),
  grantTypesSupported: z.array(z.string().trim().min(1).max(200)).max(100).optional(),
  tokenEndpointAuthMethodsSupported: z
    .array(z.string().trim().min(1).max(200))
    .max(100)
    .optional(),
  codeChallengeMethodsSupported: z
    .array(z.string().trim().min(1).max(200))
    .max(100)
    .optional(),
  authorizationResponseIssParameterSupported: z.boolean().optional()
});

const upworkOAuthResourceMetadataSchema = z.object({
  resource: httpsUrlSchema,
  authorizationServers: z.array(httpsUrlSchema).max(20).optional(),
  scopesSupported: z.array(z.string().trim().min(1).max(200)).max(100).optional()
});

export const upworkOAuthDiscoverySchema = z.object({
  authorizationServerUrl: httpsUrlSchema,
  authorizationServerMetadata: upworkOAuthAuthorizationServerMetadataSchema.optional(),
  resourceMetadata: upworkOAuthResourceMetadataSchema.optional(),
  resourceMetadataUrl: httpsUrlSchema.optional()
});

/**
 * Encrypted long-lived OAuth material. Dynamic-client and discovery metadata
 * are retained because a background worker needs them to refresh a token
 * without initiating another browser authorization flow.
 */
export const upworkOAuthCredentialPayloadSchema = z.object({
  version: z.literal(1),
  accessToken: z.string().trim().min(1).max(20_000).optional(),
  refreshToken: z.string().trim().min(1).max(20_000).optional(),
  accessTokenExpiresAt: z.string().datetime({ offset: true }).optional(),
  scope: z.string().trim().min(1).max(10_000).optional(),
  orgUid: z.string().trim().min(1).max(200).optional(),
  authorizationServerIssuer: httpsUrlSchema.optional(),
  clientInformation: upworkOAuthClientInformationSchema.optional(),
  discovery: upworkOAuthDiscoverySchema.optional()
});

/** Persisted subset required to resume the SDK's PKCE callback after a restart. */
export const upworkOAuthAuthorizationPayloadSchema = z.object({
  version: z.literal(1),
  orgUid: z.string().trim().min(1).max(200),
  state: z.string().regex(/^[A-Za-z0-9_-]{32,200}$/).optional(),
  codeVerifier: z.string().regex(/^[A-Za-z0-9._~-]{43,200}$/).optional(),
  clientInformation: upworkOAuthClientInformationSchema.optional(),
  discovery: upworkOAuthDiscoverySchema.optional()
});

const encryptedEnvelopeSchema = z.object({
  version: z.literal(1),
  initializationVector: base64ValueSchema,
  authenticationTag: base64ValueSchema,
  ciphertext: base64ValueSchema
});

export type UpworkOAuthCredentialPayload = z.infer<typeof upworkOAuthCredentialPayloadSchema>;
export type UpworkOAuthAuthorizationPayload = z.infer<
  typeof upworkOAuthAuthorizationPayloadSchema
>;
export type UpworkOAuthClientInformation = z.infer<
  typeof upworkOAuthClientInformationSchema
>;

export class UpworkOAuthCredentialConfigurationError extends Error {
  public constructor() {
    super("UPWORK_MCP_CREDENTIAL_ENCRYPTION_KEY must be a base64-encoded 32-byte value");
    this.name = "UpworkOAuthCredentialConfigurationError";
  }
}

export class UpworkOAuthCredentialDecryptionError extends Error {
  public constructor() {
    super("Unable to decrypt stored Upwork OAuth material");
    this.name = "UpworkOAuthCredentialDecryptionError";
  }
}

function encryptionContext(input: { readonly workspaceId: string; readonly connectionId: string }): Buffer {
  const workspaceId = uuidSchema.parse(input.workspaceId);
  const connectionId = uuidSchema.parse(input.connectionId);
  return Buffer.from(`upwork-mcp-oauth:v1:${workspaceId}:${connectionId}`, "utf8");
}

function authorizationEncryptionContext(input: {
  readonly workspaceId: string;
  readonly connectionId: string;
}): Buffer {
  const workspaceId = uuidSchema.parse(input.workspaceId);
  const connectionId = uuidSchema.parse(input.connectionId);
  return Buffer.from(`upwork-mcp-oauth-authorization:v1:${workspaceId}:${connectionId}`, "utf8");
}

function decodeEncryptionKey(value: string): Buffer {
  try {
    const keyMaterial = encryptionKeyMaterialSchema.parse(value);
    const key = Buffer.from(keyMaterial, "base64");
    if (key.length !== 32) throw new UpworkOAuthCredentialConfigurationError();
    return key;
  } catch {
    throw new UpworkOAuthCredentialConfigurationError();
  }
}

/** AES-256-GCM envelope encryption bound to a workspace and connection. */
export class UpworkOAuthCredentialCipher {
  readonly #key: Buffer;

  public constructor(base64Key: string) {
    this.#key = decodeEncryptionKey(base64Key);
  }

  public encrypt(input: {
    readonly workspaceId: string;
    readonly connectionId: string;
    readonly payload: UpworkOAuthCredentialPayload;
  }): string {
    const payload = upworkOAuthCredentialPayloadSchema.parse(input.payload);
    const initializationVector = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.#key, initializationVector);
    cipher.setAAD(encryptionContext(input));
    const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return JSON.stringify(
      encryptedEnvelopeSchema.parse({
        version: 1,
        initializationVector: initializationVector.toString("base64"),
        authenticationTag: cipher.getAuthTag().toString("base64"),
        ciphertext: ciphertext.toString("base64")
      })
    );
  }

  public decrypt(input: {
    readonly workspaceId: string;
    readonly connectionId: string;
    readonly encryptedPayload: string;
  }): UpworkOAuthCredentialPayload {
    try {
      const envelope = encryptedEnvelopeSchema.parse(JSON.parse(input.encryptedPayload) as unknown);
      const decipher = createDecipheriv(
        "aes-256-gcm",
        this.#key,
        Buffer.from(envelope.initializationVector, "base64")
      );
      decipher.setAAD(encryptionContext(input));
      decipher.setAuthTag(Buffer.from(envelope.authenticationTag, "base64"));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(envelope.ciphertext, "base64")),
        decipher.final()
      ]);
      return upworkOAuthCredentialPayloadSchema.parse(
        JSON.parse(plaintext.toString("utf8")) as unknown
      );
    } catch {
      throw new UpworkOAuthCredentialDecryptionError();
    }
  }

  public encryptAuthorization(input: {
    readonly workspaceId: string;
    readonly connectionId: string;
    readonly payload: UpworkOAuthAuthorizationPayload;
  }): string {
    const payload = upworkOAuthAuthorizationPayloadSchema.parse(input.payload);
    const initializationVector = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.#key, initializationVector);
    cipher.setAAD(authorizationEncryptionContext(input));
    const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return JSON.stringify(
      encryptedEnvelopeSchema.parse({
        version: 1,
        initializationVector: initializationVector.toString("base64"),
        authenticationTag: cipher.getAuthTag().toString("base64"),
        ciphertext: ciphertext.toString("base64")
      })
    );
  }

  public decryptAuthorization(input: {
    readonly workspaceId: string;
    readonly connectionId: string;
    readonly encryptedPayload: string;
  }): UpworkOAuthAuthorizationPayload {
    try {
      const envelope = encryptedEnvelopeSchema.parse(JSON.parse(input.encryptedPayload) as unknown);
      const decipher = createDecipheriv(
        "aes-256-gcm",
        this.#key,
        Buffer.from(envelope.initializationVector, "base64")
      );
      decipher.setAAD(authorizationEncryptionContext(input));
      decipher.setAuthTag(Buffer.from(envelope.authenticationTag, "base64"));
      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(envelope.ciphertext, "base64")),
        decipher.final()
      ]);
      return upworkOAuthAuthorizationPayloadSchema.parse(
        JSON.parse(plaintext.toString("utf8")) as unknown
      );
    } catch {
      throw new UpworkOAuthCredentialDecryptionError();
    }
  }
}

export interface UpworkOAuthCredentialVault {
  save(input: {
    readonly workspaceId: string;
    readonly connectionId: string;
    readonly payload: UpworkOAuthCredentialPayload;
    readonly now?: Date;
  }): Promise<void>;
  load(input: {
    readonly workspaceId: string;
    readonly connectionId: string;
  }): Promise<UpworkOAuthCredentialPayload | undefined>;
  remove(input: { readonly workspaceId: string; readonly connectionId: string }): Promise<void>;
}

/**
 * Server-only vault repository. It verifies the composite tenant relationship
 * before storing or reading a ciphertext, then authenticates the payload with
 * context-bound AES-GCM encryption.
 */
export function createDatabaseUpworkOAuthCredentialVault(
  database: Database,
  cipher: UpworkOAuthCredentialCipher
): UpworkOAuthCredentialVault {
  return {
    async save(input) {
      const workspaceId = uuidSchema.parse(input.workspaceId);
      const connectionId = uuidSchema.parse(input.connectionId);
      const payload = upworkOAuthCredentialPayloadSchema.parse(input.payload);
      const now = input.now ?? new Date();
      const encryptedPayload = cipher.encrypt({ workspaceId, connectionId, payload });

      await database.transaction(async (transaction) => {
        const connection = await transaction
          .select({ id: upworkConnections.id })
          .from(upworkConnections)
          .where(
            and(
              eq(upworkConnections.id, connectionId),
              eq(upworkConnections.workspaceId, workspaceId)
            )
          )
          .for("update")
          .limit(1);
        if (connection[0] === undefined) {
          throw new Error("Upwork OAuth credential connection was not found");
        }
        await transaction
          .insert(upworkOAuthCredentials)
          .values({
            workspaceId,
            connectionId,
            encryptedPayload,
            keyVersion: 1,
            createdAt: now,
            updatedAt: now
          })
          .onConflictDoUpdate({
            target: upworkOAuthCredentials.connectionId,
            set: { encryptedPayload, keyVersion: 1, updatedAt: now }
          });
      });
    },

    async load(input) {
      const workspaceId = uuidSchema.parse(input.workspaceId);
      const connectionId = uuidSchema.parse(input.connectionId);
      const rows = await database
        .select({ encryptedPayload: upworkOAuthCredentials.encryptedPayload })
        .from(upworkOAuthCredentials)
        .where(
          and(
            eq(upworkOAuthCredentials.workspaceId, workspaceId),
            eq(upworkOAuthCredentials.connectionId, connectionId)
          )
        )
        .limit(1);
      const credential = rows[0];
      if (credential === undefined) return undefined;
      return cipher.decrypt({ workspaceId, connectionId, ...credential });
    },

    async remove(input) {
      const workspaceId = uuidSchema.parse(input.workspaceId);
      const connectionId = uuidSchema.parse(input.connectionId);
      await database
        .delete(upworkOAuthCredentials)
        .where(
          and(
            eq(upworkOAuthCredentials.workspaceId, workspaceId),
            eq(upworkOAuthCredentials.connectionId, connectionId)
          )
        );
    }
  };
}

import { createHash, timingSafeEqual } from "node:crypto";

import { and, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "./database.js";
import {
  UpworkOAuthCredentialCipher,
  upworkOAuthAuthorizationPayloadSchema,
  type UpworkOAuthAuthorizationPayload
} from "./upwork-oauth-credentials.js";
import { upworkConnections, upworkOAuthAuthorizations, workspaces } from "./schema.js";

const uuidSchema = z.uuid();
const oauthStateSchema = z.string().regex(/^[A-Za-z0-9_-]{32,200}$/);

export class UpworkOAuthAuthorizationNotFoundError extends Error {
  public constructor() {
    super("Upwork authorization was not found or has expired");
    this.name = "UpworkOAuthAuthorizationNotFoundError";
  }
}

export class UpworkOAuthAuthorizationStateError extends Error {
  public constructor() {
    super("Upwork authorization state did not match");
    this.name = "UpworkOAuthAuthorizationStateError";
  }
}

export function hashUpworkOAuthState(stateValue: string): string {
  const state = oauthStateSchema.parse(stateValue);
  return createHash("sha256").update(state, "utf8").digest("base64url");
}

function statesMatch(leftValue: string, rightValue: string): boolean {
  const left = Buffer.from(leftValue, "utf8");
  const right = Buffer.from(rightValue, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

export interface UpworkOAuthAuthorizationVault {
  save(input: {
    readonly workspaceId: string;
    readonly connectionId: string;
    readonly payload: UpworkOAuthAuthorizationPayload;
    readonly expiresAt?: Date;
    readonly consumedAt?: Date;
    readonly now?: Date;
  }): Promise<void>;
  loadForConnection(input: {
    readonly workspaceId: string;
    readonly connectionId: string;
  }): Promise<UpworkOAuthAuthorizationPayload | undefined>;
  consume(input: {
    readonly state: string;
    readonly ownerUserId: string;
    readonly now?: Date;
  }): Promise<{
    readonly workspaceId: string;
    readonly connectionId: string;
    readonly payload: UpworkOAuthAuthorizationPayload;
  }>;
  remove(input: { readonly workspaceId: string; readonly connectionId: string }): Promise<void>;
}

/**
 * Server-only authorization state. The only callback lookup value is a SHA-256
 * hash; the state and PKCE verifier remain encrypted and are consumed once.
 */
export function createDatabaseUpworkOAuthAuthorizationVault(
  database: Database,
  cipher: UpworkOAuthCredentialCipher
): UpworkOAuthAuthorizationVault {
  return {
    async save(input) {
      const workspaceId = uuidSchema.parse(input.workspaceId);
      const connectionId = uuidSchema.parse(input.connectionId);
      const payload = upworkOAuthAuthorizationPayloadSchema.parse(input.payload);
      const now = input.now ?? new Date();
      const stateHash = payload.state === undefined ? null : hashUpworkOAuthState(payload.state);
      const encryptedPayload = cipher.encryptAuthorization({ workspaceId, connectionId, payload });

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
          throw new Error("Upwork OAuth authorization connection was not found");
        }
        await transaction
          .insert(upworkOAuthAuthorizations)
          .values({
            workspaceId,
            connectionId,
            stateHash,
            encryptedPayload,
            expiresAt: input.expiresAt ?? null,
            consumedAt: input.consumedAt ?? null,
            createdAt: now,
            updatedAt: now
          })
          .onConflictDoUpdate({
            target: upworkOAuthAuthorizations.connectionId,
            set: {
              stateHash,
              encryptedPayload,
              expiresAt: input.expiresAt ?? null,
              consumedAt: input.consumedAt ?? null,
              updatedAt: now
            }
          });
      });
    },

    async loadForConnection(input) {
      const workspaceId = uuidSchema.parse(input.workspaceId);
      const connectionId = uuidSchema.parse(input.connectionId);
      const rows = await database
        .select({ encryptedPayload: upworkOAuthAuthorizations.encryptedPayload })
        .from(upworkOAuthAuthorizations)
        .where(
          and(
            eq(upworkOAuthAuthorizations.workspaceId, workspaceId),
            eq(upworkOAuthAuthorizations.connectionId, connectionId)
          )
        )
        .limit(1);
      const row = rows[0];
      if (row === undefined) return undefined;
      return cipher.decryptAuthorization({ workspaceId, connectionId, ...row });
    },

    async consume(input) {
      const state = oauthStateSchema.parse(input.state);
      const ownerUserId = uuidSchema.parse(input.ownerUserId);
      const stateHash = hashUpworkOAuthState(state);
      const now = input.now ?? new Date();
      return database.transaction(async (transaction) => {
        const rows = await transaction
          .select({
            workspaceId: upworkOAuthAuthorizations.workspaceId,
            connectionId: upworkOAuthAuthorizations.connectionId,
            encryptedPayload: upworkOAuthAuthorizations.encryptedPayload
          })
          .from(upworkOAuthAuthorizations)
          .innerJoin(workspaces, eq(workspaces.id, upworkOAuthAuthorizations.workspaceId))
          .where(
            and(
              eq(upworkOAuthAuthorizations.stateHash, stateHash),
              eq(workspaces.ownerUserId, ownerUserId),
              isNull(upworkOAuthAuthorizations.consumedAt),
              gt(upworkOAuthAuthorizations.expiresAt, now)
            )
          )
          .for("update")
          .limit(1);
        const row = rows[0];
        if (row === undefined) throw new UpworkOAuthAuthorizationNotFoundError();
        const payload = cipher.decryptAuthorization(row);
        if (payload.state === undefined || !statesMatch(payload.state, state)) {
          throw new UpworkOAuthAuthorizationStateError();
        }
        const retainedPayload = upworkOAuthAuthorizationPayloadSchema.parse({
          version: 1,
          orgUid: payload.orgUid,
          ...(payload.clientInformation === undefined
            ? {}
            : { clientInformation: payload.clientInformation }),
          ...(payload.discovery === undefined ? {} : { discovery: payload.discovery })
        });
        await transaction
          .update(upworkOAuthAuthorizations)
          .set({
            stateHash: null,
            encryptedPayload: cipher.encryptAuthorization({
              workspaceId: row.workspaceId,
              connectionId: row.connectionId,
              payload: retainedPayload
            }),
            expiresAt: null,
            consumedAt: now,
            updatedAt: now
          })
          .where(eq(upworkOAuthAuthorizations.connectionId, row.connectionId));
        return { workspaceId: row.workspaceId, connectionId: row.connectionId, payload };
      });
    },

    async remove(input) {
      const workspaceId = uuidSchema.parse(input.workspaceId);
      const connectionId = uuidSchema.parse(input.connectionId);
      await database
        .delete(upworkOAuthAuthorizations)
        .where(
          and(
            eq(upworkOAuthAuthorizations.workspaceId, workspaceId),
            eq(upworkOAuthAuthorizations.connectionId, connectionId)
          )
        );
    }
  };
}

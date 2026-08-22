import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "./database.js";
import {
  upworkConnections,
  upworkMonitors,
  upworkOAuthAuthorizations,
  upworkOAuthCredentials,
  workspaces
} from "./schema.js";

const uuidSchema = z.uuid();
const approvalReferenceSchema = z.string().trim().min(1).max(500);

export class UpworkOAuthConnectionConfigurationError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "UpworkOAuthConnectionConfigurationError";
  }
}

export interface UpworkOAuthConnectionView {
  readonly id: string;
  readonly workspaceId: string;
  readonly status: "authorizing" | "connected" | "reconnect_required" | "disabled";
  readonly accountId: string | null;
}

export async function getUpworkOAuthConnectionView(
  database: Database,
  input: { readonly ownerUserId: string }
): Promise<UpworkOAuthConnectionView | null> {
  const ownerUserId = uuidSchema.parse(input.ownerUserId);
  const rows = await database
    .select({
      id: upworkConnections.id,
      workspaceId: upworkConnections.workspaceId,
      status: upworkConnections.status,
      accountId: upworkConnections.accountId
    })
    .from(upworkConnections)
    .innerJoin(workspaces, eq(upworkConnections.workspaceId, workspaces.id))
    .where(eq(workspaces.ownerUserId, ownerUserId))
    .limit(1);
  const row = rows[0];
  if (row === undefined || row.status === "fake") return null;
  return {
    ...row,
    status: z
      .enum(["authorizing", "connected", "reconnect_required", "disabled"])
      .parse(row.status)
  };
}

/** Starts a user-owned browser consent flow and pauses any real polling by status. */
export async function beginUpworkOAuthConnection(
  database: Database,
  input: {
    readonly ownerUserId: string;
    readonly workspaceId: string;
    readonly approvalReference: string;
    readonly now?: Date;
  }
): Promise<UpworkOAuthConnectionView | null> {
  const ownerUserId = uuidSchema.parse(input.ownerUserId);
  const workspaceId = uuidSchema.parse(input.workspaceId);
  const approvalReference = approvalReferenceSchema.parse(input.approvalReference);
  const now = input.now ?? new Date();

  return database.transaction(async (transaction) => {
    const workspaceRows = await transaction
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(and(eq(workspaces.id, workspaceId), eq(workspaces.ownerUserId, ownerUserId)))
      .for("update")
      .limit(1);
    if (workspaceRows[0] === undefined) return null;

    const existingRows = await transaction
      .select({ id: upworkConnections.id, status: upworkConnections.status })
      .from(upworkConnections)
      .where(eq(upworkConnections.workspaceId, workspaceId))
      .for("update")
      .limit(1);
    const existing = existingRows[0];
    if (existing?.status === "fake") {
      throw new UpworkOAuthConnectionConfigurationError(
        "Disable the local fake Upwork monitor before connecting a real Upwork account"
      );
    }

    if (existing === undefined) {
      const rows = await transaction
        .insert(upworkConnections)
        .values({
          workspaceId,
          status: "authorizing",
          approvalReference,
          nextPurgeAt: now,
          createdAt: now,
          updatedAt: now
        })
        .returning({ id: upworkConnections.id, workspaceId: upworkConnections.workspaceId });
      const connection = rows[0];
      if (connection === undefined) throw new Error("Upwork OAuth connection insert returned no row");
      return { ...connection, accountId: null, status: "authorizing" };
    }

    const rows = await transaction
      .update(upworkConnections)
      .set({
        status: "authorizing",
        accountId: null,
        approvalReference,
        updatedAt: now
      })
      .where(and(eq(upworkConnections.id, existing.id), eq(upworkConnections.workspaceId, workspaceId)))
      .returning({ id: upworkConnections.id, workspaceId: upworkConnections.workspaceId });
    const connection = rows[0];
    if (connection === undefined) throw new Error("Upwork OAuth connection update returned no row");
    return { ...connection, accountId: null, status: "authorizing" };
  });
}

export async function completeUpworkOAuthConnection(
  database: Database,
  input: {
    readonly workspaceId: string;
    readonly connectionId: string;
    readonly accountId: string;
    readonly now?: Date;
  }
): Promise<void> {
  const workspaceId = uuidSchema.parse(input.workspaceId);
  const connectionId = uuidSchema.parse(input.connectionId);
  const accountId = z.string().trim().min(1).max(200).parse(input.accountId);
  const now = input.now ?? new Date();
  await database
    .update(upworkConnections)
    .set({
      status: "connected",
      accountId,
      credentialRef: "database-encrypted-v1",
      nextRequestAt: now,
      updatedAt: now
    })
    .where(
      and(
        eq(upworkConnections.workspaceId, workspaceId),
        eq(upworkConnections.id, connectionId),
        eq(upworkConnections.status, "authorizing")
      )
    );
}

export async function requireUpworkOAuthReconnect(
  database: Database,
  input: { readonly workspaceId: string; readonly connectionId: string; readonly now?: Date }
): Promise<void> {
  const workspaceId = uuidSchema.parse(input.workspaceId);
  const connectionId = uuidSchema.parse(input.connectionId);
  const now = input.now ?? new Date();
  await database
    .update(upworkConnections)
    .set({ status: "reconnect_required", updatedAt: now })
    .where(
      and(
        eq(upworkConnections.workspaceId, workspaceId),
        eq(upworkConnections.id, connectionId)
      )
    );
}

/**
 * Revokes this application's local access immediately. Remote token
 * revocation is not advertised by the approved Upwork MCP discovery contract,
 * so reconnecting requires a fresh user-directed OAuth consent flow.
 */
export async function disconnectUpworkOAuthConnection(
  database: Database,
  input: { readonly ownerUserId: string; readonly now?: Date }
): Promise<boolean> {
  const ownerUserId = uuidSchema.parse(input.ownerUserId);
  const now = input.now ?? new Date();

  return database.transaction(async (transaction) => {
    const rows = await transaction
      .select({
        id: upworkConnections.id,
        workspaceId: upworkConnections.workspaceId
      })
      .from(upworkConnections)
      .innerJoin(workspaces, eq(upworkConnections.workspaceId, workspaces.id))
      .where(eq(workspaces.ownerUserId, ownerUserId))
      .for("update")
      .limit(1);
    const connection = rows[0];
    if (connection === undefined) return false;

    await transaction
      .update(upworkMonitors)
      .set({
        status: "paused",
        scheduleVersion: sql`${upworkMonitors.scheduleVersion} + 1`,
        nextRunAt: null,
        lastErrorCode: null,
        consecutiveFailureCount: 0,
        updatedAt: now
      })
      .where(
        and(
          eq(upworkMonitors.workspaceId, connection.workspaceId),
          eq(upworkMonitors.connectionId, connection.id)
        )
      );
    await transaction
      .delete(upworkOAuthAuthorizations)
      .where(
        and(
          eq(upworkOAuthAuthorizations.workspaceId, connection.workspaceId),
          eq(upworkOAuthAuthorizations.connectionId, connection.id)
        )
      );
    await transaction
      .delete(upworkOAuthCredentials)
      .where(
        and(
          eq(upworkOAuthCredentials.workspaceId, connection.workspaceId),
          eq(upworkOAuthCredentials.connectionId, connection.id)
        )
      );
    await transaction
      .update(upworkConnections)
      .set({
        status: "disabled",
        accountId: null,
        credentialRef: null,
        nextRequestAt: null,
        updatedAt: now
      })
      .where(
        and(
          eq(upworkConnections.workspaceId, connection.workspaceId),
          eq(upworkConnections.id, connection.id)
        )
      );
    return true;
  });
}

import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "./database.js";
import { upworkProfiles, workspaces, type UpworkProfileRow } from "./schema.js";

const uuidSchema = z.uuid();
const profileNameSchema = z.string().trim().min(1).max(120);
const profileTextSchema = z.string().trim().max(12_000);
const stringListSchema = z.array(z.string().trim().min(1).max(120)).max(100);

export type UpworkProfileSummary = Pick<
  UpworkProfileRow,
  "id" | "workspaceId" | "name" | "title" | "isDefault" | "configVersion" | "createdAt" | "updatedAt"
>;

export async function ensureDefaultUpworkProfileForWorkspace(
  database: Database,
  input: { readonly workspaceId: string },
): Promise<UpworkProfileRow> {
  const workspaceId = uuidSchema.parse(input.workspaceId);
  const inserted = await database
    .insert(upworkProfiles)
    .values({
      workspaceId,
      name: "General Profile",
      title: "Default BidWork context",
      isDefault: true,
    })
    .onConflictDoNothing({ target: [upworkProfiles.workspaceId, upworkProfiles.name] })
    .returning();
  const created = inserted[0];
  if (created !== undefined) return created;

  const rows = await database
    .select()
    .from(upworkProfiles)
    .where(and(eq(upworkProfiles.workspaceId, workspaceId), eq(upworkProfiles.isDefault, true)))
    .limit(1);
  const profile = rows[0];
  if (profile === undefined) throw new Error("Default profile could not be reloaded");
  return profile;
}

export async function listUpworkProfiles(
  database: Database,
  input: { readonly ownerUserId: string },
): Promise<UpworkProfileSummary[]> {
  const ownerUserId = uuidSchema.parse(input.ownerUserId);
  return database
    .select({
      id: upworkProfiles.id,
      workspaceId: upworkProfiles.workspaceId,
      name: upworkProfiles.name,
      title: upworkProfiles.title,
      isDefault: upworkProfiles.isDefault,
      configVersion: upworkProfiles.configVersion,
      createdAt: upworkProfiles.createdAt,
      updatedAt: upworkProfiles.updatedAt,
    })
    .from(upworkProfiles)
    .innerJoin(workspaces, eq(upworkProfiles.workspaceId, workspaces.id))
    .where(eq(workspaces.ownerUserId, ownerUserId))
    .orderBy(asc(upworkProfiles.name));
}

export async function getUpworkProfile(
  database: Database,
  input: { readonly ownerUserId: string; readonly profileId: string },
): Promise<UpworkProfileRow | null> {
  const ownerUserId = uuidSchema.parse(input.ownerUserId);
  const profileId = uuidSchema.parse(input.profileId);
  const rows = await database
    .select({ profile: upworkProfiles })
    .from(upworkProfiles)
    .innerJoin(workspaces, eq(upworkProfiles.workspaceId, workspaces.id))
    .where(and(eq(upworkProfiles.id, profileId), eq(workspaces.ownerUserId, ownerUserId)))
    .limit(1);
  return rows[0]?.profile ?? null;
}

export async function createUpworkProfile(
  database: Database,
  input: { readonly ownerUserId: string; readonly name: string; readonly title?: string },
): Promise<UpworkProfileRow | null> {
  const ownerUserId = uuidSchema.parse(input.ownerUserId);
  const name = profileNameSchema.parse(input.name);
  const title = z.string().trim().max(160).parse(input.title ?? "");
  return database.transaction(async (transaction) => {
    const workspace = await transaction
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.ownerUserId, ownerUserId))
      .for("update")
      .limit(1);
    const workspaceId = workspace[0]?.id;
    if (workspaceId === undefined) return null;
    const existingProfiles = await transaction
      .select({ id: upworkProfiles.id })
      .from(upworkProfiles)
      .where(eq(upworkProfiles.workspaceId, workspaceId))
      .limit(1);
    const rows = await transaction
      .insert(upworkProfiles)
      .values({ workspaceId, name, title, isDefault: existingProfiles.length === 0 })
      .returning();
    return rows[0] ?? null;
  });
}

export async function updateUpworkProfile(
  database: Database,
  input: {
    readonly ownerUserId: string;
    readonly profileId: string;
    readonly name: string;
    readonly title: string;
    readonly professionalSummary: string;
    readonly coreServices: readonly string[];
    readonly tools: readonly string[];
    readonly idealCustomerProfile: string;
    readonly preferredProjects: string;
    readonly projectsToAvoid: string;
    readonly languages: readonly string[];
    readonly additionalAiInstructions: string;
  },
): Promise<UpworkProfileRow | null> {
  const ownerUserId = uuidSchema.parse(input.ownerUserId);
  const profileId = uuidSchema.parse(input.profileId);
  const name = profileNameSchema.parse(input.name);
  const title = z.string().trim().max(160).parse(input.title);
  const professionalSummary = profileTextSchema.parse(input.professionalSummary);
  const coreServices = stringListSchema.parse(input.coreServices);
  const tools = stringListSchema.parse(input.tools);
  const idealCustomerProfile = profileTextSchema.parse(input.idealCustomerProfile);
  const preferredProjects = profileTextSchema.parse(input.preferredProjects);
  const projectsToAvoid = profileTextSchema.parse(input.projectsToAvoid);
  const languages = stringListSchema.parse(input.languages);
  const additionalAiInstructions = profileTextSchema.parse(input.additionalAiInstructions);
  const owned = await getUpworkProfile(database, { ownerUserId, profileId });
  if (owned === null) return null;
  const rows = await database.update(upworkProfiles).set({
    name, title, professionalSummary, coreServices, tools, idealCustomerProfile,
    preferredProjects, projectsToAvoid, languages, additionalAiInstructions,
    configVersion: sql`${upworkProfiles.configVersion} + 1`, updatedAt: new Date(),
  }).where(and(eq(upworkProfiles.id, profileId), eq(upworkProfiles.workspaceId, owned.workspaceId))).returning();
  return rows[0] ?? null;
}

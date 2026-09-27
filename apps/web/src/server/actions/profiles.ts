"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import { createUpworkProfile, getUpworkProfile, updateUpworkProfile } from "@upwork-agent/db";

import { activeProfileCookieName } from "@/server/profile-context";
import { requireUser } from "@/server/auth";
import { getDatabase } from "@/server/database";

export async function selectActiveProfileAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const profileId = z.uuid().parse(formData.get("profileId"));
  const profile = await getUpworkProfile(getDatabase(), { ownerUserId: user.id, profileId });
  if (profile === null) redirect("/app/campaigns");
  (await cookies()).set(activeProfileCookieName, profile.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/app",
  });
  revalidatePath("/app", "layout");
}

export async function createProfileAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const values = z.object({ name: z.string().trim().min(1).max(120), title: z.string().trim().max(160) }).parse({
    name: formData.get("name"),
    title: formData.get("title"),
  });
  const profile = await createUpworkProfile(getDatabase(), { ownerUserId: user.id, ...values });
  if (profile === null) redirect("/app/campaigns");
  (await cookies()).set(activeProfileCookieName, profile.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/app",
  });
  revalidatePath("/app", "layout");
  redirect("/app/campaigns");
}

function commaSeparated(formData: FormData, name: string): string[] {
  const value = formData.get(name);
  return typeof value !== "string" ? [] : value.split(",").map((item) => item.trim()).filter(Boolean);
}

export async function updateProfileAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const values = z.object({
    profileId: z.uuid(), name: z.string().trim().min(1).max(120), title: z.string().trim().max(160),
    professionalSummary: z.string().trim().max(12_000), idealCustomerProfile: z.string().trim().max(12_000),
    preferredProjects: z.string().trim().max(12_000), projectsToAvoid: z.string().trim().max(12_000),
    additionalAiInstructions: z.string().trim().max(12_000),
  }).parse({
    profileId: formData.get("profileId"), name: formData.get("name"), title: formData.get("title"),
    professionalSummary: formData.get("professionalSummary"), idealCustomerProfile: formData.get("idealCustomerProfile"),
    preferredProjects: formData.get("preferredProjects"), projectsToAvoid: formData.get("projectsToAvoid"),
    additionalAiInstructions: formData.get("additionalAiInstructions"),
  });
  await updateUpworkProfile(getDatabase(), { ownerUserId: user.id, ...values, coreServices: commaSeparated(formData, "coreServices"), tools: commaSeparated(formData, "tools"), languages: commaSeparated(formData, "languages") });
  revalidatePath("/app", "layout");
  redirect("/app/profiles");
}

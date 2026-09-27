import { cookies } from "next/headers";

import { ensureWorkspaceForUser, getUpworkProfile, listUpworkProfiles, type UpworkProfileSummary } from "@upwork-agent/db";

import { getDatabase } from "@/server/database";

export const activeProfileCookieName = "bidwork_active_profile";

export type ActiveProfileContext = {
  readonly profiles: UpworkProfileSummary[];
  readonly activeProfile: UpworkProfileSummary;
};

export async function getActiveProfileContext(input: {
  readonly ownerUserId: string;
  readonly workspaceName: string;
}): Promise<ActiveProfileContext> {
  const database = getDatabase();
  await ensureWorkspaceForUser(database, {
    ownerUserId: input.ownerUserId,
    name: input.workspaceName,
  });
  const profiles = await listUpworkProfiles(database, { ownerUserId: input.ownerUserId });
  const savedProfileId = (await cookies()).get(activeProfileCookieName)?.value;
  const savedProfile = savedProfileId === undefined
    ? null
    : await getUpworkProfile(database, { ownerUserId: input.ownerUserId, profileId: savedProfileId });
  const activeProfile = profiles.find((profile) => profile.id === savedProfile?.id)
    ?? profiles.find((profile) => profile.isDefault)
    ?? profiles[0];
  if (activeProfile === undefined) throw new Error("No Upwork profile is available");
  return { profiles, activeProfile };
}

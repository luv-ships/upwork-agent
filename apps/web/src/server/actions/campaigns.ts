"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { campaignFilterV1Schema } from "@upwork-agent/core";
import {
  archiveCampaign,
  createCampaign,
  deleteCampaign,
  disconnectUpworkOAuthConnection,
  enableConnectedUpworkMonitor,
  enableFakeUpworkMonitor,
  ensureWorkspaceForUser,
  pauseUpworkMonitor,
  updateCampaign
} from "@upwork-agent/db";
import { revalidatePath } from "next/cache";

import { requireUser } from "@/server/auth";
import { getDatabase } from "@/server/database";
import { getServerEnvironment } from "@/server/env";

function strings(formData: FormData, name: string): string[] {
  return formData
    .getAll(name)
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

function commaSeparated(formData: FormData, name: string): string[] {
  const value = formData.get(name);
  if (typeof value !== "string") return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function optionalText(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function optionalNumber(formData: FormData, name: string): number | undefined {
  const value = optionalText(formData, name);
  if (value === undefined) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function range(minimum: number | undefined, maximum: number | undefined) {
  if (minimum === undefined && maximum === undefined) return undefined;
  return {
    ...(minimum === undefined ? {} : { min: minimum }),
    ...(maximum === undefined ? {} : { max: maximum })
  };
}

function proposalRange(value: string | undefined) {
  if (value === "under_5") return { max: 4 };
  if (value === "5_to_10") return { min: 5, max: 10 };
  if (value === "10_to_15") return { min: 10, max: 15 };
  if (value === "15_to_20") return { min: 15, max: 20 };
  if (value === "20_to_50") return { min: 20, max: 50 };
  return undefined;
}

function fixedBudgetRange(formData: FormData) {
  const custom = range(optionalNumber(formData, "fixedMin"), optionalNumber(formData, "fixedMax"));
  if (custom !== undefined) return custom;

  const preset = optionalText(formData, "fixedBudgetPreset");
  if (preset === "under_100") return { max: 99.99 };
  if (preset === "100_to_500") return { min: 100, max: 500 };
  if (preset === "500_to_1000") return { min: 500, max: 1000 };
  if (preset === "1000_to_5000") return { min: 1000, max: 5000 };
  if (preset === "5000_plus") return { min: 5000 };
  return undefined;
}

const campaignCommandSchema = z.object({
  name: z.string().trim().min(1).max(120),
  aiInstructions: z.string().max(4000),
  scoreThreshold: z.number().int().min(0).max(100),
  filters: campaignFilterV1Schema
});

function safeErrorRedirect(): never {
  redirect("/app/campaigns/new?error=Please%20check%20the%20campaign%20fields%20and%20try%20again.");
}

function parseCampaignCommand(formData: FormData) {
  const hourlyRate = range(optionalNumber(formData, "hourlyMin"), optionalNumber(formData, "hourlyMax"));
  const fixedBudget = fixedBudgetRange(formData);
  const proposalCount = proposalRange(optionalText(formData, "proposalBand"));
  const clientHireRatePercent = range(
    optionalNumber(formData, "clientHireMin"),
    optionalNumber(formData, "clientHireMax"),
  );
  const postedWithinMinutes = optionalNumber(formData, "postedWithinMinutes");

  const candidate = {
    name: optionalText(formData, "name") ?? "",
    aiInstructions: optionalText(formData, "aiInstructions") ?? "",
    scoreThreshold: optionalNumber(formData, "scoreThreshold"),
    filters: {
      version: 1,
      requiredSkills: commaSeparated(formData, "requiredSkills"),
      includeKeywords: commaSeparated(formData, "includeKeywords"),
      excludeKeywords: commaSeparated(formData, "excludeKeywords"),
      categoryIds: commaSeparated(formData, "categoryIds"),
      experienceLevels: strings(formData, "experienceLevels"),
      jobTypes: strings(formData, "jobTypes"),
      ...(hourlyRate === undefined ? {} : { hourlyRate }),
      ...(fixedBudget === undefined ? {} : { fixedBudget }),
      ...(proposalCount === undefined ? {} : { proposalCount }),
      ...(clientHireRatePercent === undefined ? {} : { clientHireRatePercent }),
      ...(postedWithinMinutes === undefined ? {} : { postedWithinMinutes }),
      paymentVerification: optionalText(formData, "paymentVerification") ?? "any",
      clientHireHistory: optionalText(formData, "clientHistory") ?? "any",
      clientCountryCodes: commaSeparated(formData, "clientLocations").map((code) => code.toUpperCase()),
      clientTimeZones: commaSeparated(formData, "clientTimeZones"),
      projectLengthBands: strings(formData, "projectLengths"),
      hoursPerWeekBands: strings(formData, "hoursPerWeek"),
      contractToHire: optionalText(formData, "contractToHire") ?? "any",
      scoringWeights: {
        version: 1,
        skills: optionalNumber(formData, "weightSkills"),
        keywords: optionalNumber(formData, "weightKeywords"),
        budget: optionalNumber(formData, "weightBudget"),
        competition: optionalNumber(formData, "weightCompetition"),
        clientQuality: optionalNumber(formData, "weightClientQuality"),
        projectFit: optionalNumber(formData, "weightProjectFit")
      }
    }
  };

  return campaignCommandSchema.safeParse(candidate);
}

export async function createCampaignAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const command = parseCampaignCommand(formData);
  if (!command.success) safeErrorRedirect();

  const database = getDatabase();
  const workspace = await ensureWorkspaceForUser(database, {
    ownerUserId: user.id,
    name: "My workspace"
  });
  const campaign = await createCampaign(database, {
    ownerUserId: user.id,
    workspaceId: workspace.id,
    name: command.data.name,
    filters: command.data.filters,
    aiInstructions: command.data.aiInstructions,
    scoreThreshold: command.data.scoreThreshold,
    status: "active"
  });
  if (campaign === null) safeErrorRedirect();
  redirect(`/app/campaigns/${campaign.id}`);
}

const campaignIdentitySchema = z.object({
  campaignId: z.uuid(),
  configVersion: z.coerce.number().int().positive()
});

export async function updateCampaignAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const identity = campaignIdentitySchema.safeParse({
    campaignId: formData.get("campaignId"),
    configVersion: formData.get("configVersion")
  });
  const command = parseCampaignCommand(formData);

  if (!identity.success || !command.success) {
    const campaignId = typeof formData.get("campaignId") === "string" ? formData.get("campaignId") : "";
    redirect(`/app/campaigns/${campaignId}/edit?error=Please%20check%20the%20campaign%20fields%20and%20try%20again.`);
  }

  const campaign = await updateCampaign(getDatabase(), {
    ownerUserId: user.id,
    campaignId: identity.data.campaignId,
    expectedConfigVersion: identity.data.configVersion,
    name: command.data.name,
    filters: command.data.filters,
    aiInstructions: command.data.aiInstructions,
    scoreThreshold: command.data.scoreThreshold
  });
  if (campaign === null) redirect("/app/campaigns");
  revalidatePath("/app/campaigns");
  redirect(`/app/campaigns/${campaign.id}`);
}

export async function updateCampaignBasicsAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const identity = campaignIdentitySchema.parse({
    campaignId: formData.get("campaignId"),
    configVersion: formData.get("configVersion")
  });
  const basics = z
    .object({
      name: z.string().trim().min(1).max(160),
      aiInstructions: z.string().max(12_000),
      scoreThreshold: z.coerce.number().int().min(0).max(100)
    })
    .parse({
      name: formData.get("name"),
      aiInstructions: formData.get("aiInstructions"),
      scoreThreshold: formData.get("scoreThreshold")
    });

  await updateCampaign(getDatabase(), {
    ownerUserId: user.id,
    campaignId: identity.campaignId,
    expectedConfigVersion: identity.configVersion,
    ...basics
  });
  revalidatePath(`/app/campaigns/${identity.campaignId}`);
  revalidatePath("/app/campaigns");
}

export async function changeCampaignStatusAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const command = campaignIdentitySchema
    .extend({ status: z.enum(["active", "paused"]) })
    .parse({
      campaignId: formData.get("campaignId"),
      configVersion: formData.get("configVersion"),
      status: formData.get("status")
    });
  await updateCampaign(getDatabase(), {
    ownerUserId: user.id,
    campaignId: command.campaignId,
    expectedConfigVersion: command.configVersion,
    status: command.status
  });
  revalidatePath(`/app/campaigns/${command.campaignId}`);
  revalidatePath("/app/campaigns");
}

export async function archiveCampaignAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const campaignId = z.uuid().parse(formData.get("campaignId"));
  await archiveCampaign(getDatabase(), { ownerUserId: user.id, campaignId });
  revalidatePath("/app/campaigns");
  redirect("/app/campaigns");
}

export async function deleteCampaignAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const campaignId = z.uuid().parse(formData.get("campaignId"));
  await deleteCampaign(getDatabase(), { ownerUserId: user.id, campaignId });
  revalidatePath("/app/campaigns");
  redirect("/app/campaigns");
}

export async function enableUpworkMonitorAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const environment = getServerEnvironment();
  if (environment.UPWORK_MONITOR_PROVIDER === "disabled") {
    throw new Error("Upwork monitoring is disabled until a provider is configured.");
  }
  const command = z
    .object({
      campaignId: z.uuid(),
      pollIntervalSeconds: z.coerce.number().int().min(60).max(86_400)
    })
    .parse({
      campaignId: formData.get("campaignId"),
      pollIntervalSeconds: formData.get("pollIntervalSeconds")
    });
  const enableMonitor =
    environment.UPWORK_MONITOR_PROVIDER === "mcp"
      ? enableConnectedUpworkMonitor
      : enableFakeUpworkMonitor;
  await enableMonitor(getDatabase(), {
    ownerUserId: user.id,
    campaignId: command.campaignId,
    pollIntervalSeconds: command.pollIntervalSeconds,
    minimumPollIntervalSeconds:
      environment.UPWORK_MCP_MIN_POLL_INTERVAL_SECONDS,
    approvalReference: environment.UPWORK_MCP_APPROVAL_REFERENCE
  });
  revalidatePath(`/app/campaigns/${command.campaignId}`);
}

export async function pauseUpworkMonitorAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const campaignId = z.uuid().parse(formData.get("campaignId"));
  await pauseUpworkMonitor(getDatabase(), { ownerUserId: user.id, campaignId });
  revalidatePath(`/app/campaigns/${campaignId}`);
}

export async function disconnectUpworkAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const campaignId = z.uuid().parse(formData.get("campaignId"));
  await disconnectUpworkOAuthConnection(getDatabase(), { ownerUserId: user.id });
  revalidatePath(`/app/campaigns/${campaignId}`);
  revalidatePath("/app/campaigns");
}

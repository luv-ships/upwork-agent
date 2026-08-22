import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { getCampaign } from "@upwork-agent/db";

import { CampaignForm } from "@/components/campaign/campaign-form";
import { updateCampaignAction } from "@/server/actions/campaigns";
import { requireUser } from "@/server/auth";
import { getDatabase } from "@/server/database";

export const metadata: Metadata = { title: "Edit campaign" };

export default async function EditCampaignPage({
  params,
  searchParams
}: {
  params: Promise<{ campaignId: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const [{ campaignId }, parameters, user] = await Promise.all([
    params,
    searchParams,
    requireUser()
  ]);
  const campaign = await getCampaign(getDatabase(), { ownerUserId: user.id, campaignId });
  if (campaign === null || campaign.status === "archived") notFound();

  return (
    <div className="grid gap-7">
      <div>
        <Link className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-950" href={`/app/campaigns/${campaign.id}`}>
          <ArrowLeft className="size-4" aria-hidden="true" />Back to campaign
        </Link>
        <p className="mt-6 text-sm font-semibold uppercase tracking-[0.16em] text-sky-700">Edit campaign</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">{campaign.name}</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
          Changes apply to new development ingests. Existing matches keep their original configuration snapshot for auditability.
        </p>
      </div>
      <CampaignForm
        action={updateCampaignAction}
        {...(parameters.error === undefined ? {} : { error: parameters.error })}
        initial={{
          aiInstructions: campaign.aiInstructions,
          campaignId: campaign.id,
          configVersion: campaign.configVersion,
          filters: campaign.filters,
          name: campaign.name,
          scoreThreshold: campaign.scoreThreshold
        }}
        submitLabel="Save campaign"
      />
    </div>
  );
}

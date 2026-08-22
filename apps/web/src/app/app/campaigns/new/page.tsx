import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { CampaignForm } from "@/components/campaign/campaign-form";
import { createCampaignAction } from "@/server/actions/campaigns";

export const metadata: Metadata = { title: "New campaign" };

export default async function NewCampaignPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const parameters = await searchParams;

  return (
    <div className="grid gap-7">
      <div>
        <Link className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-950" href="/app/campaigns">
          <ArrowLeft className="size-4" aria-hidden="true" />
          Back to campaigns
        </Link>
        <p className="mt-6 text-sm font-semibold uppercase tracking-[0.16em] text-sky-700">New campaign</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Define a qualified opportunity</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
          Start broad, then add only the constraints that represent a real business decision. Skills such as Make.com and OpenAI express technical fit; the remaining controls express commercial and client fit.
        </p>
      </div>
      <CampaignForm
        action={createCampaignAction}
        {...(parameters.error === undefined ? {} : { error: parameters.error })}
      />
    </div>
  );
}

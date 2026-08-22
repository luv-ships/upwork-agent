import { Activity, ArrowRight, BriefcaseBusiness, Plus } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { listCampaigns } from "@upwork-agent/db";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { requireUser } from "@/server/auth";
import { getDatabase } from "@/server/database";

export const metadata: Metadata = { title: "Campaigns" };

function statusTone(status: string): "success" | "warning" | "neutral" {
  if (status === "active") return "success";
  if (status === "paused") return "warning";
  return "neutral";
}

export default async function CampaignsPage() {
  const user = await requireUser();
  const campaigns = await listCampaigns(getDatabase(), { ownerUserId: user.id });
  const activeCount = campaigns.filter((campaign) => campaign.status === "active").length;

  return (
    <div className="grid gap-7">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-sky-700">Opportunity qualification</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">Campaigns</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
            Define transparent rules first, then use AI only on jobs that pass them.
          </p>
        </div>
        <Link className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-slate-950 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-2" href="/app/campaigns/new">
          <Plus className="size-4" aria-hidden="true" />
          New campaign
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Total campaigns</p>
          <p className="mt-2 text-3xl font-semibold text-slate-950">{campaigns.length}</p>
        </Card>
        <Card className="p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Active</p>
          <p className="mt-2 text-3xl font-semibold text-emerald-700">{activeCount}</p>
        </Card>
        <Card className="p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">AI default</p>
          <p className="mt-2 text-3xl font-semibold text-slate-950">Fake</p>
          <p className="mt-1 text-xs text-slate-500">Key-free and deterministic</p>
        </Card>
      </div>

      {campaigns.length === 0 ? (
        <Card className="grid min-h-72 place-items-center p-8 text-center">
          <div className="max-w-md">
            <span className="mx-auto grid size-12 place-items-center rounded-xl bg-sky-100 text-sky-800">
              <BriefcaseBusiness className="size-5" aria-hidden="true" />
            </span>
            <h2 className="mt-5 text-lg font-semibold text-slate-950">Create your first campaign</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Start with Make.com and OpenAI skills, then add the client and budget controls that matter to your business.
            </p>
            <Link className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-sky-800 hover:text-sky-950" href="/app/campaigns/new">
              Configure a campaign <ArrowRight className="size-4" aria-hidden="true" />
            </Link>
          </div>
        </Card>
      ) : (
        <div className="grid gap-3">
          {campaigns.map((campaign) => (
            <Link href={`/app/campaigns/${campaign.id}`} key={campaign.id}>
              <Card className="group flex flex-wrap items-center gap-5 p-5 transition hover:border-slate-300 hover:shadow-md sm:p-6">
                <span className="grid size-11 place-items-center rounded-xl bg-slate-100 text-slate-700 group-hover:bg-sky-100 group-hover:text-sky-800">
                  <Activity className="size-5" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-3">
                    <h2 className="truncate font-semibold text-slate-950">{campaign.name}</h2>
                    <Badge tone={statusTone(campaign.status)}>{campaign.status}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-slate-500">Score threshold {campaign.scoreThreshold} · configuration v{campaign.configVersion}</p>
                </div>
                <ArrowRight className="size-5 text-slate-400 transition group-hover:translate-x-0.5 group-hover:text-slate-700" aria-hidden="true" />
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

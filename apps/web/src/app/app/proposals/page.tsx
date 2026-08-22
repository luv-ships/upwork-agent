import { RefreshCw, Send } from "lucide-react";
import type { Metadata } from "next";

import { listProposalQueueViews } from "@upwork-agent/db";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusRefresher } from "@/components/campaign/status-refresher";
import { requireUser } from "@/server/auth";
import { getDatabase } from "@/server/database";
import { regenerateProposalAction, reviewProposalAction } from "@/server/actions/proposals";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Proposals" };

function statusTone(status: string): "neutral" | "success" | "warning" | "danger" {
  if (status === "ready_for_review") return "warning";
  if (status === "approved") return "success";
  if (status === "rejected" || status === "failed") return "danger";
  return "neutral";
}

export default async function ProposalsPage() {
  const user = await requireUser();
  const proposals = await listProposalQueueViews(getDatabase(), { ownerUserId: user.id });
  const hasPending = proposals.some((item) => item.proposal.status === "queued" || item.proposal.status === "generating");
  return (
    <div className="grid gap-7">
      <StatusRefresher active={hasPending} />
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="grid size-9 place-items-center rounded-xl bg-slate-950 text-white"><Send className="size-4" aria-hidden="true" /></span>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-950">Proposal queue</h1>
          <Badge tone="info">Manual review</Badge>
        </div>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">Generated drafts are grounded in your private knowledge and suitability results. Nothing is submitted to Upwork from this queue.</p>
      </div>

      {proposals.length === 0 ? <Card className="grid min-h-72 place-items-center p-8 text-center"><div className="max-w-md"><h2 className="text-lg font-semibold text-slate-950">No proposal drafts yet</h2><p className="mt-2 text-sm leading-6 text-slate-600">Add knowledge, run the score loop, and qualifying matches will appear here for review.</p></div></Card> : <div className="grid gap-4">{proposals.map((item) => <Card className="p-6" key={item.proposal.id}><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{item.campaignName}</p><h2 className="mt-1 text-lg font-semibold text-slate-950">{item.jobTitle ?? "Untitled job"}</h2></div><Badge tone={statusTone(item.proposal.status)}>{item.proposal.status.replaceAll("_", " ")}</Badge></div>{item.version ? <div className="mt-5 rounded-xl bg-slate-50 p-4"><p className="whitespace-pre-wrap text-sm leading-6 text-slate-700">{item.version.body}</p>{item.version.suggestedBidAmount !== null ? <p className="mt-3 text-xs font-semibold text-slate-500">Suggested bid: {item.version.suggestedBidCurrency ?? "USD"} {item.version.suggestedBidAmount}</p> : null}</div> : <p className="mt-5 text-sm text-slate-500">Draft is queued for generation.</p>}<div className="mt-5 flex flex-wrap gap-2"><form action={reviewProposalAction}><input type="hidden" name="proposalId" value={item.proposal.id} /><input type="hidden" name="status" value="approved" /><Button type="submit">Approve for handoff</Button></form><form action={reviewProposalAction}><input type="hidden" name="proposalId" value={item.proposal.id} /><input type="hidden" name="status" value="rejected" /><Button type="submit" variant="danger">Reject</Button></form><form action={regenerateProposalAction}><input type="hidden" name="proposalId" value={item.proposal.id} /><Button type="submit" variant="secondary"><RefreshCw className="mr-2 size-4" aria-hidden="true" />Regenerate</Button></form></div></Card>)}</div>}
    </div>
  );
}

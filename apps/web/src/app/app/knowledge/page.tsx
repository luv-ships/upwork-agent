import type { Metadata } from "next";

import { listKnowledgeDocuments } from "@upwork-agent/db";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { StatusRefresher } from "@/components/campaign/status-refresher";
import { requireUser } from "@/server/auth";
import { getDatabase } from "@/server/database";
import { createKnowledgeDocumentAction } from "@/server/actions/proposals";

export const metadata: Metadata = { title: "Knowledge" };

export default async function KnowledgePage() {
  const user = await requireUser();
  const documents = await listKnowledgeDocuments(getDatabase(), { ownerUserId: user.id });
  return <div className="grid max-w-3xl gap-7"><StatusRefresher active={documents.some((document) => document.status === "pending")} /><div><h1 className="text-3xl font-semibold tracking-tight text-slate-950">Private knowledge</h1><p className="mt-3 text-sm leading-6 text-slate-600">Add reusable case studies, capabilities, and proof points. Documents are indexed privately per workspace and used only to ground proposal drafts.</p></div><Card className="p-6"><form action={createKnowledgeDocumentAction} className="grid gap-5"><label className="grid gap-2 text-sm font-medium text-slate-800">Title<input className="min-h-11 rounded-lg border border-slate-300 px-3" name="title" placeholder="React migration case study" required /></label><label className="grid gap-2 text-sm font-medium text-slate-800">Content<textarea className="min-h-56 rounded-lg border border-slate-300 p-3" name="content" placeholder="Describe the work, outcomes, tools, and evidence..." required /></label><div><Button type="submit">Save to private knowledge</Button></div></form></Card>{documents.length > 0 ? <Card className="divide-y divide-slate-200"><div className="p-5"><h2 className="font-semibold text-slate-950">Indexed sources</h2></div>{documents.map((document) => <div className="flex items-center justify-between gap-4 p-5" key={document.id}><p className="text-sm font-medium text-slate-800">{document.title}</p><Badge tone={document.status === "ready" ? "success" : document.status === "failed" ? "danger" : "warning"}>{document.status}</Badge></div>)}</Card> : null}</div>;
}

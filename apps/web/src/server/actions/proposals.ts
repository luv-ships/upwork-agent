"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import {
  createKnowledgeDocument,
  ensureWorkspaceForUser,
  regenerateProposal,
  reviewProposal,
} from "@upwork-agent/db";

import { requireUser } from "@/server/auth";
import { getDatabase } from "@/server/database";

const proposalIdSchema = z.uuid();

export async function reviewProposalAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const proposalId = proposalIdSchema.safeParse(formData.get("proposalId"));
  const status = z.enum(["approved", "rejected"]).safeParse(formData.get("status"));
  if (!proposalId.success || !status.success) redirect("/app/proposals?error=Invalid%20proposal%20action");
  await reviewProposal(getDatabase(), { ownerUserId: user.id, proposalId: proposalId.data, status: status.data });
  revalidatePath("/app/proposals");
}

export async function regenerateProposalAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const proposalId = proposalIdSchema.safeParse(formData.get("proposalId"));
  if (!proposalId.success) redirect("/app/proposals?error=Invalid%20proposal");
  await regenerateProposal(getDatabase(), { ownerUserId: user.id, proposalId: proposalId.data });
  revalidatePath("/app/proposals");
}

export async function createKnowledgeDocumentAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const values = z.object({ title: z.string().trim().min(1).max(200), content: z.string().trim().min(1).max(200_000) }).safeParse({
    title: formData.get("title"),
    content: formData.get("content"),
  });
  if (!values.success) redirect("/app/knowledge?error=Add%20a%20title%20and%20some%20knowledge");
  const database = getDatabase();
  await ensureWorkspaceForUser(database, { ownerUserId: user.id, name: "My workspace" });
  await createKnowledgeDocument(database, { ownerUserId: user.id, title: values.data.title, content: values.data.content });
  revalidatePath("/app/knowledge");
}

import { FlaskConical } from "lucide-react";
import type { Metadata } from "next";

import { ensureWorkspaceForUser } from "@upwork-agent/db";

import { Badge } from "@/components/ui/badge";
import { DevelopmentJobForm } from "@/components/development/development-job-form";
import { requireUser } from "@/server/auth";
import { getDatabase } from "@/server/database";

export const metadata: Metadata = { title: "Test job" };

export default async function DevelopmentPage() {
  const user = await requireUser();
  const workspace = await ensureWorkspaceForUser(getDatabase(), {
    ownerUserId: user.id,
    name: "My workspace"
  });

  return (
    <div className="grid gap-7">
      <div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="grid size-9 place-items-center rounded-xl bg-violet-100 text-violet-800"><FlaskConical className="size-4" aria-hidden="true" /></span>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-950">Inject a test job</h1>
          <Badge tone="warning">Development only</Badge>
        </div>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
          Exercise normalization, deterministic matching, and fake AI scoring without connecting to Upwork or another external source.
        </p>
      </div>
      <DevelopmentJobForm workspaceId={workspace.id} />
    </div>
  );
}

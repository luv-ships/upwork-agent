import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getUpworkProfile } from "@upwork-agent/db";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/field";
import { updateProfileAction } from "@/server/actions/profiles";
import { requireUser } from "@/server/auth";
import { getDatabase } from "@/server/database";
import { getActiveProfileContext } from "@/server/profile-context";

export const metadata: Metadata = { title: "Profile context" };

function csv(values: readonly string[]): string { return values.join(", "); }

export default async function ProfileSettingsPage() {
  const user = await requireUser();
  const context = await getActiveProfileContext({ ownerUserId: user.id, workspaceName: "My workspace" });
  const profile = await getUpworkProfile(getDatabase(), { ownerUserId: user.id, profileId: context.activeProfile.id });
  if (profile === null) notFound();
  return (
    <div className="grid max-w-4xl gap-7">
      <div>
        <p className="text-sm font-semibold uppercase tracking-[0.16em] text-teal-700">Active profile</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">{profile.name}</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-600">This context controls future job suitability decisions, campaigns, knowledge retrieval, and proposal drafts. Past results keep their original profile snapshot.</p>
      </div>
      <Card className="p-6 sm:p-8">
        <form action={updateProfileAction} className="grid gap-6">
          <input name="profileId" type="hidden" value={profile.id} />
          <div className="grid gap-5 sm:grid-cols-2"><Field label="Profile name"><Input defaultValue={profile.name} name="name" required /></Field><Field label="Specialization"><Input defaultValue={profile.title} name="title" placeholder="AI Automation" /></Field></div>
          <Field label="Professional summary"><Textarea defaultValue={profile.professionalSummary} name="professionalSummary" placeholder="Describe what this profile represents and the work it should win." /></Field>
          <div className="grid gap-5 sm:grid-cols-2"><Field label="Core services"><Input defaultValue={csv(profile.coreServices)} name="coreServices" placeholder="AI automation, n8n workflows" /></Field><Field label="Tools and technologies"><Input defaultValue={csv(profile.tools)} name="tools" placeholder="OpenAI, n8n, Python" /></Field></div>
          <Field label="Ideal customer profile"><Textarea defaultValue={profile.idealCustomerProfile} name="idealCustomerProfile" placeholder="The clients and project types this profile should target." /></Field>
          <div className="grid gap-5 sm:grid-cols-2"><Field label="Preferred projects"><Textarea defaultValue={profile.preferredProjects} name="preferredProjects" placeholder="Projects to actively pursue." /></Field><Field label="Projects to avoid"><Textarea defaultValue={profile.projectsToAvoid} name="projectsToAvoid" placeholder="Work to classify as unsuitable even when filters pass." /></Field></div>
          <Field label="Languages"><Input defaultValue={csv(profile.languages)} name="languages" placeholder="English, Hindi" /></Field>
          <Field label="Additional AI instructions"><Textarea defaultValue={profile.additionalAiInstructions} name="additionalAiInstructions" placeholder="Additional guidance for future suitability decisions." /></Field>
          <div><Button type="submit">Save profile context</Button></div>
        </form>
      </Card>
    </div>
  );
}

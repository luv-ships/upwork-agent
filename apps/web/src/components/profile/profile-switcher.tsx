"use client";

import { Check, ChevronDown, Plus, UserRound } from "lucide-react";
import { useState } from "react";

import type { UpworkProfileSummary } from "@upwork-agent/db";

import { createProfileAction, selectActiveProfileAction } from "@/server/actions/profiles";

export function ProfileSwitcher({
  activeProfile,
  profiles,
}: {
  readonly activeProfile: UpworkProfileSummary;
  readonly profiles: readonly UpworkProfileSummary[];
}) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  return (
    <div className="relative">
      <button
        aria-expanded={open}
        className="flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-left text-sm shadow-sm transition hover:border-teal-300 hover:bg-teal-50"
        onClick={() => setOpen((value) => !value)}
        type="button"
      >
        <span className="grid size-6 place-items-center rounded-lg bg-teal-100 text-teal-700"><UserRound className="size-3.5" /></span>
        <span className="hidden max-w-36 truncate font-semibold text-slate-900 lg:block">{activeProfile.name}</span>
        <ChevronDown className="size-4 text-slate-500" />
      </button>
      {open ? (
        <div className="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-80 rounded-2xl border border-slate-200 bg-white p-2 shadow-xl">
          <div className="px-3 py-2"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Upwork profiles</p></div>
          <div className="grid gap-1">
            {profiles.map((profile) => (
              <form action={selectActiveProfileAction} key={profile.id}>
                <input name="profileId" type="hidden" value={profile.id} />
                <button className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-slate-50" type="submit">
                  <span className="grid size-8 place-items-center rounded-lg bg-slate-100 text-slate-600"><UserRound className="size-4" /></span>
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-slate-900">{profile.name}</span><span className="block truncate text-xs text-slate-500">{profile.title || "Profile context"}</span></span>
                  {profile.id === activeProfile.id ? <Check className="size-4 text-teal-600" aria-label="Active profile" /> : null}
                </button>
              </form>
            ))}
          </div>
          <div className="mt-2 border-t border-slate-100 pt-2">
            {creating ? (
              <form action={createProfileAction} className="grid gap-2 p-2">
                <input className="min-h-9 rounded-lg border border-slate-300 px-2 text-sm" name="name" placeholder="Profile name" required />
                <input className="min-h-9 rounded-lg border border-slate-300 px-2 text-sm" name="title" placeholder="Specialization" />
                <button className="min-h-9 rounded-lg bg-teal-600 px-3 text-sm font-semibold text-white hover:bg-teal-700" type="submit">Create profile</button>
              </form>
            ) : <button className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-semibold text-teal-700 hover:bg-teal-50" onClick={() => setCreating(true)} type="button"><Plus className="size-4" />Add profile</button>}
          </div>
        </div>
      ) : null}
    </div>
  );
}

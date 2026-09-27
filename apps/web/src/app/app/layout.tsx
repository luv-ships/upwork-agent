import { BookOpen, BriefcaseBusiness, FlaskConical, LogOut, Send, Settings2 } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import { ensureWorkspaceForUser } from "@upwork-agent/db";

import { requireUser } from "@/server/auth";
import { getDatabase } from "@/server/database";
import { getActiveProfileContext } from "@/server/profile-context";
import { ProfileSwitcher } from "@/components/profile/profile-switcher";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: Readonly<{ children: ReactNode }>) {
  const user = await requireUser();
  const displayName =
    typeof user.user_metadata["full_name"] === "string"
      ? user.user_metadata["full_name"]
      : (user.email ?? "Account");
  await ensureWorkspaceForUser(getDatabase(), {
    ownerUserId: user.id,
    name: `${displayName}'s workspace`
  });
  const profileContext = await getActiveProfileContext({
    ownerUserId: user.id,
    workspaceName: `${displayName}'s workspace`,
  });

  return (
    <div className="min-h-screen bg-[#f8fbfb] md:flex">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-200 bg-white px-4 py-6 md:flex">
        <Link className="flex items-center gap-2.5 px-2 font-semibold tracking-tight text-slate-950" href="/app/campaigns">
          <Image alt="" aria-hidden="true" className="brand-mark-image size-10" height={500} src="/landing/bidwork-logo-mark.png" unoptimized width={500} />
          <span>BidWork<span className="text-xs font-semibold">.app</span></span>
        </Link>
        <nav aria-label="Primary" className="mt-10 grid gap-1">
          <Link className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-teal-50 hover:text-teal-800" href="/app/campaigns"><BriefcaseBusiness className="size-4" />Campaigns</Link>
          <Link className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-teal-50 hover:text-teal-800" href="/app/development"><FlaskConical className="size-4" />Test suitability</Link>
          <Link className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-teal-50 hover:text-teal-800" href="/app/proposals"><Send className="size-4" />Proposals</Link>
          <Link className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-teal-50 hover:text-teal-800" href="/app/knowledge"><BookOpen className="size-4" />Knowledge</Link>
          <Link className="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-700 transition hover:bg-teal-50 hover:text-teal-800" href="/app/profiles"><Settings2 className="size-4" />Profile settings</Link>
        </nav>
        <div className="mt-auto grid gap-4 border-t border-slate-100 pt-5">
          <ProfileSwitcher activeProfile={profileContext.activeProfile} profiles={profileContext.profiles} />
          <div className="flex items-center justify-between gap-2 px-2"><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-900">{displayName}</p><p className="truncate text-xs text-slate-500">{user.email}</p></div><form action="/auth/sign-out" method="post"><button aria-label="Sign out" className="grid size-9 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900" type="submit"><LogOut className="size-4" /></button></form></div>
        </div>
      </aside>
      <div className="min-w-0 flex-1">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur md:hidden">
        <div className="mx-auto flex min-h-16 max-w-7xl items-center gap-4 px-4 sm:px-6 lg:px-8">
          <Link className="flex items-center gap-2.5 font-semibold tracking-tight text-slate-950" href="/app/campaigns">
            <Image
              alt=""
              aria-hidden="true"
              className="brand-mark-image size-10"
              height={500}
              src="/landing/bidwork-logo-mark.png"
              unoptimized
              width={500}
            />
            <span className="hidden sm:inline">BidWork<span className="text-xs font-semibold">.app</span></span>
          </Link>

          <nav aria-label="Primary" className="flex flex-1 items-center gap-1">
            <Link className="rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-950" href="/app/campaigns">
              Campaigns
            </Link>
            <Link className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-950" href="/app/development">
              <FlaskConical className="size-4" aria-hidden="true" />
              <span className="hidden sm:inline">Test job</span>
            </Link>
          </nav>
          <ProfileSwitcher activeProfile={profileContext.activeProfile} profiles={profileContext.profiles} />
          <form action="/auth/sign-out" method="post">
            <button
              aria-label="Sign out"
              className="grid size-10 place-items-center rounded-lg text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400"
              type="submit"
            >
              <LogOut className="size-4" aria-hidden="true" />
            </button>
          </form>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}

import { BookOpen, FlaskConical, LogOut, Send } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

import { ensureWorkspaceForUser } from "@upwork-agent/db";

import { requireUser } from "@/server/auth";
import { getDatabase } from "@/server/database";

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

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex min-h-16 max-w-7xl items-center gap-6 px-4 sm:px-6 lg:px-8">
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
            <Link className="hidden items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-950 md:flex" href="/app/proposals">
              <Send className="size-4" aria-hidden="true" />
              Proposals
            </Link>
            <Link className="hidden items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-950 lg:flex" href="/app/knowledge">
              <BookOpen className="size-4" aria-hidden="true" />
              Knowledge
            </Link>
          </nav>

          <div className="hidden min-w-0 text-right sm:block">
            <p className="max-w-48 truncate text-sm font-medium text-slate-900">{displayName}</p>
            <p className="max-w-48 truncate text-xs text-slate-500">{user.email}</p>
          </div>
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
  );
}

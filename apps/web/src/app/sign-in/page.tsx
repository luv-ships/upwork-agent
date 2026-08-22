import { ArrowRight, CheckCircle2, Radar } from "lucide-react";
import type { Metadata } from "next";

import { Card } from "@/components/ui/card";
import { safeAppNextPath } from "@/lib/safe-next-path";

export const metadata: Metadata = { title: "Sign in" };
export const dynamic = "force-dynamic";

export default async function SignInPage({
  searchParams
}: {
  searchParams: Promise<{ error?: string; next?: string }>;
}) {
  const parameters = await searchParams;
  const nextPath = safeAppNextPath(parameters.next);

  return (
    <main className="grid min-h-screen place-items-center px-5 py-12">
      <div className="grid w-full max-w-5xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-xl shadow-slate-200/50 lg:grid-cols-[1.1fr_0.9fr]">
        <section className="relative overflow-hidden bg-slate-950 px-8 py-12 text-white sm:px-12 lg:py-20">
          <div className="absolute -right-24 -top-24 h-72 w-72 rounded-full bg-sky-500/20 blur-3xl" />
          <div className="relative max-w-lg">
            <div className="mb-10 flex items-center gap-3 text-sm font-semibold tracking-wide text-sky-200">
              <span className="grid size-9 place-items-center rounded-xl bg-white/10">
                <Radar className="size-5" aria-hidden="true" />
              </span>
              SIGNALFOUND
            </div>
            <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
              Find the work worth winning.
            </h1>
            <p className="mt-5 max-w-md text-base leading-7 text-slate-300">
              Turn a clear campaign into an explainable opportunity score—then keep
              every proposal decision under your control.
            </p>
            <ul className="mt-10 grid gap-4 text-sm text-slate-200">
              {[
                "Deterministic campaign filters first",
                "AI scoring with reasons and risks",
                "Human review before any external action"
              ].map((item) => (
                <li className="flex items-center gap-3" key={item}>
                  <CheckCircle2 className="size-5 text-sky-400" aria-hidden="true" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="grid place-items-center px-6 py-12 sm:px-12">
          <Card className="w-full max-w-sm border-0 p-0 shadow-none">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-700">
              Welcome
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">
              Sign in to continue
            </h2>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              Your Google account is used for identity only. We do not request Gmail
              or Drive access.
            </p>

            {parameters.error ? (
              <div
                className="mt-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
                role="alert"
              >
                Sign-in could not be completed. Please try again.
              </div>
            ) : null}

            <a
              className="mt-8 flex min-h-12 w-full items-center justify-between rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-900 shadow-sm transition hover:border-slate-400 hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2"
              href={`/auth/google?next=${encodeURIComponent(nextPath)}`}
            >
              <span className="flex items-center gap-3">
                <span className="grid size-7 place-items-center rounded-full bg-slate-100 font-bold text-slate-700">
                  G
                </span>
                Continue with Google
              </span>
              <ArrowRight className="size-4" aria-hidden="true" />
            </a>

            <p className="mt-6 text-xs leading-5 text-slate-500">
              Phase 1 processes development-injected jobs only. It does not connect
              to or act on an Upwork account.
            </p>
          </Card>
        </section>
      </div>
    </main>
  );
}

import { ArrowRight, CheckCircle2 } from "lucide-react";
import Image from "next/image";
import type { Metadata } from "next";

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
    <main className="grid min-h-screen place-items-center bg-[#f7fbfb] px-5 py-10 sm:py-14">
      <div className="grid w-full max-w-5xl overflow-hidden rounded-[28px] border border-[#dce9e8] bg-white shadow-[0_24px_70px_rgba(25,67,76,0.12)] lg:grid-cols-[1.08fr_0.92fr]">
        <section className="bg-[#eaf8f5] px-8 py-10 text-[#122336] sm:px-12 lg:py-16">
          <div className="max-w-lg">
            <div className="mb-12 inline-flex items-center gap-3">
              <Image
                alt=""
                aria-hidden="true"
                className="brand-mark-image h-11 w-11"
                height={500}
                src="/landing/bidwork-logo-mark.png"
                unoptimized
                width={500}
              />
              <span className="text-[22px] font-extrabold tracking-[-0.04em] text-[#111827]">
                BidWork<span className="text-[15px] font-semibold">.app</span>
              </span>
            </div>
            <h1 className="text-4xl font-semibold tracking-[-0.05em] text-[#111827] sm:text-5xl">
              Find the work worth winning.
            </h1>
            <p className="mt-5 max-w-md text-base leading-7 text-[#53667b]">
              Turn a clear campaign into an explainable opportunity score, then keep
              every proposal decision under your control.
            </p>
            <ul className="mt-10 grid gap-4 text-sm text-[#30465d]">
              {[
                "Deterministic campaign filters first",
                "AI scoring with reasons and risks",
                "Human review before any external action"
              ].map((item) => (
                <li className="flex items-center gap-3" key={item}>
                  <CheckCircle2 className="size-5 text-[#0d978e]" aria-hidden="true" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="grid place-items-center px-6 py-12 sm:px-12">
          <div className="w-full max-w-sm">
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-[#087b74]">
              Welcome
            </p>
            <h2 className="mt-3 text-3xl font-semibold tracking-[-0.04em] text-[#111827]">
              Sign in to continue
            </h2>
            <p className="mt-3 text-sm leading-6 text-[#607086]">
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
              className="mt-8 flex min-h-12 w-full items-center justify-between rounded-xl border border-[#b7c2ce] bg-white px-4 text-sm font-semibold text-[#172234] shadow-sm transition hover:border-[#0d978e] hover:bg-[#f1fbfa] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0d978e] focus-visible:ring-offset-2"
              href={`/auth/google?next=${encodeURIComponent(nextPath)}`}
            >
              <span className="flex items-center gap-3">
                <span className="grid size-7 place-items-center rounded-full bg-[#f3f7f8] font-bold text-[#3f4d5e]">
                  G
                </span>
                Continue with Google
              </span>
              <ArrowRight className="size-4 text-[#087b74]" aria-hidden="true" />
            </a>

            <p className="mt-6 text-xs leading-5 text-[#718095]">
              Phase 1 processes development-injected jobs only. It does not connect
              to or act on an Upwork account.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}

import {
  AlertTriangle,
  Archive,
  ArrowLeft,
  BrainCircuit,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Filter,
  Pause,
  Play,
  Pencil,
  Send,
  Trash2
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  filterEvidenceSchema,
  preferenceScoreResultSchema,
  type CampaignFilterV1
} from "@upwork-agent/core";
import {
  getCampaignDetailView,
  getCampaignMonitorView,
  getUpworkOAuthConnectionView
} from "@upwork-agent/db";

import { StatusRefresher } from "@/components/campaign/status-refresher";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/field";
import {
  archiveCampaignAction,
  changeCampaignStatusAction,
  disconnectUpworkAction,
  enableUpworkMonitorAction,
  pauseUpworkMonitorAction,
  updateCampaignBasicsAction
} from "@/server/actions/campaigns";
import { DeleteCampaignButton } from "@/components/campaign/delete-campaign-button";
import { requireUser } from "@/server/auth";
import { getDatabase } from "@/server/database";
import { getServerEnvironment } from "@/server/env";

export const metadata: Metadata = { title: "Campaign" };

const processingStatuses = new Set(["matched", "analysis_queued", "analyzing"]);

function matchTone(status: string): "success" | "warning" | "danger" | "info" | "neutral" {
  if (status === "low_fit" || status === "retrying") return "warning";
  if (status === "qualified" || status === "proposal_queued" || status === "ready_for_review") return "success";
  if (status === "failed") return "danger";
  if (processingStatuses.has(status)) return "info";
  return "neutral";
}

function labelStatus(status: string): string {
  return status.replaceAll("_", " ");
}

function visibleMatchStatus(
  pipelineStatus: string,
  taskStatus: "queued" | "running" | "retry_wait" | "succeeded" | "dead" | "cancelled" | null
): string {
  if (taskStatus === "retry_wait") return "retrying";
  if (taskStatus === "dead") return "failed";
  return pipelineStatus;
}

function filterSummary(filters: CampaignFilterV1) {
  return Object.entries(filters).filter(([key, value]) => {
    if (key === "version" || key === "scoringWeights") return false;
    if (Array.isArray(value)) return value.length > 0;
    if (value === "any" || value === undefined || value === null) return false;
    return true;
  });
}

function displayFilterValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object" && value !== null) {
    const range = value as { min?: unknown; max?: unknown };
    return `${range.min === undefined ? "Any" : String(range.min)} – ${range.max === undefined ? "Any" : String(range.max)}`;
  }
  return String(value).replaceAll("_", " ");
}

function displayDate(value: Date | null): string {
  return value === null ? "Not yet" : value.toLocaleString();
}

function UpworkConnectForm({
  defaultOrgUid,
  reconnect
}: {
  defaultOrgUid: string | undefined;
  reconnect: boolean;
}) {
  return (
    <form action="/api/upwork/oauth/connect" className="grid gap-3" method="post">
      <Field label="Upwork organization UID">
        <Input
          autoComplete="off"
          defaultValue={defaultOrgUid}
          maxLength={200}
          name="orgUid"
          placeholder="Your freelancer or agency organization UID"
          required
        />
      </Field>
      <p className="text-xs leading-5 text-slate-500">
        This non-secret identifier binds job searches to the Upwork account you approve.
      </p>
      <Button type="submit">{reconnect ? "Reconnect Upwork" : "Connect Upwork account"}</Button>
    </form>
  );
}

export default async function CampaignDetailPage({
  params
}: {
  params: Promise<{ campaignId: string }>;
}) {
  const { campaignId } = await params;
  const user = await requireUser();
  const database = getDatabase();
  const detail = await getCampaignDetailView(database, {
    ownerUserId: user.id,
    campaignId
  });
  if (detail === null) notFound();

  const { campaign, matches, upstreamWork } = detail;
  const [monitor, upworkConnection, environment] = await Promise.all([
    getCampaignMonitorView(database, { ownerUserId: user.id, campaignId }),
    getUpworkOAuthConnectionView(database, { ownerUserId: user.id }),
    Promise.resolve(getServerEnvironment())
  ]);
  const upworkOAuthSetupReady =
    environment.UPWORK_MCP_CREDENTIAL_ENCRYPTION_KEY !== undefined &&
    environment.UPWORK_MCP_OAUTH_REDIRECT_URL !== undefined;
  const hasProcessing =
    upstreamWork.hasActiveTasks ||
    matches.some(
      (view) =>
        processingStatuses.has(view.match.pipelineStatus) &&
        view.analysisTaskStatus !== "dead" &&
        view.analysisTaskStatus !== "cancelled"
    );
  const summaries = filterSummary(campaign.filters);

  return (
    <div className="grid gap-7">
      <StatusRefresher
        active={
          hasProcessing ||
          (monitor?.status === "active" && monitor.lastSuccessAt === null)
        }
      />
      <div>
        <Link className="inline-flex items-center gap-2 text-sm font-medium text-slate-600 hover:text-slate-950" href="/app/campaigns">
          <ArrowLeft className="size-4" aria-hidden="true" /> Back to campaigns
        </Link>
        <div className="mt-6 flex flex-wrap items-start justify-between gap-5">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-3xl font-semibold tracking-tight text-slate-950">{campaign.name}</h1>
              <Badge tone={campaign.status === "active" ? "success" : campaign.status === "paused" ? "warning" : "neutral"}>{campaign.status}</Badge>
            </div>
            <p className="mt-2 text-sm text-slate-600">Threshold {campaign.scoreThreshold} · Configuration v{campaign.configVersion}</p>
          </div>
          <div className="flex gap-2">
            {campaign.status !== "archived" ? (
              <>
                <Link className="inline-flex min-h-10 items-center justify-center rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900 transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2" href={`/app/campaigns/${campaign.id}/edit`}>
                  <Pencil className="mr-2 size-4" aria-hidden="true" />Edit filters
                </Link>
                <form action={changeCampaignStatusAction}>
                  <input name="campaignId" type="hidden" value={campaign.id} />
                  <input name="configVersion" type="hidden" value={campaign.configVersion} />
                  <input name="status" type="hidden" value={campaign.status === "active" ? "paused" : "active"} />
                  <Button variant="secondary" type="submit">
                    {campaign.status === "active" ? <Pause className="mr-2 size-4" aria-hidden="true" /> : <Play className="mr-2 size-4" aria-hidden="true" />}
                    {campaign.status === "active" ? "Pause" : "Activate"}
                  </Button>
                </form>
                <form action={archiveCampaignAction}>
                  <input name="campaignId" type="hidden" value={campaign.id} />
                  <Button variant="ghost" type="submit"><Archive className="mr-2 size-4" aria-hidden="true" />Archive</Button>
                </form>
              </>
            ) : null}
            <DeleteCampaignButton campaignId={campaign.id} campaignName={campaign.name} />
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.55fr)_minmax(19rem,0.85fr)]">
        <section className="grid content-start gap-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold text-slate-950">Matched jobs</h2>
              <p className="mt-1 text-sm text-slate-600">Only positive deterministic matches are stored.</p>
            </div>
            <Badge tone="neutral">{matches.length}</Badge>
          </div>

          {matches.length === 0 ? (
            <Card className="grid min-h-60 place-items-center p-8 text-center">
              <div className="max-w-sm">
                <span className={`mx-auto grid size-12 place-items-center rounded-xl ${upstreamWork.hasLatestFailure ? "bg-rose-50 text-rose-700" : upstreamWork.hasActiveTasks ? "bg-sky-50 text-sky-700" : "bg-slate-100 text-slate-600"}`}>
                  {upstreamWork.hasLatestFailure ? <AlertTriangle className="size-5" aria-hidden="true" /> : upstreamWork.hasActiveTasks ? <BrainCircuit className="size-5 animate-pulse" aria-hidden="true" /> : <Clock3 className="size-5" aria-hidden="true" />}
                </span>
                <h3 className="mt-5 font-semibold text-slate-950">
                  {upstreamWork.hasLatestFailure ? "Job processing failed" : upstreamWork.hasActiveTasks ? "Processing development job" : "No matching jobs yet"}
                </h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  {upstreamWork.hasLatestFailure
                    ? "The latest job stopped during normalization or campaign matching after its capped retries."
                    : upstreamWork.hasActiveTasks
                      ? campaign.status === "active"
                        ? "The worker is normalizing the job and checking it against active campaign filters. This page refreshes automatically."
                        : `The workspace is processing a job, but this ${campaign.status} campaign is not eligible for new matches.`
                      : "Inject a development job to exercise the durable score loop."}
                </p>
                <Link className="mt-5 inline-flex text-sm font-semibold text-sky-800 hover:text-sky-950" href="/app/development">Open test job source</Link>
              </div>
            </Card>
          ) : (
            matches.map(({ analysisNextAttemptAt, analysisTaskStatus, job, match, score }) => {
              const evidence = filterEvidenceSchema.safeParse(match.deterministicEvidence);
              const preference = preferenceScoreResultSchema.safeParse(match.preferenceScoreEvidence);
              const visibleStatus = visibleMatchStatus(match.pipelineStatus, analysisTaskStatus);
              return (
                <Card className="overflow-hidden" key={match.id}>
                  <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 p-5 sm:p-6">
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold text-slate-950">{job.title ?? "Untitled normalized job"}</h3>
                      <p className="mt-1 line-clamp-2 text-sm leading-6 text-slate-600">{job.description}</p>
                      {job.canonicalUrl ? (
                        <a className="mt-2 inline-flex items-center gap-1.5 text-sm font-semibold text-sky-800 hover:text-sky-950" href={job.canonicalUrl} rel="noreferrer" target="_blank">
                          Open source listing <ExternalLink className="size-3.5" aria-hidden="true" />
                        </a>
                      ) : null}
                    </div>
                    <Badge tone={matchTone(visibleStatus)}>{labelStatus(visibleStatus)}</Badge>
                  </div>

                  <div className="grid gap-4 border-b border-slate-200 bg-sky-50/60 px-5 py-4 sm:grid-cols-[8rem_1fr] sm:px-6">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-sky-800">Preference score</p>
                      <p className="mt-1 text-3xl font-semibold text-slate-950">{match.preferenceScore}</p>
                    </div>
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">User-defined evidence</p>
                      {preference.success && preference.data.components.length > 0 ? (
                        <div className="mt-2 grid gap-2 sm:grid-cols-2">
                          {preference.data.components.map((component) => (
                            <div className="rounded-lg bg-white px-3 py-2 ring-1 ring-sky-200" key={component.dimension}>
                              <div className="flex items-center justify-between gap-3 text-xs font-semibold text-slate-900">
                                <span>{component.dimension.replaceAll("_", " ")}</span>
                                <span>{component.score}/100</span>
                              </div>
                              <p className="mt-1 text-xs leading-5 text-slate-600">{component.explanation} · Weight {component.weight}</p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-2 text-sm text-slate-600">{preference.success ? preference.data.summary[0] : "No preference explanation is available."}</p>
                      )}
                    </div>
                  </div>

                  {score ? (
                    <div className="grid gap-5 p-5 sm:grid-cols-[8rem_1fr] sm:p-6">
                      <div className="rounded-xl bg-slate-950 p-4 text-white">
                        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">AI suitability</p>
                        <p className="mt-2 text-4xl font-semibold">{score.score}</p>
                        <p className="mt-1 text-xs text-slate-300">of 100</p>
                      </div>
                      <div className="grid gap-4">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Why</p>
                          <ul className="mt-2 grid gap-2 text-sm text-slate-700">
                            {score.reasons.map((reason) => <li className="flex gap-2" key={reason}><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden="true" />{reason}</li>)}
                          </ul>
                        </div>
                        {score.risks.length > 0 ? (
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Risks</p>
                            <ul className="mt-2 grid gap-2 text-sm text-slate-700">
                              {score.risks.map((risk) => <li className="flex gap-2" key={risk}><AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden="true" />{risk}</li>)}
                            </ul>
                          </div>
                        ) : null}
                        {score.suggestedBidAmount !== null && score.suggestedBidCurrency !== null ? <p className="text-sm font-semibold text-slate-950">Suggested {job.jobType === "hourly" ? "rate" : "bid"}: {score.suggestedBidCurrency} {Number(score.suggestedBidAmount).toLocaleString()}</p> : null}
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3 p-5 text-sm text-slate-600 sm:p-6">
                      <BrainCircuit className="size-5 text-sky-700" aria-hidden="true" />
                      {visibleStatus === "retrying"
                        ? `Suitability analysis will retry${analysisNextAttemptAt === null ? "." : ` after ${analysisNextAttemptAt.toLocaleTimeString()}.`}`
                        : visibleStatus === "failed"
                          ? "Suitability analysis failed after its capped retries."
                          : processingStatuses.has(match.pipelineStatus)
                            ? "Suitability analysis is processing…"
                            : "No score was stored for this match."}
                    </div>
                  )}

                  {evidence.success ? (
                    <div className="border-t border-slate-200 bg-slate-50 px-5 py-4 sm:px-6">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Deterministic evidence</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {evidence.data.checks.map((item) => <span className="rounded-full bg-white px-2.5 py-1 text-xs text-slate-700 ring-1 ring-slate-200" key={item.rule}>{item.rule.replaceAll("_", " ")}</span>)}
                      </div>
                    </div>
                  ) : null}
                  {visibleStatus === "proposal_queued" || visibleStatus === "ready_for_review" ? (
                    <div className="border-t border-slate-200 px-5 py-4 sm:px-6">
                      <Link className="inline-flex items-center gap-2 text-sm font-semibold text-sky-800 hover:text-sky-950" href="/app/proposals">
                        <Send className="size-4" aria-hidden="true" />
                        {visibleStatus === "ready_for_review" ? "Review generated proposal" : "Open proposal queue"}
                      </Link>
                    </div>
                  ) : null}
                </Card>
              );
            })
          )}
        </section>

        <aside className="grid content-start gap-5">
          <Card className="p-5 sm:p-6">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <Clock3 className="size-5 text-sky-700" aria-hidden="true" />
                <h2 className="font-semibold text-slate-950">24/7 Upwork monitor</h2>
              </div>
              {monitor ? (
                <Badge tone={monitor.status === "active" ? "success" : monitor.status === "error" ? "danger" : "warning"}>
                  {monitor.status}
                </Badge>
              ) : null}
            </div>

            {monitor ? (
              <div className="mt-5 grid gap-4">
                <dl className="grid grid-cols-2 gap-3 text-sm">
                  <div><dt className="text-slate-500">Cadence</dt><dd className="mt-1 font-semibold text-slate-900">Every {Math.round(monitor.pollIntervalSeconds / 60)} min</dd></div>
                  <div><dt className="text-slate-500">Connection</dt><dd className="mt-1 font-semibold text-slate-900">{monitor.connectionStatus.replaceAll("_", " ")}</dd></div>
                  <div><dt className="text-slate-500">Last success</dt><dd className="mt-1 text-slate-800">{displayDate(monitor.lastSuccessAt)}</dd></div>
                  <div><dt className="text-slate-500">Next check</dt><dd className="mt-1 text-slate-800">{displayDate(monitor.nextRunAt)}</dd></div>
                </dl>
                {monitor.lastErrorCode ? <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800">Last error: {monitor.lastErrorCode.replaceAll("_", " ")}</p> : null}
                {monitor.status === "active" ? (
                  <form action={pauseUpworkMonitorAction}>
                    <input name="campaignId" type="hidden" value={campaign.id} />
                    <Button className="w-full" type="submit" variant="secondary"><Pause className="mr-2 size-4" aria-hidden="true" />Pause monitor</Button>
                  </form>
                ) : environment.UPWORK_MONITOR_PROVIDER !== "disabled" &&
                  campaign.status === "active" &&
                  (environment.UPWORK_MONITOR_PROVIDER === "fake" ||
                    upworkConnection?.status === "connected") ? (
                  <form action={enableUpworkMonitorAction} className="grid gap-3">
                    <input name="campaignId" type="hidden" value={campaign.id} />
                    <Field label="Polling interval (seconds)"><Input defaultValue={monitor.pollIntervalSeconds} min={environment.UPWORK_MCP_MIN_POLL_INTERVAL_SECONDS} max="86400" name="pollIntervalSeconds" required type="number" /></Field>
                    <Button type="submit"><Play className="mr-2 size-4" aria-hidden="true" />Resume monitor</Button>
                  </form>
                ) : environment.UPWORK_MONITOR_PROVIDER === "mcp" &&
                  upworkOAuthSetupReady ? (
                  <UpworkConnectForm
                    defaultOrgUid={upworkConnection?.accountId ?? undefined}
                    reconnect
                  />
                ) : <p className="text-sm leading-6 text-slate-600">Activate the campaign and configure an approved worker provider to resume monitoring.</p>}
                {environment.UPWORK_MONITOR_PROVIDER === "mcp" &&
                upworkConnection !== null &&
                upworkConnection.status !== "disabled" ? (
                  <form action={disconnectUpworkAction}>
                    <input name="campaignId" type="hidden" value={campaign.id} />
                    <Button className="w-full" type="submit" variant="ghost">Disconnect Upwork</Button>
                  </form>
                ) : null}
              </div>
            ) : environment.UPWORK_MONITOR_PROVIDER !== "disabled" &&
              campaign.status === "active" &&
              (environment.UPWORK_MONITOR_PROVIDER === "fake" ||
                upworkConnection?.status === "connected") ? (
              <form action={enableUpworkMonitorAction} className="mt-5 grid gap-4">
                <p className="text-sm leading-6 text-slate-600">
                  Start the durable {environment.UPWORK_MONITOR_PROVIDER === "mcp" ? "read-only MCP" : "fake-backed"} monitor. It continuously queues the next check; no browser session is used.
                </p>
                <input name="campaignId" type="hidden" value={campaign.id} />
                <Field label="Polling interval (seconds)"><Input defaultValue={environment.UPWORK_MCP_MIN_POLL_INTERVAL_SECONDS} min={environment.UPWORK_MCP_MIN_POLL_INTERVAL_SECONDS} max="86400" name="pollIntervalSeconds" required type="number" /></Field>
                <Button type="submit"><Play className="mr-2 size-4" aria-hidden="true" />Enable monitor</Button>
              </form>
            ) : (
              <div className="mt-4 grid gap-3">
                <p className="text-sm leading-6 text-slate-600">
                  The worker-only connector is installed. Connecting an account starts only an OAuth consent flow; recurring discovery remains read-only and is paused until you enable a monitor.
                </p>
                {upworkOAuthSetupReady && environment.UPWORK_MONITOR_PROVIDER === "mcp" ? (
                  <UpworkConnectForm
                    defaultOrgUid={upworkConnection?.accountId ?? undefined}
                    reconnect={upworkConnection?.status === "reconnect_required"}
                  />
                ) : (
                  <p className="text-sm text-amber-800">Connection setup needs a final HTTPS callback URL in the server environment.</p>
                )}
                {environment.UPWORK_MONITOR_PROVIDER === "mcp" &&
                upworkConnection !== null &&
                upworkConnection.status !== "disabled" ? (
                  <form action={disconnectUpworkAction}>
                    <input name="campaignId" type="hidden" value={campaign.id} />
                    <Button className="w-full" type="submit" variant="ghost">Disconnect Upwork</Button>
                  </form>
                ) : null}
              </div>
            )}
          </Card>

          <Card className="p-5 sm:p-6">
            <div className="flex items-center gap-3"><Filter className="size-5 text-slate-600" aria-hidden="true" /><h2 className="font-semibold text-slate-950">Active filters</h2></div>
            {summaries.length > 0 ? (
              <dl className="mt-5 grid gap-4">
                {summaries.map(([key, value]) => <div key={key}><dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{key.replaceAll(/([A-Z])/g, " $1")}</dt><dd className="mt-1 text-sm leading-6 text-slate-800">{displayFilterValue(value)}</dd></div>)}
              </dl>
            ) : <p className="mt-4 text-sm leading-6 text-slate-600">No deterministic restrictions. Every development job can reach scoring.</p>}
          </Card>

          {campaign.status !== "archived" ? (
            <Card className="p-5 sm:p-6">
              <h2 className="font-semibold text-slate-950">Campaign settings</h2>
              <form action={updateCampaignBasicsAction} className="mt-5 grid gap-4">
                <input name="campaignId" type="hidden" value={campaign.id} />
                <input name="configVersion" type="hidden" value={campaign.configVersion} />
                <Field label="Name"><Input defaultValue={campaign.name} name="name" required /></Field>
                <Field label="Score threshold"><Input defaultValue={campaign.scoreThreshold} max="100" min="0" name="scoreThreshold" required type="number" /></Field>
                <Field label="AI instructions"><Textarea defaultValue={campaign.aiInstructions} name="aiInstructions" /></Field>
                <Button type="submit">Save settings</Button>
              </form>
            </Card>
          ) : null}
        </aside>
      </div>
    </div>
  );
}

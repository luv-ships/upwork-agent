import { AlertCircle, Bot, BriefcaseBusiness, Filter, ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";

import {
  defaultCampaignScoringWeightsV1,
  type CampaignFilterV1
} from "@upwork-agent/core";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/field";

type CampaignFormProps = {
  action: (formData: FormData) => Promise<void>;
  error?: string;
  initial?: {
    aiInstructions: string;
    campaignId: string;
    configVersion: number;
    filters: CampaignFilterV1;
    name: string;
    scoreThreshold: number;
  };
  submitLabel?: string;
};

const checkboxClassName =
  "size-4 rounded border-slate-300 text-slate-950 accent-slate-950 focus:ring-slate-400";

function Choice({
  label,
  name,
  value,
  checked = false
}: {
  checked?: boolean | undefined;
  label: string;
  name: string;
  value: string;
}) {
  return (
    <label className="flex min-h-10 cursor-pointer items-center gap-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 transition hover:border-slate-300 hover:bg-slate-50">
      <input className={checkboxClassName} defaultChecked={checked} name={name} type="checkbox" value={value} />
      <span>{label}</span>
    </label>
  );
}

function Section({
  children,
  description,
  icon,
  title
}: {
  children: ReactNode;
  description: string;
  icon: ReactNode;
  title: string;
}) {
  return (
    <Card className="overflow-hidden">
      <div className="flex gap-4 border-b border-slate-200 px-5 py-5 sm:px-6">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-slate-100 text-slate-700">
          {icon}
        </span>
        <div>
          <h2 className="font-semibold text-slate-950">{title}</h2>
          <p className="mt-1 text-sm leading-6 text-slate-500">{description}</p>
        </div>
      </div>
      <div className="grid gap-6 p-5 sm:p-6">{children}</div>
    </Card>
  );
}

function listValue(values: string[] | undefined): string {
  return values?.join(", ") ?? "";
}

function proposalBand(filters: CampaignFilterV1 | undefined): string {
  const range = filters?.proposalCount;
  if (range?.min === undefined && range?.max === 4) return "under_5";
  if (range?.min === 5 && range.max === 10) return "5_to_10";
  if (range?.min === 10 && range.max === 15) return "10_to_15";
  if (range?.min === 15 && range.max === 20) return "15_to_20";
  if (range?.min === 20 && range.max === 50) return "20_to_50";
  return "";
}

export function CampaignForm({ action, error, initial, submitLabel = "Create active campaign" }: CampaignFormProps) {
  const filters = initial?.filters;
  const scoringWeights = filters?.scoringWeights ?? defaultCampaignScoringWeightsV1;
  return (
    <form action={action} className="grid gap-6">
      {initial ? (
        <>
          <input name="campaignId" type="hidden" value={initial.campaignId} />
          <input name="configVersion" type="hidden" value={initial.configVersion} />
        </>
      ) : null}
      {error ? (
        <div className="flex gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {error}
        </div>
      ) : null}

      <Section
        description="Name this search and decide when a match is strong enough for AI follow-up."
        icon={<BriefcaseBusiness className="size-5" aria-hidden="true" />}
        title="Campaign basics"
      >
        <div className="grid gap-5 md:grid-cols-2">
          <Field label="Campaign name">
            <Input autoComplete="off" defaultValue={initial?.name} maxLength={120} name="name" placeholder="AI automation projects" required />
          </Field>
          <Field hint="Scores below this remain visible as low fit." label="Qualification threshold">
            <Input defaultValue={initial?.scoreThreshold ?? 75} max="100" min="0" name="scoreThreshold" required type="number" />
          </Field>
        </div>
        <Field hint="Optional guidance for suitability scoring; deterministic filters still run first." label="AI scoring instructions">
          <Textarea defaultValue={initial?.aiInstructions} maxLength={4000} name="aiInstructions" placeholder="Prefer projects with a clear business outcome and realistic implementation scope." />
        </Field>
        <div>
          <p className="text-sm font-medium text-slate-800">Preference scoring weights</p>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            These weights rank jobs that already pass your hard filters. They are transparent and never submit an application.
            Skill and keyword scores use coverage; budget rewards stronger value inside your range; competition rewards fewer proposals; client quality uses payment, hire-history, and hire-rate selections when the source provides them.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Skills"><Input defaultValue={scoringWeights.skills} max="100" min="0" name="weightSkills" required type="number" /></Field>
            <Field label="Keywords"><Input defaultValue={scoringWeights.keywords} max="100" min="0" name="weightKeywords" required type="number" /></Field>
            <Field label="Budget"><Input defaultValue={scoringWeights.budget} max="100" min="0" name="weightBudget" required type="number" /></Field>
            <Field label="Competition"><Input defaultValue={scoringWeights.competition} max="100" min="0" name="weightCompetition" required type="number" /></Field>
            <Field label="Client quality"><Input defaultValue={scoringWeights.clientQuality} max="100" min="0" name="weightClientQuality" required type="number" /></Field>
            <Field label="Project fit"><Input defaultValue={scoringWeights.projectFit} max="100" min="0" name="weightProjectFit" required type="number" /></Field>
          </div>
        </div>
      </Section>

      <Section
        description="These terms capture technical fit that budget and client filters cannot express."
        icon={<Bot className="size-5" aria-hidden="true" />}
        title="Skills and text"
      >
        <div className="grid gap-5 md:grid-cols-2">
          <Field hint="Comma-separated; a job must include every listed skill." label="Required skills">
            <Input autoComplete="off" defaultValue={listValue(filters?.requiredSkills)} name="requiredSkills" placeholder="Make.com, OpenAI, API integration" />
          </Field>
          <Field hint="Comma-separated words or phrases matched against title and description." label="Include keywords">
            <Input autoComplete="off" defaultValue={listValue(filters?.includeKeywords)} name="includeKeywords" placeholder="automation, webhook, AI agent" />
          </Field>
        </div>
        <Field hint="Comma-separated phrases that reject a job when present." label="Exclude keywords">
          <Input autoComplete="off" defaultValue={listValue(filters?.excludeKeywords)} name="excludeKeywords" placeholder="commission only, unpaid trial" />
        </Field>
      </Section>

      <Section
        description="Choose source facts that must be present before a job can reach AI scoring."
        icon={<Filter className="size-5" aria-hidden="true" />}
        title="Job filters"
      >
        <Field hint="Comma-separated canonical category IDs for the development source." label="Categories">
          <Input autoComplete="off" defaultValue={listValue(filters?.categoryIds)} name="categoryIds" placeholder="automation, ai-development" />
        </Field>

        <Field hint="Jobs without a trustworthy publication timestamp do not match this constraint." label="Posted within">
          <Select defaultValue={filters?.postedWithinMinutes === undefined ? "" : String(filters.postedWithinMinutes)} name="postedWithinMinutes">
            <option value="">Any age</option>
            <option value="60">Last hour</option>
            <option value="360">Last 6 hours</option>
            <option value="1440">Last 24 hours</option>
          </Select>
        </Field>

        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium text-slate-800">Experience level</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            <Choice checked={filters?.experienceLevels.includes("entry")} label="Entry level" name="experienceLevels" value="entry" />
            <Choice checked={filters?.experienceLevels.includes("intermediate")} label="Intermediate" name="experienceLevels" value="intermediate" />
            <Choice checked={filters?.experienceLevels.includes("expert")} label="Expert" name="experienceLevels" value="expert" />
          </div>
        </fieldset>

        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium text-slate-800">Job type</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            <Choice checked={filters?.jobTypes.includes("hourly")} label="Hourly" name="jobTypes" value="hourly" />
            <Choice checked={filters?.jobTypes.includes("fixed")} label="Fixed-price" name="jobTypes" value="fixed" />
          </div>
        </fieldset>

        <div className="grid gap-5 rounded-xl border border-slate-200 bg-slate-50 p-4 md:grid-cols-2">
          <div>
            <p className="mb-3 text-sm font-medium text-slate-800">Hourly rate (USD/hr)</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Minimum"><Input defaultValue={filters?.hourlyRate?.min} inputMode="decimal" min="0" name="hourlyMin" placeholder="25" step="0.01" type="number" /></Field>
              <Field label="Maximum"><Input defaultValue={filters?.hourlyRate?.max} inputMode="decimal" min="0" name="hourlyMax" placeholder="150" step="0.01" type="number" /></Field>
            </div>
          </div>
          <div className="grid content-start gap-3">
            <p className="mb-3 text-sm font-medium text-slate-800">Fixed budget (USD)</p>
            <Field hint="Custom values below override this preset." label="Budget preset">
              <Select defaultValue="" name="fixedBudgetPreset">
                <option value="">Custom or any budget</option>
                <option value="under_100">Less than $100</option>
                <option value="100_to_500">$100 to $500</option>
                <option value="500_to_1000">$500 to $1K</option>
                <option value="1000_to_5000">$1K to $5K</option>
                <option value="5000_plus">$5K+</option>
              </Select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Minimum"><Input defaultValue={filters?.fixedBudget?.min} inputMode="decimal" min="0" name="fixedMin" placeholder="500" step="0.01" type="number" /></Field>
              <Field label="Maximum"><Input defaultValue={filters?.fixedBudget?.max} inputMode="decimal" min="0" name="fixedMax" placeholder="5000" step="0.01" type="number" /></Field>
            </div>
          </div>
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          <Field label="Number of proposals">
            <Select defaultValue={proposalBand(filters)} name="proposalBand">
              <option value="">Any number</option>
              <option value="under_5">Fewer than 5</option>
              <option value="5_to_10">5 to 10</option>
              <option value="10_to_15">10 to 15</option>
              <option value="15_to_20">15 to 20</option>
              <option value="20_to_50">20 to 50</option>
            </Select>
          </Field>
          <Field label="Payment verification">
            <Select defaultValue={filters?.paymentVerification ?? "any"} name="paymentVerification">
              <option value="any">Any client</option>
              <option value="only_verified">Payment verified only</option>
              <option value="only_unverified">Payment unverified only</option>
            </Select>
          </Field>
        </div>
      </Section>

      <Section
        description="Use client track record and geography to narrow the opportunity set."
        icon={<ShieldCheck className="size-5" aria-hidden="true" />}
        title="Client filters"
      >
        <div className="grid gap-5 md:grid-cols-2">
          <Field label="Client hiring history">
            <Select defaultValue={filters?.clientHireHistory === "any" ? "" : (filters?.clientHireHistory ?? "")} name="clientHistory">
              <option value="">Any hiring history</option>
              <option value="no_hires">No hires</option>
              <option value="1_to_9">1 to 9 hires</option>
              <option value="10_plus">10+ hires</option>
            </Select>
          </Field>
          <Field hint="Unavailable until an approved source provides trustworthy relationship history." label="My previous clients">
            <Input disabled value="Not available in Phase 1" />
          </Field>
          <Field hint="Comma-separated ISO country codes." label="Client locations">
            <Input autoComplete="off" defaultValue={listValue(filters?.clientCountryCodes)} name="clientLocations" placeholder="US, GB, AU" />
          </Field>
          <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2">
            <p className="sm:col-span-2 text-sm font-medium text-slate-800">Client hire rate (%)</p>
            <Field hint="Jobs without a trustworthy rate are rejected when this is set." label="Minimum">
              <Input defaultValue={filters?.clientHireRatePercent?.min} inputMode="numeric" max="100" min="0" name="clientHireMin" placeholder="40" step="1" type="number" />
            </Field>
            <Field label="Maximum">
              <Input defaultValue={filters?.clientHireRatePercent?.max} inputMode="numeric" max="100" min="0" name="clientHireMax" placeholder="100" step="1" type="number" />
            </Field>
          </div>
          <Field hint="Comma-separated IANA names." label="Client time zones">
            <Input autoComplete="off" defaultValue={listValue(filters?.clientTimeZones)} name="clientTimeZones" placeholder="America/New_York, Europe/London" />
          </Field>
        </div>

        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium text-slate-800">Project length</legend>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <Choice checked={filters?.projectLengthBands.includes("under_1_month")} label="Less than one month" name="projectLengths" value="under_1_month" />
            <Choice checked={filters?.projectLengthBands.includes("one_to_three_months")} label="1 to 3 months" name="projectLengths" value="one_to_three_months" />
            <Choice checked={filters?.projectLengthBands.includes("three_to_six_months")} label="3 to 6 months" name="projectLengths" value="three_to_six_months" />
            <Choice checked={filters?.projectLengthBands.includes("over_6_months")} label="More than 6 months" name="projectLengths" value="over_6_months" />
          </div>
        </fieldset>

        <fieldset className="grid gap-2">
          <legend className="text-sm font-medium text-slate-800">Hours per week</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            <Choice checked={filters?.hoursPerWeekBands.includes("under_30")} label="Less than 30 hrs/week" name="hoursPerWeek" value="under_30" />
            <Choice checked={filters?.hoursPerWeekBands.includes("over_30")} label="More than 30 hrs/week" name="hoursPerWeek" value="over_30" />
          </div>
        </fieldset>

        <Field label="Contract-to-hire roles">
          <Select defaultValue={filters?.contractToHire ?? "any"} name="contractToHire">
            <option value="any">Include either</option>
            <option value="only">Contract-to-hire only</option>
            <option value="exclude">Exclude contract-to-hire</option>
          </Select>
        </Field>
      </Section>

      <div className="sticky bottom-4 z-20 flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white/95 p-4 shadow-lg shadow-slate-300/20 backdrop-blur">
        <p className="hidden max-w-2xl text-xs leading-5 text-slate-500 sm:block">
          Empty groups impose no restriction. When a selected filter depends on missing job data, the job is rejected with explicit evidence.
        </p>
        <Button className="w-full sm:w-auto" type="submit">{submitLabel}</Button>
      </div>
    </form>
  );
}

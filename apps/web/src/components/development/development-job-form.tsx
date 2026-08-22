"use client";

import { CheckCircle2, FlaskConical, LoaderCircle } from "lucide-react";
import { useState, type FormEvent } from "react";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/field";

const ingestionResponseSchema = z.object({
  jobId: z.string().uuid(),
  taskId: z.string().uuid(),
  duplicate: z.boolean()
});

const apiErrorMessages: Readonly<Record<string, string>> = {
  authentication_required: "Sign in again before injecting a test job.",
  development_ingestion_unavailable: "Development ingestion is not configured on this server.",
  invalid_development_token: "The development token is incorrect.",
  invalid_job_payload: "The test job contains an invalid or out-of-range value.",
  source_job_id_payload_conflict:
    "This source job ID already belongs to different content. Use a new source job ID.",
  workspace_not_found: "This workspace is no longer available."
};

function stringValue(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
}

function stringList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function optionalNumber(formData: FormData, name: string): number | undefined {
  const value = stringValue(formData, name);
  if (value.length === 0) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function DevelopmentJobForm({ workspaceId }: { workspaceId: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<z.infer<typeof ingestionResponseSchema> | null>(null);

  async function submitJob(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setResult(null);

    const formData = new FormData(event.currentTarget);
    const hourlyMin = optionalNumber(formData, "hourlyMin");
    const hourlyMax = optionalNumber(formData, "hourlyMax");
    const fixedMin = optionalNumber(formData, "fixedMin");
    const fixedMax = optionalNumber(formData, "fixedMax");
    const proposalCount = optionalNumber(formData, "proposalCount");
    const clientHireCount = optionalNumber(formData, "clientHireCount");
    const countryCode = stringValue(formData, "countryCode");
    const timeZone = stringValue(formData, "timeZone");
    const experienceLevel = stringValue(formData, "experienceLevel");
    const projectLengthBand = stringValue(formData, "projectLengthBand");
    const hoursPerWeekBand = stringValue(formData, "hoursPerWeekBand");
    const paymentVerified = stringValue(formData, "paymentVerified");
    const contractToHire = stringValue(formData, "contractToHire");
    const jobType = stringValue(formData, "jobType");

    const payload = {
      workspaceId,
      sourceJobId: stringValue(formData, "sourceJobId"),
      title: stringValue(formData, "title"),
      description: stringValue(formData, "description"),
      skills: stringList(stringValue(formData, "skills")),
      categoryIds: stringList(stringValue(formData, "categoryIds")),
      jobType,
      ...(experienceLevel ? { experienceLevel } : {}),
      ...(hourlyMin !== undefined || hourlyMax !== undefined
        ? { hourlyRate: { currency: "USD", ...(hourlyMin !== undefined ? { min: hourlyMin } : {}), ...(hourlyMax !== undefined ? { max: hourlyMax } : {}) } }
        : {}),
      ...(fixedMin !== undefined || fixedMax !== undefined
        ? { fixedBudget: { currency: "USD", ...(fixedMin !== undefined ? { min: fixedMin } : {}), ...(fixedMax !== undefined ? { max: fixedMax } : {}) } }
        : {}),
      ...(proposalCount !== undefined ? { proposalCount } : {}),
      ...(paymentVerified ? { paymentVerified: paymentVerified === "true" } : {}),
      ...(clientHireCount !== undefined || countryCode || timeZone
        ? {
            client: {
              ...(clientHireCount !== undefined ? { hireCount: clientHireCount } : {}),
              ...(countryCode ? { countryCode: countryCode.toUpperCase() } : {}),
              ...(timeZone ? { timeZone } : {})
            }
          }
        : {}),
      ...(projectLengthBand ? { projectLengthBand } : {}),
      ...(hoursPerWeekBand ? { hoursPerWeekBand } : {}),
      ...(contractToHire ? { isContractToHire: contractToHire === "true" } : {})
    };

    try {
      const response = await fetch("/api/internal/dev/jobs", {
        method: "POST",
        headers: {
          authorization: `Bearer ${stringValue(formData, "token")}`,
          "content-type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message = z.object({ error: z.string() }).safeParse(body);
        const errorCode = message.success ? message.data.error : null;
        throw new Error(
          errorCode === null
            ? "Job injection failed."
            : (apiErrorMessages[errorCode] ?? "Job injection failed.")
        );
      }

      setResult(ingestionResponseSchema.parse(body));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Job injection failed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="grid gap-6" onSubmit={submitJob}>
      <Card className="grid gap-5 p-5 sm:p-6">
        <div className="flex items-start gap-4">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-violet-100 text-violet-800">
            <FlaskConical className="size-5" aria-hidden="true" />
          </span>
          <div>
            <h2 className="font-semibold text-slate-950">Development source</h2>
            <p className="mt-1 text-sm leading-6 text-slate-600">
              This creates durable test work only. It is not an Upwork endpoint and makes no external request.
            </p>
          </div>
        </div>

        <div className="grid gap-5 md:grid-cols-2">
          <Field hint="Must match the server-side development secret." label="Development token">
            <Input autoComplete="off" minLength={16} name="token" required type="password" />
          </Field>
          <Field hint="Reuse this ID to verify ingestion idempotency." label="Source job ID">
            <Input defaultValue="dev-make-openai-001" maxLength={160} name="sourceJobId" required />
          </Field>
        </div>

        <Field label="Job title">
          <Input defaultValue="Need Make.com + OpenAI automation expert" maxLength={300} name="title" required />
        </Field>
        <Field label="Job description">
          <Textarea defaultValue="Build a Make.com workflow that calls the OpenAI API, validates webhook payloads, and writes results to our CRM. We need a reliable automation expert who can document the handoff." maxLength={20_000} name="description" required />
        </Field>

        <div className="grid gap-5 md:grid-cols-2">
          <Field hint="Comma-separated." label="Skills">
            <Input defaultValue="Make.com, OpenAI, API integration, Webhooks" name="skills" required />
          </Field>
          <Field hint="Comma-separated canonical IDs." label="Categories">
            <Input defaultValue="automation, ai-development" name="categoryIds" />
          </Field>
          <Field label="Experience level">
            <Select defaultValue="expert" name="experienceLevel">
              <option value="">Not supplied</option>
              <option value="entry">Entry level</option>
              <option value="intermediate">Intermediate</option>
              <option value="expert">Expert</option>
            </Select>
          </Field>
          <Field label="Job type">
            <Select defaultValue="fixed" name="jobType" required>
              <option value="hourly">Hourly</option>
              <option value="fixed">Fixed-price</option>
            </Select>
          </Field>
        </div>

        <div className="grid gap-5 rounded-xl border border-slate-200 bg-slate-50 p-4 md:grid-cols-2">
          <div>
            <p className="mb-3 text-sm font-medium text-slate-800">Hourly rate (USD/hr)</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Minimum"><Input min="0" name="hourlyMin" step="0.01" type="number" /></Field>
              <Field label="Maximum"><Input min="0" name="hourlyMax" step="0.01" type="number" /></Field>
            </div>
          </div>
          <div>
            <p className="mb-3 text-sm font-medium text-slate-800">Fixed budget (USD)</p>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Minimum"><Input defaultValue="1500" min="0" name="fixedMin" step="0.01" type="number" /></Field>
              <Field label="Maximum"><Input defaultValue="2200" min="0" name="fixedMax" step="0.01" type="number" /></Field>
            </div>
          </div>
        </div>

        <div className="grid gap-5 md:grid-cols-3">
          <Field label="Proposal count"><Input defaultValue="3" min="0" name="proposalCount" type="number" /></Field>
          <Field label="Payment verified">
            <Select defaultValue="true" name="paymentVerified">
              <option value="">Not supplied</option>
              <option value="true">Verified</option>
              <option value="false">Unverified</option>
            </Select>
          </Field>
          <Field label="Client hires"><Input defaultValue="14" min="0" name="clientHireCount" type="number" /></Field>
          <Field label="Client country"><Input defaultValue="US" maxLength={2} name="countryCode" /></Field>
          <Field label="Client time zone"><Input defaultValue="America/New_York" name="timeZone" /></Field>
          <Field label="Project length">
            <Select defaultValue="one_to_three_months" name="projectLengthBand">
              <option value="">Not supplied</option>
              <option value="under_1_month">Less than one month</option>
              <option value="one_to_three_months">1 to 3 months</option>
              <option value="three_to_six_months">3 to 6 months</option>
              <option value="over_6_months">More than 6 months</option>
            </Select>
          </Field>
          <Field label="Hours per week">
            <Select defaultValue="under_30" name="hoursPerWeekBand">
              <option value="">Not supplied</option>
              <option value="under_30">Less than 30</option>
              <option value="over_30">More than 30</option>
            </Select>
          </Field>
          <Field label="Contract-to-hire">
            <Select defaultValue="false" name="contractToHire">
              <option value="">Not supplied</option>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </Select>
          </Field>
        </div>
      </Card>

      {result ? (
        <div className="flex gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900" role="status">
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            {result.duplicate ? "Existing job reused" : "Job accepted"}. Reference: <code>{result.jobId}</code>
          </span>
        </div>
      ) : null}
      {error ? <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800" role="alert">{error}</div> : null}

      <div className="flex justify-end">
        <Button disabled={pending} type="submit">
          {pending ? <LoaderCircle className="mr-2 size-4 animate-spin" aria-hidden="true" /> : null}
          {pending ? "Injecting…" : "Inject test job"}
        </Button>
      </div>
    </form>
  );
}

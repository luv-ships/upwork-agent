import { z } from "zod";

import { campaignFilterV1Schema, type CampaignFilterV1, type NumericRange } from "./campaign.js";
import { normalizedJobSchema, type NormalizedJob } from "./jobs.js";

const filterEvidenceValueSchema = z.union([
  z.boolean(),
  z.number(),
  z.string(),
  z.array(z.string())
]);

export const filterCheckSchema = z.object({
  rule: z.string().min(1),
  passed: z.boolean(),
  code: z.enum(["matched", "not_matched", "missing_source_data"]),
  expected: filterEvidenceValueSchema,
  actual: filterEvidenceValueSchema.nullable()
});

export const filterEvidenceSchema = z.object({
  version: z.literal(1),
  checks: z.array(filterCheckSchema),
  matchedSkills: z.array(z.string()),
  matchedKeywords: z.array(z.string())
});

export type FilterCheck = z.infer<typeof filterCheckSchema>;
export type FilterEvidence = z.infer<typeof filterEvidenceSchema>;

export type CampaignFilterDecision = {
  matched: boolean;
  evidence: FilterEvidence;
};

export interface FilterEvaluationOptions {
  /** The caller's observation time; the pure evaluator never reads the clock. */
  readonly asOf?: Date;
}

function casefold(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}

function check(
  checks: FilterCheck[],
  rule: string,
  passed: boolean,
  expected: FilterCheck["expected"],
  actual: FilterCheck["actual"],
  missing = false
): void {
  checks.push({
    rule,
    passed,
    code: missing ? "missing_source_data" : passed ? "matched" : "not_matched",
    expected,
    actual
  });
}

function rangeMatches(expected: NumericRange, actual: NumericRange | undefined): boolean | null {
  if (actual === undefined || (actual.min === undefined && actual.max === undefined)) return null;
  const actualMinimum = actual.min ?? actual.max;
  const actualMaximum = actual.max ?? actual.min;
  if (actualMinimum === undefined || actualMaximum === undefined) return null;
  return (
    (expected.min === undefined || actualMaximum >= expected.min) &&
    (expected.max === undefined || actualMinimum <= expected.max)
  );
}

function rangeLabel(range: NumericRange): string {
  if (range.min !== undefined && range.max !== undefined) return `${range.min}–${range.max}`;
  if (range.min !== undefined) return `at least ${range.min}`;
  return `at most ${String(range.max)}`;
}

export function evaluateCampaignFilter(
  filterInput: CampaignFilterV1,
  jobInput: NormalizedJob,
  options: FilterEvaluationOptions = {}
): CampaignFilterDecision {
  const filter = campaignFilterV1Schema.parse(filterInput);
  const job = normalizedJobSchema.parse(jobInput);
  const checks: FilterCheck[] = [];
  const normalizedSkills = new Set(job.skills.map(casefold));
  const matchedSkills = filter.requiredSkills.filter((skill) => normalizedSkills.has(casefold(skill)));
  if (filter.requiredSkills.length > 0) {
    const missing = job.skills.length === 0;
    check(
      checks,
      "required_skills",
      matchedSkills.length === filter.requiredSkills.length,
      filter.requiredSkills,
      job.skills,
      missing
    );
  }

  const searchableText = casefold(`${job.title}\n${job.description}\n${job.skills.join(" ")}`);
  const matchedKeywords = filter.includeKeywords.filter((keyword) => searchableText.includes(casefold(keyword)));
  if (filter.includeKeywords.length > 0) {
    check(checks, "include_keywords", matchedKeywords.length > 0, filter.includeKeywords, matchedKeywords);
  }
  if (filter.excludeKeywords.length > 0) {
    const excluded = filter.excludeKeywords.filter((keyword) => searchableText.includes(casefold(keyword)));
    check(checks, "exclude_keywords", excluded.length === 0, filter.excludeKeywords, excluded);
  }

  if (filter.categoryIds.length > 0) {
    const actual = job.categoryIds;
    const actualSet = new Set(actual.map(casefold));
    const passed = filter.categoryIds.some((category) => actualSet.has(casefold(category)));
    check(checks, "category", passed, filter.categoryIds, actual, actual.length === 0);
  }
  if (filter.experienceLevels.length > 0) {
    const experienceLevel = job.experienceLevel;
    const missing = experienceLevel === undefined;
    check(
      checks,
      "experience_level",
      experienceLevel !== undefined && filter.experienceLevels.includes(experienceLevel),
      filter.experienceLevels,
      experienceLevel ?? null,
      missing
    );
  }
  const effectiveJobTypes =
    filter.jobTypes.length > 0
      ? filter.jobTypes
      : [
          ...(filter.hourlyRate === undefined ? [] : (["hourly"] as const)),
          ...(filter.fixedBudget === undefined ? [] : (["fixed"] as const))
        ];
  if (effectiveJobTypes.length > 0) {
    check(checks, "job_type", effectiveJobTypes.includes(job.jobType), effectiveJobTypes, job.jobType);
  }

  if (filter.hourlyRate !== undefined && job.jobType === "hourly") {
    const result = rangeMatches(filter.hourlyRate, job.hourlyRate);
    check(
      checks,
      "hourly_rate",
      result === true,
      rangeLabel(filter.hourlyRate),
      job.hourlyRate === undefined ? null : rangeLabel(job.hourlyRate),
      result === null
    );
  }
  if (filter.fixedBudget !== undefined && job.jobType === "fixed") {
    const result = rangeMatches(filter.fixedBudget, job.fixedBudget);
    check(
      checks,
      "fixed_budget",
      result === true,
      rangeLabel(filter.fixedBudget),
      job.fixedBudget === undefined ? null : rangeLabel(job.fixedBudget),
      result === null
    );
  }
  if (filter.proposalCount !== undefined) {
    const proposalCount = job.proposalCount;
    const missing = proposalCount === undefined;
    const passed =
      proposalCount !== undefined &&
      (filter.proposalCount.min === undefined || proposalCount >= filter.proposalCount.min) &&
      (filter.proposalCount.max === undefined || proposalCount <= filter.proposalCount.max);
    check(
      checks,
      "proposal_count",
      passed,
      rangeLabel(filter.proposalCount),
      proposalCount ?? null,
      missing
    );
  }

  if (filter.postedWithinMinutes !== undefined) {
    const postedAt = job.postedAt;
    const asOf = options.asOf;
    const postedTime = postedAt === undefined ? Number.NaN : new Date(postedAt).getTime();
    const asOfTime = asOf?.getTime() ?? Number.NaN;
    const cutoff = asOfTime - filter.postedWithinMinutes * 60_000;
    const missing =
      postedAt === undefined ||
      !Number.isFinite(postedTime) ||
      !Number.isFinite(asOfTime);
    const passed = !missing && postedTime >= cutoff && postedTime <= asOfTime;
    check(
      checks,
      "posted_within",
      passed,
      filter.postedWithinMinutes,
      postedAt ?? null,
      missing,
    );
  }

  if (filter.paymentVerification !== "any") {
    const missing = job.paymentVerified === undefined;
    const expected = filter.paymentVerification === "only_verified";
    check(checks, "payment_verification", !missing && job.paymentVerified === expected, expected, job.paymentVerified ?? null, missing);
  }
  if (filter.clientHireHistory !== "any") {
    const hires = job.clientHireCount;
    const missing = hires === undefined;
    const passed =
      hires !== undefined &&
      ((filter.clientHireHistory === "no_hires" && hires === 0) ||
        (filter.clientHireHistory === "1_to_9" && hires >= 1 && hires <= 9) ||
        (filter.clientHireHistory === "10_plus" && hires >= 10));
    check(checks, "client_hire_history", passed, filter.clientHireHistory, hires ?? null, missing);
  }
  if (filter.clientHireRatePercent !== undefined) {
    const hireRatePercent = job.clientHireRatePercent;
    const missing = hireRatePercent === undefined;
    const passed =
      hireRatePercent !== undefined &&
      (filter.clientHireRatePercent.min === undefined || hireRatePercent >= filter.clientHireRatePercent.min) &&
      (filter.clientHireRatePercent.max === undefined || hireRatePercent <= filter.clientHireRatePercent.max);
    check(
      checks,
      "client_hire_rate_percent",
      passed,
      rangeLabel(filter.clientHireRatePercent),
      hireRatePercent ?? null,
      missing,
    );
  }
  if (filter.clientCountryCodes.length > 0) {
    const countryCode = job.clientCountryCode;
    const missing = countryCode === undefined;
    check(
      checks,
      "client_location",
      countryCode !== undefined && filter.clientCountryCodes.includes(countryCode),
      filter.clientCountryCodes,
      countryCode ?? null,
      missing
    );
  }
  if (filter.clientTimeZones.length > 0) {
    const timeZone = job.clientTimeZone;
    const missing = timeZone === undefined;
    check(
      checks,
      "client_time_zone",
      timeZone !== undefined && filter.clientTimeZones.includes(timeZone),
      filter.clientTimeZones,
      timeZone ?? null,
      missing
    );
  }
  if (filter.projectLengthBands.length > 0) {
    const projectLengthBand = job.projectLengthBand;
    const missing = projectLengthBand === undefined;
    check(
      checks,
      "project_length",
      projectLengthBand !== undefined && filter.projectLengthBands.includes(projectLengthBand),
      filter.projectLengthBands,
      projectLengthBand ?? null,
      missing
    );
  }
  if (filter.hoursPerWeekBands.length > 0) {
    const hoursPerWeekBand = job.hoursPerWeekBand;
    const missing = hoursPerWeekBand === undefined;
    check(
      checks,
      "hours_per_week",
      hoursPerWeekBand !== undefined && filter.hoursPerWeekBands.includes(hoursPerWeekBand),
      filter.hoursPerWeekBands,
      hoursPerWeekBand ?? null,
      missing
    );
  }
  if (filter.contractToHire !== "any") {
    const missing = job.isContractToHire === undefined;
    const expected = filter.contractToHire === "only";
    check(checks, "contract_to_hire", !missing && job.isContractToHire === expected, expected, job.isContractToHire ?? null, missing);
  }

  return {
    matched: checks.every((item) => item.passed),
    evidence: { version: 1, checks, matchedSkills, matchedKeywords }
  };
}

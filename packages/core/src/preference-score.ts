import { z } from "zod";

import {
  campaignFilterV1Schema,
  defaultCampaignScoringWeightsV1,
  type CampaignFilterV1,
  type CampaignScoringWeightsV1,
  type NumericRange
} from "./campaign.js";
import { filterEvidenceSchema, type FilterEvidence } from "./filter.js";
import { normalizedJobSchema, type NormalizedJob } from "./jobs.js";

export const preferenceScoreDimensionSchema = z.enum([
  "skills",
  "keywords",
  "budget",
  "competition",
  "client_quality",
  "project_fit"
]);

export const preferenceScoreComponentSchema = z.object({
  dimension: preferenceScoreDimensionSchema,
  weight: z.number().int().min(0).max(100),
  score: z.number().int().min(0).max(100),
  explanation: z.string().trim().min(1).max(300)
});

export const preferenceScoreResultSchema = z.object({
  version: z.literal(1),
  score: z.number().int().min(0).max(100),
  components: z.array(preferenceScoreComponentSchema).max(6),
  summary: z.array(z.string().trim().min(1).max(300)).max(6)
});

export type PreferenceScoreComponent = z.infer<typeof preferenceScoreComponentSchema>;
export type PreferenceScoreResult = z.infer<typeof preferenceScoreResultSchema>;

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function casefold(value: string): string {
  return value.trim().toLocaleLowerCase("en-US");
}

function monetaryFit(expected: NumericRange, actual: NumericRange | undefined): number | null {
  if (actual === undefined) return null;
  const actualMinimum = actual.min ?? actual.max;
  const actualMaximum = actual.max ?? actual.min;
  if (actualMinimum === undefined || actualMaximum === undefined) return null;

  if (expected.min !== undefined && expected.max !== undefined) {
    if (expected.min === expected.max) {
      return actualMinimum <= expected.min && actualMaximum >= expected.max ? 100 : 0;
    }
    const representative = Math.min(expected.max, Math.max(expected.min, actualMaximum));
    const position = (representative - expected.min) / (expected.max - expected.min);
    return clampScore(60 + position * 40);
  }

  if (expected.min !== undefined) {
    const ratio = actualMaximum / Math.max(expected.min, 0.01);
    return clampScore(60 + Math.min(1, Math.max(0, ratio - 1)) * 40);
  }

  if (expected.max !== undefined) {
    return clampScore((Math.min(actualMaximum, expected.max) / Math.max(expected.max, 0.01)) * 100);
  }

  return null;
}

function skillComponent(
  filter: CampaignFilterV1,
  job: NormalizedJob,
  weight: number
): PreferenceScoreComponent | null {
  if (weight === 0 || filter.requiredSkills.length === 0) return null;
  const actual = new Set(job.skills.map(casefold));
  const matched = filter.requiredSkills.filter((skill) => actual.has(casefold(skill))).length;
  const score = clampScore((matched / filter.requiredSkills.length) * 100);
  return {
    dimension: "skills",
    weight,
    score,
    explanation: `${matched} of ${filter.requiredSkills.length} required skills matched`
  };
}

function keywordComponent(
  filter: CampaignFilterV1,
  evidence: FilterEvidence,
  weight: number
): PreferenceScoreComponent | null {
  if (weight === 0 || filter.includeKeywords.length === 0) return null;
  const matched = new Set(evidence.matchedKeywords.map(casefold)).size;
  const score = clampScore((matched / filter.includeKeywords.length) * 100);
  return {
    dimension: "keywords",
    weight,
    score,
    explanation: `${matched} of ${filter.includeKeywords.length} preferred keywords matched`
  };
}

function budgetComponent(
  filter: CampaignFilterV1,
  job: NormalizedJob,
  weight: number
): PreferenceScoreComponent | null {
  if (weight === 0) return null;
  const expected = job.jobType === "hourly" ? filter.hourlyRate : filter.fixedBudget;
  const actual = job.jobType === "hourly" ? job.hourlyRate : job.fixedBudget;
  if (expected === undefined) return null;
  const score = monetaryFit(expected, actual);
  if (score === null) return null;
  return {
    dimension: "budget",
    weight,
    score,
    explanation: `${job.jobType === "hourly" ? "Hourly rate" : "Fixed budget"} fit scored ${score}/100`
  };
}

function competitionComponent(
  filter: CampaignFilterV1,
  job: NormalizedJob,
  weight: number
): PreferenceScoreComponent | null {
  const range = filter.proposalCount;
  if (weight === 0 || range === undefined || job.proposalCount === undefined) return null;
  if (range.max === undefined) {
    return {
      dimension: "competition",
      weight,
      score: 50,
      explanation: `${job.proposalCount} proposals met the configured lower bound`
    };
  }
  const lower = range.min ?? 0;
  const width = Math.max(1, range.max - lower);
  const position = Math.min(1, Math.max(0, (job.proposalCount - lower) / width));
  const score = clampScore(100 - position * 80);
  return {
    dimension: "competition",
    weight,
    score,
    explanation: `${job.proposalCount} proposals within the selected competition range`
  };
}

function clientQualityComponent(
  filter: CampaignFilterV1,
  job: NormalizedJob,
  weight: number
): PreferenceScoreComponent | null {
  if (weight === 0) return null;
  const scores: number[] = [];
  const details: string[] = [];
  if (filter.paymentVerification !== "any" && job.paymentVerified !== undefined) {
    const expected = filter.paymentVerification === "only_verified";
    scores.push(job.paymentVerified === expected ? 100 : 0);
    details.push(job.paymentVerified ? "payment verified" : "payment unverified");
  }
  if (filter.clientHireHistory !== "any" && job.clientHireCount !== undefined) {
    if (filter.clientHireHistory === "no_hires") {
      scores.push(job.clientHireCount === 0 ? 100 : 0);
    } else if (filter.clientHireHistory === "1_to_9") {
      scores.push(clampScore(55 + Math.min(9, job.clientHireCount) * 5));
    } else {
      scores.push(clampScore(70 + Math.min(30, Math.log10(Math.max(10, job.clientHireCount)) * 20)));
    }
    details.push(`${job.clientHireCount} prior hires`);
  }
  if (filter.clientHireRatePercent !== undefined && job.clientHireRatePercent !== undefined) {
    const expected = filter.clientHireRatePercent;
    const score =
      expected.min !== undefined && job.clientHireRatePercent < expected.min
        ? 0
        : expected.max !== undefined && job.clientHireRatePercent > expected.max
          ? 0
          : expected.min === undefined
            ? clampScore((job.clientHireRatePercent / Math.max(expected.max ?? 100, 1)) * 100)
            : clampScore(60 + Math.min(1, (job.clientHireRatePercent - expected.min) / Math.max(1, 100 - expected.min)) * 40);
    scores.push(score);
    details.push(`${job.clientHireRatePercent}% client hire rate`);
  }
  if (scores.length === 0) return null;
  const score = clampScore(scores.reduce((total, item) => total + item, 0) / scores.length);
  return {
    dimension: "client_quality",
    weight,
    score,
    explanation: details.join("; ")
  };
}

function projectFitComponent(
  evidence: FilterEvidence,
  weight: number
): PreferenceScoreComponent | null {
  if (weight === 0) return null;
  const projectRules = new Set([
    "category",
    "experience_level",
    "job_type",
    "client_location",
    "client_time_zone",
    "project_length",
    "hours_per_week",
    "contract_to_hire"
  ]);
  const checks = evidence.checks.filter((item) => projectRules.has(item.rule));
  if (checks.length === 0) return null;
  const passed = checks.filter((item) => item.passed).length;
  const score = clampScore((passed / checks.length) * 100);
  return {
    dimension: "project_fit",
    weight,
    score,
    explanation: `${passed} of ${checks.length} selected project attributes matched`
  };
}

function configuredWeights(filter: CampaignFilterV1): CampaignScoringWeightsV1 {
  return filter.scoringWeights ?? defaultCampaignScoringWeightsV1;
}

export function scoreJobPreference(
  filterInput: CampaignFilterV1,
  jobInput: NormalizedJob,
  evidenceInput: FilterEvidence
): PreferenceScoreResult {
  const filter = campaignFilterV1Schema.parse(filterInput);
  const job = normalizedJobSchema.parse(jobInput);
  const evidence = filterEvidenceSchema.parse(evidenceInput);
  const weights = configuredWeights(filter);
  const components = [
    skillComponent(filter, job, weights.skills),
    keywordComponent(filter, evidence, weights.keywords),
    budgetComponent(filter, job, weights.budget),
    competitionComponent(filter, job, weights.competition),
    clientQualityComponent(filter, job, weights.clientQuality),
    projectFitComponent(evidence, weights.projectFit)
  ].filter((component): component is PreferenceScoreComponent => component !== null);

  if (components.length === 0) {
    return preferenceScoreResultSchema.parse({
      version: 1,
      score: 50,
      components: [],
      summary: ["No weighted preference criteria were configured for this job"]
    });
  }

  const activeWeight = components.reduce((total, component) => total + component.weight, 0);
  const score = clampScore(
    components.reduce((total, component) => total + component.score * component.weight, 0) /
      activeWeight
  );
  const strongest = [...components].sort((left, right) => right.score - left.score).slice(0, 3);
  return preferenceScoreResultSchema.parse({
    version: 1,
    score,
    components,
    summary: strongest.map(
      (component) => `${component.dimension.replaceAll("_", " ")}: ${component.score}/100`
    )
  });
}

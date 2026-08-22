import { z } from "zod";

import { campaignFilterV1Schema } from "./campaign.js";
import { filterEvidenceSchema } from "./filter.js";
import { normalizedJobSchema } from "./jobs.js";
import { monetaryAmountSchema } from "./money.js";
import { preferenceScoreResultSchema } from "./preference-score.js";
import {
  proposalDraftSchema,
  proposalGenerationInputSchema,
  type ProposalGenerationInput,
  type ProposalGenerationProvider,
  type ProposalDraft
} from "./proposal.js";

export const suitabilityInputSchema = z.object({
  job: normalizedJobSchema,
  campaign: z.object({
    filters: campaignFilterV1Schema,
    aiInstructions: z.string().max(12_000),
    scoreThreshold: z.number().int().min(0).max(100)
  }),
  deterministicEvidence: filterEvidenceSchema,
  preferenceScore: preferenceScoreResultSchema
});

export const suitabilityResultSchema = z
  .object({
    score: z.number().int().min(0).max(100),
    recommendation: z.enum(["apply", "review", "skip"]),
    reasons: z.array(z.string().trim().min(1).max(500)).min(1).max(12),
    risks: z.array(z.string().trim().min(1).max(500)).max(12),
    estimatedWinProbability: z.number().min(0).max(1),
    pricingDirection: z.enum(["below_market", "market", "premium", "hourly"]),
    suggestedBidAmount: monetaryAmountSchema.optional(),
    suggestedBidCurrency: z.string().regex(/^[A-Z]{3}$/).optional()
  })
  .refine(
    (result) =>
      (result.suggestedBidAmount === undefined) ===
      (result.suggestedBidCurrency === undefined),
    { message: "suggested bid amount and currency must be supplied together" }
  );

export type SuitabilityInput = z.infer<typeof suitabilityInputSchema>;
export type SuitabilityResult = z.infer<typeof suitabilityResultSchema>;

export interface TextGenerationProvider extends ProposalGenerationProvider {
  assessSuitability(input: SuitabilityInput): Promise<SuitabilityResult>;
}

function recommendedAmount(input: SuitabilityInput): number | undefined {
  if (input.job.jobType === "fixed") {
    return input.job.fixedBudget?.max ?? input.job.fixedBudget?.min;
  }
  return input.job.hourlyRate?.max ?? input.job.hourlyRate?.min;
}

export class FakeAIProvider implements TextGenerationProvider {
  public async assessSuitability(inputValue: SuitabilityInput): Promise<SuitabilityResult> {
    const input = suitabilityInputSchema.parse(inputValue);
    const checks = input.deterministicEvidence.checks.length;
    const technologySignals =
      input.deterministicEvidence.matchedSkills.length +
      input.deterministicEvidence.matchedKeywords.length;
    const commercialSignals = input.deterministicEvidence.checks.filter((item) =>
      ["fixed_budget", "hourly_rate", "payment_verification", "client_hire_history", "client_hire_rate_percent"].includes(item.rule)
    ).length;
    const score = Math.min(98, 76 + Math.min(12, technologySignals * 4) + Math.min(8, commercialSignals * 2));
    const amount = recommendedAmount(input);
    const reasons = [
      technologySignals > 0 ? "Strong technology match" : "Deterministic campaign rules matched",
      commercialSignals > 0 ? "Budget and client characteristics fit" : "Selected job constraints fit",
      `${checks} deterministic filter ${checks === 1 ? "group" : "groups"} passed`
    ];

    return suitabilityResultSchema.parse({
      score,
      recommendation: score >= input.campaign.scoreThreshold ? "apply" : "review",
      reasons,
      risks: input.campaign.aiInstructions.trim().length === 0
        ? ["No campaign-specific AI instructions were supplied"]
        : [],
      estimatedWinProbability: Number((Math.min(0.85, Math.max(0.15, score / 120))).toFixed(4)),
      pricingDirection: input.job.jobType === "hourly" ? "hourly" : "market",
      ...(amount === undefined ? {} : { suggestedBidAmount: amount, suggestedBidCurrency: "USD" })
    });
  }

  public async generateProposal(inputValue: ProposalGenerationInput): Promise<ProposalDraft> {
    const input = proposalGenerationInputSchema.parse(inputValue);
    const firstName = input.job.title.split(/\s+/u)[0] ?? "there";
    const skills = input.job.skills.slice(0, 3).join(", ");
    const knowledgeLine =
      input.knowledgeChunks.length > 0
        ? ` I can draw on relevant delivery experience from ${input.knowledgeChunks.map((chunk) => chunk.title).join(", ")}.`
        : " I can share relevant examples during the conversation.";
    const body = `Hi,\n\nI can help with ${input.job.title.toLowerCase()}. My experience with ${skills || "the requested workflow"} lets me build a reliable solution and document the handoff.${knowledgeLine}\n\nI would start by confirming the current workflow, defining the first measurable milestone, and then delivering a tested implementation. I can begin promptly and communicate clearly throughout the project.\n\nBest,\nYour implementation partner`;
    const bid = input.suitability.suggestedBidAmount;
    return proposalDraftSchema.parse({
      body,
      sourceChunkIds: input.knowledgeChunks.map((chunk) => chunk.id),
      ...(bid === undefined
        ? {}
        : { suggestedBidAmount: bid, suggestedBidCurrency: input.suitability.suggestedBidCurrency ?? "USD" }),
    });
  }
}

import { z } from "zod";

import { monetaryAmountSchema } from "./money.js";
import { normalizedJobSchema } from "./jobs.js";
import { createInputHash } from "./hash.js";

const boundedProposalText = z.string().trim().min(1).max(12_000);

const proposalSuitabilitySnapshotSchema = z.object({
  score: z.number().int().min(0).max(100),
  recommendation: z.enum(["apply", "review", "skip"]),
  reasons: z.array(z.string().trim().min(1).max(500)).min(1).max(12),
  risks: z.array(z.string().trim().min(1).max(500)).max(12),
  estimatedWinProbability: z.number().min(0).max(1),
  pricingDirection: z.enum(["below_market", "market", "premium", "hourly"]),
  suggestedBidAmount: monetaryAmountSchema.optional(),
  suggestedBidCurrency: z.string().regex(/^[A-Z]{3}$/).optional(),
});

export const proposalKnowledgeChunkSchema = z.object({
  id: z.uuid(),
  title: z.string().trim().min(1).max(200),
  content: z.string().trim().min(1).max(4_000),
});

export const proposalGenerationInputSchema = z.object({
  job: normalizedJobSchema,
  campaignName: z.string().trim().min(1).max(120),
  aiInstructions: z.string().max(4_000),
  suitability: proposalSuitabilitySnapshotSchema,
  knowledgeChunks: z.array(proposalKnowledgeChunkSchema).max(20),
  generationNonce: z.string().regex(/^[0-9a-f]{64}$/).optional(),
});

export const proposalDraftSchema = z
  .object({
    body: boundedProposalText,
    sourceChunkIds: z.array(z.uuid()).max(20),
    suggestedBidAmount: monetaryAmountSchema.optional(),
    suggestedBidCurrency: z.string().regex(/^[A-Z]{3}$/).optional(),
  })
  .refine(
    (draft) =>
      (draft.suggestedBidAmount === undefined) ===
      (draft.suggestedBidCurrency === undefined),
    { message: "suggested bid amount and currency must be supplied together" },
  )
  .refine(
    (draft) => new Set(draft.sourceChunkIds).size === draft.sourceChunkIds.length,
    { message: "source chunk ids must be unique" },
  );

export type ProposalGenerationInput = z.infer<typeof proposalGenerationInputSchema>;
export type ProposalDraft = z.infer<typeof proposalDraftSchema>;

export interface ProposalGenerationProvider {
  generateProposal(input: ProposalGenerationInput): Promise<ProposalDraft>;
}

export function proposalGenerationInputHash(input: ProposalGenerationInput): string {
  return createInputHash(proposalGenerationInputSchema.parse(input));
}

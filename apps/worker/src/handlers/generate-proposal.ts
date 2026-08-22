import {
  parseWorkflowTaskPayload,
  proposalDraftSchema,
  type EmbeddingProvider,
  type ProposalGenerationProvider,
} from "@upwork-agent/core";

import type { ProposalRepository } from "../adapters/database-proposals.js";
import type { AnalysisProviderMetadata } from "./analyze-match.js";
import type { ClaimedTask } from "../runtime/worker.js";

export async function handleGenerateProposal(
  repository: ProposalRepository,
  provider: ProposalGenerationProvider,
  embeddingProvider: EmbeddingProvider | undefined,
  providerMetadata: AnalysisProviderMetadata,
  task: ClaimedTask,
): Promise<void> {
  const payload = parseWorkflowTaskPayload("generate-proposal", task.payload);
  try {
    const query = await repository.loadProposalGenerationQuery({
      matchId: payload.matchId,
      workspaceId: task.workspaceId,
    });
    const queryEmbedding = query.status === "ready" && embeddingProvider !== undefined
      ? (await embeddingProvider.embed({ texts: [query.text] })).vectors[0]
      : undefined;
    const context = await repository.loadProposalGenerationContext({
      generationKey: payload.generationKey,
      matchId: payload.matchId,
      ...(queryEmbedding === undefined ? {} : { queryEmbedding }),
      workspaceId: task.workspaceId,
    });
    if (context.status === "skip") return;
    const draft = proposalDraftSchema.parse(await provider.generateProposal(context.input));
    await repository.commitProposalGeneration({
      draft,
      generationInputHash: context.generationInputHash,
      matchId: context.matchId,
      model: providerMetadata.model,
      promptVersion: providerMetadata.proposalPromptVersion,
      provider: providerMetadata.provider,
      workspaceId: context.workspaceId,
    });
  } catch (error) {
    if (task.attemptCount >= task.maxAttempts) {
      await repository.failProposalGeneration({
        failureCode: "proposal_generation_failed",
        matchId: payload.matchId,
        workspaceId: task.workspaceId,
      });
    }
    throw error;
  }
}

import {
  parseWorkflowTaskPayload,
  suitabilityResultSchema,
  type TextGenerationProvider,
} from "@upwork-agent/core";

import type { PipelineRepository } from "../adapters/database-pipeline.js";
import type { ClaimedTask } from "../runtime/worker.js";

export type AnalysisProviderMetadata = {
  model: string;
  promptVersion: string;
  proposalPromptVersion: string;
  provider: string;
};

export async function handleAnalyzeMatch(
  repository: PipelineRepository,
  provider: TextGenerationProvider,
  providerMetadata: AnalysisProviderMetadata,
  task: ClaimedTask,
): Promise<void> {
  const payload = parseWorkflowTaskPayload("analyze-match", task.payload);
  const context = await repository.loadMatchAnalysisContext({
    inputHash: payload.inputHash,
    matchId: payload.matchId,
    workspaceId: task.workspaceId,
  });

  if (context.status === "skip") {
    return;
  }

  const providerResult = await provider.assessSuitability(context.input);
  const result = suitabilityResultSchema.parse(providerResult);

  await repository.commitMatchAnalysis({
    inputHash: payload.inputHash,
    matchId: context.matchId,
    model: providerMetadata.model,
    promptVersion: providerMetadata.promptVersion,
    provider: providerMetadata.provider,
    result,
    workspaceId: context.workspaceId,
  });
}

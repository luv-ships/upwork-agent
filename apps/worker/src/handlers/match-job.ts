import {
  createInputHash,
  evaluateCampaignFilter,
  parseWorkflowTaskPayload,
  scoreJobPreference,
} from "@upwork-agent/core";

import type { PipelineRepository } from "../adapters/database-pipeline.js";
import {
  suitabilityContractVersion,
} from "../runtime/ai-contract.js";
import type { ClaimedTask } from "../runtime/worker.js";
import type { AnalysisProviderMetadata } from "./analyze-match.js";

export async function handleMatchJob(
  repository: PipelineRepository,
  providerMetadata: AnalysisProviderMetadata,
  task: ClaimedTask,
): Promise<void> {
  const payload = parseWorkflowTaskPayload("match-job", task.payload);
  const context = await repository.loadJobMatchContext({
    jobId: payload.jobId,
    normalizedRevision: payload.normalizedRevision,
    workspaceId: task.workspaceId,
    ...(payload.campaignId === undefined
      ? {}
      : { campaignId: payload.campaignId }),
  });

  if (context.status === "skip") {
    return;
  }

  const evaluationAsOf = new Date();

  const matches = context.campaigns.flatMap((campaign) => {
    const decision = evaluateCampaignFilter(campaign.filters, context.job, {
      asOf: evaluationAsOf,
    });
    if (!decision.matched) {
      return [];
    }
    const preferenceScore = scoreJobPreference(
      campaign.filters,
      context.job,
      decision.evidence,
    );

    return [
      {
        analysisInputHash: createInputHash({
          aiInstructions: campaign.aiInstructions,
          campaignConfigVersion: campaign.configVersion,
          campaignId: campaign.id,
          deterministicEvidence: decision.evidence,
          filterSnapshot: campaign.filters,
          job: context.job,
          jobRevision: context.normalizedRevision,
          model: providerMetadata.model,
          preferenceScore,
          promptVersion: providerMetadata.promptVersion,
          provider: providerMetadata.provider,
          suitabilityContractVersion,
        }),
        campaignConfigVersion: campaign.configVersion,
        campaignId: campaign.id,
        deterministicEvidence: decision.evidence,
        filterSnapshot: campaign.filters,
        preferenceScore,
      },
    ];
  });

  await repository.commitJobMatches({
    jobId: context.jobId,
    matches,
    normalizedRevision: context.normalizedRevision,
    workspaceId: context.workspaceId,
  });
}

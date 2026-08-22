import type { EmbeddingProvider, TextGenerationProvider, UpworkMcpPort } from "@upwork-agent/core";

import type { PipelineRepository } from "../adapters/database-pipeline.js";
import type { UpworkMonitorRepository } from "../adapters/database-upwork-monitor.js";
import type { UpworkRetentionRepository } from "../adapters/database-upwork-retention.js";
import type { ProposalRepository } from "../adapters/database-proposals.js";
import { WorkerError } from "../runtime/errors.js";
import type { ClaimedTask, TaskProcessor } from "../runtime/worker.js";
import { handleAnalyzeMatch, type AnalysisProviderMetadata } from "./analyze-match.js";
import { handleMatchJob } from "./match-job.js";
import { handleNormalizeJob } from "./normalize-job.js";
import { handlePollUpworkMonitor } from "./poll-upwork-monitor.js";
import { handlePurgeUpworkData } from "./purge-upwork-data.js";
import { handleGenerateProposal } from "./generate-proposal.js";
import { handleIndexKnowledgeDocument } from "./index-knowledge-doc.js";

export function createTaskProcessor(options: {
  provider: TextGenerationProvider;
  embeddingProvider?: EmbeddingProvider;
  providerMetadata: AnalysisProviderMetadata;
  repository: PipelineRepository;
  proposalRepository: ProposalRepository;
  upworkMcpPort?: UpworkMcpPort;
  upworkMinimumPollIntervalSeconds?: number;
  upworkMonitorRepository?: UpworkMonitorRepository;
  upworkRetentionRepository: UpworkRetentionRepository;
}): TaskProcessor {
  return async (task: ClaimedTask): Promise<void> => {
    if (task.schemaVersion !== 1) {
      throw new WorkerError({
        code: "UNSUPPORTED_TASK_SCHEMA_VERSION",
        message: "The claimed task schema version is not supported by this worker release.",
        retryable: false,
      });
    }

    switch (task.kind) {
      case "normalize-job":
        await handleNormalizeJob(options.repository, task);
        return;
      case "match-job":
        await handleMatchJob(options.repository, options.providerMetadata, task);
        return;
      case "analyze-match":
        await handleAnalyzeMatch(
          options.repository,
          options.provider,
          options.providerMetadata,
          task,
        );
        return;
      case "poll-upwork-monitor":
        if (
          options.upworkMcpPort === undefined ||
          options.upworkMinimumPollIntervalSeconds === undefined ||
          options.upworkMonitorRepository === undefined
        ) {
          throw new WorkerError({
            code: "UPWORK_MONITOR_DISABLED",
            message: "The Upwork monitor provider is disabled for this worker.",
            retryable: false,
          });
        }
        await handlePollUpworkMonitor(
          options.upworkMonitorRepository,
          options.upworkMcpPort,
          task,
          options.upworkMinimumPollIntervalSeconds,
        );
        return;
      case "purge-upwork-data":
        await handlePurgeUpworkData(options.upworkRetentionRepository, task);
        return;
      case "index-knowledge-doc":
        await handleIndexKnowledgeDocument(options.proposalRepository, options.embeddingProvider, task);
        return;
      case "generate-proposal":
        await handleGenerateProposal(options.proposalRepository, options.provider, options.embeddingProvider, options.providerMetadata, task);
        return;
      default:
        throw new WorkerError({
          code: "UNSUPPORTED_TASK_KIND",
          message: "The claimed task kind is not supported by this worker release.",
          retryable: false,
        });
    }
  };
}

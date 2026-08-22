import { FakeAIProvider, FakeEmbeddingProvider, type EmbeddingProvider, type TextGenerationProvider } from "@upwork-agent/core";
import {
  closeDatabase,
  createDatabase,
  createDatabaseUpworkOAuthCredentialVault,
  UpworkOAuthCredentialCipher
} from "@upwork-agent/db";

import { createDatabaseTaskQueue } from "./adapters/database-task-queue.js";
import { createDatabasePipelineRepository } from "./adapters/database-pipeline.js";
import { createOpenAIProvider } from "./adapters/openai-provider.js";
import { createDatabaseUpworkMonitorRepository } from "./adapters/database-upwork-monitor.js";
import { createDatabaseUpworkRetentionRepository } from "./adapters/database-upwork-retention.js";
import { createDatabaseProposalRepository } from "./adapters/database-proposals.js";
import { FakeUpworkMcpPort } from "./adapters/fake-upwork-mcp.js";
import { createDatabaseUpworkMcpConnectionAccessResolver } from "./adapters/database-upwork-mcp-access.js";
import { UpworkMcpRemoteFindJobsClient } from "./adapters/upwork-mcp-remote.js";
import { RemoteUpworkMcpPort } from "./adapters/upwork-mcp.js";
import { createTaskProcessor } from "./handlers/index.js";
import {
  fakeSuitabilityModel,
  suitabilityPromptVersion,
} from "./runtime/ai-contract.js";
import {
  formatEnvironmentError,
  parseWorkerConfig,
  type WorkerConfig,
} from "./runtime/env.js";
import { toWorkerFailure } from "./runtime/errors.js";
import { createLogger, type Logger } from "./runtime/logger.js";
import { startWorkerHealthServer, type WorkerHealthServer } from "./runtime/health.js";
import { runWorker } from "./runtime/worker.js";

const LEASE_DURATION_MS = 5 * 60 * 1_000;
const LEASE_REAPER_INTERVAL_MS = 30_000;

function selectProvider(config: WorkerConfig): {
  metadata: { model: string; promptVersion: string; proposalPromptVersion: string; provider: string };
  provider: TextGenerationProvider;
  embeddingProvider?: EmbeddingProvider;
} {
  if (config.aiProvider === "openai") {
    if (config.openAiApiKey === undefined || config.openAiTextModel === undefined) {
      throw new Error("OpenAI provider settings are incomplete");
    }
    const provider = createOpenAIProvider({
      apiKey: config.openAiApiKey,
      model: config.openAiTextModel,
      ...(config.openAiEmbeddingModel === undefined ? {} : { embeddingModel: config.openAiEmbeddingModel }),
    });
    return {
      metadata: {
        model: config.openAiTextModel ?? "unconfigured",
        promptVersion: suitabilityPromptVersion,
        proposalPromptVersion: "proposal-v1",
        provider: "openai",
      },
      provider,
      ...(config.openAiEmbeddingModel === undefined ? {} : { embeddingProvider: provider }),
    };
  }

  return {
    metadata: {
      model: fakeSuitabilityModel,
      promptVersion: suitabilityPromptVersion,
      proposalPromptVersion: "proposal-v1",
      provider: "fake",
    },
    provider: new FakeAIProvider(),
    embeddingProvider: new FakeEmbeddingProvider(),
  };
}

async function start(config: WorkerConfig, logger: Logger): Promise<void> {
  // Provider selection happens before opening the database so an unsupported
  // live-provider configuration cannot claim work or initiate external I/O.
  const selectedProvider = selectProvider(config);
  const database = createDatabase(config.databaseUrl, {
    applicationName: `upwork-agent-worker:${config.workerId}`,
    maxConnections: config.workerConcurrency + 1,
  });
  const abortController = new AbortController();
  let healthServer: WorkerHealthServer | undefined;
  let shutdownRequested = false;

  function requestShutdown(signalName: "SIGINT" | "SIGTERM"): void {
    if (shutdownRequested) {
      return;
    }

    shutdownRequested = true;
    logger.info("worker.shutdown_requested", { signal: signalName });
    abortController.abort();
  }

  process.once("SIGINT", () => requestShutdown("SIGINT"));
  process.once("SIGTERM", () => requestShutdown("SIGTERM"));

  try {
    healthServer = await startWorkerHealthServer({
      port: config.workerHealthPort,
      workerId: config.workerId,
    });
    const upworkMcpPort = (() => {
      if (config.upworkMonitorProvider === "fake") return new FakeUpworkMcpPort();
      if (config.upworkMonitorProvider !== "mcp") return undefined;
      if (config.upworkMcpCredentialEncryptionKey === undefined) {
        throw new Error("Live Upwork monitoring is missing its credential encryption key");
      }
      const vault = createDatabaseUpworkOAuthCredentialVault(
        database,
        new UpworkOAuthCredentialCipher(config.upworkMcpCredentialEncryptionKey)
      );
      return new RemoteUpworkMcpPort(
        new UpworkMcpRemoteFindJobsClient({
          accessResolver: createDatabaseUpworkMcpConnectionAccessResolver(vault)
        })
      );
    })();
    await runWorker(
      {
        leaseDurationMs: LEASE_DURATION_MS,
        logger,
        pollIntervalMs: config.workerPollIntervalMs,
        processTask: createTaskProcessor({
          provider: selectedProvider.provider,
          ...(selectedProvider.embeddingProvider === undefined ? {} : { embeddingProvider: selectedProvider.embeddingProvider }),
          providerMetadata: selectedProvider.metadata,
          proposalRepository: createDatabaseProposalRepository(database),
          repository: createDatabasePipelineRepository(database),
          upworkRetentionRepository:
            createDatabaseUpworkRetentionRepository(database),
          ...(upworkMcpPort === undefined
            ? {}
            : {
                upworkMcpPort,
                upworkMinimumPollIntervalSeconds:
                  config.upworkMcpMinPollIntervalSeconds,
                upworkMonitorRepository:
                  createDatabaseUpworkMonitorRepository(database),
              }),
        }),
        reaperIntervalMs: LEASE_REAPER_INTERVAL_MS,
        taskQueue: createDatabaseTaskQueue(database),
        workerId: config.workerId,
      },
      abortController.signal,
    );
  } finally {
    await healthServer?.close();
    await closeDatabase(database);
  }
}

function main(): void {
  let config: WorkerConfig;

  try {
    config = parseWorkerConfig(process.env);
  } catch (error) {
    const configurationLogger = createLogger("error");
    for (const issue of formatEnvironmentError(error)) {
      configurationLogger.error("worker.configuration_invalid", {
        errorCode: "INVALID_WORKER_CONFIGURATION",
        issue,
      });
    }
    process.exitCode = 1;
    return;
  }

  const logger = createLogger(config.logLevel);
  start(config, logger).catch((error: unknown) => {
    const failure = toWorkerFailure(error);
    logger.error("worker.fatal", {
      errorCode: failure.code,
      retryable: failure.retryable,
    });
    process.exitCode = 1;
  });
}

main();

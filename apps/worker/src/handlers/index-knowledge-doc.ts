import { parseWorkflowTaskPayload, type EmbeddingProvider } from "@upwork-agent/core";

import type { KnowledgeRepository } from "../adapters/database-proposals.js";
import type { ClaimedTask } from "../runtime/worker.js";

export async function handleIndexKnowledgeDocument(
  repository: KnowledgeRepository,
  embeddingProvider: EmbeddingProvider | undefined,
  task: ClaimedTask,
): Promise<void> {
  const payload = parseWorkflowTaskPayload("index-knowledge-doc", task.payload);
  try {
    const context = await repository.loadKnowledgeIndexContext({
      contentHash: payload.contentHash,
      documentId: payload.documentId,
      workspaceId: task.workspaceId,
    });
    if (context.status === "skip") return;
    let embeddings: readonly number[][] | undefined;
    let embeddingModel: string | undefined;
    if (embeddingProvider !== undefined) {
      embeddings = (await embeddingProvider.embed({ texts: context.chunks })).vectors;
      embeddingModel = embeddingProvider.model;
    }
    await repository.commitKnowledgeIndex({
      contentHash: context.contentHash,
      documentId: context.documentId,
      ...(embeddings === undefined || embeddingModel === undefined ? {} : { embeddings, embeddingModel }),
      workspaceId: context.workspaceId,
    });
  } catch (error) {
    if (task.attemptCount >= task.maxAttempts) {
      await repository.failKnowledgeIndex({
        documentId: payload.documentId,
        failureCode: "knowledge_index_failed",
        workspaceId: task.workspaceId,
      });
    }
    throw error;
  }
}

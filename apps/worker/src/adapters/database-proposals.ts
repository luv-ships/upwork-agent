import {
  commitKnowledgeIndex,
  commitProposalGeneration,
  failKnowledgeIndex,
  failProposalGeneration,
  loadKnowledgeIndexContext,
  loadProposalGenerationQuery,
  loadProposalGenerationContext,
  type CommitProposalGenerationResult,
  type LoadKnowledgeIndexContextResult,
  type ProposalGenerationContextResult,
  type ProposalGenerationQueryResult,
} from "@upwork-agent/db";

import type { Database } from "@upwork-agent/db";

export interface KnowledgeRepository {
  loadKnowledgeIndexContext(input: {
    contentHash: string;
    documentId: string;
    workspaceId: string;
  }): Promise<LoadKnowledgeIndexContextResult>;
  commitKnowledgeIndex(input: {
    contentHash: string;
    documentId: string;
    embeddings?: readonly number[][];
    embeddingModel?: string;
    workspaceId: string;
  }): Promise<{ readonly status: "committed" | "skip"; readonly chunkCount: number }>;
  failKnowledgeIndex(input: {
    documentId: string;
    failureCode: string;
    workspaceId: string;
  }): Promise<boolean>;
}

export interface ProposalRepository extends KnowledgeRepository {
  loadProposalGenerationQuery(input: {
    matchId: string;
    workspaceId: string;
  }): Promise<ProposalGenerationQueryResult>;
  loadProposalGenerationContext(input: {
    generationKey: string;
    matchId: string;
    queryEmbedding?: readonly number[];
    workspaceId: string;
  }): Promise<ProposalGenerationContextResult>;
  commitProposalGeneration(input: Parameters<typeof commitProposalGeneration>[1]): Promise<CommitProposalGenerationResult>;
  failProposalGeneration(input: {
    failureCode: string;
    matchId: string;
    workspaceId: string;
  }): Promise<boolean>;
}

export function createDatabaseProposalRepository(database: Database): ProposalRepository {
  return {
    commitKnowledgeIndex: (input) => commitKnowledgeIndex(database, input),
    commitProposalGeneration: (input) => commitProposalGeneration(database, input),
    failKnowledgeIndex: (input) => failKnowledgeIndex(database, input),
    failProposalGeneration: (input) => failProposalGeneration(database, input),
    loadKnowledgeIndexContext: (input) => loadKnowledgeIndexContext(database, input),
    loadProposalGenerationQuery: (input) => loadProposalGenerationQuery(database, input),
    loadProposalGenerationContext: (input) => loadProposalGenerationContext(database, input),
  };
}

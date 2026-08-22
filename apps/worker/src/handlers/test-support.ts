import type { PipelineRepository } from "../adapters/database-pipeline.js";
import type { ProposalRepository } from "../adapters/database-proposals.js";

export function createPipelineRepositoryStub(
  overrides: Partial<PipelineRepository> = {},
): PipelineRepository {
  return {
    commitJobMatches: async () => ({ status: "skip" }),
    commitJobNormalization: async () => ({ status: "skip" }),
    commitMatchAnalysis: async () => ({ status: "skip" }),
    loadJobForNormalization: async () => ({ status: "skip" }),
    loadJobMatchContext: async () => ({ status: "skip" }),
    loadMatchAnalysisContext: async () => ({ status: "skip" }),
    ...overrides,
  };
}

export function createProposalRepositoryStub(
  overrides: Partial<ProposalRepository> = {},
): ProposalRepository {
  return {
    commitKnowledgeIndex: async () => ({ status: "skip", chunkCount: 0 }),
    commitProposalGeneration: async () => ({ status: "skip" }),
    failKnowledgeIndex: async () => false,
    failProposalGeneration: async () => false,
    loadKnowledgeIndexContext: async () => ({ status: "skip" }),
    loadProposalGenerationQuery: async () => ({ status: "skip" }),
    loadProposalGenerationContext: async () => ({ status: "skip" }),
    ...overrides,
  };
}

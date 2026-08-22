import type {
  CampaignFilterV1,
  FilterEvidence,
  NormalizedJob,
  PreferenceScoreResult,
  SuitabilityResult,
} from "@upwork-agent/core";
import {
  commitJobMatches,
  commitJobNormalization,
  commitMatchAnalysis,
  loadJobForNormalization,
  loadJobMatchContext,
  loadMatchAnalysisContext,
  type CommitJobMatchesResult,
  type CommitJobNormalizationResult,
  type CommitMatchAnalysisResult,
  type Database,
  type LoadJobForNormalizationResult,
  type LoadJobMatchContextResult,
  type LoadMatchAnalysisContextResult,
} from "@upwork-agent/db";

export interface PipelineRepository {
  commitJobMatches(input: {
    jobId: string;
    matches: readonly {
      analysisInputHash: string;
      campaignConfigVersion: number;
      campaignId: string;
      deterministicEvidence: FilterEvidence;
      filterSnapshot: CampaignFilterV1;
      preferenceScore: PreferenceScoreResult;
    }[];
    normalizedRevision: number;
    workspaceId: string;
  }): Promise<CommitJobMatchesResult>;
  commitJobNormalization(input: {
    jobId: string;
    normalizedHash: string;
    normalizedJob: NormalizedJob;
    sourcePayloadHash: string;
    workspaceId: string;
  }): Promise<CommitJobNormalizationResult>;
  commitMatchAnalysis(input: {
    inputHash: string;
    matchId: string;
    model: string;
    promptVersion: string;
    provider: string;
    result: SuitabilityResult;
    workspaceId: string;
  }): Promise<CommitMatchAnalysisResult>;
  loadJobForNormalization(input: {
    jobId: string;
    sourcePayloadHash: string;
    workspaceId: string;
  }): Promise<LoadJobForNormalizationResult>;
  loadJobMatchContext(input: {
    campaignId?: string;
    jobId: string;
    normalizedRevision: number;
    workspaceId: string;
  }): Promise<LoadJobMatchContextResult>;
  loadMatchAnalysisContext(input: {
    inputHash: string;
    matchId: string;
    workspaceId: string;
  }): Promise<LoadMatchAnalysisContextResult>;
}

export function createDatabasePipelineRepository(database: Database): PipelineRepository {
  return {
    commitJobMatches: (input) => commitJobMatches(database, input),
    commitJobNormalization: (input) => commitJobNormalization(database, input),
    commitMatchAnalysis: (input) => commitMatchAnalysis(database, input),
    loadJobForNormalization: (input) => loadJobForNormalization(database, input),
    loadJobMatchContext: (input) => loadJobMatchContext(database, input),
    loadMatchAnalysisContext: (input) => loadMatchAnalysisContext(database, input),
  };
}

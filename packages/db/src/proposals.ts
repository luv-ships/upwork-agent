import {
  createInputHash,
  EMBEDDING_DIMENSIONS,
  proposalDraftSchema,
  proposalGenerationInputHash,
  proposalGenerationInputSchema,
  normalizeSourceJob,
  type NormalizedJob,
  type ProposalDraft,
  type ProposalGenerationInput,
} from "@upwork-agent/core";
import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "./database.js";
import {
  aiScores,
  analyticsEvents,
  campaignJobMatches,
  campaigns,
  jobs,
  knowledgeChunks,
  knowledgeDocuments,
  proposals,
  proposalVersions,
  workspaces,
  workflowTasks,
} from "./schema.js";

const uuidSchema = z.uuid();
const hashSchema = z.string().regex(/^[0-9a-f]{64}$/);

function chunkContent(content: string): string[] {
  const paragraphs = content
    .split(/\n\s*\n/u)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  const chunks: string[] = [];
  for (const paragraph of paragraphs.length > 0 ? paragraphs : [content.trim()]) {
    for (let offset = 0; offset < paragraph.length; offset += 1_200) {
      const chunk = paragraph.slice(offset, offset + 1_200).trim();
      if (chunk.length > 0) chunks.push(chunk);
    }
  }
  return chunks.slice(0, 200);
}

function tokenSet(value: string): Set<string> {
  return new Set(value.toLocaleLowerCase("en-US").match(/[a-z0-9]{3,}/gu) ?? []);
}

function rowToNormalizedJob(row: typeof jobs.$inferSelect): NormalizedJob {
  return normalizeSourceJob({
    sourceJobId: row.sourceJobId,
    title: z.string().min(1).parse(row.title),
    description: z.string().min(1).parse(row.description),
    skills: row.skills ?? [],
    categoryIds: row.categoryIds ?? [],
    experienceLevel: row.experienceLevel ?? undefined,
    jobType: z.enum(["hourly", "fixed"]).parse(row.jobType),
    ...(row.hourlyRateMin === null && row.hourlyRateMax === null
      ? {}
      : {
          hourlyRate: {
            currency: "USD",
            ...(row.hourlyRateMin === null ? {} : { min: Number(row.hourlyRateMin) }),
            ...(row.hourlyRateMax === null ? {} : { max: Number(row.hourlyRateMax) }),
          },
        }),
    ...(row.fixedBudgetMin === null && row.fixedBudgetMax === null
      ? {}
      : {
          fixedBudget: {
            currency: "USD",
            ...(row.fixedBudgetMin === null ? {} : { min: Number(row.fixedBudgetMin) }),
            ...(row.fixedBudgetMax === null ? {} : { max: Number(row.fixedBudgetMax) }),
          },
        }),
    proposalCount: row.proposalCount ?? undefined,
    paymentVerified: row.paymentVerified ?? undefined,
    client: {
      ...(row.clientCountryCode === null ? {} : { countryCode: row.clientCountryCode }),
      ...(row.clientTimeZone === null ? {} : { timeZone: row.clientTimeZone }),
      ...(row.clientHireCount === null ? {} : { hireCount: row.clientHireCount }),
      ...(row.clientHireRatePercent === null ? {} : { hireRatePercent: row.clientHireRatePercent }),
    },
    postedAt: row.postedAt?.toISOString(),
    projectLengthBand: row.projectLengthBand ?? undefined,
    hoursPerWeekBand: row.hoursPerWeekBand ?? undefined,
    isContractToHire: row.isContractToHire ?? undefined,
  });
}

export type CreateKnowledgeDocumentResult = {
  readonly documentId: string;
  readonly created: boolean;
};

export type KnowledgeDocumentView = {
  readonly id: string;
  readonly title: string;
  readonly status: "pending" | "ready" | "failed";
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

export async function createKnowledgeDocument(
  database: Database,
  input: { readonly ownerUserId: string; readonly title: string; readonly content: string },
): Promise<CreateKnowledgeDocumentResult> {
  const ownerUserId = uuidSchema.parse(input.ownerUserId);
  const title = z.string().trim().min(1).max(200).parse(input.title);
  const content = z.string().trim().min(1).max(200_000).parse(input.content);
  const hash = createInputHash({ content });
  return database.transaction(async (transaction) => {
    const workspaceRows = await transaction
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.ownerUserId, ownerUserId))
      .limit(1);
    const workspace = workspaceRows[0];
    if (workspace === undefined) throw new Error("Workspace not found");
    const inserted = await transaction
      .insert(knowledgeDocuments)
      .values({ workspaceId: workspace.id, title, content, contentHash: hash })
      .onConflictDoNothing({ target: [knowledgeDocuments.workspaceId, knowledgeDocuments.contentHash] })
      .returning({ id: knowledgeDocuments.id });
    const documentId = inserted[0]?.id;
    if (documentId === undefined) {
      const existing = await transaction
        .select({ id: knowledgeDocuments.id })
        .from(knowledgeDocuments)
        .where(and(eq(knowledgeDocuments.workspaceId, workspace.id), eq(knowledgeDocuments.contentHash, hash)))
        .limit(1);
      const existingId = existing[0]?.id;
      if (existingId === undefined) throw new Error("Knowledge document conflict could not be reloaded");
      return { documentId: existingId, created: false };
    }
    await transaction.insert(workflowTasks).values({
      workspaceId: workspace.id,
      kind: "index-knowledge-doc",
      payload: { documentId, contentHash: hash },
      dedupeKey: `index-knowledge-doc:${workspace.id}:${documentId}:${hash}`,
    });
    return { documentId, created: true };
  });
}

export async function listKnowledgeDocuments(
  database: Database,
  input: { readonly ownerUserId: string },
): Promise<KnowledgeDocumentView[]> {
  const ownerUserId = uuidSchema.parse(input.ownerUserId);
  const rows = await database
    .select({ document: knowledgeDocuments })
    .from(knowledgeDocuments)
    .innerJoin(workspaces, and(eq(workspaces.id, knowledgeDocuments.workspaceId), eq(workspaces.ownerUserId, ownerUserId)))
    .where(eq(knowledgeDocuments.workspaceId, workspaces.id))
    .orderBy(desc(knowledgeDocuments.updatedAt));
  return rows.map(({ document }) => ({
    id: document.id,
    title: document.title,
    status: document.status,
    createdAt: document.createdAt,
    updatedAt: document.updatedAt,
  }));
}

export type LoadKnowledgeIndexContextResult =
  | { readonly status: "skip" }
  | { readonly status: "ready"; readonly documentId: string; readonly workspaceId: string; readonly contentHash: string; readonly content: string; readonly chunks: string[] };

export async function loadKnowledgeIndexContext(
  database: Database,
  input: { readonly workspaceId: string; readonly documentId: string; readonly contentHash: string },
): Promise<LoadKnowledgeIndexContextResult> {
  const workspaceId = uuidSchema.parse(input.workspaceId);
  const documentId = uuidSchema.parse(input.documentId);
  const contentHash = hashSchema.parse(input.contentHash);
  const rows = await database
    .select({ document: knowledgeDocuments })
    .from(knowledgeDocuments)
    .where(and(eq(knowledgeDocuments.id, documentId), eq(knowledgeDocuments.workspaceId, workspaceId), eq(knowledgeDocuments.contentHash, contentHash)))
    .limit(1);
  const row = rows[0]?.document;
  if (row === undefined || (row.status === "ready" && row.contentHash === contentHash)) return { status: "skip" };
  return { status: "ready", documentId, workspaceId, contentHash, content: row.content, chunks: chunkContent(row.content) };
}

export async function commitKnowledgeIndex(
  database: Database,
  input: { readonly workspaceId: string; readonly documentId: string; readonly contentHash: string; readonly embeddings?: readonly number[][]; readonly embeddingModel?: string },
): Promise<{ readonly status: "committed" | "skip"; readonly chunkCount: number }> {
  const workspaceId = uuidSchema.parse(input.workspaceId);
  const documentId = uuidSchema.parse(input.documentId);
  const contentHash = hashSchema.parse(input.contentHash);
  const embeddings = input.embeddings === undefined
    ? undefined
    : z.array(z.array(z.number().finite()).length(EMBEDDING_DIMENSIONS)).max(200).parse(input.embeddings);
  const embeddingModel = input.embeddingModel === undefined
    ? undefined
    : z.string().trim().min(1).max(200).parse(input.embeddingModel);
  return database.transaction(async (transaction) => {
    const rows = await transaction
      .select({ document: knowledgeDocuments })
      .from(knowledgeDocuments)
      .where(and(eq(knowledgeDocuments.id, documentId), eq(knowledgeDocuments.workspaceId, workspaceId), eq(knowledgeDocuments.contentHash, contentHash)))
      .for("update")
      .limit(1);
    const document = rows[0]?.document;
    if (document === undefined) return { status: "skip", chunkCount: 0 };
    if (document.status === "ready") return { status: "skip", chunkCount: 0 };
    await transaction.delete(knowledgeChunks).where(and(eq(knowledgeChunks.workspaceId, workspaceId), eq(knowledgeChunks.documentId, documentId)));
    const chunks = chunkContent(document.content);
    if (chunks.length === 0) throw new Error("Knowledge document contains no indexable text");
    if (embeddings !== undefined && (embeddings.length !== chunks.length || embeddingModel === undefined)) {
      throw new Error("Knowledge embeddings must align with every indexed chunk and include a model");
    }
    await transaction.insert(knowledgeChunks).values(
      chunks.map((content, ordinal) => ({
        workspaceId,
        documentId,
        ordinal,
        content,
        contentHash: createInputHash({ documentId, ordinal, content }),
        ...(embeddings === undefined ? {} : { embedding: embeddings[ordinal], embeddingModel }),
      })),
    );
    await transaction.update(knowledgeDocuments).set({ status: "ready", failureCode: null, updatedAt: new Date() }).where(eq(knowledgeDocuments.id, documentId));
    return { status: "committed", chunkCount: chunks.length };
  });
}

export async function failKnowledgeIndex(
  database: Database,
  input: { readonly workspaceId: string; readonly documentId: string; readonly failureCode: string },
): Promise<boolean> {
  const workspaceId = uuidSchema.parse(input.workspaceId);
  const documentId = uuidSchema.parse(input.documentId);
  const failureCode = z.string().trim().regex(/^[a-z0-9_.-]{1,80}$/).parse(input.failureCode);
  const rows = await database.update(knowledgeDocuments)
    .set({ status: "failed", failureCode, updatedAt: new Date() })
    .where(and(eq(knowledgeDocuments.id, documentId), eq(knowledgeDocuments.workspaceId, workspaceId)))
    .returning({ id: knowledgeDocuments.id });
  return rows.length > 0;
}

export type ProposalGenerationContextResult =
  | { readonly status: "skip" }
  | { readonly status: "ready"; readonly workspaceId: string; readonly matchId: string; readonly generationInputHash: string; readonly input: ProposalGenerationInput };

export type ProposalGenerationQueryResult =
  | { readonly status: "skip" }
  | { readonly status: "ready"; readonly text: string };

export async function loadProposalGenerationQuery(
  database: Database,
  input: { readonly workspaceId: string; readonly matchId: string },
): Promise<ProposalGenerationQueryResult> {
  const workspaceId = uuidSchema.parse(input.workspaceId);
  const matchId = uuidSchema.parse(input.matchId);
  const rows = await database
    .select({ job: jobs })
    .from(campaignJobMatches)
    .innerJoin(jobs, and(eq(jobs.id, campaignJobMatches.jobId), eq(jobs.workspaceId, workspaceId)))
    .innerJoin(aiScores, and(eq(aiScores.matchId, matchId), eq(aiScores.workspaceId, workspaceId), eq(aiScores.inputHash, campaignJobMatches.analysisInputHash)))
    .where(and(
      eq(campaignJobMatches.id, matchId),
      eq(campaignJobMatches.workspaceId, workspaceId),
      inArray(campaignJobMatches.pipelineStatus, ["proposal_queued", "generating_proposal"]),
      eq(jobs.status, "ready"),
    ))
    .limit(1);
  const row = rows[0]?.job;
  if (row === undefined) return { status: "skip" };
  return {
    status: "ready",
    text: `${row.title ?? ""}\n${row.description ?? ""}\n${(row.skills ?? []).join(" ")}`,
  };
}

export async function loadProposalGenerationContext(
  database: Database,
  input: { readonly workspaceId: string; readonly matchId: string; readonly generationKey: string; readonly queryEmbedding?: readonly number[] },
): Promise<ProposalGenerationContextResult> {
  const workspaceId = uuidSchema.parse(input.workspaceId);
  const matchId = uuidSchema.parse(input.matchId);
  hashSchema.parse(input.generationKey);
  const queryEmbedding = input.queryEmbedding === undefined
    ? undefined
    : z.array(z.number().finite()).length(EMBEDDING_DIMENSIONS).parse(input.queryEmbedding);
  const rows = await database
    .select({ match: campaignJobMatches, campaign: campaigns, job: jobs, score: aiScores })
    .from(campaignJobMatches)
    .innerJoin(campaigns, and(eq(campaigns.id, campaignJobMatches.campaignId), eq(campaigns.workspaceId, workspaceId)))
    .innerJoin(jobs, and(eq(jobs.id, campaignJobMatches.jobId), eq(jobs.workspaceId, workspaceId)))
    .innerJoin(aiScores, and(
      eq(aiScores.matchId, matchId),
      eq(aiScores.workspaceId, workspaceId),
      eq(aiScores.inputHash, campaignJobMatches.analysisInputHash),
    ))
    .where(and(eq(campaignJobMatches.id, matchId), eq(campaignJobMatches.workspaceId, workspaceId), inArray(campaignJobMatches.pipelineStatus, ["proposal_queued", "generating_proposal"]), eq(jobs.status, "ready")))
    .limit(1);
  const row = rows[0];
  if (row === undefined) return { status: "skip" };

  const vectorChunks = queryEmbedding === undefined
    ? []
    : await database
      .select({ id: knowledgeChunks.id, title: knowledgeDocuments.title, content: knowledgeChunks.content, ordinal: knowledgeChunks.ordinal })
      .from(knowledgeChunks)
      .innerJoin(knowledgeDocuments, and(eq(knowledgeDocuments.id, knowledgeChunks.documentId), eq(knowledgeDocuments.workspaceId, workspaceId)))
      .where(and(eq(knowledgeChunks.workspaceId, workspaceId), eq(knowledgeDocuments.status, "ready"), isNotNull(knowledgeChunks.embedding)))
      .orderBy(sql`${knowledgeChunks.embedding} <=> ${JSON.stringify(queryEmbedding)}::vector`)
      .limit(8);
  const chunks = vectorChunks.length > 0
    ? vectorChunks
    : await database
      .select({ id: knowledgeChunks.id, title: knowledgeDocuments.title, content: knowledgeChunks.content, ordinal: knowledgeChunks.ordinal })
      .from(knowledgeChunks)
      .innerJoin(knowledgeDocuments, and(eq(knowledgeDocuments.id, knowledgeChunks.documentId), eq(knowledgeDocuments.workspaceId, workspaceId)))
      .where(and(eq(knowledgeChunks.workspaceId, workspaceId), eq(knowledgeDocuments.status, "ready")))
      .orderBy(asc(knowledgeChunks.ordinal))
      .limit(200);
  const jobTokens = tokenSet(`${row.job.title ?? ""} ${row.job.description ?? ""} ${(row.job.skills ?? []).join(" ")}`);
  const rankedChunks = vectorChunks.length > 0
    ? vectorChunks.map((chunk) => ({ id: chunk.id, title: chunk.title, content: chunk.content }))
    : chunks
      .map((chunk) => ({ chunk, score: [...tokenSet(chunk.content)].filter((token) => jobTokens.has(token)).length }))
      .sort((left, right) => right.score - left.score || left.chunk.ordinal - right.chunk.ordinal)
      .slice(0, 8)
      .map(({ chunk }) => ({ id: chunk.id, title: chunk.title, content: chunk.content }));
  const proposalInput = proposalGenerationInputSchema.parse({
    job: rowToNormalizedJob(row.job),
    campaignName: row.campaign.name,
    aiInstructions: row.match.aiInstructionsSnapshot,
    suitability: {
      score: row.score.score,
      recommendation: row.score.recommendation,
      reasons: row.score.reasons,
      risks: row.score.risks,
      estimatedWinProbability: Number(row.score.estimatedWinProbability),
      pricingDirection: row.score.pricingDirection,
      ...(row.score.suggestedBidAmount === null ? {} : { suggestedBidAmount: Number(row.score.suggestedBidAmount) }),
      ...(row.score.suggestedBidCurrency === null ? {} : { suggestedBidCurrency: row.score.suggestedBidCurrency }),
    },
    knowledgeChunks: rankedChunks,
    generationNonce: input.generationKey,
  });
  await database.update(campaignJobMatches).set({ pipelineStatus: "generating_proposal", updatedAt: new Date() }).where(and(eq(campaignJobMatches.id, matchId), eq(campaignJobMatches.workspaceId, workspaceId), eq(campaignJobMatches.pipelineStatus, "proposal_queued")));
  return {
    status: "ready",
    workspaceId,
    matchId,
    generationInputHash: proposalGenerationInputHash(proposalInput),
    input: proposalInput,
  };
}

export type CommitProposalGenerationResult =
  | { readonly status: "skip" }
  | { readonly status: "committed"; readonly proposalId: string; readonly versionId: string; readonly version: number };

export async function commitProposalGeneration(
  database: Database,
  input: { readonly workspaceId: string; readonly matchId: string; readonly generationInputHash: string; readonly draft: ProposalDraft; readonly provider: string; readonly model: string; readonly promptVersion: string },
): Promise<CommitProposalGenerationResult> {
  const workspaceId = uuidSchema.parse(input.workspaceId);
  const matchId = uuidSchema.parse(input.matchId);
  const generationInputHash = hashSchema.parse(input.generationInputHash);
  const draft = proposalDraftSchema.parse(input.draft);
  const provider = z.string().trim().min(1).max(100).parse(input.provider);
  const model = z.string().trim().min(1).max(200).parse(input.model);
  const promptVersion = z.string().trim().min(1).max(100).parse(input.promptVersion);
  const sourceChunkIds = new Set(draft.sourceChunkIds);
  return database.transaction(async (transaction) => {
    const matchRows = await transaction.select().from(campaignJobMatches).where(and(eq(campaignJobMatches.id, matchId), eq(campaignJobMatches.workspaceId, workspaceId))).for("update").limit(1);
    const match = matchRows[0];
    if (match === undefined) return { status: "skip" };
    const existingProposalRows = await transaction.select().from(proposals).where(and(eq(proposals.matchId, matchId), eq(proposals.workspaceId, workspaceId))).limit(1);
    let proposal = existingProposalRows[0];
    if (proposal === undefined) {
      const inserted = await transaction.insert(proposals).values({ workspaceId, matchId, status: "generating", currentVersion: 0 }).returning();
      proposal = inserted[0];
    }
    if (proposal === undefined) return { status: "skip" };
    if (sourceChunkIds.size > 0) {
      const sourceRows = await transaction
        .select({ id: knowledgeChunks.id })
        .from(knowledgeChunks)
        .innerJoin(knowledgeDocuments, and(eq(knowledgeDocuments.id, knowledgeChunks.documentId), eq(knowledgeDocuments.workspaceId, workspaceId)))
        .where(and(eq(knowledgeChunks.workspaceId, workspaceId), eq(knowledgeDocuments.status, "ready"), inArray(knowledgeChunks.id, [...sourceChunkIds])));
      if (sourceRows.length !== sourceChunkIds.size) throw new Error("Proposal cites knowledge outside its workspace");
    }
    const existingVersion = await transaction.select().from(proposalVersions).where(and(eq(proposalVersions.proposalId, proposal.id), eq(proposalVersions.generationInputHash, generationInputHash))).limit(1);
    const already = existingVersion[0];
    if (already !== undefined) {
      await transaction.update(campaignJobMatches).set({ pipelineStatus: "ready_for_review", updatedAt: new Date() }).where(eq(campaignJobMatches.id, matchId));
      return { status: "committed", proposalId: proposal.id, versionId: already.id, version: already.version };
    }
    const version = proposal.currentVersion + 1;
    const versions = await transaction.insert(proposalVersions).values({
      workspaceId,
      proposalId: proposal.id,
      version,
      body: draft.body,
      sourceChunkIds: draft.sourceChunkIds,
      generationInputHash,
      provider,
      model,
      promptVersion,
      suggestedBidAmount: draft.suggestedBidAmount === undefined ? null : String(draft.suggestedBidAmount),
      suggestedBidCurrency: draft.suggestedBidCurrency ?? null,
    }).returning({ id: proposalVersions.id });
    const versionId = versions[0]?.id;
    if (versionId === undefined) throw new Error("Proposal version insert did not return an id");
    await transaction.update(proposals).set({ status: "ready_for_review", currentVersion: version, updatedAt: new Date() }).where(eq(proposals.id, proposal.id));
    await transaction.update(campaignJobMatches).set({ pipelineStatus: "ready_for_review", updatedAt: new Date() }).where(eq(campaignJobMatches.id, matchId));
    await transaction.insert(analyticsEvents).values({ workspaceId, eventName: "proposal.generated", subjectType: "proposal", subjectId: proposal.id, properties: { version }, dedupeKey: `proposal-generated:${proposal.id}:${generationInputHash}` }).onConflictDoNothing();
    return { status: "committed", proposalId: proposal.id, versionId, version };
  });
}

export async function failProposalGeneration(
  database: Database,
  input: { readonly workspaceId: string; readonly matchId: string; readonly failureCode: string },
): Promise<boolean> {
  const workspaceId = uuidSchema.parse(input.workspaceId);
  const matchId = uuidSchema.parse(input.matchId);
  const failureCode = z.string().trim().regex(/^[a-z0-9_.-]{1,80}$/).parse(input.failureCode);
  return database.transaction(async (transaction) => {
    const matchRows = await transaction.select({ pipelineStatus: campaignJobMatches.pipelineStatus })
      .from(campaignJobMatches)
      .where(and(eq(campaignJobMatches.workspaceId, workspaceId), eq(campaignJobMatches.id, matchId)))
      .for("update")
      .limit(1);
    const match = matchRows[0];
    if (match === undefined) return false;
    if (match.pipelineStatus !== "proposal_queued" && match.pipelineStatus !== "generating_proposal") return true;
    const proposalRows = await transaction.select({ id: proposals.id })
      .from(proposals)
      .where(and(eq(proposals.workspaceId, workspaceId), eq(proposals.matchId, matchId)))
      .for("update")
      .limit(1);
    let proposal = proposalRows[0];
    if (proposal === undefined) {
      const inserted = await transaction.insert(proposals)
        .values({ workspaceId, matchId, status: "failed", currentVersion: 0, failureCode })
        .onConflictDoNothing({ target: [proposals.workspaceId, proposals.matchId] })
        .returning({ id: proposals.id });
      proposal = inserted[0];
      if (proposal === undefined) {
        const reloaded = await transaction.select({ id: proposals.id })
          .from(proposals)
          .where(and(eq(proposals.workspaceId, workspaceId), eq(proposals.matchId, matchId)))
          .limit(1);
        proposal = reloaded[0];
      }
    }
    if (proposal === undefined) return false;
    await transaction.update(proposals)
      .set({ status: "failed", failureCode, updatedAt: new Date() })
      .where(eq(proposals.id, proposal.id));
    await transaction.update(campaignJobMatches)
      .set({ pipelineStatus: "failed", failedStep: "generate-proposal", failureCode, updatedAt: new Date() })
      .where(and(eq(campaignJobMatches.id, matchId), eq(campaignJobMatches.workspaceId, workspaceId)));
    return true;
  });
}

export type ProposalQueueView = {
  readonly proposal: {
    readonly id: string;
    readonly status: "queued" | "generating" | "ready_for_review" | "approved" | "rejected" | "failed";
    readonly currentVersion: number;
    readonly createdAt: Date;
    readonly updatedAt: Date;
  };
  readonly version: {
    readonly id: string;
    readonly version: number;
    readonly body: string;
    readonly sourceChunkIds: string[];
    readonly suggestedBidAmount: number | null;
    readonly suggestedBidCurrency: string | null;
    readonly createdAt: Date;
  } | null;
  readonly campaignName: string;
  readonly jobTitle: string | null;
  readonly jobDescription: string | null;
  readonly matchId: string;
};

export async function listProposalQueueViews(
  database: Database,
  input: { readonly ownerUserId: string },
): Promise<ProposalQueueView[]> {
  const ownerUserId = uuidSchema.parse(input.ownerUserId);
  const rows = await database
    .select({ proposal: proposals, version: proposalVersions, campaign: campaigns, match: campaignJobMatches, job: jobs })
    .from(proposals)
    .innerJoin(workspaces, and(eq(workspaces.id, proposals.workspaceId), eq(workspaces.ownerUserId, ownerUserId)))
    .innerJoin(campaignJobMatches, and(eq(campaignJobMatches.id, proposals.matchId), eq(campaignJobMatches.workspaceId, proposals.workspaceId)))
    .innerJoin(campaigns, and(eq(campaigns.id, campaignJobMatches.campaignId), eq(campaigns.workspaceId, proposals.workspaceId)))
    .innerJoin(jobs, and(eq(jobs.id, campaignJobMatches.jobId), eq(jobs.workspaceId, proposals.workspaceId)))
    .leftJoin(proposalVersions, and(eq(proposalVersions.proposalId, proposals.id), eq(proposalVersions.workspaceId, proposals.workspaceId)))
    .where(eq(proposals.workspaceId, workspaces.id))
    .orderBy(desc(proposals.updatedAt), desc(proposalVersions.version));
  const views = new Map<string, ProposalQueueView>();
  for (const row of rows) {
    const currentVersion = row.version !== null && row.version.version === row.proposal.currentVersion ? row.version : null;
    const existing = views.get(row.proposal.id);
    if (existing !== undefined) {
      continue;
    }
    views.set(row.proposal.id, {
      proposal: {
        id: row.proposal.id,
        status: row.proposal.status,
        currentVersion: row.proposal.currentVersion,
        createdAt: row.proposal.createdAt,
        updatedAt: row.proposal.updatedAt,
      },
      version: currentVersion === null ? null : {
        id: currentVersion.id,
        version: currentVersion.version,
        body: currentVersion.body,
        sourceChunkIds: currentVersion.sourceChunkIds,
        suggestedBidAmount: currentVersion.suggestedBidAmount === null ? null : Number(currentVersion.suggestedBidAmount),
        suggestedBidCurrency: currentVersion.suggestedBidCurrency,
        createdAt: currentVersion.createdAt,
      },
      campaignName: row.campaign.name,
      jobTitle: row.job.title,
      jobDescription: row.job.description,
      matchId: row.match.id,
    });
  }
  return [...views.values()];
}

export async function reviewProposal(
  database: Database,
  input: { readonly ownerUserId: string; readonly proposalId: string; readonly status: "approved" | "rejected" },
): Promise<boolean> {
  const ownerUserId = uuidSchema.parse(input.ownerUserId);
  const proposalId = uuidSchema.parse(input.proposalId);
  const status = z.enum(["approved", "rejected"]).parse(input.status);
  return database.transaction(async (transaction) => {
    const rows = await transaction
      .select({ proposal: proposals, workspaceId: workspaces.id })
      .from(proposals)
      .innerJoin(workspaces, and(eq(workspaces.id, proposals.workspaceId), eq(workspaces.ownerUserId, ownerUserId)))
      .where(eq(proposals.id, proposalId))
      .for("update")
      .limit(1);
    const row = rows[0];
    if (row === undefined) return false;
    if (row.proposal.status === status) return true;
    if (row.proposal.status !== "ready_for_review") return false;
    await transaction.update(proposals).set({ status, updatedAt: new Date() }).where(eq(proposals.id, proposalId));
    await transaction.insert(analyticsEvents).values({
      workspaceId: row.workspaceId,
      eventName: `proposal.${status}`,
      subjectType: "proposal",
      subjectId: proposalId,
      properties: {},
      dedupeKey: `proposal-${status}:${proposalId}:${row.proposal.currentVersion}`,
    }).onConflictDoNothing();
    return true;
  });
}

export async function regenerateProposal(
  database: Database,
  input: { readonly ownerUserId: string; readonly proposalId: string },
): Promise<boolean> {
  const ownerUserId = uuidSchema.parse(input.ownerUserId);
  const proposalId = uuidSchema.parse(input.proposalId);
  return database.transaction(async (transaction) => {
    const rows = await transaction
      .select({ proposal: proposals, workspaceId: workspaces.id })
      .from(proposals)
      .innerJoin(workspaces, and(eq(workspaces.id, proposals.workspaceId), eq(workspaces.ownerUserId, ownerUserId)))
      .where(eq(proposals.id, proposalId))
      .for("update")
      .limit(1);
    const row = rows[0];
    if (row === undefined) return false;
    const generationKey = createInputHash({ proposalId, requestedAt: new Date().toISOString() });
    await transaction.update(proposals).set({ status: "queued", updatedAt: new Date() }).where(eq(proposals.id, proposalId));
    await transaction.update(campaignJobMatches).set({ pipelineStatus: "proposal_queued", updatedAt: new Date() }).where(and(eq(campaignJobMatches.id, row.proposal.matchId), eq(campaignJobMatches.workspaceId, row.workspaceId)));
    await transaction.insert(workflowTasks).values({
      workspaceId: row.workspaceId,
      kind: "generate-proposal",
      payload: { matchId: row.proposal.matchId, generationKey },
      dedupeKey: `generate-proposal:${row.workspaceId}:${row.proposal.matchId}:${generationKey}`,
    }).onConflictDoNothing({ target: [workflowTasks.kind, workflowTasks.dedupeKey] });
    return true;
  });
}

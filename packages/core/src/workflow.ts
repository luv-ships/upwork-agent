import { z } from "zod";

const normalizeJobTaskPayloadSchema = z.object({
  jobId: z.uuid(),
  sourcePayloadHash: z.string().regex(/^[0-9a-f]{64}$/)
});

const matchJobTaskPayloadSchema = z.object({
  jobId: z.uuid(),
  normalizedRevision: z.number().int().positive(),
  /** Set for a newly observed MCP job; omitted for development/workspace jobs. */
  campaignId: z.uuid().optional()
});

const analyzeMatchTaskPayloadSchema = z.object({
  matchId: z.uuid(),
  inputHash: z.string().regex(/^[0-9a-f]{64}$/)
});

const pollUpworkMonitorTaskPayloadSchema = z.object({
  monitorId: z.uuid(),
  scheduleVersion: z.number().int().positive(),
  runSequence: z.number().int().positive()
});

const purgeUpworkDataTaskPayloadSchema = z.object({
  connectionId: z.uuid(),
  scheduleVersion: z.number().int().positive(),
  runSequence: z.number().int().positive()
});

const indexKnowledgeDocumentTaskPayloadSchema = z.object({
  documentId: z.uuid(),
  contentHash: z.string().regex(/^[0-9a-f]{64}$/),
});

const generateProposalTaskPayloadSchema = z.object({
  matchId: z.uuid(),
  generationKey: z.string().regex(/^[0-9a-f]{64}$/),
});

export const workflowTaskPayloadSchemas = {
  "normalize-job": normalizeJobTaskPayloadSchema,
  "match-job": matchJobTaskPayloadSchema,
  "analyze-match": analyzeMatchTaskPayloadSchema,
  "poll-upwork-monitor": pollUpworkMonitorTaskPayloadSchema,
  "purge-upwork-data": purgeUpworkDataTaskPayloadSchema,
  "index-knowledge-doc": indexKnowledgeDocumentTaskPayloadSchema,
  "generate-proposal": generateProposalTaskPayloadSchema,
} as const;

export type WorkflowTaskKind = keyof typeof workflowTaskPayloadSchemas;
export type WorkflowTaskPayload<K extends WorkflowTaskKind> = z.infer<
  (typeof workflowTaskPayloadSchemas)[K]
>;

export function parseWorkflowTaskPayload<K extends WorkflowTaskKind>(
  kind: K,
  payload: unknown
): WorkflowTaskPayload<K> {
  return workflowTaskPayloadSchemas[kind].parse(payload) as WorkflowTaskPayload<K>;
}

import { z } from "zod";

const schemaReadinessSchema = z.object({
  embeddings: z.boolean(),
  knowledgeChunks: z.boolean(),
  proposals: z.boolean(),
  upworkConnections: z.boolean(),
  workflowTasks: z.boolean(),
  workspaces: z.boolean(),
});

export function isSchemaReady(value: unknown): boolean {
  const parsed = schemaReadinessSchema.safeParse(value);
  return parsed.success && Object.values(parsed.data).every(Boolean);
}

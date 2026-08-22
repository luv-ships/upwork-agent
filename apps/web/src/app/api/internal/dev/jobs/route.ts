import { createInputHash, developmentJobInputSchema } from "@upwork-agent/core";
import {
  DevelopmentJobPayloadConflictError,
  ingestDevelopmentJob
} from "@upwork-agent/db";

import { getCurrentUser } from "@/server/auth";
import { getDatabase } from "@/server/database";
import { getServerEnvironment } from "@/server/env";
import { apiError, bearerToken, constantTimeEqual } from "@/server/http";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let environment: ReturnType<typeof getServerEnvironment>;
  try {
    environment = getServerEnvironment();
  } catch {
    return apiError(503, "development_ingestion_unavailable");
  }

  if (!environment.DEV_INGESTION_ENABLED || environment.NODE_ENV === "production") {
    return apiError(404, "not_found");
  }

  if (!constantTimeEqual(bearerToken(request), environment.DEV_INGEST_TOKEN)) {
    return apiError(401, "invalid_development_token");
  }

  const user = await getCurrentUser();
  if (!user) return apiError(401, "authentication_required");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError(400, "invalid_json");
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return apiError(400, "invalid_job_payload");
  }

  const { workspaceId, ...jobCandidate } = body as Record<string, unknown>;
  if (typeof workspaceId !== "string") return apiError(400, "invalid_workspace_id");
  const job = developmentJobInputSchema.safeParse(jobCandidate);
  if (!job.success) return apiError(400, "invalid_job_payload");

  let result: Awaited<ReturnType<typeof ingestDevelopmentJob>>;
  try {
    result = await ingestDevelopmentJob(getDatabase(), {
      ownerUserId: user.id,
      workspaceId,
      input: job.data,
      sourcePayloadHash: createInputHash(job.data)
    });
  } catch (error) {
    if (error instanceof DevelopmentJobPayloadConflictError) {
      return apiError(409, "source_job_id_payload_conflict");
    }
    throw error;
  }
  if (result === null) return apiError(404, "workspace_not_found");

  return Response.json(result, { status: 202 });
}

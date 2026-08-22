import { createInputHash, normalizeDevelopmentJob, parseWorkflowTaskPayload } from "@upwork-agent/core";

import type { PipelineRepository } from "../adapters/database-pipeline.js";
import type { ClaimedTask } from "../runtime/worker.js";

export async function handleNormalizeJob(
  repository: PipelineRepository,
  task: ClaimedTask,
): Promise<void> {
  const payload = parseWorkflowTaskPayload("normalize-job", task.payload);
  const context = await repository.loadJobForNormalization({
    jobId: payload.jobId,
    sourcePayloadHash: payload.sourcePayloadHash,
    workspaceId: task.workspaceId,
  });

  if (context.status === "skip") {
    return;
  }

  const normalizedJob = normalizeDevelopmentJob(context.rawPayload);
  await repository.commitJobNormalization({
    jobId: context.jobId,
    normalizedHash: createInputHash(normalizedJob),
    normalizedJob,
    sourcePayloadHash: context.sourcePayloadHash,
    workspaceId: context.workspaceId,
  });
}

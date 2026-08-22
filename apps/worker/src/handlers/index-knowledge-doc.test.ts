import { describe, expect, it, vi } from "vitest";

import type { ClaimedTask } from "../runtime/worker.js";
import type { KnowledgeRepository } from "../adapters/database-proposals.js";
import { handleIndexKnowledgeDocument } from "./index-knowledge-doc.js";

const task: ClaimedTask = {
  attemptCount: 3,
  id: "00000000-0000-4000-8000-000000000031",
  kind: "index-knowledge-doc",
  maxAttempts: 3,
  payload: {
    contentHash: "a".repeat(64),
    documentId: "00000000-0000-4000-8000-000000000041",
  },
  schemaVersion: 1,
  workspaceId: "00000000-0000-4000-8000-000000000011",
};
const documentId = "00000000-0000-4000-8000-000000000041";

describe("handleIndexKnowledgeDocument", () => {
  it("marks a document failed when its final indexing attempt errors", async () => {
    const failKnowledgeIndex = vi.fn<KnowledgeRepository["failKnowledgeIndex"]>().mockResolvedValue(true);
    const repository: KnowledgeRepository = {
      commitKnowledgeIndex: vi.fn().mockRejectedValue(new Error("index failed")),
      failKnowledgeIndex,
      loadKnowledgeIndexContext: vi.fn().mockResolvedValue({
        content: "case study",
        chunks: ["case study"],
        contentHash: "a".repeat(64),
        documentId,
        status: "ready",
        workspaceId: task.workspaceId,
      }),
    };

    await expect(handleIndexKnowledgeDocument(repository, undefined, task)).rejects.toThrow("index failed");
    expect(failKnowledgeIndex).toHaveBeenCalledWith({
      documentId,
      failureCode: "knowledge_index_failed",
      workspaceId: task.workspaceId,
    });
  });
});

import { describe, expect, it } from "vitest";

import { isSchemaReady } from "./health";

const ready = {
  embeddings: true,
  knowledgeChunks: true,
  proposals: true,
  upworkConnections: true,
  workflowTasks: true,
  workspaces: true,
};

describe("isSchemaReady", () => {
  it("accepts the complete launch schema", () => {
    expect(isSchemaReady(ready)).toBe(true);
  });

  it("rejects incomplete or malformed schema probes", () => {
    expect(isSchemaReady({ ...ready, embeddings: false })).toBe(false);
    expect(isSchemaReady({ ...ready, proposals: "yes" })).toBe(false);
    expect(isSchemaReady(null)).toBe(false);
  });
});

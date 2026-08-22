import { describe, expect, it } from "vitest";

import { EMBEDDING_DIMENSIONS, FakeEmbeddingProvider } from "./embedding.js";

describe("FakeEmbeddingProvider", () => {
  it("returns deterministic normalized vectors without a network call", async () => {
    const provider = new FakeEmbeddingProvider();
    const first = await provider.embed({ texts: ["Make.com OpenAI automation"] });
    const second = await provider.embed({ texts: ["Make.com OpenAI automation"] });
    expect(first).toEqual(second);
    expect(first.vectors[0]).toHaveLength(EMBEDDING_DIMENSIONS);
    expect(Math.sqrt(first.vectors[0]?.reduce((sum, value) => sum + value * value, 0) ?? 0)).toBeCloseTo(1);
  });
});

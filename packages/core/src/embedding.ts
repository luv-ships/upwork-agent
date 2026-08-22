import { z } from "zod";

export const EMBEDDING_DIMENSIONS = 1_536;

const embeddingTextSchema = z.string().trim().min(1).max(20_000);
const embeddingVectorSchema = z.array(z.number().finite()).length(EMBEDDING_DIMENSIONS);

export const embeddingInputSchema = z.object({
  texts: z.array(embeddingTextSchema).min(1).max(200),
});

export const embeddingResultSchema = z.object({
  vectors: z.array(embeddingVectorSchema).min(1).max(200),
});

export type EmbeddingInput = z.infer<typeof embeddingInputSchema>;
export type EmbeddingResult = z.infer<typeof embeddingResultSchema>;

export interface EmbeddingProvider {
  readonly model: string;
  embed(input: EmbeddingInput): Promise<EmbeddingResult>;
}

function tokenHash(value: string): number {
  let hash = 2_166_136_261;
  for (const character of value) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function fakeVector(text: string): number[] {
  const vector = Array<number>(EMBEDDING_DIMENSIONS).fill(0);
  const tokens = text.toLocaleLowerCase("en-US").match(/[a-z0-9]{2,}/gu) ?? [];
  for (const token of tokens) {
    const hash = tokenHash(token);
    const index = hash % EMBEDDING_DIMENSIONS;
    vector[index] = (vector[index] ?? 0) + ((hash & 1) === 0 ? 1 : -1);
  }
  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (magnitude === 0) return vector;
  return vector.map((value) => value / magnitude);
}

export class FakeEmbeddingProvider implements EmbeddingProvider {
  public readonly model = "fake-embedding-v1";

  public async embed(inputValue: EmbeddingInput): Promise<EmbeddingResult> {
    const input = embeddingInputSchema.parse(inputValue);
    return embeddingResultSchema.parse({ vectors: input.texts.map(fakeVector) });
  }
}

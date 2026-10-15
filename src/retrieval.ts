import type { SourceRegion } from './source.js';

export const DEFAULT_MODEL = 'Xenova/all-MiniLM-L6-v2';

export interface Embedder {
  embed(texts: readonly string[]): Promise<number[][]>;
}

export interface SearchCandidate extends SourceRegion {
  score: number;
}

export interface CandidateDisplaySelection {
  candidates: SearchCandidate[];
  withheldCount: number;
}

/**
 * Keeps only candidates with positive vector alignment. This is a display floor,
 * not a relevance or confidence threshold: every retained candidate is unverified.
 */
export function selectDisplayCandidates(
  candidates: readonly SearchCandidate[],
): CandidateDisplaySelection {
  const displayed = candidates.filter(candidate => candidate.score > 0);
  return { candidates: displayed, withheldCount: candidates.length - displayed.length };
}

export async function retrieveCandidates(
  query: string,
  regions: readonly SourceRegion[],
  embedder: Embedder,
  limit = 5,
): Promise<SearchCandidate[]> {
  if (regions.length === 0) return [];
  const vectors = await embedder.embed([query, ...regions.map(regionEmbeddingText)]);
  const queryVector = vectors[0];
  if (queryVector === undefined || vectors.length !== regions.length + 1) {
    throw new Error('Embedding runtime returned an unexpected number of vectors.');
  }

  return regions
    .map((region, index) => {
      const vector = vectors[index + 1];
      if (vector === undefined) throw new Error('Embedding runtime omitted a source vector.');
      return { ...region, score: cosineSimilarity(queryVector, vector) };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}

export function cosineSimilarity(left: readonly number[], right: readonly number[]): number {
  if (left.length === 0 || left.length !== right.length) {
    throw new Error('Embedding vectors must have the same non-zero length.');
  }
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index];
    const rightValue = right[index];
    if (leftValue === undefined || rightValue === undefined) throw new Error('Invalid embedding vector.');
    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }
  if (leftMagnitude === 0 || rightMagnitude === 0) return 0;
  return dot / Math.sqrt(leftMagnitude * rightMagnitude);
}

export async function createLocalEmbedder(): Promise<Embedder> {
  const { pipeline } = await import('@huggingface/transformers');
  const extractor = await pipeline('feature-extraction', DEFAULT_MODEL, { dtype: 'q8' });

  return {
    async embed(texts: readonly string[]): Promise<number[][]> {
      const output: number[][] = [];
      for (let start = 0; start < texts.length; start += 16) {
        const batch = texts.slice(start, start + 16);
        const tensor = await extractor([...batch], { pooling: 'mean', normalize: true });
        const values: unknown = tensor.tolist();
        if (!isNumberMatrix(values)) throw new Error('Embedding runtime returned invalid vectors.');
        output.push(...values);
      }
      return output;
    },
  };
}

function regionEmbeddingText(region: SourceRegion): string {
  return `File: ${region.filePath}\n${region.text}`;
}

function isNumberMatrix(value: unknown): value is number[][] {
  return Array.isArray(value) && value.every(
    (row) => Array.isArray(row) && row.every((item) => typeof item === 'number'),
  );
}

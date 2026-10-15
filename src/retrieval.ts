import type { SourceRegion } from './source.js';

export const DEFAULT_MODEL = 'Xenova/all-MiniLM-L6-v2';

export interface Embedder {
  embed(texts: readonly string[]): Promise<number[][]>;
}

export interface EmbeddingCacheStats {
  hits: number;
  misses: number;
  entries: number;
}

/**
 * A process-local LRU cache keyed by the exact text passed to the embedding
 * model. Exact keys deliberately include the region path prefix, so renamed
 * regions are re-embedded while unchanged regions retain their vectors.
 */
export class CachingEmbedder implements Embedder {
  private readonly entries = new Map<string, Promise<number[]>>();
  private hits = 0;
  private misses = 0;

  constructor(private readonly delegate: Embedder, private readonly maxEntries = 2_000) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new Error('Embedding cache size must be a positive integer.');
    }
  }

  async embed(texts: readonly string[]): Promise<number[][]> {
    const pending = new Map<string, DeferredVector>();
    const vectors = texts.map((text) => {
      const cached = this.entries.get(text);
      if (cached !== undefined) {
        this.hits += 1;
        this.touch(text, cached);
        return cached;
      }

      this.misses += 1;
      const deferred = createDeferredVector();
      this.entries.set(text, deferred.promise);
      pending.set(text, deferred);
      this.evict();
      return deferred.promise;
    });

    if (pending.size > 0) {
      void this.embedMissing(pending);
    }
    return Promise.all(vectors);
  }

  getStats(): EmbeddingCacheStats {
    return { hits: this.hits, misses: this.misses, entries: this.entries.size };
  }

  private async embedMissing(pending: ReadonlyMap<string, DeferredVector>): Promise<void> {
    const texts = [...pending.keys()];
    try {
      const vectors = await this.delegate.embed(texts);
      if (vectors.length !== texts.length || vectors.some(vector => vector.length === 0)) {
        throw new Error('Embedding runtime returned an unexpected number of vectors.');
      }
      texts.forEach((text, index) => pending.get(text)?.resolve(vectors[index]!));
    } catch (error: unknown) {
      for (const [text, deferred] of pending) {
        if (this.entries.get(text) === deferred.promise) this.entries.delete(text);
        deferred.reject(error);
      }
    }
  }

  private touch(text: string, vector: Promise<number[]>): void {
    this.entries.delete(text);
    this.entries.set(text, vector);
  }

  private evict(): void {
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) return;
      this.entries.delete(oldest);
    }
  }
}

interface DeferredVector {
  promise: Promise<number[]>;
  resolve(vector: number[]): void;
  reject(error: unknown): void;
}

function createDeferredVector(): DeferredVector {
  let resolve!: (vector: number[]) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<number[]>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
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

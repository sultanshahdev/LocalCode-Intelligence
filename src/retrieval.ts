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
  /** Exact identifier/path token evidence; independent of cosine similarity. */
  lexicalEvidence?: boolean;
  /** Reciprocal-rank fusion ordering signal, never a probability. */
  fusionScore?: number;
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
  const displayed = candidates.filter(candidate => candidate.score > 0 || candidate.lexicalEvidence === true);
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

/** Lightweight hybrid retrieval: exact identifier/path evidence is fused with
 * semantic ranks, so MiniLM cannot bury an obvious symbol match. */
export async function retrieveHybridCandidates(
  query: string, regions: readonly SourceRegion[], embedder: Embedder, limit = 5,
): Promise<SearchCandidate[]> {
  const allSemantic = await retrieveCandidates(query, regions, embedder, regions.length);
  const semantic = allSemantic.slice(0, 50);
  const rawByLocation = new Map(allSemantic.map(candidate => [`${candidate.filePath}:${candidate.startLine}:${candidate.endLine}`, candidate]));
  const lexical = retrieveLexicalCandidates(query, regions, 50).map(candidate => rawByLocation.get(`${candidate.filePath}:${candidate.startLine}:${candidate.endLine}`) ?? candidate);
  const fused = new Map<string, { candidate: SearchCandidate; score: number; lexical: boolean }>();
  const add = (candidate: SearchCandidate, rank: number) => {
    const key = `${candidate.filePath}:${candidate.startLine}:${candidate.endLine}`;
    const current = fused.get(key);
    const score = (current?.score ?? 0) + 1 / (60 + rank);
    fused.set(key, { candidate, score, lexical: current?.lexical ?? false });
  };
  semantic.forEach((candidate, index) => add(candidate, index + 1));
  lexical.forEach((candidate, index) => {
    add(candidate, index + 1);
    const key = `${candidate.filePath}:${candidate.startLine}:${candidate.endLine}`;
    const entry = fused.get(key);
    if (entry !== undefined) entry.lexical = true;
  });
  return [...fused.values()].sort((a, b) => b.score - a.score || b.candidate.score - a.candidate.score).slice(0, limit)
    .map(item => withRetrievalEvidence(item.candidate, item.lexical, item.score));
}

function withRetrievalEvidence(candidate: SearchCandidate, lexical: boolean, fusionScore: number): SearchCandidate {
  // Keep API/CLI candidate shapes stable; diagnostics can still inspect these
  // non-enumerable fields without presenting fusion as a user-facing score.
  const output = { ...candidate };
  Object.defineProperty(output, 'fusionScore', { value: fusionScore, enumerable: false });
  if (lexical) Object.defineProperty(output, 'lexicalEvidence', { value: true, enumerable: false });
  return output;
}

export function retrieveLexicalCandidates(query: string, regions: readonly SourceRegion[], limit = 50): SearchCandidate[] {
  const terms = identifierTokens(query);
  if (terms.length === 0) return [];
  return regions.map(region => {
    const tokens = new Set(identifierTokens(`${region.filePath} ${region.text}`));
    const matches = terms.filter(term => tokens.has(term)).length;
    return { ...region, score: matches / terms.length };
  }).filter(candidate => candidate.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
}

export function identifierTokens(text: string): string[] {
  return (text.match(/[A-Z]?[a-z]+|[A-Z]+(?![a-z])|\d+/g) ?? []).map(token => token.toLowerCase());
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

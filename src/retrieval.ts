import type { SourceRegion } from './source.js';
import { classifySearchIntent, type SearchIntent } from './search-intent.js';

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

export type EvidenceClass =
  | 'exact-identifier'
  | 'exact-path'
  | 'strong-lexical'
  | 'partial-token'
  | 'weak-overlap'
  | 'semantic-only';

export interface SearchCandidate extends SourceRegion {
  score: number;
  /** Exact identifier/path token evidence; independent of cosine similarity. */
  lexicalEvidence?: boolean | undefined;
  /** Reciprocal-rank fusion ordering signal, never a probability. */
  fusionScore?: number | undefined;
  /** Granular classification of lexical retrieval evidence. */
  evidenceClass?: EvidenceClass | undefined;
  /** Detailed match metadata for diagnostics and ranking. */
  lexicalRank?: number | undefined;
  semanticRank?: number | undefined;
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
  const displayed = candidates.filter(candidate =>
    candidate.score > 0 ||
    candidate.lexicalEvidence === true ||
    (candidate.evidenceClass !== undefined && candidate.evidenceClass !== 'semantic-only')
  );
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
  options: { intentReranking?: boolean } = {},
): Promise<SearchCandidate[]> {
  const allSemantic = await retrieveCandidates(query, regions, embedder, regions.length);
  const semantic = allSemantic.slice(0, 50);
  const rawByLocation = new Map(allSemantic.map(candidate => [`${candidate.filePath}:${candidate.startLine}:${candidate.endLine}`, candidate]));
  
  const lexicalAll = retrieveLexicalCandidates(query, regions, 50);
  const lexical = lexicalAll.map(candidate => {
    const raw = rawByLocation.get(`${candidate.filePath}:${candidate.startLine}:${candidate.endLine}`);
    return {
      ...(raw ?? candidate),
      score: raw !== undefined ? raw.score : candidate.score,
      evidenceClass: candidate.evidenceClass,
      lexicalEvidence: candidate.lexicalEvidence,
    };
  });

  const fused = new Map<string, {
    candidate: SearchCandidate;
    score: number;
    lexical: boolean;
    evidenceClass: EvidenceClass;
    semanticRank?: number | undefined;
    lexicalRank?: number | undefined;
  }>();

  const add = (
    candidate: SearchCandidate,
    rank: number,
    source: 'semantic' | 'lexical',
    evidenceClass?: EvidenceClass,
  ) => {
    const key = `${candidate.filePath}:${candidate.startLine}:${candidate.endLine}`;
    const current = fused.get(key);
    const score = (current?.score ?? 0) + 1 / (60 + rank);
    const resolvedEvidence = evidenceClass ?? current?.evidenceClass ?? 'semantic-only';
    fused.set(key, {
      candidate: { ...candidate, ...(current?.candidate ?? {}) },
      score,
      lexical: current?.lexical || source === 'lexical',
      evidenceClass: resolvedEvidence,
      semanticRank: source === 'semantic' ? rank : current?.semanticRank,
      lexicalRank: source === 'lexical' ? rank : current?.lexicalRank,
    });
  };

  semantic.forEach((candidate, index) => add(candidate, index + 1, 'semantic'));
  lexical.forEach((candidate, index) => {
    add(candidate, index + 1, 'lexical', candidate.evidenceClass);
  });

  const explicitSymbol = isSymbolQuery(query.trim());
  const symbolPriority = (item: typeof fused extends Map<string, infer V> ? V : never): number => {
    if (!explicitSymbol) return 0;
    const symbol = query.trim();
    if (item.evidenceClass === 'exact-identifier' && isSymbolDefinition(item.candidate.text, symbol)) return 3;
    // When an implementation is anonymously exported, its filename is the
    // navigation symbol. Treat that source as a definition rather than
    // prioritizing imports/call sites that mention the symbol in their text.
    const basename = item.candidate.filePath.split('/').at(-1)?.replace(/\.[cm]?[jt]sx?$/i, '') ?? '';
    if (item.evidenceClass === 'exact-path' && basename.toLowerCase() === symbol.toLowerCase() &&
        /\bexport\s+default\b|\bmodule\.exports\s*=/.test(item.candidate.text)) return 3;
    if (item.evidenceClass === 'exact-identifier') return 2;
    if (item.evidenceClass === 'exact-path') return 1;
    return 0;
  };
  const intent = classifySearchIntent(query);
  return [...fused.values()]
    .sort((a, b) =>
      symbolPriority(b) - symbolPriority(a)
      || (options.intentReranking === false ? 0 :
        intentCompatibility(b.candidate, intent) - intentCompatibility(a.candidate, intent))
      || b.score - a.score
      || b.candidate.score - a.candidate.score,
    )
    .slice(0, limit)
    .map(item => withRetrievalEvidence(
      item.candidate,
      item.lexical,
      item.score,
      item.evidenceClass,
      item.semanticRank,
      item.lexicalRank,
    ));
}

/**
 * Structural evidence is intentionally small and only breaks ties between
 * fused retrieval candidates. It does not remove tests/examples: explicit
 * intent reverses the preference. Regexes cover common JS/TS declaration
 * forms without adding an AST dependency to the hot search path.
 */
function intentCompatibility(candidate: SearchCandidate, intent: SearchIntent): number {
  const text = candidate.text;
  const testRole = /(?:^|\/)(?:test|tests|__tests__|spec)(?:\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(candidate.filePath)
    || /\b(?:describe|it|test|expect|assert)\s*\(/.test(text);
  const exampleRole = /(?:^|\/)(?:examples?|demo|docs?)(?:\/|$)|readme/i.test(candidate.filePath);
  const definition = /\b(?:export\s+)?(?:async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(|\bclass\s+[A-Za-z_$][\w$]*\b|\b(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>|\b[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+\s*=\s*(?:async\s*)?function\b/.test(text);
  const executableLogic = /\b(?:if|switch|for|while|try|catch|throw|return|await)\b/.test(text);
  const implementationEvidence = (definition ? 2 : 0) + (executableLogic ? 1 : 0);

  if (intent === 'test') return (testRole ? 4 : 0) + (exampleRole ? -1 : 0);
  if (intent === 'example') return (exampleRole ? 4 : 0) + (testRole ? -1 : 0);
  if (intent === 'usage') return (definition ? -1 : 1) + (testRole ? -1 : 0);
  if (intent === 'implementation' || intent === 'identifier') {
    return implementationEvidence + (testRole ? -3 : 0) + (exampleRole ? -2 : 0);
  }
  return implementationEvidence * 0.25 + (testRole ? -0.25 : 0);
}

function withRetrievalEvidence(
  candidate: SearchCandidate,
  lexical: boolean,
  fusionScore: number,
  evidenceClass: EvidenceClass = 'semantic-only',
  semanticRank?: number,
  lexicalRank?: number,
): SearchCandidate {
  const output: SearchCandidate = { ...candidate };
  Object.defineProperty(output, 'fusionScore', { value: fusionScore, enumerable: false, configurable: true, writable: true });
  if (lexical || evidenceClass !== 'semantic-only') {
    Object.defineProperty(output, 'lexicalEvidence', { value: true, enumerable: false, configurable: true, writable: true });
  }
  Object.defineProperty(output, 'evidenceClass', { value: evidenceClass, enumerable: false, configurable: true, writable: true });
  if (semanticRank !== undefined) {
    Object.defineProperty(output, 'semanticRank', { value: semanticRank, enumerable: false, configurable: true, writable: true });
  }
  if (lexicalRank !== undefined) {
    Object.defineProperty(output, 'lexicalRank', { value: lexicalRank, enumerable: false, configurable: true, writable: true });
  }
  return output;
}

export function serializeCandidateDetails(candidate: SearchCandidate): Record<string, unknown> {
  return {
    filePath: candidate.filePath,
    startLine: candidate.startLine,
    endLine: candidate.endLine,
    text: candidate.text,
    score: candidate.score,
    fusionScore: candidate.fusionScore,
    lexicalEvidence: candidate.lexicalEvidence ?? false,
    evidenceClass: candidate.evidenceClass ?? 'semantic-only',
    semanticRank: candidate.semanticRank,
    lexicalRank: candidate.lexicalRank,
  };
}

const STOP_TERMS = new Set([
  'find', 'where', 'is', 'the', 'a', 'an', 'what', 'how', 'does', 'for', 'and', 'in', 'of', 'to', 'with', 'logic', 'implemented', 'are'
]);

export function retrieveLexicalCandidates(query: string, regions: readonly SourceRegion[], limit = 50): SearchCandidate[] {
  const queryRawTokens = extractRawTokens(query);
  const querySubTokens = identifierTokens(query);
  if (queryRawTokens.length === 0 && querySubTokens.length === 0) return [];

  const queryNonStopRaw = queryRawTokens.filter(t => !STOP_TERMS.has(t.toLowerCase()));
  const queryNonStopSub = querySubTokens.filter(t => !STOP_TERMS.has(t));

  return regions
    .map(region => {
      const classification = classifyEvidence(query, queryRawTokens, queryNonStopRaw, queryNonStopSub, region);
      return {
        ...region,
        score: classification.score,
        evidenceClass: classification.evidenceClass,
        lexicalEvidence: classification.evidenceClass !== 'semantic-only',
      };
    })
    .filter(candidate => candidate.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function extractRawTokens(text: string): string[] {
  return text.match(/[A-Za-z0-9_$-]+/g) ?? [];
}

export function identifierTokens(text: string): string[] {
  return (text.match(/[A-Z]?[a-z]+|[A-Z]+(?![a-z])|\d+/g) ?? []).map(token => token.toLowerCase());
}

function isSymbolQuery(query: string): boolean {
  return /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*$/.test(query.trim());
}

function matchesWholeSymbol(text: string, symbol: string): boolean {
  const escapedParts = symbol.split('.').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const expression = escapedParts.join('\\s*\\.\\s*');
  return new RegExp(`(^|[^A-Za-z0-9_$])${expression}(?![A-Za-z0-9_$])`).test(text);
}

/**
 * A declaration/assignment is stronger navigation evidence than a call in a
 * test or example. This is a ranking hint for explicit symbol queries only.
 */
function isSymbolDefinition(text: string, symbol: string): boolean {
  const escapedParts = symbol.split('.').map(part => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const expression = escapedParts.join('\\s*\\.\\s*');
  const assigned = new RegExp(`(^|[^A-Za-z0-9_$])${expression}\\s*=(?!=)`);
  const bareName = symbol.split('.').at(-1)!;
  const declaration = new RegExp(`\\b(?:function|class|interface|type|const|let|var)\\s+${bareName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
  const escapedBare = escapedParts.at(-1)!;
  const isImportAlias = symbol === bareName &&
    new RegExp('\\b(?:const|let|var)\\s+' + escapedBare +
      '\\s*=\\s*(?:require\\s*\\(|(?:await\\s+)?import\\s*\\()').test(text);
  const isNamedImplementation = symbol === bareName &&
    new RegExp('\\b(?:function|class|interface|type)\\s+' + escapedBare + '\\b').test(text);
  const isSymbolObjectProperty = symbol === bareName &&
    new RegExp('\\b' + escapedBare + '\\s*:\\s*Symbol\\s*\\(').test(text);
  // A const identifier imported via require() is a reference, not its
  // implementation. CommonJS object keys initialized with Symbol() ARE
  // definitions, even though they lack a declaration keyword.
  return isNamedImplementation || isSymbolObjectProperty ||
    (!isImportAlias && (assigned.test(text) || (symbol === bareName && declaration.test(text))));
}

function classifyEvidence(
  query: string,
  _rawTokens: string[],
  nonStopRaw: string[],
  nonStopSub: string[],
  region: SourceRegion,
): { score: number; evidenceClass: EvidenceClass } {
  const filePath = region.filePath;
  const regionText = region.text;
  const trimmed = query.trim();

  // Match the FULL requested symbol, especially dotted members such as
  // app.listen. Matching just "app" is not an exact app.listen match.
  if (isSymbolQuery(trimmed) && matchesWholeSymbol(regionText, trimmed)) {
    return { score: isSymbolDefinition(regionText, trimmed) ? 1.2 : 1, evidenceClass: 'exact-identifier' };
  }

  // Identifier-shaped tokens mentioned in a longer question can also be
  // useful; avoid promoting ordinary language words to exact symbols.
  const technicalName = nonStopRaw.find(token =>
    token.length >= 4 && /[A-Z_$]/.test(token) && matchesWholeSymbol(regionText, token)
  );
  if (technicalName) {
    return { score: 0.9, evidenceClass: 'strong-lexical' };
  }

  // For a simple filename query, match complete path components rather than
  // arbitrary substrings within path names.
  if (isSymbolQuery(trimmed)) {
    const lower = trimmed.toLowerCase();
    const components = filePath.toLowerCase().split(/[/.]/);
    if (components.includes(lower) || filePath.toLowerCase().endsWith('/' + lower)) {
      return { score: 0.9, evidenceClass: 'exact-path' };
    }
  }

  const regionTokens = new Set(identifierTokens(`${filePath} ${regionText}`));
  const meaningfulTerms = [...new Set(nonStopSub)];
  const matched = meaningfulTerms.filter(term => regionTokens.has(term));

  if (meaningfulTerms.length >= 2 && matched.length === meaningfulTerms.length) {
    return { score: 0.8, evidenceClass: 'strong-lexical' };
  }
  if (matched.length >= 2 && matched.length / meaningfulTerms.length >= 0.5) {
    return { score: 0.5 * (matched.length / meaningfulTerms.length), evidenceClass: 'strong-lexical' };
  }
  if (matched.length > 0) {
    return { score: 0.2 * (matched.length / meaningfulTerms.length), evidenceClass: 'partial-token' };
  }

  // Stopwords alone are never lexical evidence.
  return { score: 0, evidenceClass: 'semantic-only' };
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

import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Embedder } from './retrieval.js';

const FORMAT = 1;
const MAX_ENTRIES = 2_000;
const SOURCE_PREFIX = 'File: ';

export function defaultEmbeddingCacheDirectory(): string {
  const configured = process.env['LOCALCODE_EMBEDDING_CACHE_DIR'];
  if (configured) return configured;
  const base = process.env['XDG_CACHE_HOME'] ?? join(process.env['HOME'] ?? '.', '.cache');
  return join(base, 'localcode-intelligence', 'embeddings');
}

export function persistentCacheDisabled(): boolean {
  return process.env['LOCALCODE_DISABLE_PERSISTENT_CACHE'] === '1';
}

interface RecordShape { format: number; model: string; vector: number[]; }

/** Private, best-effort cache: failures always degrade to the delegate. */
export class PersistentEmbeddingCache {
  private readonly directory: string;
  constructor(readonly model: string, directory = defaultEmbeddingCacheDirectory()) { this.directory = directory; }
  private key(text: string): string { return createHash('sha256').update(`${FORMAT}\0${this.model}\0${text}`).digest('hex'); }
  private file(text: string): string { return join(this.directory, `${this.key(text)}.json`); }
  async get(text: string): Promise<number[] | undefined> {
    try {
      const parsed = JSON.parse(await readFile(this.file(text), 'utf8')) as RecordShape;
      if (parsed.format !== FORMAT || parsed.model !== this.model || !validVector(parsed.vector)) return undefined;
      return parsed.vector;
    } catch { return undefined; }
  }
  async set(text: string, vector: readonly number[]): Promise<void> {
    if (!validVector(vector) || persistentCacheDisabled()) return;
    try {
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
      const target = this.file(text);
      const temp = join(this.directory, `.${randomUUID()}.tmp`);
      await writeFile(temp, JSON.stringify({ format: FORMAT, model: this.model, vector }), { mode: 0o600 });
      await rename(temp, target);
      void this.evict();
    } catch { /* cache storage is optional */ }
  }
  async clear(): Promise<void> {
    // This directory is application-owned; never accept an arbitrary deletion target here.
    await rm(this.directory, { recursive: true, force: true });
  }
  private async evict(): Promise<void> {
    try {
      const entries = await Promise.all((await readdir(this.directory)).filter(x => x.endsWith('.json')).map(async name => ({ name, info: await stat(join(this.directory, name)) })));
      entries.sort((a, b) => a.info.mtimeMs - b.info.mtimeMs);
      await Promise.all(entries.slice(0, Math.max(0, entries.length - MAX_ENTRIES)).map(entry => rm(join(this.directory, entry.name), { force: true })));
    } catch { /* best effort */ }
  }
}

function validVector(value: unknown): value is number[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 4_096 && value.every(item => typeof item === 'number' && Number.isFinite(item));
}

/** Persists only region inputs. User query text/vectors never reach disk. */
export class PersistentCachingEmbedder implements Embedder {
  private readonly cache: PersistentEmbeddingCache;
  constructor(private readonly delegate: Embedder, modelIdentity: string, directory?: string) { this.cache = new PersistentEmbeddingCache(modelIdentity, directory); }
  async embed(texts: readonly string[]): Promise<number[][]> {
    if (persistentCacheDisabled()) return this.delegate.embed(texts);
    const output: Array<number[] | undefined> = new Array(texts.length);
    const missing: Array<{ text: string; index: number }> = [];
    await Promise.all(texts.map(async (text, index) => {
      if (!text.startsWith(SOURCE_PREFIX)) { missing.push({ text, index }); return; }
      output[index] = await this.cache.get(text);
      if (output[index] === undefined) missing.push({ text, index });
    }));
    if (missing.length > 0) {
      const vectors = await this.delegate.embed(missing.map(item => item.text));
      if (vectors.length !== missing.length || vectors.some(vector => !validVector(vector))) throw new Error('Embedding runtime returned invalid vectors.');
      await Promise.all(missing.map(async (item, index) => {
        const vector = vectors[index]!; output[item.index] = vector;
        if (item.text.startsWith(SOURCE_PREFIX)) await this.cache.set(item.text, vector);
      }));
    }
    return output as number[][];
  }
  async clear(): Promise<void> { await this.cache.clear(); }
}

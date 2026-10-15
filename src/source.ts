import { open, readdir, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { extname, relative, resolve } from 'node:path';

export const DEFAULT_SOURCE_LIMITS = {
  maxFiles: 500,
  maxFileBytes: 256 * 1024,
  maxTotalBytes: 5 * 1024 * 1024,
  windowLines: 40,
  overlapLines: 10,
} as const;

const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts']);
const IGNORED_DIRECTORIES = new Set([
  '.git', 'node_modules', 'dist', 'build', 'coverage', '.next', '.nuxt', 'out', 'vendor', 'generated', '.cache',
]);

export interface SourceRegion {
  filePath: string;
  startLine: number;
  endLine: number;
  text: string;
}

export interface SourceScope {
  regions: SourceRegion[];
  /** Supported files observed before per-file and total-byte limits are applied. */
  filesDiscovered?: number;
  filesProcessed: number;
  warnings: string[];
}

export interface SourceLimits {
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  windowLines: number;
  overlapLines: number;
}

/** Reads an explicitly bounded JavaScript/TypeScript scope without following symlinks. */
export async function prepareSourceScope(
  repositoryPath: string,
  limits: SourceLimits = DEFAULT_SOURCE_LIMITS,
): Promise<SourceScope> {
  const files = await discoverSourceFiles(repositoryPath, limits.maxFiles + 1);
  const warnings: string[] = [];
  const filesDiscovered = files.length;
  if (files.length > limits.maxFiles) {
    warnings.push(`File limit reached (${limits.maxFiles}); some supported files were not processed.`);
    files.length = limits.maxFiles;
  }

  const regions: SourceRegion[] = [];
  let totalBytes = 0;
  let filesProcessed = 0;
  for (const absolutePath of files) {
    const displayPath = relative(repositoryPath, absolutePath);
    let expectedBytes: number;
    try {
      expectedBytes = (await stat(absolutePath)).size;
    } catch {
      warnings.push(`Skipped ${displayPath}: file became unavailable during scanning.`);
      continue;
    }
    if (expectedBytes > limits.maxFileBytes) {
      warnings.push(`Skipped ${displayPath}: exceeds ${limits.maxFileBytes} bytes.`);
      continue;
    }
    if (totalBytes + expectedBytes > limits.maxTotalBytes) {
      warnings.push(`Source byte limit reached (${limits.maxTotalBytes}); remaining files were not processed.`);
      break;
    }

    let content: string;
    try {
      content = await readBoundedSourceFile(absolutePath, limits.maxFileBytes);
    } catch {
      warnings.push(`Skipped ${displayPath}: file became unavailable during scanning.`);
      continue;
    }

    const bytes = Buffer.byteLength(content);
    if (bytes > limits.maxFileBytes) {
      warnings.push(`Skipped ${displayPath}: exceeds ${limits.maxFileBytes} bytes.`);
      continue;
    }
    if (totalBytes + bytes > limits.maxTotalBytes) {
      warnings.push(`Source byte limit reached (${limits.maxTotalBytes}); remaining files were not processed.`);
      break;
    }

    totalBytes += bytes;
    filesProcessed += 1;
    regions.push(...segmentSource(displayPath, content, limits));
  }

  return { regions, filesDiscovered, filesProcessed, warnings };
}

async function readBoundedSourceFile(path: string, maxBytes: number): Promise<string> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const buffer = Buffer.alloc(maxBytes + 1);
    let count = 0;
    while (count < buffer.length) {
      const { bytesRead } = await handle.read(buffer, count, buffer.length - count, count);
      if (bytesRead === 0) break;
      count += bytesRead;
    }
    return buffer.subarray(0, count).toString('utf8');
  } finally {
    await handle.close();
  }
}

export async function discoverSourceFiles(
  repositoryPath: string,
  maximum: number = DEFAULT_SOURCE_LIMITS.maxFiles,
): Promise<string[]> {
  const root = resolve(repositoryPath);
  const found: string[] = [];

  async function visit(directory: string): Promise<void> {
    if (found.length >= maximum) return;
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error: unknown) {
      throw new SourceProcessingError(`Unable to inspect source directory: ${relative(root, directory) || '.'}`, error);
    }

    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (found.length >= maximum) break;
      const path = resolve(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!IGNORED_DIRECTORIES.has(entry.name)) await visit(path);
      } else if (entry.isFile() && SOURCE_EXTENSIONS.has(extname(entry.name).toLowerCase())) {
        found.push(path);
      }
    }
  }

  await visit(root);
  return found;
}

/** A bounded, repository-relative list for navigation UI. It deliberately uses
 * the same extension, ignored-directory, and no-symlink discovery policy as
 * search preparation. */
export async function listNavigableSourceFiles(repositoryPath: string, maximum = DEFAULT_SOURCE_LIMITS.maxFiles): Promise<{ files: string[]; truncated: boolean }> {
  const files = await discoverSourceFiles(repositoryPath, maximum + 1);
  const truncated = files.length > maximum;
  return { files: files.slice(0, maximum).map(file => relative(repositoryPath, file)), truncated };
}

export function segmentSource(
  filePath: string,
  content: string,
  limits: Pick<SourceLimits, 'windowLines' | 'overlapLines'> = DEFAULT_SOURCE_LIMITS,
): SourceRegion[] {
  const lines = content.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  const stride = limits.windowLines - limits.overlapLines;
  if (stride <= 0) throw new Error('Source window overlap must be smaller than its size.');

  const regions: SourceRegion[] = [];
  for (let start = 0; start < lines.length; start += stride) {
    const selected = lines.slice(start, start + limits.windowLines);
    if (selected.every((line) => line.trim().length === 0)) continue;
    regions.push({ filePath, startLine: start + 1, endLine: start + selected.length, text: selected.join('\n') });
    if (start + limits.windowLines >= lines.length) break;
  }
  return regions;
}

export class SourceProcessingError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'SourceProcessingError';
  }
}

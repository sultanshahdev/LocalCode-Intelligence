import { readFile, readdir } from 'node:fs/promises';
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
  if (files.length > limits.maxFiles) {
    warnings.push(`File limit reached (${limits.maxFiles}); some supported files were not processed.`);
    files.length = limits.maxFiles;
  }

  const regions: SourceRegion[] = [];
  let totalBytes = 0;
  let filesProcessed = 0;
  for (const absolutePath of files) {
    let content: string;
    try {
      content = await readFile(absolutePath, 'utf8');
    } catch (error: unknown) {
      throw new SourceProcessingError(`Unable to read source file: ${relative(repositoryPath, absolutePath)}`, error);
    }

    const bytes = Buffer.byteLength(content);
    if (bytes > limits.maxFileBytes) {
      warnings.push(`Skipped ${relative(repositoryPath, absolutePath)}: exceeds ${limits.maxFileBytes} bytes.`);
      continue;
    }
    if (totalBytes + bytes > limits.maxTotalBytes) {
      warnings.push(`Source byte limit reached (${limits.maxTotalBytes}); remaining files were not processed.`);
      break;
    }

    totalBytes += bytes;
    filesProcessed += 1;
    regions.push(...segmentSource(relative(repositoryPath, absolutePath), content, limits));
  }

  return { regions, filesProcessed, warnings };
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

import { open, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { relative } from 'node:path';

import { DEFAULT_SOURCE_LIMITS, discoverSourceFiles, type SourceLimits } from './source.js';

export const EXACT_SEARCH_LIMITS = {
  maxQueryLength: 256,
  maxMatches: 200,
  maxSnippetCharacters: 320,
} as const;

export interface ExactMatch {
  filePath: string;
  line: number;
  text: string;
  /** Zero-based character spans in text, used to render literal highlights. */
  occurrences: Array<{ start: number; end: number }>;
}

export interface ExactSearchResult {
  matches: ExactMatch[];
  filesWithMatches: number;
  truncated: boolean;
  scope: { filesProcessed: number; filesDiscovered: number; warnings: string[] };
}

/**
 * Scans the same bounded, symlink-free source scope as semantic preparation.
 * This deliberately has no dependency on retrieval or embedding modules.
 */
export async function searchExactText(
  query: string,
  repositoryPath: string,
  options: { caseSensitive?: boolean; wholeWord?: boolean } = {},
  limits: SourceLimits = DEFAULT_SOURCE_LIMITS,
): Promise<ExactSearchResult> {
  const files = await discoverSourceFiles(repositoryPath, limits.maxFiles + 1);
  const warnings: string[] = [];
  const filesDiscovered = files.length;
  if (files.length > limits.maxFiles) {
    warnings.push(`File limit reached (${limits.maxFiles}); some supported files were not processed.`);
    files.length = limits.maxFiles;
  }

  const needle = options.caseSensitive ? query : query.toLocaleLowerCase();
  const matches: ExactMatch[] = [];
  let filesProcessed = 0;
  let filesWithMatches = 0;
  let totalBytes = 0;
  let truncated = false;

  for (const absolutePath of files) {
    const filePath = relative(repositoryPath, absolutePath);
    let expectedBytes: number;
    try { expectedBytes = (await stat(absolutePath)).size; }
    catch { warnings.push(`Skipped ${filePath}: file became unavailable during scanning.`); continue; }
    if (expectedBytes > limits.maxFileBytes) { warnings.push(`Skipped ${filePath}: exceeds ${limits.maxFileBytes} bytes.`); continue; }
    if (totalBytes + expectedBytes > limits.maxTotalBytes) {
      warnings.push(`Source byte limit reached (${limits.maxTotalBytes}); remaining files were not processed.`);
      break;
    }

    let content: string;
    try { content = await readBounded(absolutePath, limits.maxFileBytes); }
    catch { warnings.push(`Skipped ${filePath}: file became unavailable during scanning.`); continue; }
    const bytes = Buffer.byteLength(content);
    if (bytes > limits.maxFileBytes) { warnings.push(`Skipped ${filePath}: exceeds ${limits.maxFileBytes} bytes.`); continue; }
    if (totalBytes + bytes > limits.maxTotalBytes) {
      warnings.push(`Source byte limit reached (${limits.maxTotalBytes}); remaining files were not processed.`);
      break;
    }
    totalBytes += bytes;
    filesProcessed += 1;

    const foundInFile = scanLines(content, needle, query.length, options, filePath, matches);
    if (foundInFile) filesWithMatches += 1;
    if (matches.length >= EXACT_SEARCH_LIMITS.maxMatches) { truncated = true; break; }
  }
  if (truncated) warnings.push(`Match limit reached (${EXACT_SEARCH_LIMITS.maxMatches}); refine your search to see additional matches.`);
  return { matches, filesWithMatches, truncated, scope: { filesProcessed, filesDiscovered, warnings } };
}

function scanLines(content: string, needle: string, queryLength: number, options: { caseSensitive?: boolean; wholeWord?: boolean }, filePath: string, matches: ExactMatch[]): boolean {
  let foundInFile = false;
  const lines = content.split(/\r?\n/);
  for (let lineIndex = 0; lineIndex < lines.length && matches.length < EXACT_SEARCH_LIMITS.maxMatches; lineIndex += 1) {
    const text = lines[lineIndex] ?? '';
    const haystack = options.caseSensitive ? text : text.toLocaleLowerCase();
    const occurrences: Array<{ start: number; end: number }> = [];
    let cursor = 0;
    while (cursor <= haystack.length - needle.length) {
      const start = haystack.indexOf(needle, cursor);
      if (start < 0) break;
      const end = start + queryLength;
      if (!options.wholeWord || (!isWordCharacter(text[start - 1]) && !isWordCharacter(text[end]))) {
        occurrences.push({ start, end });
      }
      cursor = start + Math.max(1, queryLength);
    }
    if (occurrences.length > 0) {
      foundInFile = true;
      matches.push({ filePath, line: lineIndex + 1, text: boundedSnippet(text, occurrences), occurrences: boundedOccurrences(text, occurrences) });
    }
  }
  return foundInFile;
}

function isWordCharacter(value: string | undefined): boolean { return value !== undefined && /[A-Za-z0-9_$]/.test(value); }

function boundedSnippet(text: string, occurrences: Array<{ start: number; end: number }>): string {
  if (text.length <= EXACT_SEARCH_LIMITS.maxSnippetCharacters) return text;
  const start = Math.max(0, occurrences[0]!.start - 80);
  const end = Math.min(text.length, start + EXACT_SEARCH_LIMITS.maxSnippetCharacters - (start > 0 ? 1 : 0));
  return `${start > 0 ? '…' : ''}${text.slice(start, end)}`;
}
function boundedOccurrences(text: string, occurrences: Array<{ start: number; end: number }>): Array<{ start: number; end: number }> {
  if (text.length <= EXACT_SEARCH_LIMITS.maxSnippetCharacters) return occurrences;
  const first = occurrences[0]!;
  const start = Math.max(0, first.start - 80);
  const prefix = start > 0 ? 1 : 0;
  const end = start + EXACT_SEARCH_LIMITS.maxSnippetCharacters - prefix;
  return occurrences.filter(item => item.start >= start && item.end <= end).map(item => ({ start: item.start - start + prefix, end: item.end - start + prefix }));
}

async function readBounded(path: string, maxBytes: number): Promise<string> {
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
  } finally { await handle.close(); }
}

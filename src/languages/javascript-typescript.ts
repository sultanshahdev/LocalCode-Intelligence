import type { LanguageAdapter } from './types.js';
import type { SourceLimits, SourceRegion } from '../source.js';
import {
  listRepositorySymbols,
  findPossibleUsages,
  resolveDefinition,
  type SourceSymbol,
  type SymbolResult,
  type UsageResult,
  type DefinitionResult,
} from '../symbols.js';

export const JAVASCRIPT_TYPESCRIPT_EXTENSIONS = [
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
] as const;

export class JavaScriptTypeScriptAdapter implements LanguageAdapter {
  readonly id = 'javascript-typescript';
  readonly name = 'JavaScript / TypeScript';
  readonly fileExtensions = JAVASCRIPT_TYPESCRIPT_EXTENSIONS;
  readonly capabilities = {
    basic: true,
    structural: true,
    precise: true,
  } as const;

  segmentSource(
    filePath: string,
    content: string,
    limits: Pick<SourceLimits, 'windowLines' | 'overlapLines'> = { windowLines: 40, overlapLines: 10 },
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

  async extractSymbols(
    repositoryPath: string,
    limits?: SourceLimits,
  ): Promise<SymbolResult> {
    return listRepositorySymbols(repositoryPath, limits);
  }

  async findPossibleUsages(
    repositoryPath: string,
    selected: Pick<SourceSymbol, 'filePath' | 'name' | 'kind' | 'startLine'>,
    limits?: SourceLimits,
  ): Promise<UsageResult> {
    return findPossibleUsages(repositoryPath, selected, limits);
  }

  async resolveDefinition(
    repositoryPath: string,
    request: { filePath: string; line: number; column: number },
    limits?: SourceLimits,
  ): Promise<DefinitionResult> {
    return resolveDefinition(repositoryPath, request, limits);
  }
}

export const javaScriptTypeScriptAdapter = new JavaScriptTypeScriptAdapter();

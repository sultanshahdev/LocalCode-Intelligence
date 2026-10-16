import { segmentSource, type SourceLimits, type SourceRegion } from '../source.js';
import {
  listRepositorySymbols,
  findPossibleUsages,
  resolveDefinition,
  type SourceSymbol,
  type SymbolResult,
  type UsageResult,
  type DefinitionResult,
} from '../symbols.js';
import type { LanguageAdapter } from './types.js';
import { LanguageRegistry } from './registry.js';

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

  // Prevent other registered language extensions from entering the TS parser.
  private readonly scopedRegistry = new LanguageRegistry([this]);

  /**
   * Delegates to the shared windowed segmentation in src/source.ts to eliminate duplication.
   * Chunk boundaries, text, paths, and embedding inputs are byte-for-byte identical.
   */
  segmentSource(
    filePath: string,
    content: string,
    limits: Pick<SourceLimits, 'windowLines' | 'overlapLines'> = { windowLines: 40, overlapLines: 10 },
  ): SourceRegion[] {
    return segmentSource(filePath, content, limits);
  }

  async extractSymbols(
    repositoryPath: string,
    limits?: SourceLimits,
  ): Promise<SymbolResult> {
    return listRepositorySymbols(repositoryPath, limits, this.scopedRegistry);
  }

  async findPossibleUsages(
    repositoryPath: string,
    selected: Pick<SourceSymbol, 'filePath' | 'name' | 'kind' | 'startLine'>,
    limits?: SourceLimits,
  ): Promise<UsageResult> {
    return findPossibleUsages(repositoryPath, selected, limits, this.scopedRegistry);
  }

  async resolveDefinition(
    repositoryPath: string,
    request: { filePath: string; line: number; column: number },
    limits?: SourceLimits,
  ): Promise<DefinitionResult> {
    return resolveDefinition(repositoryPath, request, limits, this.scopedRegistry);
  }
}

export const javaScriptTypeScriptAdapter = new JavaScriptTypeScriptAdapter();

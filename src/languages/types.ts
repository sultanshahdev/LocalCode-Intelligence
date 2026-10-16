import type { SourceRegion, SourceLimits, RepositorySourceSnapshot } from '../source.js';
import type { SourceSymbol, SymbolResult, UsageResult, DefinitionResult } from '../symbols.js';

export type LanguageId = 'javascript-typescript' | 'python' | 'go' | 'java' | 'rust' | 'c-cpp' | string;

export type CapabilityLevel = 'basic' | 'structural' | 'precise';

export interface LanguageCapabilities {
  /** Basic capability includes exact search, semantic search, and bounded source inspection. */
  basic: boolean;
  /** Structural capability includes syntax-aware segmentation, declaration/symbol extraction, and possible usages. */
  structural: boolean;
  /** Precise capability includes compiler-proven or reliably resolved definition navigation. */
  precise: boolean;
}

export interface LanguageAdapter {
  readonly id: LanguageId;
  readonly name: string;
  readonly fileExtensions: readonly string[];
  readonly capabilities: Readonly<LanguageCapabilities>;

  /**
   * Syntax-aware source segmentation into inspectable regions.
   * If not implemented, fallback standard windowed segmentation is used.
   */
  segmentSource?(
    filePath: string,
    content: string,
    limits?: Pick<SourceLimits, 'windowLines' | 'overlapLines'>,
  ): SourceRegion[] | Promise<SourceRegion[]>;

  /**
   * Extracts declarations and symbols from repository source files.
   * Required when capabilities.structural is true.
   */
  extractSymbols?(
    repositoryPath: string,
    limits?: SourceLimits,
  ): Promise<SymbolResult>;
  extractSymbolsFromSnapshot?(snapshot: RepositorySourceSnapshot, maximumSymbols?: number): Promise<SymbolResult>;

  /**
   * Finds possible usages for a selected declaration.
   * Required when capabilities.structural is true.
   */
  findPossibleUsages?(
    repositoryPath: string,
    selected: Pick<SourceSymbol, 'filePath' | 'name' | 'kind' | 'startLine'>,
    limits?: SourceLimits,
  ): Promise<UsageResult>;
  findPossibleUsagesInSnapshot?(snapshot: RepositorySourceSnapshot, selected: Pick<SourceSymbol, 'filePath' | 'name' | 'kind' | 'startLine'>): Promise<UsageResult>;

  /**
   * Resolves the definition location for an identifier at a given coordinate.
   * Required when capabilities.precise is true.
   */
  resolveDefinition?(
    repositoryPath: string,
    request: { filePath: string; line: number; column: number },
    limits?: SourceLimits,
  ): Promise<DefinitionResult>;
}

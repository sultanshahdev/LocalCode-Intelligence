import { prepareSourceScope, type SourceScope } from './source.js';

export interface RepositorySearchStatus {
  filesDiscovered: number;
  filesProcessed: number;
  eligible: boolean;
  coverage: 'complete' | 'partial';
  warnings: string[];
}

export type RepositoryStatusResult =
  | { ok: true; status: RepositorySearchStatus }
  | { ok: false; message: string };

export interface StatusDependencies {
  prepare(repositoryPath: string): Promise<SourceScope>;
}

const defaultDependencies: StatusDependencies = { prepare: prepareSourceScope };

/** Inspects the same bounded source scope used by search, without loading a model. */
export async function inspectRepositorySearchStatus(
  repositoryPath: string,
  dependencies: StatusDependencies = defaultDependencies,
): Promise<RepositoryStatusResult> {
  try {
    const scope = await dependencies.prepare(repositoryPath);
    return {
      ok: true,
      status: {
        filesDiscovered: scope.filesDiscovered ?? scope.filesProcessed,
        filesProcessed: scope.filesProcessed,
        eligible: scope.regions.length > 0,
        coverage: scope.warnings.length === 0 ? 'complete' : 'partial',
        warnings: scope.warnings,
      },
    };
  } catch (error: unknown) {
    const detail = error instanceof Error ? error.message : 'unknown error';
    return { ok: false, message: `Repository status could not inspect the source scope: ${detail}` };
  }
}

import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { resolve } from 'node:path';

export type RepositoryValidationFailure =
  | 'not-found'
  | 'not-directory'
  | 'inaccessible';

export type RepositoryValidationResult =
  | { ok: true; resolvedPath: string }
  | {
      ok: false;
      reason: RepositoryValidationFailure;
      resolvedPath: string;
      message: string;
    };

export interface FileSystemOperations {
  stat(path: string): Promise<{ isDirectory(): boolean }>;
  access(path: string, mode: number): Promise<void>;
}

const nodeFileSystem: FileSystemOperations = { stat, access };

/** Validates one exact local directory without reading or modifying its contents. */
export async function validateRepositoryDirectory(
  suppliedPath: string,
  currentDirectory: string = process.cwd(),
  fileSystem: FileSystemOperations = nodeFileSystem,
): Promise<RepositoryValidationResult> {
  const resolvedPath = resolve(currentDirectory, suppliedPath);

  let pathStatus: { isDirectory(): boolean };
  try {
    pathStatus = await fileSystem.stat(resolvedPath);
  } catch (error: unknown) {
    const code = getErrorCode(error);
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      return failure(
        'not-found',
        resolvedPath,
        `Repository cannot be used: path does not exist: ${resolvedPath}`,
      );
    }

    return failure(
      'inaccessible',
      resolvedPath,
      `Repository cannot be used: unable to inspect directory: ${resolvedPath}`,
    );
  }

  if (!pathStatus.isDirectory()) {
    return failure(
      'not-directory',
      resolvedPath,
      `Repository cannot be used: a directory is required: ${resolvedPath}`,
    );
  }

  try {
    // Directory traversal is required to use a readable directory as a scope.
    await fileSystem.access(resolvedPath, constants.R_OK | constants.X_OK);
  } catch {
    return failure(
      'inaccessible',
      resolvedPath,
      `Repository cannot be used: directory is not readable: ${resolvedPath}`,
    );
  }

  return { ok: true, resolvedPath };
}

function failure(
  reason: RepositoryValidationFailure,
  resolvedPath: string,
  message: string,
): RepositoryValidationResult {
  return { ok: false, reason, resolvedPath, message };
}

function getErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return undefined;
  }

  return typeof error.code === 'string' ? error.code : undefined;
}

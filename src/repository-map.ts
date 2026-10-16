import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { IGNORED_DIRECTORIES } from './source.js';
import { defaultLanguageRegistry, type LanguageRegistry } from './languages/index.js';

export const REPOSITORY_MAP_LIMITS = { maxNodes: 2_500, maxDepth: 32 } as const;
export interface RepositoryMapLimits { maxNodes: number; maxDepth: number; }

export interface RepositoryMapNode {
  id: string;
  path: string;
  name: string;
  type: 'directory' | 'file';
  parentId: string | null;
  language?: string;
  sizeBytes?: number;
}

export interface RepositoryMapManifest {
  root: '.';
  nodes: RepositoryMapNode[];
  truncated: boolean;
  warnings: string[];
}

/** Metadata-only, deterministic repository hierarchy. Never reads file bodies. */
export async function buildRepositoryMap(
  repositoryPath: string,
  registry: LanguageRegistry = defaultLanguageRegistry,
  limits: RepositoryMapLimits = REPOSITORY_MAP_LIMITS,
): Promise<RepositoryMapManifest> {
  const root = resolve(repositoryPath);
  const nodes: RepositoryMapNode[] = [{ id: '.', path: '.', name: 'repository', type: 'directory', parentId: null }];
  const warnings: string[] = [];
  let truncated = false;

  const visit = async (directory: string, relativeDirectory: string, depth: number): Promise<void> => {
    if (truncated) return;
    if (depth >= limits.maxDepth) { truncated = true; warnings.push(`Repository map depth limit reached (${limits.maxDepth}).`); return; }
    let entries: import('node:fs').Dirent<string>[];
    try { entries = await readdir(directory, { withFileTypes: true, encoding: 'utf8' }); }
    catch { warnings.push(`Could not inspect ${relativeDirectory || '.'}.`); return; }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (nodes.length >= limits.maxNodes) { truncated = true; break; }
      if (entry.isSymbolicLink()) continue;
      const path = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      const absolutePath = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name)) continue;
        nodes.push({ id: path, path, name: entry.name, type: 'directory', parentId: relativeDirectory || '.' });
        await visit(absolutePath, path, depth + 1);
      } else if (entry.isFile()) {
        const adapter = registry.getByPath(path);
        nodes.push({ id: path, path, name: entry.name, type: 'file', parentId: relativeDirectory || '.', ...(adapter ? { language: adapter.id } : {}) });
      }
    }
  };
  await visit(root, '', 0);
  if (truncated) warnings.push(`Repository map node limit reached (${limits.maxNodes}); the hierarchy is partial.`);
  return { root: '.', nodes, truncated, warnings };
}

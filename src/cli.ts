#!/usr/bin/env node

import { pathToFileURL } from 'node:url';

import { validateRepositoryDirectory } from './repository.js';
import { searchRepository, type SearchResult } from './search.js';

const REPO_USAGE = 'Usage: localcode repo check <path>';
const SEARCH_USAGE = 'Usage: localcode search "<query>" --repo <path>';
const USAGE = `Usage:
  localcode repo check <path>
  localcode search "<query>" --repo <path>`;

export interface CliDependencies {
  search(query: string, repositoryPath: string): Promise<SearchResult>;
}

export interface CliStreams {
  stdout: Pick<NodeJS.WriteStream, 'write'>;
  stderr: Pick<NodeJS.WriteStream, 'write'>;
}

export async function runCli(
  args: readonly string[],
  streams: CliStreams = { stdout: process.stdout, stderr: process.stderr },
  dependencies: CliDependencies = { search: searchRepository },
): Promise<number> {
  if (args[0] === 'search') {
    return runSearch(args.slice(1), streams, dependencies);
  }

  const [group, command, repositoryPath, ...extraArguments] = args;

  if (group !== 'repo' || command !== 'check') {
    streams.stderr.write(`Unknown command.\n${USAGE}\n`);
    return 2;
  }

  if (repositoryPath === undefined || repositoryPath.length === 0) {
    streams.stderr.write(`Repository path is required.\n${REPO_USAGE}\n`);
    return 2;
  }

  if (extraArguments.length > 0) {
    streams.stderr.write(`Too many arguments.\n${REPO_USAGE}\n`);
    return 2;
  }

  const result = await validateRepositoryDirectory(repositoryPath);
  if (!result.ok) {
    streams.stderr.write(`${result.message}\n`);
    return 1;
  }

  streams.stdout.write(`Validated repository scope: ${result.resolvedPath}\n`);
  streams.stdout.write('Status: directory is readable; indexing has not been performed.\n');
  return 0;
}

async function runSearch(
  args: readonly string[],
  streams: CliStreams,
  dependencies: CliDependencies,
): Promise<number> {
  const [query, repoFlag, repositoryPath, ...extraArguments] = args;
  if (query === undefined || query.trim().length === 0) {
    streams.stderr.write(`Search query is required.\n${SEARCH_USAGE}\n`);
    return 2;
  }
  if (repoFlag !== '--repo' || repositoryPath === undefined || repositoryPath.length === 0) {
    streams.stderr.write(`Search repository must be supplied with --repo.\n${SEARCH_USAGE}\n`);
    return 2;
  }
  if (extraArguments.length > 0) {
    streams.stderr.write(`Too many arguments.\n${SEARCH_USAGE}\n`);
    return 2;
  }

  const validation = await validateRepositoryDirectory(repositoryPath);
  if (!validation.ok) {
    streams.stderr.write(`${validation.message}\n`);
    return 1;
  }

  const result = await dependencies.search(query.trim(), validation.resolvedPath);
  if (!result.ok) {
    streams.stderr.write(`${result.message}\n`);
    return 1;
  }

  streams.stdout.write(`Query: ${query.trim()}\n`);
  streams.stdout.write(`Repository: ${validation.resolvedPath}\n`);
  streams.stdout.write(`Processed source files: ${result.scope.filesProcessed}\n`);
  for (const warning of result.scope.warnings) streams.stdout.write(`Warning: ${warning}\n`);
  streams.stdout.write('\n');

  result.candidates.forEach((candidate, index) => {
    streams.stdout.write(`Candidate ${index + 1}\n`);
    streams.stdout.write(`File: ${candidate.filePath}\n`);
    streams.stdout.write(`Lines: ${candidate.startLine}-${candidate.endLine}\n`);
    streams.stdout.write(`Similarity: ${candidate.score.toFixed(4)}\n\n`);
    streams.stdout.write(`Candidate source excerpt:\n${candidate.text}\n\n`);
  });
  streams.stdout.write('Note: Matches are candidates for inspection, not verified behavioral guarantees.\n');
  return 0;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const exitCode = await runCli(process.argv.slice(2));
  process.exitCode = exitCode;
}

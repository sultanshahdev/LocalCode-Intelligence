#!/usr/bin/env node

import { pathToFileURL } from 'node:url';

import { validateRepositoryDirectory } from './repository.js';
import { searchRepository, type SearchResult } from './search.js';
import { inspectRepositorySearchStatus, type RepositoryStatusResult } from './status.js';

const REPO_USAGE = 'Usage: localcode repo check <path>';
const STATUS_USAGE = 'Usage: localcode repo status <path>';
const SEARCH_USAGE = 'Usage: localcode search "<query>" --repo <path>';
const USAGE = `Usage:
  localcode repo check <path>
  localcode repo status <path>
  localcode search "<query>" --repo <path>`;

export interface CliDependencies {
  search(query: string, repositoryPath: string): Promise<SearchResult>;
  status?(repositoryPath: string): Promise<RepositoryStatusResult>;
}

export interface CliStreams {
  stdout: Pick<NodeJS.WriteStream, 'write'>;
  stderr: Pick<NodeJS.WriteStream, 'write'>;
}

export async function runCli(
  args: readonly string[],
  streams: CliStreams = { stdout: process.stdout, stderr: process.stderr },
  dependencies: CliDependencies = { search: searchRepository, status: inspectRepositorySearchStatus },
): Promise<number> {
  if (args[0] === 'search') return runSearch(args.slice(1), streams, dependencies);

  const [group, command, repositoryPath, ...extraArguments] = args;
  if (group !== 'repo' || (command !== 'check' && command !== 'status')) {
    streams.stderr.write(`Unknown command.\n${USAGE}\n`);
    return 2;
  }

  const commandUsage = command === 'status' ? STATUS_USAGE : REPO_USAGE;
  if (repositoryPath === undefined || repositoryPath.length === 0) {
    streams.stderr.write(`Repository path is required.\n${commandUsage}\n`);
    return 2;
  }
  if (extraArguments.length > 0) {
    streams.stderr.write(`Too many arguments.\n${commandUsage}\n`);
    return 2;
  }

  const validation = await validateRepositoryDirectory(repositoryPath);
  if (!validation.ok) {
    streams.stderr.write(`${validation.message}\n`);
    return 1;
  }

  if (command === 'status') {
    return runRepositoryStatus(validation.resolvedPath, streams, dependencies);
  }

  streams.stdout.write(`Validated repository scope: ${validation.resolvedPath}\n`);
  streams.stdout.write('Status: directory is readable; indexing has not been performed.\n');
  return 0;
}

async function runRepositoryStatus(
  repositoryPath: string,
  streams: CliStreams,
  dependencies: CliDependencies,
): Promise<number> {
  const result = await (dependencies.status ?? inspectRepositorySearchStatus)(repositoryPath);
  if (!result.ok) {
    streams.stderr.write(`${result.message}\n`);
    return 1;
  }

  const { status } = result;
  streams.stdout.write(`Repository: ${repositoryPath}\n`);
  streams.stdout.write('Directory: Accessible\n');
  streams.stdout.write(`Supported source files: ${status.filesDiscovered}\n`);
  streams.stdout.write(`Eligible source files processed: ${status.filesProcessed}\n`);
  streams.stdout.write(`Source eligibility: ${status.eligible ? 'Available' : 'None'}\n`);
  streams.stdout.write(`Coverage: ${status.coverage === 'complete' ? 'Complete within configured discovery rules' : 'Partial'}\n`);
  for (const warning of status.warnings) streams.stdout.write(`Warning: ${warning}\n`);
  streams.stdout.write(`Preparation: ${status.eligible ? 'On-demand; not performed by status' : 'Not performed'}\n`);
  streams.stdout.write('Persistent index: None\n');
  streams.stdout.write('Model readiness: Not checked\n');
  streams.stdout.write('Search execution: Not performed\n\n');
  streams.stdout.write(status.eligible
    ? 'Status: Source is available for search preparation.\n'
    : 'Status: No supported searchable source content is available for search.\n');
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

  if (result.outcome === 'no-supported-candidate') {
    streams.stdout.write('Outcome: No sufficiently supported candidate was found under the display rule.\n');
    streams.stdout.write('The search completed, but no retrieved region had positive cosine alignment.\n');
    streams.stdout.write(`Withheld candidates: ${result.withheldCandidates} with non-positive cosine alignment.\n`);
    streams.stdout.write('This does not establish that the requested behavior is absent from the repository.\n');
    return 0;
  }

  result.candidates.forEach((candidate, index) => {
    streams.stdout.write(`Candidate ${index + 1}\n`);
    streams.stdout.write(`File: ${candidate.filePath}\n`);
    streams.stdout.write(`Lines: ${candidate.startLine}-${candidate.endLine}\n`);
    streams.stdout.write(`Similarity: ${candidate.score.toFixed(4)}\n\n`);
    streams.stdout.write('Evidence: Unverified semantic candidate; relevance is uncertain.\n\n');
    streams.stdout.write(`Candidate source excerpt:\n${candidate.text}\n\n`);
  });
  if (result.withheldCandidates > 0) {
    streams.stdout.write(`Withheld candidates: ${result.withheldCandidates} with non-positive cosine alignment.\n`);
  }
  streams.stdout.write('Note: Similarity is a ranking signal, not a probability or verified behavioral guarantee.\n');
  return 0;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const exitCode = await runCli(process.argv.slice(2));
  process.exitCode = exitCode;
}

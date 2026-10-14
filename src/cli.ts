#!/usr/bin/env node

import { validateRepositoryDirectory } from './repository.js';

const USAGE = 'Usage: localcode repo check <path>';

export interface CliStreams {
  stdout: Pick<NodeJS.WriteStream, 'write'>;
  stderr: Pick<NodeJS.WriteStream, 'write'>;
}

export async function runCli(
  args: readonly string[],
  streams: CliStreams = { stdout: process.stdout, stderr: process.stderr },
): Promise<number> {
  const [group, command, repositoryPath, ...extraArguments] = args;

  if (group !== 'repo' || command !== 'check') {
    streams.stderr.write(`Unknown command.\n${USAGE}\n`);
    return 2;
  }

  if (repositoryPath === undefined || repositoryPath.length === 0) {
    streams.stderr.write(`Repository path is required.\n${USAGE}\n`);
    return 2;
  }

  if (extraArguments.length > 0) {
    streams.stderr.write(`Too many arguments.\n${USAGE}\n`);
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

const exitCode = await runCli(process.argv.slice(2));
process.exitCode = exitCode;

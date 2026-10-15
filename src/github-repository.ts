import { createHash } from 'node:crypto';
import { mkdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';

export interface GitHubRepository { owner: string; repository: string; canonicalUrl: string; }
export class GitHubRepositoryError extends Error {
  constructor(readonly code: 'invalid-url' | 'git-unavailable' | 'network' | 'unavailable' | 'timeout' | 'clone-failed', message: string) { super(message); }
}

export function parseGitHubRepositoryUrl(value: string): GitHubRepository {
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new GitHubRepositoryError('invalid-url', 'Enter a public HTTPS GitHub repository URL.'); }
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.username || url.password || url.search || url.hash) {
    throw new GitHubRepositoryError('invalid-url', 'Enter a public HTTPS GitHub repository URL.');
  }
  const parts = url.pathname.replace(/^\/+|\/+$/g, '').replace(/\.git$/, '').split('/');
  if (parts.length !== 2 || !parts.every(part => /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(part))) {
    throw new GitHubRepositoryError('invalid-url', 'Enter a GitHub URL in the form https://github.com/owner/repository.');
  }
  return { owner: parts[0]!, repository: parts[1]!, canonicalUrl: `https://github.com/${parts[0]}/${parts[1]}` };
}

export class GitHubRepositoryAcquirer {
  private readonly prepared = new Map<string, string>();
  constructor(private readonly root = join(tmpdir(), 'localcode-github'), private readonly timeoutMs = 60_000) {}
  async acquire(value: string, refresh = false): Promise<{ repository: GitHubRepository; path: string }> {
    const repository = parseGitHubRepositoryUrl(value);
    const key = repository.canonicalUrl.toLowerCase();
    const previous = this.prepared.get(key);
    if (previous !== undefined && !refresh) return { repository, path: previous };
    const destination = join(this.root, createHash('sha256').update(key).digest('hex').slice(0, 24));
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    if (refresh) await rm(destination, { recursive: true, force: true });
    try { await stat(destination); this.prepared.set(key, destination); return { repository, path: destination }; } catch { /* clone below */ }
    try {
      await runGit(['clone', '--depth', '1', '--no-tags', '--recurse-submodules=no', repository.canonicalUrl, destination], this.timeoutMs);
    } catch (error: unknown) {
      await rm(destination, { recursive: true, force: true });
      throw error;
    }
    this.prepared.set(key, destination);
    return { repository, path: destination };
  }
}

function runGit(args: string[], timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = execFile('git', args, { timeout: timeoutMs, maxBuffer: 64 * 1024 }, error => {
      if (!error) return resolve();
      const code = (error as NodeJS.ErrnoException & { killed?: boolean }).code;
      if (code === 'ENOENT') return reject(new GitHubRepositoryError('git-unavailable', 'Git is required to download GitHub repositories.'));
      if ((error as { killed?: boolean }).killed) return reject(new GitHubRepositoryError('timeout', 'Repository download timed out. Try a smaller repository.'));
      const message = String(error.message).toLowerCase();
      if (message.includes('could not resolve') || message.includes('network')) return reject(new GitHubRepositoryError('network', 'Couldn’t connect to GitHub. Check your connection and try again.'));
      reject(new GitHubRepositoryError('unavailable', 'We couldn’t access this public GitHub repository. Verify the URL and visibility.'));
    });
    child.unref?.();
  });
}

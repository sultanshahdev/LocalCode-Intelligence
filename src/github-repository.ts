import { randomUUID } from 'node:crypto';
import { mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
export interface GitHubRepository { owner: string; repository: string; canonicalUrl: string; }
export interface AcquiredGitHubRepository { repository: GitHubRepository; path: string; revision: string; }
export class GitHubRepositoryError extends Error { constructor(readonly code: 'invalid-url' | 'git-unavailable' | 'network' | 'unavailable' | 'timeout' | 'clone-failed', message: string) { super(message); } }
export function parseGitHubRepositoryUrl(value: string): GitHubRepository {
  let url: URL; try { url = new URL(value.trim()); } catch { throw new GitHubRepositoryError('invalid-url', 'Enter a public HTTPS GitHub repository URL.'); }
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || url.username || url.password || url.search || url.hash) throw new GitHubRepositoryError('invalid-url', 'Enter a public HTTPS GitHub repository URL.');
  const parts = url.pathname.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '').split('/');
  if (parts.length !== 2 || !parts.every(part => /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(part))) throw new GitHubRepositoryError('invalid-url', 'Enter a GitHub URL in the form https://github.com/owner/repository.');
  return { owner: parts[0]!, repository: parts[1]!, canonicalUrl: `https://github.com/${parts[0]}/${parts[1]}` };
}
/** Refresh stages a uniquely named checkout, verifies HEAD, then publishes it. A failed refresh never removes the old revision. */
export class GitHubRepositoryAcquirer {
  private readonly prepared = new Map<string, AcquiredGitHubRepository>(); private readonly inFlight = new Map<string, Promise<AcquiredGitHubRepository>>();
  constructor(private readonly root = join(tmpdir(), 'localcode-github'), private readonly timeoutMs = 60_000) {}
  async acquire(value: string, refresh = false): Promise<AcquiredGitHubRepository> {
    const repository = parseGitHubRepositoryUrl(value); const key = repository.canonicalUrl.toLowerCase(); const cached = this.prepared.get(key);
    if (cached && !refresh) return cached; const running = this.inFlight.get(key); if (running) return running;
    const work = this.stage(repository).then(next => { this.prepared.set(key, next); return next; }).finally(() => this.inFlight.delete(key)); this.inFlight.set(key, work); return work;
  }
  private async stage(repository: GitHubRepository): Promise<AcquiredGitHubRepository> {
    await mkdir(this.root, { recursive: true, mode: 0o700 }); const path = join(this.root, `checkout-${randomUUID()}`);
    try {
      await runGit(['-c', 'protocol.file.allow=never', 'clone', '--depth', '1', '--no-tags', '--recurse-submodules=no', '--config', 'submodule.recurse=false', repository.canonicalUrl, path], this.timeoutMs);
      const revision = (await runGitOutput(['-C', path, 'rev-parse', '--verify', 'HEAD'], this.timeoutMs)).trim();
      if (!/^[0-9a-f]{40}$/i.test(revision)) throw new GitHubRepositoryError('clone-failed', 'Repository checkout could not be verified.'); return { repository, path, revision };
    } catch (error) { await rm(path, { recursive: true, force: true }); throw error; }
  }
}
function runGit(args: string[], timeoutMs: number): Promise<void> { return runGitOutput(args, timeoutMs).then(() => undefined); }
function runGitOutput(args: string[], timeoutMs: number): Promise<string> { return new Promise((resolve, reject) => execFile('git', args, { timeout: timeoutMs, maxBuffer: 64 * 1024, windowsHide: true }, (error, stdout) => {
  if (!error) return resolve(stdout); const tagged = error as NodeJS.ErrnoException & { killed?: boolean };
  if (tagged.code === 'ENOENT') return reject(new GitHubRepositoryError('git-unavailable', 'Git is required to download GitHub repositories.'));
  if (tagged.killed) return reject(new GitHubRepositoryError('timeout', 'Repository download timed out. Try a smaller repository.'));
  if (String(error.message).toLowerCase().includes('resolve')) return reject(new GitHubRepositoryError('network', 'Couldn’t connect to GitHub. Check your connection and try again.'));
  reject(new GitHubRepositoryError('unavailable', 'We couldn’t access this public GitHub repository. Verify the URL and visibility.'));
})); }

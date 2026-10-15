import assert from 'node:assert/strict';
import test from 'node:test';
import { parseGitHubRepositoryUrl, GitHubRepositoryError } from '../src/github-repository.js';
import { assessRelevance } from '../src/relevance.js';

test('accepts canonical public GitHub URLs and rejects unsafe URLs', () => {
  assert.deepEqual(parseGitHubRepositoryUrl('https://github.com/facebook/react.git/'), {
    owner: 'facebook', repository: 'react', canonicalUrl: 'https://github.com/facebook/react',
  });
  for (const value of ['http://github.com/a/b', 'https://user@github.com/a/b', 'https://github.com/a/b/issues', 'https://127.0.0.1/a/b']) {
    assert.throws(() => parseGitHubRepositoryUrl(value), GitHubRepositoryError);
  }
});

const authCandidate = { filePath: 'src/auth/session.ts', startLine: 1, endLine: 2, text: 'export function verifyToken(token: string) {}', score: 0.44 };
test('relevance keeps natural-language and short programming evidence but rejects unrelated queries', () => {
  assert.equal(assessRelevance('Where is user authentication implemented?', [authCandidate]).relevant, true);
  assert.equal(assessRelevance('authentication', [authCandidate]).relevant, true);
  assert.equal(assessRelevance('banana', [authCandidate]).relevant, false);
  assert.equal(assessRelevance('asdfghjkl', [authCandidate]).relevant, false);
});

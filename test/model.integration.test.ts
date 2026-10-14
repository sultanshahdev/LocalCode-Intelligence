import assert from 'node:assert/strict';
import test from 'node:test';

import { createLocalEmbedder, retrieveCandidates } from '../src/retrieval.js';

test('local model retrieves labeled expired-session evidence', {
  skip: process.env['LOCALCODE_RUN_MODEL_TEST'] !== '1' ? 'set LOCALCODE_RUN_MODEL_TEST=1 to run local model integration' : false,
  timeout: 120_000,
}, async () => {
  const embedder = await createLocalEmbedder();
  const results = await retrieveCandidates('where is an expired session rejected?', [
    { filePath: 'src/report.ts', startLine: 1, endLine: 3, text: 'export function renderAnnualReport(rows: Row[]) {\n  return rows.join("\\n");\n}' },
    { filePath: 'src/session.ts', startLine: 10, endLine: 14, text: 'export function enforceSession(session: Session) {\n  if (session.expiresAt < Date.now()) {\n    throw new UnauthorizedError("session expired");\n  }\n}' },
    { filePath: 'src/profile.ts', startLine: 4, endLine: 6, text: 'export function displayName(user: User) {\n  return user.name;\n}' },
  ], embedder, 3);
  assert.equal(results[0]?.filePath, 'src/session.ts');
});

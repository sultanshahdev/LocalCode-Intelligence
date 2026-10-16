#!/usr/bin/env node
// Chromium smoke test with MOCKED backend responses. This tests browser UI
// behavior and request contracts, not actual Git downloads or model inference.
// Run after npm run build and installing playwright + its Chromium browser.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as pause } from 'node:timers/promises';
import { chromium } from 'playwright';

const PORT = 4173;
const BASE_URL = 'http://127.0.0.1:' + PORT;
const GITHUB = 'https://github.com/sultanshahdev/LocalCode-Intelligence';
const REVISION = 'a'.repeat(40);
const UPDATED_REVISION = 'b'.repeat(40);
let refreshAttempts = 0;
const LOCAL = '/tmp/localcode-browser-smoke';
const status = { eligible: true, coverage: 'complete', filesDiscovered: 2, filesProcessed: 2, warnings: [] };
const localCandidate = { filePath: 'src/auth.ts', startLine: 3, endLine: 4, text: 'export function verifyToken() { return true; }', score: 0.82 };
const githubCandidate = { filePath: 'src/search.ts', startLine: 12, endLine: 14, text: 'export function searchRepository() { return true; }', score: 0.76 };
const exactMatch = { filePath: 'src/auth.ts', line: 3, text: 'export const verifyToken = verifyToken();', occurrences: [{ start: 13, end: 24 }, { start: 27, end: 38 }] };
let server;
let browser;
const pageErrors = [];
const observed = [];
async function waitForPreview() {
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(BASE_URL, { signal: AbortSignal.timeout(700) })).ok) return; } catch {}
    await pause(150);
  }
  throw new Error('Vite preview was not reachable on port 4173');
}
function reply(route, data, statusCode = 200) {
  return route.fulfill({ status: statusCode, contentType: 'application/json', body: JSON.stringify(data) });
}
async function run() {
  server = spawn('npm', ['run', 'preview', '--prefix', 'web', '--', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
    stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32',
  });
  let errors = '';
  server.stderr.on('data', chunk => { errors += String(chunk); });
  await waitForPreview().catch(error => { throw new Error(error.message + '\n' + errors); });

  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on('pageerror', error => pageErrors.push(String(error)));
  await page.route('**/api/**', async route => {
    const request = route.request();
    const endpoint = new URL(request.url()).pathname;
    const body = request.postDataJSON();
    observed.push({ endpoint, body });
    if (endpoint === '/api/repositories/prepare') {
      if (body.source.type === 'local') {
        if (body.source.value === '/tmp/delayed') await pause(600);
        return reply(route, { ok: true, repositoryId: 'local-id', source: { type: 'local', label: body.source.value }, status });
      }
      if (body.refresh === true) {
        refreshAttempts += 1;
        if (refreshAttempts === 1) return reply(route, { ok: false, code: 'network', message: 'Temporary GitHub network failure' });
        return reply(route, { ok: true, repositoryId: 'github-updated-id',
          source: { type: 'github', label: 'sultanshahdev/LocalCode-Intelligence', githubUrl: GITHUB, revision: UPDATED_REVISION }, status });
      }
      return reply(route, { ok: true, repositoryId: 'github-id',
        source: { type: 'github', label: 'sultanshahdev/LocalCode-Intelligence', githubUrl: GITHUB, revision: REVISION }, status });
    }
    if (endpoint === '/api/search') {
      if (body.query === 'slow search') await pause(600);
      if (body.query.includes('banana') || body.query.includes('astrology')) {
        return reply(route, { ok: true, outcome: 'no-relevant-results', candidates: [],
          withheldCandidates: 1, scope: { filesProcessed: 2, filesDiscovered: 2, warnings: [] } });
      }
      const candidate = body.repositoryId === 'github-id' || body.repositoryId === 'github-updated-id' ? githubCandidate : localCandidate;
      return reply(route, { ok: true, outcome: 'candidates', candidates: [candidate],
        withheldCandidates: 0, scope: { filesProcessed: 2, filesDiscovered: 2, warnings: [] } });
    }
    if (endpoint === '/api/search/exact') {
      if (body.query.includes('banana')) return reply(route, { ok: true, matches: [], filesWithMatches: 0, truncated: false, scope: { filesProcessed: 2, filesDiscovered: 2, warnings: [] } });
      return reply(route, { ok: true, matches: [exactMatch], filesWithMatches: 1, truncated: false, scope: { filesProcessed: 2, filesDiscovered: 2, warnings: [] } });
    }
    if (endpoint === '/api/repositories/files') {
      return reply(route, { ok: true, files: ['src/auth.ts', 'src/search.ts'], truncated: false });
    }
    if (endpoint === '/api/source') {
      return reply(route, { ok: true, filePath: body.filePath,
        startLine: body.startLine, endLine: body.endLine, totalLines: 30,
        lines: ['export function verifyToken() {', '  return true;'] });
    }
    return reply(route, { error: 'Unexpected API endpoint ' + endpoint }, 404);
  });

  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  await page.getByRole('textbox', { name: 'Repository path' }).fill(LOCAL);
  await page.getByRole('button', { name: 'Check Repository' }).click();
  await page.getByText('Ready for search').waitFor();
  await page.getByRole('button', { name: /auth\.ts/ }).click();
  await page.getByRole('dialog', { name: 'Source viewer' }).waitFor();
  await page.getByRole('button', { name: 'Close source viewer' }).click();
  console.log('PASS repository navigator opens a listed file');
  await page.getByRole('textbox', { name: 'Search query' }).fill('verifyToken');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.locator('.card').first().waitFor();
  assert.match(await page.locator('.card').first().innerText(), /auth\.ts/);
  assert(observed.some(item => item.endpoint === '/api/search' && item.body.repositoryId === 'local-id'));
  await page.getByRole('button', { name: 'View source for src/auth.ts' }).click();
  await page.getByRole('dialog', { name: 'Source viewer' }).waitFor();
  await page.locator('.sv-line--hl').first().waitFor();
  await page.getByRole('button', { name: 'Close source viewer' }).click();
  console.log('PASS local prepare, search and source inspection');

  await page.getByRole('button', { name: 'Exact text' }).click();
  await page.getByRole('checkbox', { name: 'Whole word' }).check();
  await page.getByRole('textbox', { name: 'Search query' }).fill('verifyToken');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.locator('.exact-card').waitFor();
  assert.equal(await page.locator('.exact-highlight').count(), 2);
  assert(observed.some(item => item.endpoint === '/api/search/exact' && item.body.wholeWord === true));
  await page.getByRole('button', { name: 'View source for src/auth.ts line 3' }).click();
  await page.getByRole('dialog', { name: 'Source viewer' }).waitFor();
  await page.getByRole('button', { name: 'Close source viewer' }).click();
  await page.getByRole('textbox', { name: 'Search query' }).fill('banana');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByText('No exact text matches').waitFor();
  await page.getByRole('button', { name: 'AI / Semantic' }).click();
  console.log('PASS exact text mode highlights, opens source, and handles empty results');

  await page.getByRole('textbox', { name: 'Search query' }).fill('slow search');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search query' }).fill('new query while search is pending');
  await pause(750);
  assert.equal(await page.locator('.card').count(), 0);
  assert.equal(await page.locator('.loading-notice').count(), 0);
  console.log('PASS editing query discards stale pending results');

  await page.getByRole('textbox', { name: 'Search query' }).fill('banana astrology');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.locator('.empty-state-title').waitFor();
  assert.equal(await page.locator('.card').count(), 0);
  console.log('PASS irrelevant query empty state');

  await page.getByRole('button', { name: 'GitHub URL' }).click();
  assert.equal(await page.getByRole('textbox', { name: 'Search query' }).isDisabled(), true);
  await page.getByRole('textbox', { name: 'Public GitHub repository URL' }).fill(GITHUB);
  await page.getByRole('button', { name: 'Prepare repository' }).click();
  await page.getByText('Ready for search').waitFor();
  await page.getByRole('textbox', { name: 'Search query' }).fill('searchRepository');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.locator('.card').first().waitFor();
  const href = await page.getByRole('link', { name: 'Open on GitHub' }).getAttribute('href');
  assert.equal(href, GITHUB + '/blob/' + REVISION + '/src/search.ts#L12-L14');
  assert(observed.some(item => item.endpoint === '/api/search' && item.body.repositoryId === 'github-id'));
  console.log('PASS GitHub prepare, search and pinned source link');

  await page.getByRole('button', { name: 'Refresh' }).click();
  await page.getByText('Temporary GitHub network failure').waitFor();
  assert.equal(await page.locator('.card').count(), 1);
  assert.equal(await page.getByRole('textbox', { name: 'Search query' }).isDisabled(), false);
  console.log('PASS failed GitHub refresh preserves results');

  await page.getByRole('button', { name: 'Refresh' }).click();
  await page.locator('.card').first().waitFor({ state: 'detached' });
  assert.equal(await page.getByRole('textbox', { name: 'Search query' }).isDisabled(), false);
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.locator('.card').first().waitFor();
  const updatedLink = await page.getByRole('link', { name: 'Open on GitHub' }).getAttribute('href');
  assert.equal(updatedLink, GITHUB + '/blob/' + UPDATED_REVISION + '/src/search.ts#L12-L14');
  console.log('PASS successful refresh invalidates old results and updates pinned revision');

  await page.getByRole('button', { name: 'Local folder' }).click();
  await page.getByRole('textbox', { name: 'Repository path' }).fill(LOCAL);
  await page.getByRole('button', { name: 'Check Repository' }).click();
  await page.getByText('Ready for search').waitFor();
  await page.getByRole('textbox', { name: 'Search query' }).fill('slow search');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByRole('button', { name: 'GitHub URL' }).click();
  await pause(750);
  assert.equal(await page.locator('.card').count(), 0);
  assert.equal(await page.getByRole('textbox', { name: 'Search query' }).isDisabled(), true);
  console.log('PASS stale search ignored on source switch');

  await page.getByRole('button', { name: 'Local folder' }).click();
  await page.getByRole('textbox', { name: 'Repository path' }).fill('/tmp/delayed');
  await page.getByRole('button', { name: 'Check Repository' }).click();
  await page.getByRole('button', { name: 'GitHub URL' }).click();
  await pause(750);
  assert.equal(await page.getByRole('textbox', { name: 'Search query' }).isDisabled(), true);
  assert.equal(await page.getByRole('button', { name: 'Prepare repository' }).isDisabled(), false);
  console.log('PASS stale preparation ignored and loading reset');
  assert.deepEqual(pageErrors, []);
  console.log('Browser smoke passed (mocked APIs only).');
}
try { await run(); }
catch (error) { console.error('Browser smoke FAILED:', error); process.exitCode = 1; }
finally {
  await browser?.close();
  if (server?.pid) {
    try { if (process.platform === 'win32') server.kill('SIGTERM'); else process.kill(-server.pid, 'SIGTERM'); }
    catch {}
  }
}

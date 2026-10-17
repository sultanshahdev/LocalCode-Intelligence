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
const symbols = [
  { filePath: 'src/auth.ts', name: 'verifyToken', kind: 'function', startLine: 3, endLine: 4 },
  { filePath: 'src/large.ts', name: 'BigClass', kind: 'class', startLine: 1, endLine: 900 },
];
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
  page.setDefaultTimeout(5_000);
  const workspaceNav = () => page.getByRole('navigation', { name: 'Workspace navigation' });
  const submitSearch = () => page.locator('.search-input-row').getByRole('button', { name: 'Search', exact: true });
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
      if (body.query === 'slow exact') await pause(600);
      if (body.query.includes('banana')) return reply(route, { ok: true, matches: [], filesWithMatches: 0, truncated: false, scope: { filesProcessed: 2, filesDiscovered: 2, warnings: [] } });
      return reply(route, { ok: true, matches: [exactMatch], filesWithMatches: 1, truncated: false, scope: { filesProcessed: 2, filesDiscovered: 2, warnings: [] } });
    }
    if (endpoint === '/api/repositories/files') {
      return reply(route, { ok: true, files: ['src/auth.ts', 'src/search.ts'], truncated: false });
    }
    if (endpoint === '/api/symbols') {
      if (body.repositoryId === 'local-id' && observed.filter(item => item.endpoint === '/api/symbols').length === 1) await pause(600);
      return reply(route, { ok: true, symbols, truncated: false, scope: { filesProcessed: 2, filesDiscovered: 2, warnings: [] } });
    }
    if (endpoint === '/api/symbols/usages') {
      return reply(route, {
        ok: true,
        symbol: body.symbol,
        usages: [
          { filePath: 'src/consumer.ts', line: 10, column: 5, preview: 'verifyToken()', start: 0, end: 11 },
          { filePath: 'src/consumer.ts', line: 20, column: 5, preview: 'verifyToken()', start: 0, end: 11 },
          { filePath: 'src/consumer.ts', line: 30, column: 5, preview: 'verifyToken()', start: 0, end: 11 },
        ],
        truncated: false,
        scope: { filesProcessed: 2, filesDiscovered: 2, warnings: [] },
      });
    }
    if (endpoint === '/api/symbols/definition') {
      if (body.line === 30) {
        await pause(600);
        return reply(route, {
          ok: true,
          outcome: 'resolved',
          definition: { filePath: 'src/auth.ts', name: 'verifyToken', kind: 'function', startLine: 3, endLine: 4 },
        });
      }
      if (body.line === 20) {
        return reply(route, {
          ok: true,
          outcome: 'ambiguous',
          message: 'The declaration is not uniquely available in the prepared source scope.',
        });
      }
      return reply(route, {
        ok: true,
        outcome: 'resolved',
        definition: { filePath: 'src/auth.ts', name: 'verifyToken', kind: 'function', startLine: 3, endLine: 4 },
      });
    }
    if (endpoint === '/api/source') {
      return reply(route, { ok: true, filePath: body.filePath,
        startLine: body.startLine, endLine: body.endLine, totalLines: 30,
        lines: ['export function verifyToken() {', '  return true;'] });
    }
    return reply(route, { error: 'Unexpected API endpoint ' + endpoint }, 404);
  });

  await page.goto(BASE_URL, { waitUntil: 'networkidle' });
  // Verify Code Buster landing page and open the investigation workspace.
  await page.getByRole('button', { name: 'Explore a repository' }).first().click();
  await page.waitForURL('**/app');
  await page.getByRole('button', { name: 'Local repository' }).click();
  await page.getByRole('textbox', { name: 'Repository path' }).fill(LOCAL);
  await page.getByRole('button', { name: 'Explore repository' }).click();
  await workspaceNav().waitFor();
  assert(observed.some(item => item.endpoint === '/api/repositories/prepare' && item.body.source.type === 'local'));
  await page.getByRole('button', { name: 'Explore' }).click();
  await page.getByRole('button', { name: 'Symbols' }).click();
  await page.getByRole('textbox', { name: 'Filter symbols' }).fill('verify');
  await page.getByText('verifyToken').last().waitFor();
  await page.getByText('verifyToken').last().click();
  await page.getByRole('complementary', { name: 'Source viewer' }).waitFor();
  await page.getByRole('button', { name: 'Close source viewer' }).click();
  console.log('PASS symbol filtering and declaration source navigation');

  // Go to Definition workflow: find usages -> go to definition -> source viewer opens
  await page.getByRole('button', { name: 'Find usages' }).first().click();
  await page.getByText('Possible usages of verifyToken').waitFor();
  assert(observed.some(item => item.endpoint === '/api/symbols/usages' && item.body.repositoryId === 'local-id'));
  const defButtons = page.getByRole('button', { name: 'Go to definition' });
  await defButtons.first().click();
  await page.getByRole('complementary', { name: 'Source viewer' }).waitFor();
  assert(observed.some(item => item.endpoint === '/api/symbols/definition' &&
    item.body.repositoryId === 'local-id' &&
    item.body.filePath === 'src/consumer.ts' &&
    item.body.line === 10));
  await page.getByRole('button', { name: 'Close source viewer' }).click();
  console.log('PASS find usages -> go to definition opens source viewer at declaration');

  // Ambiguous/unresolved definition shows explanatory message and does NOT open source viewer
  await defButtons.nth(1).click();
  await page.getByText('The declaration is not uniquely available in the prepared source scope.').waitFor();
  assert.equal(await page.getByRole('complementary', { name: 'Source viewer' }).count(), 0);
  console.log('PASS ambiguous definition displays explanatory message and avoids navigating');

  // Pending definition response is discarded when repository changes
  await defButtons.nth(2).click(); // line 30: pauses 600ms
  // Switch repository before definition responds
  await page.getByRole('button', { name: 'Switch repository' }).click();
  await page.getByRole('textbox', { name: 'Repository path' }).fill('/tmp/other-repo');
  await pause(750);
  assert.equal(await page.getByRole('complementary', { name: 'Source viewer' }).count(), 0);
  // The usage panel container always exists in the new UI; verify no usage items are rendered
  assert.equal(await page.locator('.usage-item-card').count(), 0);
  console.log('PASS pending definition discarded on repository change');

  // Restore repository to continue checks — invalidateRepository() resets activeTab to 'overview'
  await page.getByRole('textbox', { name: 'Repository path' }).fill(LOCAL);
  await page.getByRole('button', { name: 'Explore repository' }).click();
  await workspaceNav().waitFor();

  // Long declaration spans must not exceed the source-view API's 500-line cap.
  // Re-enter Symbols through Explore (repository change resets to overview).
  await page.getByRole('button', { name: 'Explore' }).click();
  await page.getByRole('button', { name: 'Symbols' }).click();
  await page.getByRole('textbox', { name: 'Filter symbols' }).fill('BigClass');
  await page.getByText('BigClass').last().click();
  await page.getByRole('complementary', { name: 'Source viewer' }).waitFor();
  assert(observed.some(item => item.endpoint === '/api/source' &&
    item.body.filePath === 'src/large.ts' &&
    item.body.startLine === 1 && item.body.endLine === 26));
  await page.getByRole('button', { name: 'Close source viewer' }).click();
  await page.getByRole('textbox', { name: 'Filter symbols' }).fill('');
  console.log('PASS large declaration opens within source-view line cap');
  await page.getByRole('button', { name: 'Explore' }).click();
  await page.getByRole('button', { name: /auth\.ts/ }).click();
  await page.getByRole('complementary', { name: 'Source viewer' }).waitFor();
  await page.getByRole('button', { name: 'Close source viewer' }).click();
  console.log('PASS repository navigator opens a listed file');
  await workspaceNav().getByRole('button', { name: 'Search' }).click();
  await page.getByRole('textbox', { name: 'Search query' }).fill('verifyToken');
  await submitSearch().click();
  await page.locator('.card').first().waitFor();
  assert.match(await page.locator('.card').first().innerText(), /auth\.ts/);
  assert(observed.some(item => item.endpoint === '/api/search' && item.body.repositoryId === 'local-id'));
  await page.getByRole('button', { name: 'View source for src/auth.ts' }).click();
  await page.getByRole('complementary', { name: 'Source viewer' }).waitFor();
  await page.locator('.sv-line--hl').first().waitFor();
  await page.getByRole('button', { name: 'Close source viewer' }).click();
  console.log('PASS local prepare, search and source inspection');
  // Exact text is a contextual Investigation mode, not a separate workspace destination.
  await page.locator('.search-mode-tab[aria-label="Exact text"]').click();
  await page.getByRole('checkbox', { name: 'Whole word' }).check();
  await page.getByRole('textbox', { name: 'Search query' }).fill('verifyToken');
  await submitSearch().click();
  await page.locator('.exact-card').waitFor();
  assert.equal(await page.locator('.exact-highlight').count(), 2);
  assert(observed.some(item => item.endpoint === '/api/search/exact' && item.body.wholeWord === true));
  await page.getByRole('button', { name: 'View source for src/auth.ts line 3' }).click();
  await page.getByRole('complementary', { name: 'Source viewer' }).waitFor();
  await page.getByRole('button', { name: 'Close source viewer' }).click();
  await page.getByRole('textbox', { name: 'Search query' }).fill('banana');
  await submitSearch().click();
  await page.getByText('No exact text matches').waitFor();
  // A pending exact-search response must not lock the button or leak into
  // semantic mode. An option change must cancel the pending UI state too.
  await page.getByRole('textbox', { name: 'Search query' }).fill('slow exact');
  await submitSearch().click();
  // Click the search-mode toggle (not the workspace nav tab for the same label)
  await page.locator('.search-mode-tab[aria-label="By meaning"]').click();
  assert.equal(await submitSearch().isDisabled(), false);
  await pause(750);
  assert.equal(await page.locator('.exact-card').count(), 0);
  assert.equal(await page.locator('.loading-notice').count(), 0);
  await page.locator('.search-mode-tab[aria-label="Exact text"]').click();
  await submitSearch().click();
  await page.getByRole('checkbox', { name: 'Whole word' }).uncheck();
  assert.equal(await submitSearch().isDisabled(), false);
  assert.equal(await page.locator('.loading-notice').count(), 0);
  await page.locator('.search-mode-tab[aria-label="By meaning"]').click();
  console.log('PASS exact text mode highlights, pending-mode cancellation, options reset, and empty results');

  await page.getByRole('textbox', { name: 'Search query' }).fill('slow search');
  await submitSearch().click();
  await page.getByRole('textbox', { name: 'Search query' }).fill('new query while search is pending');
  await pause(750);
  assert.equal(await page.locator('.card').count(), 0);
  assert.equal(await page.locator('.loading-notice').count(), 0);
  console.log('PASS editing query discards stale pending results');

  await page.getByRole('textbox', { name: 'Search query' }).fill('banana astrology');
  await submitSearch().click();
  await page.locator('.empty-state-title').waitFor();
  assert.equal(await page.locator('.card').count(), 0);
  console.log('PASS irrelevant query empty state');

  await page.getByRole('button', { name: 'Switch repository' }).click();
  await page.getByRole('button', { name: 'GitHub repository' }).click();
  // Changing repository source invalidates the prepared repository and returns
  // the workspace to Overview. Search is deliberately unmounted until a new
  // repository has been prepared; its navigation action is locked meanwhile.
  assert.equal(await page.getByRole('textbox', { name: 'Search query' }).count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Search' }).count(), 0);
  await page.getByRole('textbox', { name: 'Public GitHub repository URL' }).fill(GITHUB);
  await page.getByRole('button', { name: 'Explore repository' }).click();
  await workspaceNav().waitFor();
  await workspaceNav().getByRole('button', { name: 'Search' }).click();
  await page.getByRole('textbox', { name: 'Search query' }).fill('searchRepository');
  await submitSearch().click();
  await page.locator('.card').first().waitFor();
  const href = await page.getByRole('link', { name: 'Open on GitHub' }).getAttribute('href');
  assert.equal(href, GITHUB + '/blob/' + REVISION + '/src/search.ts#L12-L14');
  assert(observed.some(item => item.endpoint === '/api/search' && item.body.repositoryId === 'github-id'));
  console.log('PASS GitHub prepare, search and pinned source link');

  await page.getByRole('button', { name: 'Refresh' }).click();
  // Refresh errors live in the repository setup drawer, while the existing
  // search evidence remains available in the workspace.
  await page.getByRole('button', { name: 'Switch repository' }).click();
  await page.getByText('Temporary GitHub network failure').waitFor();
  assert.equal(await page.locator('.card').count(), 1);
  assert.equal(await page.getByRole('textbox', { name: 'Search query' }).isDisabled(), false);
  console.log('PASS failed GitHub refresh preserves results');

  await page.getByRole('button', { name: 'Refresh' }).click();
  await page.locator('.card').first().waitFor({ state: 'detached' });
  assert.equal(await page.getByRole('textbox', { name: 'Search query' }).isDisabled(), false);
  await submitSearch().click();
  await page.locator('.card').first().waitFor();
  const updatedLink = await page.getByRole('link', { name: 'Open on GitHub' }).getAttribute('href');
  assert.equal(updatedLink, GITHUB + '/blob/' + UPDATED_REVISION + '/src/search.ts#L12-L14');
  console.log('PASS successful refresh invalidates old results and updates pinned revision');

  await page.locator('.search-mode-tab[aria-label="Exact text"]').click();
  await page.getByRole('textbox', { name: 'Search query' }).fill('verifyToken');
  await submitSearch().click();
  await page.locator('.exact-card').waitFor();
  await page.getByRole('button', { name: 'Refresh' }).click();
  await page.locator('.exact-card').first().waitFor({ state: 'detached' });
  assert.equal(await page.locator('.exact-card').count(), 0);
  console.log('PASS successful GitHub refresh discards exact text matches');

  await page.getByRole('button', { name: 'Switch repository' }).click();
  await page.getByRole('button', { name: 'Local repository' }).click();
  await page.getByRole('textbox', { name: 'Repository path' }).fill(LOCAL);
  await page.getByRole('button', { name: 'Explore repository' }).click();
  await workspaceNav().waitFor();
  await workspaceNav().getByRole('button', { name: 'Search' }).click();
  await page.getByRole('textbox', { name: 'Search query' }).fill('slow search');
  await submitSearch().click();
  await page.getByRole('button', { name: 'Switch repository' }).click();
  await page.getByRole('button', { name: 'GitHub repository' }).click();
  await pause(750);
  assert.equal(await page.locator('.card').count(), 0);
  assert.equal(await page.getByRole('textbox', { name: 'Search query' }).count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Search' }).count(), 0);
  console.log('PASS stale search ignored on source switch');

  await page.getByRole('button', { name: 'Local repository' }).click();
  await page.getByRole('textbox', { name: 'Repository path' }).fill('/tmp/delayed');
  await page.getByRole('button', { name: 'Explore repository' }).click();
  await page.getByRole('button', { name: 'GitHub repository' }).click();
  await pause(750);
  assert.equal(await page.getByRole('textbox', { name: 'Search query' }).count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Search' }).count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Explore repository' }).isDisabled(), false);
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

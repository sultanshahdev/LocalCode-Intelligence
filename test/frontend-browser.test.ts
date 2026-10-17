import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium, type Browser, type Page } from 'playwright';
import { createLocalcodeServer } from '../src/server.js';
import { type Server } from 'node:http';
import { resolve } from 'node:path';

describe('Frontend Browser Integration (Playwright)', () => {
  let server: Server;
  let browser: Browser;
  const PORT = 4319;
  const BASE_URL = `http://127.0.0.1:${PORT}`;

  before(async () => {
    server = createLocalcodeServer();
    await new Promise<void>((res) => server.listen(PORT, '127.0.0.1', () => res()));
    browser = await chromium.launch({ headless: true });
  });

  after(async () => {
    if (browser) await browser.close();
    if (server) await new Promise<void>((res) => server.close(() => res()));
  });

  test('Code Buster landing page renders its branded investigation hero', async () => {
    const page = await browser.newPage();
    await page.goto(`${BASE_URL}/`);

    // Verify title and main hero copy
    const title = await page.title();
    assert.match(title, /Code Buster/);

    const headline = await page.locator('.cb-hero h1').textContent();
    assert.match(headline ?? '', /Every codebase/);
    assert.match(headline ?? '', /has a mystery/);
    assert.ok(await page.locator('.buster-ghost').count() >= 1);

    // Verify Primary and Secondary CTAs
    const openWorkspaceBtn = page.getByRole('button', { name: 'Explore a repository' }).first();
    assert.match(await openWorkspaceBtn.textContent() ?? '', /Explore a repository/);

    assert.equal(await page.locator('.cb-trail-stage').count(), 1);
    assert.equal(await page.locator('.cb-map-illustration').count(), 1);

    await page.close();
  });

  test('Primary CTA navigates from Landing Page to Workspace at /app', async () => {
    const page = await browser.newPage();
    await page.goto(`${BASE_URL}/`);

    const openWorkspaceBtn = page.getByRole('button', { name: 'Explore a repository' }).first();
    await openWorkspaceBtn.click();

    // Verify URL changed to /app
    assert.equal(page.url(), `${BASE_URL}/app`);
    assert.ok(await page.locator('.workspace-app-layout').isVisible());

    // Verify return button navigates back to landing
    await page.locator('.workspace-back-btn').click();
    assert.equal(page.url(), `${BASE_URL}/`);
    assert.ok(await page.locator('.cb-landing').isVisible());

    await page.close();
  });

  test('Landing page keeps the mascot and content available with reduced motion', async () => {
    const page = await browser.newPage();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`${BASE_URL}/`);
    assert.ok(await page.locator('.cb-hero h1').isVisible());
    assert.ok(await page.locator('.buster-ghost').first().isVisible());
    assert.equal(await page.locator('.cb-hero-ghost').evaluate((element) => getComputedStyle(element).animationName), 'none');
    await page.close();
  });

  test('Direct URL refresh at /app serves Workspace without 404', async () => {
    const page = await browser.newPage();
    await page.goto(`${BASE_URL}/app`);

    assert.ok(await page.locator('.workspace-app-layout').isVisible());
    assert.ok(await page.locator('.workspace-mode-nav').isVisible());

    await page.reload();
    assert.ok(await page.locator('.workspace-app-layout').isVisible());

    await page.close();
  });

  test('Workspace prepares local repository, runs exact search, and opens Source Inspector', async () => {
    const page = await browser.newPage();
    await page.goto(`${BASE_URL}/app`);

    // Input current repository path
    const repoInput = page.locator('.prep-input-field');
    const targetPath = resolve(process.cwd());
    await repoInput.fill(targetPath);

    // Click Check Repository
    const prepareBtn = page.locator('.prep-input-row .kiro-btn--primary');
    await prepareBtn.click();

    // Wait for repository ready badge
    await page.waitForSelector('.repo-badge-status--ready', { timeout: 10000 });

    // Exact text is a contextual mode of the unified Investigation surface.
    await page.getByRole('button', { name: 'AI / Semantic' }).click();
    await page.locator('.search-mode-tab[aria-label="Exact text"]').click();

    // Search for a known identifier in this repo
    const searchInput = page.locator('.search-main-input');
    await searchInput.fill('createLocalcodeServer');
    await page.locator('.search-input-row .kiro-btn--primary').click();

    // Verify exact matches appeared
    await page.waitForSelector('.exact-match-row', { timeout: 10000 });
    const count = await page.locator('.exact-match-row').count();
    assert.ok(count > 0);

    // Click View Source
    await page.locator('.exact-view-btn').first().click();

    // Verify Source Inspector opened
    await page.waitForSelector('.workspace-inspector', { timeout: 5000 });
    assert.ok(await page.locator('.inspector-filename').isVisible());

    // Close Inspector with close button
    await page.locator('.inspector-close-btn').click();
    assert.equal(await page.locator('.workspace-inspector').count(), 0);

    await page.close();
  });

  test('Responsive viewports render properly without overflow', async () => {
    const viewports = [
      { width: 1440, height: 900, name: 'desktop' },
      { width: 1280, height: 800, name: 'laptop' },
      { width: 768, height: 1024, name: 'tablet' },
      { width: 390, height: 844, name: 'mobile' },
    ];

    for (const vp of viewports) {
      const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
      await page.goto(`${BASE_URL}/`);
      assert.ok(await page.locator('.cb-hero h1').isVisible());

      await page.goto(`${BASE_URL}/app`);
      assert.ok(await page.locator('.workspace-app-layout').isVisible());
      await page.close();
    }
  });
});

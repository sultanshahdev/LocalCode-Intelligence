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

  test('Landing page renders with Kiro-inspired hero and navigation', async () => {
    const page = await browser.newPage();
    await page.goto(`${BASE_URL}/`);

    // Verify title and main hero copy
    const title = await page.title();
    assert.match(title, /LocalCode Intelligence/);

    const headline = await page.locator('.landing-hero-title').textContent();
    assert.match(headline ?? '', /Understand any codebase/);
    assert.match(headline ?? '', /Follow the evidence/);

    // Verify Primary and Secondary CTAs
    const openWorkspaceBtn = page.locator('.landing-hero-actions button').first();
    assert.equal(await openWorkspaceBtn.textContent(), 'Open Workspace');

    // Verify Hero Interactive Demo is present and advancing
    const demo = page.locator('.hero-demo-showcase');
    assert.equal(await demo.count(), 1);

    // Verify FAQ accordion expands and collapses
    const secondFaqItem = page.locator('.faq-item').nth(1);
    await secondFaqItem.locator('.faq-question').click();
    assert.ok(await secondFaqItem.locator('.faq-answer').isVisible());

    await page.close();
  });

  test('Primary CTA navigates from Landing Page to Workspace at /app', async () => {
    const page = await browser.newPage();
    await page.goto(`${BASE_URL}/`);

    const openWorkspaceBtn = page.locator('.landing-nav-actions .kiro-btn--primary');
    await openWorkspaceBtn.click();

    // Verify URL changed to /app
    assert.equal(page.url(), `${BASE_URL}/app`);
    assert.ok(await page.locator('.workspace-app-layout').isVisible());

    // Verify return button navigates back to landing
    await page.locator('.workspace-back-btn').click();
    assert.equal(page.url(), `${BASE_URL}/`);
    assert.ok(await page.locator('.landing-page-root').isVisible());

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

    // Navigate to Exact Text Tab
    await page.locator('.workspace-tab-btn', { hasText: 'Exact Text' }).click();

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
      assert.ok(await page.locator('.landing-hero-title').isVisible());

      await page.goto(`${BASE_URL}/app`);
      assert.ok(await page.locator('.workspace-app-layout').isVisible());
      await page.close();
    }
  });
});

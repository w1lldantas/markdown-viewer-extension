/**
 * Auto light/dark mode, end to end on the installed extension.
 *
 * Covers the three things unit tests cannot: that the resolved theme reaches a
 * real render, that manual mode still ignores a dark OS, and that a live OS
 * flip re-themes an already open viewer without a reload.
 *
 * Each case launches its own context: Playwright's colorScheme is a
 * context-level option, so it cannot be varied inside a shared browser.
 */

import assert from 'node:assert/strict';
import path from 'node:path';
import { after, describe, it } from 'node:test';

import {
  FIXED_SETTINGS,
  SET_STORAGE_JS,
  VIEWER_EMBED_READY_JS,
  WAIT_STANDALONE_READY_JS,
  evalJs,
  installPageDiagnostics,
  launchExtensionContext,
  waitFor,
  type ExtensionContextHarness,
} from '../../helpers/extension-e2e.ts';

const SKIP_EXT = process.env.MV_SKIP_EXT_TESTS === '1';
const LAYOUT_DIR = path.resolve('test/fixtures/layout');
const FIXTURE = 'body-text.md';

const AUTO_SETTINGS = {
  ...FIXED_SETTINGS,
  themeMode: 'auto',
  lightThemeId: 'typewriter',
  darkThemeId: 'midnight',
};

/** Theme CSS is injected asynchronously; sample only once it declares the page bg. */
const THEME_CSS_READY_JS = `() => {
  const s = document.getElementById('theme-dynamic-style');
  return Boolean(s && s.textContent && s.textContent.includes('--md-page-bg'));
}`;

const READ_BACKGROUND_JS = `() => {
  const el = document.getElementById('markdown-content');
  return el ? getComputedStyle(el).backgroundColor : '';
}`;

function isDark(rgb: string): boolean {
  const match = rgb.match(/(\d+),\s*(\d+),\s*(\d+)/);
  assert.ok(match, `unparsable colour: ${rgb}`);
  const [r, g, b] = [Number(match[1]), Number(match[2]), Number(match[3])];
  return (r * 0.299 + g * 0.587 + b * 0.114) < 128;
}

/**
 * Launch a context at the given OS colour scheme, seed settings from an
 * extension page, then open the fixture in standalone mode and wait for the
 * theme CSS to land.
 */
async function openAt(
  prefix: string,
  colorScheme: 'light' | 'dark',
  settings: Record<string, unknown>,
): Promise<{ harness: ExtensionContextHarness; page: import('playwright-core').Page }> {
  const harness = await launchExtensionContext(prefix, { colorScheme });

  const settingsPage = await harness.context.newPage();
  installPageDiagnostics(settingsPage, `${prefix}settings`);
  await settingsPage.goto(
    `chrome-extension://${harness.extensionId}/ui/workspace/viewer-embed.html?embed=1`,
    { waitUntil: 'load' },
  );
  await waitFor(settingsPage, VIEWER_EMBED_READY_JS);
  await evalJs(settingsPage, SET_STORAGE_JS, settings);

  const page = await harness.context.newPage();
  installPageDiagnostics(page, `${prefix}viewer`);
  await page.goto('file://' + path.join(LAYOUT_DIR, FIXTURE), { waitUntil: 'load' });
  await waitFor(page, WAIT_STANDALONE_READY_JS);
  await waitFor(page, THEME_CSS_READY_JS);

  return { harness, page };
}

describe('auto light/dark mode', { skip: SKIP_EXT }, () => {
  let open: ExtensionContextHarness | null = null;

  after(async () => {
    await open?.close();
  });

  it('applies the dark preset when the OS reports dark', async () => {
    const { harness, page } = await openAt('mv-auto-dark-', 'dark', AUTO_SETTINGS);
    open = harness;
    const background = await evalJs(page, READ_BACKGROUND_JS);
    assert.ok(isDark(String(background)), `expected a dark background, got ${background}`);
    await harness.close();
    open = null;
  });

  it('applies the light preset when the OS reports light', async () => {
    const { harness, page } = await openAt('mv-auto-light-', 'light', AUTO_SETTINGS);
    open = harness;
    const background = await evalJs(page, READ_BACKGROUND_JS);
    assert.ok(!isDark(String(background)), `expected a light background, got ${background}`);
    await harness.close();
    open = null;
  });

  it('ignores a dark OS in manual mode', async () => {
    const { harness, page } = await openAt('mv-manual-dark-os-', 'dark', {
      ...FIXED_SETTINGS,
      themeId: 'typewriter',
    });
    open = harness;
    const background = await evalJs(page, READ_BACKGROUND_JS);
    assert.ok(!isDark(String(background)), `manual mode must stay light, got ${background}`);
    await harness.close();
    open = null;
  });

  it('re-themes an open viewer when the OS flips', async () => {
    const { harness, page } = await openAt('mv-auto-flip-', 'light', AUTO_SETTINGS);
    open = harness;

    const before = String(await evalJs(page, READ_BACKGROUND_JS));
    assert.ok(!isDark(before), `expected a light start, got ${before}`);

    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForFunction(
      `(start) => {
        const el = document.getElementById('markdown-content');
        return Boolean(el) && getComputedStyle(el).backgroundColor !== start;
      }`,
      before,
      { timeout: 10000 },
    );

    const after = String(await evalJs(page, READ_BACKGROUND_JS));
    assert.ok(isDark(after), `expected a dark background after the flip, got ${after}`);

    await harness.close();
    open = null;
  });
});

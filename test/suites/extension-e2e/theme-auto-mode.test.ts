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

/**
 * Read `themeId` back from extension storage. Must run on an extension page,
 * the file:// viewer has no chrome.storage access.
 */
const READ_THEME_ID_JS = `() => chrome.storage.local.get('markdownViewerSettings').then((stored) => {
  const settings = stored && stored.markdownViewerSettings;
  return settings && typeof settings.themeId === 'string' ? settings.themeId : null;
})`;

/**
 * True once #markdown-content has a parseable, non-transparent background
 * reading as light (luminance >= 128). Zero-argument predicate body, routed
 * through the suite's waitFor helper (see test/helpers/extension-e2e.ts) -
 * Playwright's own page.waitForFunction rejects a string predicate that
 * declares a parameter, evaluating it as a (truthy) function expression
 * instead of calling it, so it must never be passed there directly.
 */
const WAIT_LIGHT_JS = `() => {
  const el = document.getElementById('markdown-content');
  if (!el) return false;
  const rgb = getComputedStyle(el).backgroundColor;
  const match = rgb.match(/(\\d+),\\s*(\\d+),\\s*(\\d+)/);
  if (!match) return false;
  const [r, g, b] = [Number(match[1]), Number(match[2]), Number(match[3])];
  return (r * 0.299 + g * 0.587 + b * 0.114) >= 128;
}`;

/**
 * True once #markdown-content's background reads as dark (luminance < 128) -
 * the flip's end state, not merely "changed". Zero-argument predicate body,
 * routed through waitFor for the same reason as WAIT_LIGHT_JS above.
 */
const WAIT_DARK_JS = `() => {
  const el = document.getElementById('markdown-content');
  if (!el) return false;
  const rgb = getComputedStyle(el).backgroundColor;
  const match = rgb.match(/(\\d+),\\s*(\\d+),\\s*(\\d+)/);
  if (!match) return false;
  const [r, g, b] = [Number(match[1]), Number(match[2]), Number(match[3])];
  return (r * 0.299 + g * 0.587 + b * 0.114) < 128;
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
): Promise<{
  harness: ExtensionContextHarness;
  page: import('playwright-core').Page;
  settingsPage: import('playwright-core').Page;
}> {
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

  return { harness, page, settingsPage };
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

    // Settle the start value before sampling it: a still-settling theme swap
    // can otherwise be captured mid-transition and misread as "the start".
    await waitFor(page, WAIT_LIGHT_JS, 10000);
    const before = String(await evalJs(page, READ_BACKGROUND_JS));
    assert.ok(!isDark(before), `expected a light start, got ${before}`);

    await page.emulateMedia({ colorScheme: 'dark' });
    // Wait for the END state (dark), not merely "different from start" - a
    // still-light background can differ from the captured start by a
    // rounding artefact and satisfy a naive inequality before the dark theme
    // has actually landed.
    await waitFor(page, WAIT_DARK_JS, 10000);

    const after = String(await evalJs(page, READ_BACKGROUND_JS));
    assert.ok(isDark(after), `expected a dark background after the flip, got ${after}`);

    await harness.close();
    open = null;
  });

  it('leaves the manually selected themeId untouched when the OS flips', async () => {
    // themeId is the user's manual preset and is read by the other hosts; an
    // OS flip resolves the auto pair without writing it back.
    const { harness, page, settingsPage } = await openAt('mv-auto-flip-keeps-id-', 'light', {
      ...AUTO_SETTINGS,
      themeId: 'typewriter',
    });
    open = harness;

    await waitFor(page, WAIT_LIGHT_JS, 10000);
    await page.emulateMedia({ colorScheme: 'dark' });
    await waitFor(page, WAIT_DARK_JS, 10000);

    // Read from the extension page opened by openAt: chrome.storage is not
    // reachable from the file:// viewer.
    const storedThemeId = await evalJs<string | null>(settingsPage, READ_THEME_ID_JS);
    assert.equal(storedThemeId, 'typewriter', 'an OS flip must not overwrite themeId');

    await harness.close();
    open = null;
  });
});

/**
 * The popup's Theme tab, end to end on the installed extension.
 *
 * This is the surface the user actually operates, and the only place
 * `themeId`/`selectedTheme` are ever written. The sibling suite
 * (theme-auto-mode.test.ts) covers the viewer, which only ever READS the
 * resolved pair, so nothing there can catch a popup that hides the wrong
 * row, poisons the inactive side on a mode switch, skips the one-shot
 * migration, or writes the manual preset while in follow-system.
 *
 * Three things are deliberately asserted the hard way:
 *   - visibility is read from the RENDERED box (`offsetParent` plus the
 *     computed `display`), never from the `hidden` attribute alone, because
 *     `.settings-row { display: flex }` in popup.css outranks the attribute
 *     unless `.settings-row[hidden] { display: none }` is present;
 *   - storage is read RAW via `chrome.storage.local` from the popup page, so
 *     the assertions see what was persisted and not a defaults-merged view;
 *   - every wait goes through the suite's `waitFor` helper. Playwright's own
 *     `page.waitForFunction` evaluates a string predicate as an EXPRESSION,
 *     so a function-in-a-string is merely truthy and the wait resolves
 *     immediately without ever testing anything.
 *
 * Each case launches its own context: the popup migrates and persists on
 * first open of the Theme tab, so a shared profile would let one case's
 * write decide the next case's starting state.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  SET_STORAGE_JS,
  VIEWER_EMBED_READY_JS,
  evalJs,
  installPageDiagnostics,
  launchExtensionContext,
  waitFor,
  type ExtensionContextHarness,
} from '../../helpers/extension-e2e.ts';

const SKIP_EXT = process.env.MV_SKIP_EXT_TESTS === '1';

/** Seed sibling storage keys the settings object does not carry (legacy `selectedTheme`). */
const SET_RAW_STORAGE_JS = `(items) => chrome.storage.local.set(items)`;

/** The popup boots on the History tab; the Theme tab button is what we click. */
const POPUP_READY_JS = `() => Boolean(window.popupManager && document.querySelector('[data-tab="theme"]'))`;

/**
 * Theme tab is on screen AND the registry-driven option lists have landed.
 * loadThemes awaits the migration write before populating, so once both
 * selects have options the one-shot migration has already hit storage.
 */
const THEME_TAB_READY_JS = `() => {
  const panel = document.getElementById('theme');
  if (!panel || !panel.classList.contains('active')) return false;
  const mode = document.getElementById('theme-mode-selector');
  const light = document.getElementById('theme-light-selector');
  const dark = document.getElementById('theme-dark-selector');
  if (!mode || !light || !dark) return false;
  return light.options.length > 0 && dark.options.length > 0;
}`;

/**
 * Raw storage, straight from chrome.storage.local on the popup page. Nothing
 * merges DEFAULT_SETTINGS in on this path, which is exactly the point: the
 * delta case below asserts on the key SET that was persisted.
 */
const READ_RAW_STORAGE_JS = `() => chrome.storage.local.get(['markdownViewerSettings', 'selectedTheme']).then((stored) => ({
  settings: (stored && stored.markdownViewerSettings) || null,
  selectedTheme: stored && 'selectedTheme' in stored ? stored.selectedTheme : null,
}))`;

/**
 * What the user can SEE for one row, not what the attribute claims.
 * `hidden` is reported too, so a failure says whether the attribute or the
 * stylesheet is the side that broke.
 */
const READ_ROW_STATE_JS = `() => {
  const read = (id) => {
    const el = document.getElementById(id);
    if (!el) return null;
    return {
      hidden: el.hidden,
      display: getComputedStyle(el).display,
      rendered: el.offsetParent !== null,
    };
  };
  return { light: read('theme-light-row'), dark: read('theme-dark-row') };
}`;

const READ_SELECT_VALUES_JS = `() => {
  const value = (id) => {
    const el = document.getElementById(id);
    return el ? el.value : null;
  };
  return {
    mode: value('theme-mode-selector'),
    light: value('theme-light-selector'),
    dark: value('theme-dark-selector'),
  };
}`;

interface RowState {
  hidden: boolean;
  display: string;
  rendered: boolean;
}

interface RowStates {
  light: RowState | null;
  dark: RowState | null;
}

interface SelectValues {
  mode: string | null;
  light: string | null;
  dark: string | null;
}

interface StoredState {
  settings: Record<string, unknown> | null;
  selectedTheme: string | null;
}

/**
 * Build a zero-argument predicate body over raw storage. `s` is the stored
 * settings object (never null) and `selectedTheme` the legacy sibling key.
 * Zero-argument on purpose: it is routed through `waitFor`, never through
 * page.waitForFunction (see the file header).
 */
function storageMatchesJs(expression: string): string {
  return `() => chrome.storage.local.get(['markdownViewerSettings', 'selectedTheme']).then((stored) => {
    const s = (stored && stored.markdownViewerSettings) || {};
    const selectedTheme = stored && 'selectedTheme' in stored ? stored.selectedTheme : undefined;
    return Boolean(${expression});
  })`;
}

/** A mode the user could have chosen, i.e. the migration has run and landed. */
const MIGRATION_SETTLED_JS = storageMatchesJs(
  `s.themeMode === 'light' || s.themeMode === 'dark' || s.themeMode === 'auto'`,
);

function assertRowVisible(state: RowState | null, label: string): void {
  assert.ok(state, `${label} row is missing from the popup`);
  assert.equal(state.rendered, true, `${label} row must be on screen, got ${JSON.stringify(state)}`);
  assert.notEqual(state.display, 'none', `${label} row must not be display:none, got ${JSON.stringify(state)}`);
}

/**
 * Hidden means hidden to the USER. The `hidden` attribute alone is not
 * enough: popup.css gives .settings-row `display: flex`, which outranks it
 * unless the `.settings-row[hidden]` rule is there, and that is precisely
 * the regression that shipped a visible light row in Dark mode.
 */
function assertRowHidden(state: RowState | null, label: string): void {
  assert.ok(state, `${label} row is missing from the popup`);
  assert.equal(state.display, 'none', `${label} row must compute to display:none, got ${JSON.stringify(state)}`);
  assert.equal(state.rendered, false, `${label} row must not render a box, got ${JSON.stringify(state)}`);
}

interface PopupSeed {
  /** Written whole into markdownViewerSettings, so an absent key stays absent. */
  settings: Record<string, unknown>;
  /** Sibling storage keys, e.g. the legacy selectedTheme. */
  extraKeys?: Record<string, unknown>;
}

/**
 * Seed storage from an extension page (chrome.storage is unreachable from a
 * content page), then open the real popup document and switch to the Theme
 * tab, which is what triggers loadThemes and therefore the migration.
 */
async function openPopup(prefix: string, seed: PopupSeed): Promise<{
  harness: ExtensionContextHarness;
  page: import('playwright-core').Page;
}> {
  const harness = await launchExtensionContext(prefix);

  const seedPage = await harness.context.newPage();
  installPageDiagnostics(seedPage, `${prefix}seed`);
  await seedPage.goto(
    `chrome-extension://${harness.extensionId}/ui/workspace/viewer-embed.html?embed=1`,
    { waitUntil: 'load' },
  );
  await waitFor(seedPage, VIEWER_EMBED_READY_JS);
  await evalJs(seedPage, SET_STORAGE_JS, seed.settings);
  if (seed.extraKeys) {
    await evalJs(seedPage, SET_RAW_STORAGE_JS, seed.extraKeys);
  }
  await seedPage.close();

  const page = await harness.context.newPage();
  installPageDiagnostics(page, `${prefix}popup`);
  await page.goto(`chrome-extension://${harness.extensionId}/ui/popup/popup.html`, { waitUntil: 'load' });
  await waitFor(page, POPUP_READY_JS);
  await page.click('[data-tab="theme"]');
  await waitFor(page, THEME_TAB_READY_JS);

  return { harness, page };
}

/**
 * Run one case against its own popup and ALWAYS close the context, pass or
 * fail. A leaked persistent context keeps the browser, and therefore the
 * node:test process, alive, which turns a red run into a hang instead of a
 * readable failure.
 */
async function withPopup(
  prefix: string,
  seed: PopupSeed,
  body: (page: import('playwright-core').Page) => Promise<void>,
): Promise<void> {
  const { harness, page } = await openPopup(prefix, seed);
  try {
    await body(page);
  } finally {
    await harness.close();
  }
}

describe('popup theme mode', { skip: SKIP_EXT }, () => {
  it('migrates a legacy light install to light mode', async () => {
    // Only themeId is stored, the shape every pre-themeMode install has.
    await withPopup('mv-popup-migrate-light-', { settings: { themeId: 'typewriter' } }, async (page) => {
      await waitFor(page, MIGRATION_SETTLED_JS);

      const values = await evalJs<SelectValues>(page, READ_SELECT_VALUES_JS);
      assert.equal(values.mode, 'light', 'a legacy light install must be presented as Light');
      assert.equal(values.light, 'typewriter', 'the light select must show the migrated preset');

      const stored = await evalJs<StoredState>(page, READ_RAW_STORAGE_JS);
      assert.equal(stored.settings?.themeMode, 'light');
      assert.equal(stored.settings?.lightThemeId, 'typewriter');
    });
  });

  it('migrates a legacy dark install to dark mode', async () => {
    // midnight is registry category "dark", the only thing the migration
    // classifies on.
    await withPopup('mv-popup-migrate-dark-', { settings: { themeId: 'midnight' } }, async (page) => {
      await waitFor(page, MIGRATION_SETTLED_JS);

      const values = await evalJs<SelectValues>(page, READ_SELECT_VALUES_JS);
      assert.equal(values.mode, 'dark', 'a legacy dark install must be presented as Dark');
      assert.equal(values.dark, 'midnight', 'the dark select must show the migrated preset');

      const stored = await evalJs<StoredState>(page, READ_RAW_STORAGE_JS);
      assert.equal(stored.settings?.themeMode, 'dark');
      assert.equal(stored.settings?.darkThemeId, 'midnight');
    });
  });

  it('treats a themeMode outside the enum as never configured', async () => {
    // 'manual' is the literal value an earlier build of this branch left in
    // storage. It is not in the enum, so it must migrate like a legacy
    // install instead of being trusted and silently flipping the theme.
    await withPopup(
      'mv-popup-migrate-manual-',
      { settings: { themeId: 'midnight', themeMode: 'manual' } },
      async (page) => {
        await waitFor(page, MIGRATION_SETTLED_JS);

        const values = await evalJs<SelectValues>(page, READ_SELECT_VALUES_JS);
        assert.equal(values.mode, 'dark', "an out-of-enum mode must migrate by the theme's category");
        assert.equal(values.dark, 'midnight');

        const stored = await evalJs<StoredState>(page, READ_RAW_STORAGE_JS);
        assert.equal(stored.settings?.themeMode, 'dark', "'manual' must not survive in storage");
        assert.equal(stored.settings?.darkThemeId, 'midnight');
      },
    );
  });

  it('renders only the light row in light mode', async () => {
    await withPopup(
      'mv-popup-rows-light-',
      { settings: { themeId: 'typewriter', themeMode: 'light', lightThemeId: 'typewriter', darkThemeId: 'midnight' } },
      async (page) => {
        const rows = await evalJs<RowStates>(page, READ_ROW_STATE_JS);
        assertRowVisible(rows.light, 'light');
        assertRowHidden(rows.dark, 'dark');
      },
    );
  });

  it('renders only the dark row in dark mode', async () => {
    await withPopup(
      'mv-popup-rows-dark-',
      { settings: { themeId: 'midnight', themeMode: 'dark', lightThemeId: 'typewriter', darkThemeId: 'midnight' } },
      async (page) => {
        const rows = await evalJs<RowStates>(page, READ_ROW_STATE_JS);
        assertRowHidden(rows.light, 'light');
        assertRowVisible(rows.dark, 'dark');
      },
    );
  });

  it('renders both rows in follow-system mode', async () => {
    await withPopup(
      'mv-popup-rows-auto-',
      { settings: { themeId: 'typewriter', themeMode: 'auto', lightThemeId: 'typewriter', darkThemeId: 'midnight' } },
      async (page) => {
        const rows = await evalJs<RowStates>(page, READ_ROW_STATE_JS);
        assertRowVisible(rows.light, 'light');
        assertRowVisible(rows.dark, 'dark');
      },
    );
  });

  it('switches the visible row without poisoning the unconfigured side', async () => {
    // Light is configured, dark never was (empty = not configured). Moving
    // to Dark must seed dark from the dark fallback, not from the light id.
    await withPopup(
      'mv-popup-switch-',
      {
        settings: { themeId: 'typewriter', themeMode: 'light', lightThemeId: 'typewriter', darkThemeId: '' },
        extraKeys: { selectedTheme: 'typewriter' },
      },
      async (page) => {
        const before = await evalJs<RowStates>(page, READ_ROW_STATE_JS);
        assertRowVisible(before.light, 'light');
        assertRowHidden(before.dark, 'dark');

        await page.selectOption('#theme-mode-selector', 'dark');
        await waitFor(page, storageMatchesJs(`s.themeMode === 'dark'`));

        const afterDark = await evalJs<RowStates>(page, READ_ROW_STATE_JS);
        assertRowHidden(afterDark.light, 'light');
        assertRowVisible(afterDark.dark, 'dark');

        const darkStored = await evalJs<StoredState>(page, READ_RAW_STORAGE_JS);
        assert.equal(darkStored.settings?.darkThemeId, 'midnight', 'the dark side must seed from the dark fallback');
        assert.equal(
          darkStored.settings?.lightThemeId,
          'typewriter',
          'switching to Dark must not overwrite the light side',
        );
        assert.equal(darkStored.settings?.themeId, 'midnight');
        assert.equal(darkStored.selectedTheme, 'midnight');

        await page.selectOption('#theme-mode-selector', 'light');
        await waitFor(page, storageMatchesJs(`s.themeMode === 'light'`));

        const backToLight = await evalJs<RowStates>(page, READ_ROW_STATE_JS);
        assertRowVisible(backToLight.light, 'light');
        assertRowHidden(backToLight.dark, 'dark');

        const lightStored = await evalJs<StoredState>(page, READ_RAW_STORAGE_JS);
        assert.equal(
          lightStored.settings?.lightThemeId,
          'typewriter',
          'switching back must keep the light side the user configured',
        );
        assert.equal(
          lightStored.settings?.darkThemeId,
          'midnight',
          'switching back to Light must not overwrite the dark side',
        );
        assert.equal(lightStored.settings?.themeId, 'typewriter');
        assert.equal(lightStored.selectedTheme, 'typewriter');
      },
    );
  });

  it('mirrors a light-mode pick into themeId and selectedTheme', async () => {
    await withPopup(
      'mv-popup-pick-light-',
      {
        settings: { themeId: 'typewriter', themeMode: 'light', lightThemeId: 'typewriter', darkThemeId: 'midnight' },
        extraKeys: { selectedTheme: 'typewriter' },
      },
      async (page) => {
        await page.selectOption('#theme-light-selector', 'garamond');
        await waitFor(page, storageMatchesJs(`s.lightThemeId === 'garamond'`));

        const stored = await evalJs<StoredState>(page, READ_RAW_STORAGE_JS);
        assert.equal(stored.settings?.themeId, 'garamond', 'an active-side pick is the manual preset');
        assert.equal(stored.selectedTheme, 'garamond', 'the legacy key must follow the manual preset');
        assert.equal(stored.settings?.darkThemeId, 'midnight', 'the inactive side must not move');
      },
    );
  });

  it('mirrors a dark-mode pick into themeId and selectedTheme', async () => {
    await withPopup(
      'mv-popup-pick-dark-',
      {
        settings: { themeId: 'midnight', themeMode: 'dark', lightThemeId: 'typewriter', darkThemeId: 'midnight' },
        extraKeys: { selectedTheme: 'midnight' },
      },
      async (page) => {
        await page.selectOption('#theme-dark-selector', 'dracula');
        await waitFor(page, storageMatchesJs(`s.darkThemeId === 'dracula'`));

        const stored = await evalJs<StoredState>(page, READ_RAW_STORAGE_JS);
        assert.equal(stored.settings?.themeId, 'dracula', 'an active-side pick is the manual preset');
        assert.equal(stored.selectedTheme, 'dracula', 'the legacy key must follow the manual preset');
        assert.equal(stored.settings?.lightThemeId, 'typewriter', 'the inactive side must not move');
      },
    );
  });

  it('never writes themeId or selectedTheme from a follow-system pick', async () => {
    // The auto invariant, asserted where it is actually written. The viewer
    // suite cannot cover this: the viewer only ever reads.
    await withPopup(
      'mv-popup-pick-auto-',
      {
        settings: { themeId: 'typewriter', themeMode: 'auto', lightThemeId: 'typewriter', darkThemeId: 'midnight' },
        extraKeys: { selectedTheme: 'typewriter' },
      },
      async (page) => {
        await page.selectOption('#theme-light-selector', 'garamond');
        await waitFor(page, storageMatchesJs(`s.lightThemeId === 'garamond'`));

        await page.selectOption('#theme-dark-selector', 'dracula');
        await waitFor(page, storageMatchesJs(`s.darkThemeId === 'dracula'`));

        const stored = await evalJs<StoredState>(page, READ_RAW_STORAGE_JS);
        assert.equal(stored.settings?.lightThemeId, 'garamond');
        assert.equal(stored.settings?.darkThemeId, 'dracula');
        assert.equal(stored.settings?.themeId, 'typewriter', 'follow-system must never move the manual preset');
        assert.equal(stored.selectedTheme, 'typewriter', 'follow-system must never move the legacy key');
      },
    );
  });

  it('persists only the theme delta when it migrates', async () => {
    // Writing the whole in-memory settings object would materialise every
    // schema key here and destroy the "never configured" sentinels the
    // resolver depends on.
    await withPopup('mv-popup-delta-', { settings: { themeId: 'typewriter' } }, async (page) => {
      await waitFor(page, MIGRATION_SETTLED_JS);

      const stored = await evalJs<StoredState>(page, READ_RAW_STORAGE_JS);
      const keys = Object.keys(stored.settings ?? {}).sort();
      assert.deepEqual(
        keys,
        ['darkThemeId', 'lightThemeId', 'themeId', 'themeMode'],
        `the migration must add only the theme keys, got ${JSON.stringify(keys)}`,
      );
    });
  });
});

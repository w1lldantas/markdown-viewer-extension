/**
 * Theme resolution tests.
 *
 * resolveEffectiveThemeId is the whole decision: manual mode is today's
 * behaviour (themeId wins), auto mode picks a side from the OS preference.
 * Missing or malformed values must fall back to the generated defaults
 * rather than producing an empty theme id, which would fail the theme load.
 */

import assert from 'assert';
import { describe, it } from 'node:test';
import { resolveEffectiveThemeId } from '../../../src/utils/theme-resolver';

describe('resolveEffectiveThemeId', () => {
  it('uses themeId in manual mode, dark OS included', () => {
    const selection = { themeMode: 'manual', themeId: 'typewriter', lightThemeId: 'swiss', darkThemeId: 'dracula' };
    assert.strictEqual(resolveEffectiveThemeId(selection, false), 'typewriter');
    assert.strictEqual(resolveEffectiveThemeId(selection, true), 'typewriter');
  });

  it('defaults to manual mode when themeMode is absent', () => {
    assert.strictEqual(resolveEffectiveThemeId({ themeId: 'swiss' }, true), 'swiss');
  });

  it('defaults to manual mode when themeMode is unknown', () => {
    assert.strictEqual(resolveEffectiveThemeId({ themeMode: 'light', themeId: 'swiss' }, true), 'swiss');
  });

  it('picks the light side in auto mode under a light OS', () => {
    const selection = { themeMode: 'auto', themeId: 'typewriter', lightThemeId: 'swiss', darkThemeId: 'dracula' };
    assert.strictEqual(resolveEffectiveThemeId(selection, false), 'swiss');
  });

  it('picks the dark side in auto mode under a dark OS', () => {
    const selection = { themeMode: 'auto', themeId: 'typewriter', lightThemeId: 'swiss', darkThemeId: 'dracula' };
    assert.strictEqual(resolveEffectiveThemeId(selection, true), 'dracula');
  });

  it('falls back to the defaults when the auto sides are missing', () => {
    assert.strictEqual(resolveEffectiveThemeId({ themeMode: 'auto' }, false), 'default');
    assert.strictEqual(resolveEffectiveThemeId({ themeMode: 'auto' }, true), 'midnight');
  });

  it('falls back to the defaults when the auto sides are empty strings', () => {
    const selection = { themeMode: 'auto', lightThemeId: '', darkThemeId: '' };
    assert.strictEqual(resolveEffectiveThemeId(selection, false), 'default');
    assert.strictEqual(resolveEffectiveThemeId(selection, true), 'midnight');
  });

  it('falls back to the default theme when themeId is missing in manual mode', () => {
    assert.strictEqual(resolveEffectiveThemeId({}, false), 'default');
    assert.strictEqual(resolveEffectiveThemeId({ themeMode: 'manual', themeId: '' }, false), 'default');
  });
});

/**
 * Theme resolution tests.
 *
 * resolveEffectiveThemeId is the whole decision: light/dark pin a side,
 * auto picks a side from the OS preference. With a themeMode inside the
 * enum the sides are symmetric, light falls through lightThemeId ->
 * 'default' and dark through darkThemeId -> 'midnight'. Only an absent or
 * out-of-enum themeMode still falls through to themeId, so a legacy install
 * that only ever set themeId keeps rendering what it renders today.
 */

import assert from 'assert';
import { describe, it } from 'node:test';
import { resolveEffectiveThemeId } from '../../../src/utils/theme-resolver';

describe('resolveEffectiveThemeId', () => {
  it('mode light uses the light side regardless of OS state', () => {
    const selection = { themeMode: 'light', themeId: 'typewriter', lightThemeId: 'swiss', darkThemeId: 'dracula' };
    assert.strictEqual(resolveEffectiveThemeId(selection, false), 'swiss');
    assert.strictEqual(resolveEffectiveThemeId(selection, true), 'swiss');
  });

  it('mode dark uses the dark side regardless of OS state', () => {
    const selection = { themeMode: 'dark', themeId: 'typewriter', lightThemeId: 'swiss', darkThemeId: 'dracula' };
    assert.strictEqual(resolveEffectiveThemeId(selection, false), 'dracula');
    assert.strictEqual(resolveEffectiveThemeId(selection, true), 'dracula');
  });

  it('mode auto follows the OS state', () => {
    const selection = { themeMode: 'auto', themeId: 'typewriter', lightThemeId: 'swiss', darkThemeId: 'dracula' };
    assert.strictEqual(resolveEffectiveThemeId(selection, false), 'swiss');
    assert.strictEqual(resolveEffectiveThemeId(selection, true), 'dracula');
  });

  it('falls back to the light side when themeMode is absent', () => {
    assert.strictEqual(resolveEffectiveThemeId({ lightThemeId: 'swiss', darkThemeId: 'dracula' }, false), 'swiss');
    assert.strictEqual(resolveEffectiveThemeId({ lightThemeId: 'swiss', darkThemeId: 'dracula' }, true), 'swiss');
  });

  it('falls back to the light side when themeMode is an unknown value', () => {
    const selection = { themeMode: 'manual', lightThemeId: 'swiss', darkThemeId: 'dracula' };
    assert.strictEqual(resolveEffectiveThemeId(selection, false), 'swiss');
    assert.strictEqual(resolveEffectiveThemeId(selection, true), 'swiss');
  });

  it('legacy selection with only a dark themeId keeps rendering it under default mode', () => {
    assert.strictEqual(resolveEffectiveThemeId({ themeId: 'midnight' }, false), 'midnight');
    assert.strictEqual(resolveEffectiveThemeId({ themeId: 'midnight' }, true), 'midnight');
  });

  it('legacy selection with only a light themeId keeps rendering it under default mode', () => {
    assert.strictEqual(resolveEffectiveThemeId({ themeId: 'swiss' }, false), 'swiss');
    assert.strictEqual(resolveEffectiveThemeId({ themeId: 'swiss' }, true), 'swiss');
  });

  it('an explicit mode keeps themeId out of the light side and uses the default preset', () => {
    assert.strictEqual(resolveEffectiveThemeId({ themeMode: 'light', lightThemeId: '', themeId: 'swiss' }, false), 'default');
    assert.strictEqual(resolveEffectiveThemeId({ themeMode: 'light', lightThemeId: '', themeId: '' }, false), 'default');
  });

  it('follow-system on a light OS ignores a dark themeId mirrored by the mode switch', () => {
    // switchThemeMode mirrors the active side's id into themeId for the other
    // hosts. That mirror must stay an OUTPUT: picking dark and then switching
    // to auto used to leave themeId='midnight' as the light side's fallback,
    // so a light OS rendered midnight.
    const selection = { themeMode: 'auto', themeId: 'midnight', lightThemeId: '', darkThemeId: 'midnight' };
    assert.strictEqual(resolveEffectiveThemeId(selection, false), 'default');
    assert.strictEqual(resolveEffectiveThemeId(selection, true), 'midnight');
  });

  it('empty string on the dark side falls through to the midnight fallback', () => {
    assert.strictEqual(resolveEffectiveThemeId({ themeMode: 'dark', darkThemeId: '' }, false), 'midnight');
    assert.strictEqual(resolveEffectiveThemeId({ themeMode: 'auto', darkThemeId: '' }, true), 'midnight');
  });

  it('a selection with nothing at all resolves to the default light theme', () => {
    assert.strictEqual(resolveEffectiveThemeId({}, false), 'default');
    assert.strictEqual(resolveEffectiveThemeId({}, true), 'default');
  });
});

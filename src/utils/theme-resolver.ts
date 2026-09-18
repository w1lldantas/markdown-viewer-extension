/**
 * Resolves which theme preset the viewer should apply.
 *
 * Pure on purpose: no storage, no DOM, no side effects. The OS preference
 * arrives as a boolean so the caller owns the matchMedia read, and this
 * function stays unit-testable in the fibjs runner.
 *
 * Manual mode is the historical behaviour and must never be altered by the
 * new keys. Auto mode never writes back to themeId, so the user's manual
 * choice survives an OS flip and other hosts keep reading it unchanged.
 */

import { DEFAULT_SETTINGS } from '../config/settings.generated';

export interface ThemeSelection {
  themeMode?: string;
  themeId?: string;
  lightThemeId?: string;
  darkThemeId?: string;
}

function firstNonEmpty(...values: Array<string | undefined>): string {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) {
      return value;
    }
  }
  return DEFAULT_SETTINGS.themeId;
}

export function resolveEffectiveThemeId(selection: ThemeSelection, isDark: boolean): string {
  if (selection.themeMode !== 'auto') {
    return firstNonEmpty(selection.themeId);
  }
  return isDark
    ? firstNonEmpty(selection.darkThemeId, DEFAULT_SETTINGS.darkThemeId)
    : firstNonEmpty(selection.lightThemeId, DEFAULT_SETTINGS.lightThemeId);
}

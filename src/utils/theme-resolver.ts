/**
 * Resolves which theme preset the viewer should apply.
 *
 * Pure on purpose: no storage, no DOM, no side effects. The OS preference
 * arrives as a boolean so the caller owns the matchMedia read, and this
 * function stays unit-testable in the fibjs runner.
 *
 * lightThemeId/darkThemeId default to the empty string, meaning "not
 * configured yet". This lets a legacy install that only ever set themeId
 * keep rendering exactly the preset it renders today: the light side falls
 * through to themeId when lightThemeId is empty, and mode defaults to
 * 'light', so nothing regresses on upgrade.
 */

import { DEFAULT_SETTINGS } from '../config/settings.generated';

// darkThemeId now defaults to '' (see above), so the historical midnight
// fallback can no longer be read off DEFAULT_SETTINGS. Kept as the single
// named constant so the literal isn't scattered.
const FALLBACK_DARK_THEME_ID = 'midnight';

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

function resolveLightSide(selection: ThemeSelection): string {
  return firstNonEmpty(selection.lightThemeId, selection.themeId);
}

function resolveDarkSide(selection: ThemeSelection): string {
  return firstNonEmpty(selection.darkThemeId, FALLBACK_DARK_THEME_ID);
}

export function resolveEffectiveThemeId(selection: ThemeSelection, isDark: boolean): string {
  if (selection.themeMode === 'auto') {
    return isDark ? resolveDarkSide(selection) : resolveLightSide(selection);
  }
  if (selection.themeMode === 'dark') {
    return resolveDarkSide(selection);
  }
  return resolveLightSide(selection);
}

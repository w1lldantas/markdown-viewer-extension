/**
 * Resolves which theme preset the viewer should apply.
 *
 * Pure on purpose: no storage, no DOM, no side effects. The OS preference
 * arrives as a boolean so the caller owns the matchMedia read, and this
 * function stays unit-testable in the fibjs runner.
 *
 * themeMode/lightThemeId/darkThemeId all default to the empty string,
 * meaning "not configured yet". themeMode needs that sentinel as much as the
 * other two, because SettingsService merges DEFAULT_SETTINGS over the stored
 * object, so an absent key never reaches here, the default does. A legacy
 * install that only ever set themeId therefore arrives with themeMode '',
 * and only that case (plus an absent or out-of-enum value) falls through to
 * themeId, so the preset it renders today survives the upgrade.
 *
 * With a themeMode inside the enum the two sides are SYMMETRIC, light is
 * lightThemeId or the default preset and dark is darkThemeId or the
 * midnight fallback. themeId stays an OUTPUT (the popup mirrors the active
 * side into it for the other hosts) and never feeds back in as an input,
 * otherwise a dark id mirrored there would resolve on the light side too.
 */

import { DEFAULT_SETTINGS } from '../config/settings.generated';

// darkThemeId now defaults to '' (see above), so the historical midnight
// fallback can no longer be read off DEFAULT_SETTINGS. Kept as the single
// named constant so the literal isn't scattered.
export const FALLBACK_DARK_THEME_ID = 'midnight';

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
  return firstNonEmpty(selection.lightThemeId);
}

function resolveDarkSide(selection: ThemeSelection): string {
  return firstNonEmpty(selection.darkThemeId, FALLBACK_DARK_THEME_ID);
}

// Only for a themeMode that is the empty sentinel, absent or outside the
// enum, the one real legacy-compatibility case. An explicit mode goes
// through resolveLightSide, which never reads themeId.
function resolveLegacyLightSide(selection: ThemeSelection): string {
  return firstNonEmpty(selection.lightThemeId, selection.themeId);
}

export function resolveEffectiveThemeId(selection: ThemeSelection, isDark: boolean): string {
  if (selection.themeMode === 'auto') {
    return isDark ? resolveDarkSide(selection) : resolveLightSide(selection);
  }
  if (selection.themeMode === 'dark') {
    return resolveDarkSide(selection);
  }
  if (selection.themeMode === 'light') {
    return resolveLightSide(selection);
  }
  // '' (the schema default), undefined, or anything outside the enum.
  return resolveLegacyLightSide(selection);
}

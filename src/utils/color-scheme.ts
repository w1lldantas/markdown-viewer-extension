/**
 * OS colour-scheme detection, shared by the viewer theme resolution and the
 * host-page code-block scanner.
 *
 * matchMedia is read off globalThis at call time on purpose: this module is
 * imported by bundles that also run in fibjs and in worker bootstraps where
 * no DOM exists, and an import-time capture would crash them.
 */

const DARK_QUERY = '(prefers-color-scheme: dark)';

type LegacyMediaQueryList = MediaQueryList & {
  addListener?: (listener: () => void) => void;
  removeListener?: (listener: () => void) => void;
};

function getMediaQueryList(): LegacyMediaQueryList | null {
  const mm = (globalThis as { matchMedia?: (query: string) => MediaQueryList }).matchMedia;
  if (typeof mm !== 'function') {
    return null;
  }
  try {
    return mm(DARK_QUERY) as LegacyMediaQueryList;
  } catch {
    return null;
  }
}

/** True when the OS/browser reports a dark colour-scheme preference. */
export function prefersDarkScheme(): boolean {
  return getMediaQueryList()?.matches === true;
}

/**
 * Call `onChange` whenever the OS colour-scheme preference flips.
 * Returns an unsubscribe function; it is a no-op when matchMedia is missing.
 */
export function watchColorScheme(onChange: (isDark: boolean) => void): () => void {
  const mql = getMediaQueryList();
  if (!mql) {
    return () => { /* nothing to unsubscribe */ };
  }

  const handler = (): void => { onChange(mql.matches === true); };

  // addEventListener is standard; addListener is the deprecated Safari fallback.
  if (typeof mql.addEventListener === 'function') {
    mql.addEventListener('change', handler);
    return () => { mql.removeEventListener?.('change', handler); };
  }
  if (typeof mql.addListener === 'function') {
    mql.addListener(handler);
    return () => { mql.removeListener?.(handler); };
  }
  return () => { /* no listener API available */ };
}

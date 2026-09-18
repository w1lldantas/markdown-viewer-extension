/**
 * OS colour-scheme helper tests.
 *
 * The helper is the single place that reads `prefers-color-scheme` for the
 * viewer. It must degrade to light when matchMedia is missing (fibjs, CLI,
 * worker bootstraps) and must support the deprecated Safari addListener API.
 */

import assert from 'assert';
import { describe, it } from 'node:test';
import { prefersDarkScheme, watchColorScheme } from '../../../src/utils/color-scheme';

interface FakeMql {
  matches: boolean;
  media: string;
  addEventListener?: (type: string, fn: () => void) => void;
  removeEventListener?: (type: string, fn: () => void) => void;
  addListener?: (fn: () => void) => void;
  removeListener?: (fn: () => void) => void;
}

function withMatchMedia(mql: FakeMql | null, run: () => void): void {
  const original = (globalThis as Record<string, unknown>).matchMedia;
  if (mql === null) {
    delete (globalThis as Record<string, unknown>).matchMedia;
  } else {
    (globalThis as Record<string, unknown>).matchMedia = (query: string) => {
      mql.media = query;
      return mql;
    };
  }
  try {
    run();
  } finally {
    if (original === undefined) {
      delete (globalThis as Record<string, unknown>).matchMedia;
    } else {
      (globalThis as Record<string, unknown>).matchMedia = original;
    }
  }
}

describe('color-scheme helper', () => {
  it('returns false when matchMedia is unavailable', () => {
    withMatchMedia(null, () => {
      assert.strictEqual(prefersDarkScheme(), false);
    });
  });

  it('reports dark when the media query matches', () => {
    const mql: FakeMql = { matches: true, media: '' };
    withMatchMedia(mql, () => {
      assert.strictEqual(prefersDarkScheme(), true);
      assert.strictEqual(mql.media, '(prefers-color-scheme: dark)');
    });
  });

  it('reports light when the media query does not match', () => {
    withMatchMedia({ matches: false, media: '' }, () => {
      assert.strictEqual(prefersDarkScheme(), false);
    });
  });

  it('notifies the modern addEventListener API and unsubscribes', () => {
    const handlers: Array<() => void> = [];
    const mql: FakeMql = {
      matches: false,
      media: '',
      addEventListener: (_type, fn) => { handlers.push(fn); },
      removeEventListener: (_type, fn) => {
        const index = handlers.indexOf(fn);
        if (index >= 0) handlers.splice(index, 1);
      },
    };
    withMatchMedia(mql, () => {
      const seen: boolean[] = [];
      const stop = watchColorScheme((isDark) => { seen.push(isDark); });
      mql.matches = true;
      handlers.forEach((fn) => { fn(); });
      assert.deepStrictEqual(seen, [true]);
      stop();
      assert.strictEqual(handlers.length, 0);
      mql.matches = false;
      handlers.forEach((fn) => { fn(); });
      assert.deepStrictEqual(seen, [true]);
    });
  });

  it('falls back to the deprecated addListener API', () => {
    const handlers: Array<() => void> = [];
    const mql: FakeMql = {
      matches: true,
      media: '',
      addListener: (fn) => { handlers.push(fn); },
      removeListener: (fn) => {
        const index = handlers.indexOf(fn);
        if (index >= 0) handlers.splice(index, 1);
      },
    };
    withMatchMedia(mql, () => {
      const seen: boolean[] = [];
      const stop = watchColorScheme((isDark) => { seen.push(isDark); });
      handlers.forEach((fn) => { fn(); });
      assert.deepStrictEqual(seen, [true]);
      stop();
      assert.strictEqual(handlers.length, 0);
    });
  });

  it('returns a no-op unsubscribe when matchMedia is unavailable', () => {
    withMatchMedia(null, () => {
      const stop = watchColorScheme(() => {
        assert.fail('callback must not fire without matchMedia');
      });
      assert.strictEqual(typeof stop, 'function');
      stop();
    });
  });
});

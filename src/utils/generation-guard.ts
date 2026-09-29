/**
 * Last-writer-wins ordering for overlapping async resolutions.
 *
 * Pure on purpose: no storage, no DOM, no timers. Every host that can have
 * two theme resolutions in flight at once (an OS colour-scheme flip racing a
 * popup broadcast, say) needs the same three lines, and writing them by hand
 * per file is how one copy ended up without the guard at all.
 *
 * The contract is minimal. `begin()` opens a generation and hands back the
 * check for it; whatever the caller awaits afterwards, `isCurrent()` is false
 * as soon as a newer generation has been opened, so the stale result is
 * dropped instead of landing on top of the newer one. `invalidate()` retires
 * every in-flight generation without opening one, for the paths that apply a
 * result directly and only need the older resolutions to stand down.
 */

export interface GenerationGuard {
  /** Open a new generation; the returned check is true until a newer one opens. */
  begin: () => () => boolean;
  /** Retire every in-flight generation without opening a new one. */
  invalidate: () => void;
}

export function createGenerationGuard(): GenerationGuard {
  let generation = 0;
  return {
    begin(): () => boolean {
      const started = ++generation;
      return () => started === generation;
    },
    invalidate(): void {
      generation += 1;
    },
  };
}

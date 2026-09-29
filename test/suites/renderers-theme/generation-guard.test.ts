/**
 * Generation guard tests.
 *
 * The guard is what keeps two overlapping theme resolutions from landing out
 * of order. The case that matters is the one that used to break in practice:
 * an older resolution that finishes AFTER a newer one has already started
 * must be dropped, otherwise a stale theme paints over the fresh one. The
 * mechanism is pure, so the async races below are expressed with plain
 * deferred promises and no DOM, no storage and no timers.
 */

import assert from 'assert';
import { describe, it } from 'node:test';
import { createGenerationGuard } from '../../../src/utils/generation-guard';

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => { resolve = r; });
  return { promise, resolve };
}

describe('createGenerationGuard', () => {
  it('keeps a lone resolution current', () => {
    const guard = createGenerationGuard();
    const isCurrent = guard.begin();
    assert.strictEqual(isCurrent(), true);
  });

  it('drops the older resolution when it finishes after a newer one', async () => {
    const guard = createGenerationGuard();
    const applied: string[] = [];
    const slow = deferred();
    const fast = deferred();

    async function resolve(label: string, gate: Promise<void>): Promise<void> {
      const isCurrent = guard.begin();
      await gate;
      if (!isCurrent()) return;
      applied.push(label);
    }

    // The old one starts first but is released last, exactly the ordering the
    // guard exists for.
    const older = resolve('older', slow.promise);
    const newer = resolve('newer', fast.promise);
    fast.resolve();
    await newer;
    slow.resolve();
    await older;

    assert.deepStrictEqual(applied, ['newer']);
  });

  it('keeps the newest generation current while older ones go stale', () => {
    const guard = createGenerationGuard();
    const first = guard.begin();
    const second = guard.begin();
    const third = guard.begin();
    assert.strictEqual(first(), false);
    assert.strictEqual(second(), false);
    assert.strictEqual(third(), true);
  });

  it('invalidate retires an in-flight generation without opening one', () => {
    const guard = createGenerationGuard();
    const inFlight = guard.begin();
    assert.strictEqual(inFlight(), true);
    guard.invalidate();
    assert.strictEqual(inFlight(), false);
    // And the generation it retired is not handed to anybody: the next
    // begin() is current on its own.
    const next = guard.begin();
    assert.strictEqual(next(), true);
    assert.strictEqual(inFlight(), false);
  });

  it('two guards never interfere with each other', () => {
    const a = createGenerationGuard();
    const b = createGenerationGuard();
    const aFirst = a.begin();
    b.begin();
    b.begin();
    assert.strictEqual(aFirst(), true);
  });
});

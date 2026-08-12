import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { tooOldCause } from '../insights.js';

/**
 * "too old" has two opposite causes and insights reported only one of them.
 *
 * A thread can be past the 72h ceiling because the FEED handed it over already old — that is a
 * collector problem, and "read a different sort" is the fix. Or it can have been collected fresh
 * and simply aged on disk because nobody has collected since — that is a cadence problem, and
 * reading a different sort would change nothing.
 *
 * Measured 2026-08-12 on the live corpus: 14 of 35 dropped as too old, and 0 of 35 were over 72h
 * AT COLLECTION (max 35.5h). 20 were collected on 2026-08-01 and 15 on 2026-08-11. The feed was
 * never the problem, and insights was sending a person to fix it.
 */
describe('too-old drops name the cause they actually have', () => {
  const CEILING = 72;
  const h = (n: number) => n * 60; // ageMinutes

  test('old when it arrived is the FEED — that is the collector reading the wrong sort', () => {
    const dropped = [
      { ageMinutes: h(200) },
      { ageMinutes: h(90) },
      { ageMinutes: h(400) }
    ];
    assert.equal(tooOldCause(dropped, CEILING), 'feed');
  });

  test('fresh when it arrived is STALE — the corpus aged, the feed did nothing wrong', () => {
    const dropped = [
      { ageMinutes: h(31.7) },
      { ageMinutes: h(12) },
      { ageMinutes: h(35.5) }
    ];
    assert.equal(tooOldCause(dropped, CEILING), 'stale');
  });

  test('a mix names whichever actually dominates, rather than defaulting to the feed', () => {
    const mostlyFresh = [{ ageMinutes: h(10) }, { ageMinutes: h(20) }, { ageMinutes: h(300) }];
    assert.equal(tooOldCause(mostlyFresh, CEILING), 'stale');

    const mostlyOld = [{ ageMinutes: h(300) }, { ageMinutes: h(200) }, { ageMinutes: h(10) }];
    assert.equal(tooOldCause(mostlyOld, CEILING), 'feed');
  });

  test('an age that was never captured cannot be evidence for either cause', () => {
    assert.equal(tooOldCause([{ ageMinutes: null }, { ageMinutes: null }], CEILING), 'unknown');
    /* One measurable row still decides; the unmeasurable ones abstain rather than vote. */
    assert.equal(tooOldCause([{ ageMinutes: null }, { ageMinutes: h(10) }], CEILING), 'stale');
  });

  test('nothing dropped is not a finding about anything', () => {
    assert.equal(tooOldCause([], CEILING), 'unknown');
  });
});

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { allowedSubreddits, PILOT_SUBREDDITS } from '../select.js';

/**
 * WHAT THIS PINS: adding an account should not decide where it speaks.
 *
 * Two places used to answer that question for the operator, and neither was reachable from the
 * screen where it mattered:
 *
 * - creating an account with the subreddit field empty stored `['WordPress']`, silently. The
 *   field arrived pre-filled with WordPress too, so an operator adding an account for another
 *   room had to notice a default and delete it.
 * - an account that declares nothing then fell back to `PILOT_SUBREDDITS` — three names in a
 *   source file — so even an emptied list still meant WordPress, one layer down.
 *
 * The rule now, in order: the account's OWN list, else the rooms the operator has actually
 * enabled as sources, else the pilot set. An account still never means "everywhere" — but what
 * it does mean is now something a person set, on a screen, rather than a constant in the build.
 */
describe('where an account may speak is the operator’s answer, not the build’s', () => {
  test('its own list wins, and is matched case-insensitively', () => {
    const own = allowedSubreddits({ subreddits: ['LasVegas', 'WebDev'] }, ['wordpress']);
    assert.deepEqual(own, ['lasvegas', 'webdev']);
  });

  test('declaring nothing falls back to the rooms the operator enabled as sources', () => {
    const allowed = allowedSubreddits({ subreddits: [] }, ['LasVegas', 'smallbusiness']);
    assert.deepEqual(allowed, ['lasvegas', 'smallbusiness'],
      'the sources are a choice a person made on a screen; the pilot set is not');
  });

  test('no list and no sources is the only case that still means the pilot set', () => {
    assert.deepEqual(allowedSubreddits({ subreddits: [] }, []), PILOT_SUBREDDITS as readonly string[]);
    assert.deepEqual(allowedSubreddits(null), PILOT_SUBREDDITS as readonly string[]);
    assert.deepEqual(allowedSubreddits(undefined, undefined), PILOT_SUBREDDITS as readonly string[]);
  });

  test('an empty list never means everywhere — "speaks nowhere" must not read as "speaks anywhere"', () => {
    const allowed = allowedSubreddits({ subreddits: [] }, ['lasvegas']);
    assert.ok(allowed.length > 0, 'an empty allow-list would let every collected thread through');
  });

  test('a source list that is not an array is ignored rather than trusted', () => {
    const allowed = allowedSubreddits({ subreddits: [] }, 'wordpress' as unknown as string[]);
    assert.deepEqual(allowed, PILOT_SUBREDDITS as readonly string[]);
  });
});

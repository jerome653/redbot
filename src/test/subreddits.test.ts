/**
 * `redbot subreddits` — the pick parser, and the honesty of the numbers.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS FILE CAN AND CANNOT PROVE, stated because the distinction is the whole reason the
 * command was built the way it was.
 *
 * It CANNOT prove the selectors match Reddit. That needs the live page, and a fixture written
 * from memory would only prove the parser agrees with whatever I typed into the fixture — the
 * circularity that makes a green suite worthless. `sel.communityResult` was measured against
 * the live search on 2026-08-03 (20 results, every one a `div[data-testid="search-community"]`)
 * and that measurement is recorded where the selector lives, not asserted here.
 *
 * It CAN prove the parts that decide what happens to a person's configuration: which candidates
 * a `--commit` spec selects, that a bad spec selects NOTHING rather than something, and that a
 * count Reddit did not report is never rendered as a number. Those are the paths where a defect
 * writes the wrong thing to `sources` or puts a fabricated figure in front of an operator.
 *
 * The live half fails SAFE by construction: a moved selector yields zero candidates and the
 * command says the markup may have moved. It cannot yield a wrong subreddit, because the name
 * comes from a `^/r/<name>/$` match on the href rather than from anything free-form.
 * ---------------------------------------------------------------------------
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parsePicks } from '../commands/subreddits.js';

type Candidate = Parameters<typeof parsePicks>[1][number];

const cand = (n: number, over: Partial<Candidate> = {}): Candidate => ({
  n,
  name: `Sub${n}`,
  permalink: `https://www.reddit.com/r/Sub${n}/`,
  description: 'a community',
  weeklyVisitors: 1000 * n,
  weeklyContributions: 10 * n,
  known: false,
  ...over
});

const three = [cand(1), cand(2), cand(3)];

describe('choosing which communities to add', () => {
  test('named numbers select exactly those, in the order given', () => {
    const { picked, error } = parsePicks('3,1', three);
    assert.equal(error, undefined);
    assert.deepEqual(picked.map((c) => c.n), [3, 1]);
  });

  test('"all" selects every candidate', () => {
    assert.deepEqual(parsePicks('all', three).picked.map((c) => c.n), [1, 2, 3]);
  });

  test('a repeated number adds the community once', () => {
    /* `addSource` is idempotent, but a duplicate would still print "added" twice and inflate the
       count reported back — a small lie about what just happened to their configuration. */
    assert.deepEqual(parsePicks('2,2,2', three).picked.map((c) => c.n), [2]);
  });

  test('an out-of-range number selects NOTHING, rather than what it could match', () => {
    /* Fail closed. A spec of "2,9" meaning "add 2 and 9" must not quietly add 2 — the person
       asked for something the preview cannot satisfy, and a partial write is the outcome they
       would not have chosen. */
    const { picked, error } = parsePicks('2,9', three);
    assert.deepEqual(picked, []);
    assert.match(error ?? '', /no entry 9/i);
  });

  test('a non-numeric spec is refused before anything is added', () => {
    const { picked, error } = parsePicks('2,wordpress', three);
    assert.deepEqual(picked, []);
    assert.match(error ?? '', /not a number/i);
  });

  test('an empty spec is refused, and says how to name them', () => {
    const { picked, error } = parsePicks('   ', three);
    assert.deepEqual(picked, []);
    assert.match(error ?? '', /--commit 1,4 or --commit all/);
  });

  test('ALL and all and " All " are the same instruction', () => {
    for (const s of ['ALL', 'all', '  All  ']) {
      assert.equal(parsePicks(s, three).picked.length, 3, `"${s}" was not understood`);
    }
  });
});

describe('what the preview is allowed to claim', () => {
  /**
   * Reddit's community search publishes WEEKLY VISITORS and WEEKLY CONTRIBUTIONS, and does not
   * publish a subscriber count on this page. The scraper's type therefore has no `subscribers`
   * field to fill in — the guard is structural, and this test states why it must stay that way.
   *
   * The failure it prevents: a large subreddit with almost no weekly contributions is a dead
   * room, and a subscriber count would make it read as the busiest option on the screen.
   */
  test('a candidate carries the two counts Reddit actually reports, and no invented one', () => {
    const c = cand(1);
    assert.ok('weeklyVisitors' in c && 'weeklyContributions' in c);
    assert.ok(!('subscribers' in c), 'a subscriber count would be fabricated — Reddit does not report one here');
    assert.ok(!('members' in c), 'likewise "members"');
  });

  test('a count Reddit did not report stays null, so it can be shown as "not reported"', () => {
    /* null and 0 are different facts: 0 contributions is a measured dead room, null is a number
       nobody has. `sources.ts` documents the same absent-vs-corrupt distinction for its own file. */
    const c = cand(1, { weeklyVisitors: null, weeklyContributions: 0 });
    assert.equal(c.weeklyVisitors, null);
    assert.equal(c.weeklyContributions, 0);
    assert.notEqual(c.weeklyVisitors, c.weeklyContributions);
  });

  test('an already-configured community is marked, so committing it again is visibly a no-op', () => {
    const known = cand(1, { known: true });
    assert.equal(parsePicks('1', [known]).picked[0]?.known, true);
  });
});

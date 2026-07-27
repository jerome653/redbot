/**
 * The warming rules.
 *
 * ACCOUNT-WARMING.md has prescribed these since day one and none of them has ever been
 * executed — `publish.ok` in the history log is 0 and karma is still 1. A rule nothing enforces
 * is a note, so these tests are about the refusals: the link that reads as promotion, the burst
 * that reads as automation, the essay that reads as a bot, the thread that is already too old
 * for a comment to be seen.
 *
 * Getting this wrong does not produce a bad reply. It produces a flagged account, and every
 * other capability in this repository runs through that account.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkWarmingComment, checkWarmingPace, isWarmingTarget,
  WARMING_MAX_WORDS
} from '../warming.js';

const GOOD =
  'Check the error log first — a 502 right after a PHP upgrade is usually a fatal in a plugin ' +
  'that has not caught up, and the log names the file. If it is empty, turn on debug logging and ' +
  'reproduce it once.';

test('an ordinary helpful comment passes', () => {
  const r = checkWarmingComment(GOOD);
  assert.equal(r.ok, true, JSON.stringify(r.issues));
});

test('any link is refused, however helpful', () => {
  for (const body of [
    `${GOOD} See https://developer.wordpress.org/debug/`,
    `${GOOD} More at www.wordpress.org`,
    `${GOOD} [the docs](https://example.com)`,
    `${GOOD} Try wpbeginner.com for a walkthrough.`
  ]) {
    const r = checkWarmingComment(body);
    assert.equal(r.ok, false, `should have been refused: ${body.slice(-40)}`);
    assert.ok(r.issues.some((i) => i.rule === 'no-links'));
  }
});

test('naming the company or a product is refused', () => {
  for (const body of [
    `${GOOD} We built SGEN to avoid this.`,
    `${GOOD} Our tool handles it automatically.`,
    `${GOOD} Sign up for the free trial and see.`
  ]) {
    const r = checkWarmingComment(body);
    assert.equal(r.ok, false, `should have been refused: ${body.slice(-40)}`);
    assert.ok(r.issues.some((i) => i.rule === 'no-promotion'));
  }
});

test('an essay from a new account is refused', () => {
  const long = Array.from({ length: WARMING_MAX_WORDS + 20 }, () => 'word').join(' ');
  const r = checkWarmingComment(long);
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => i.rule === 'too-long'));
});

test('a one-liner is refused too — warming still has to be worth reading', () => {
  const r = checkWarmingComment('Same here, following.');
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => i.rule === 'too-short'));
});

/**
 * Warned, not blocked. The claim budget is a provisional number and has no business refusing a
 * publish on its own — but a new account being publicly wrong is exactly the outcome warming
 * exists to avoid, so it is surfaced.
 */
test('a claim-heavy warming comment warns without blocking', () => {
  const claimy =
    'The cache always returns the old row. That deletes the stored value. ' +
    'The filter never fires on the front end. The migration truncates the column every time.';
  const r = checkWarmingComment(claimy);
  assert.equal(r.issues.some((i) => i.rule === 'no-links' || i.rule === 'no-promotion'), false);
  assert.ok(r.warnings.some((w) => /unhedged/.test(w)));
});

/* ---- pace ---- */

test('the daily ceiling holds', () => {
  const r = checkWarmingPace({ publishedToday: 3, minutesSinceLast: 600, karma: 1 });
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => i.rule === 'daily-ceiling'));
});

test('comments arriving in a cluster are refused', () => {
  const r = checkWarmingPace({ publishedToday: 1, minutesSinceLast: 5, karma: 1 });
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => i.rule === 'spacing'));
});

test('a first-ever comment has no spacing to violate', () => {
  const r = checkWarmingPace({ publishedToday: 0, minutesSinceLast: null, karma: 1 });
  assert.equal(r.ok, true, JSON.stringify(r.issues));
});

/* ---- targets ---- */

test('threads are chosen for being read, not for being easy', () => {
  // under 2h with few answers — the whole point
  assert.equal(isWarmingTarget({ ageHours: 1, commentCount: 2, subreddit: 'WordPress', title: 't' }).ok, true);

  // past 2h a comment is buried and earns nothing
  assert.equal(isWarmingTarget({ ageHours: 6, commentCount: 1, subreddit: 'WordPress', title: 't' }).ok, false);

  // the eleventh voice in a crowded thread is invisible
  assert.equal(isWarmingTarget({ ageHours: 1, commentCount: 40, subreddit: 'WordPress', title: 't' }).ok, false);

  // unknown age fails closed — we cannot tell whether it would be read
  assert.equal(isWarmingTarget({ ageHours: null, commentCount: 0, subreddit: 'WordPress', title: 't' }).ok, false);
});

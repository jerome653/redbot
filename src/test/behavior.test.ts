import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeRng, chance, skewedDelay } from '../rand.js';
import { planSession, dwellMsFor, scrollPlan, nextMove, wordCount, viewThread } from '../behavior.js';
import { policy } from '../policy.js';
import type { Thread } from '../types.js';

const thread = (words: number): Pick<Thread, 'title' | 'body' | 'comments'> => ({
  title: 'test thread',
  body: Array.from({ length: words }, (_, i) => `word${i % 40}`).join(' '),
  comments: []
});

test('a seed replays a session exactly', () => {
  const a = planSession('medium', makeRng(1234));
  const b = planSession('medium', makeRng(1234));
  assert.equal(a.budgetMs, b.budgetMs);
  assert.equal(a.maxThreadsToOpen, b.maxThreadsToOpen);
  assert.equal(a.mayReply, b.mayReply);
  assert.equal(a.seed, 1234);
});

test('different seeds produce different sessions', () => {
  const budgets = new Set(
    Array.from({ length: 20 }, (_, i) => planSession('medium', makeRng(i + 1)).budgetMs)
  );
  assert.ok(budgets.size > 1, 'every seed produced the same budget — the plan is not varying');
});

test('session length stays inside the declared band', () => {
  for (let seed = 1; seed <= 50; seed++) {
    const s = planSession('short', makeRng(seed));
    assert.ok(s.budgetMs >= policy.shortSessionMs.value);
    assert.ok(s.budgetMs < policy.shortSessionMaxMs.value);

    const m = planSession('medium', makeRng(seed));
    assert.ok(m.budgetMs >= policy.mediumSessionMs.value);
    assert.ok(m.budgetMs < policy.mediumSessionMaxMs.value);
  }
});

test('most sessions are not allowed to end in a reply, and some are', () => {
  const plans = Array.from({ length: 200 }, (_, i) => planSession('short', makeRng(i + 1)));
  const replying = plans.filter((p) => p.mayReply).length;
  assert.ok(replying > 0, 'no session ever permits a reply');
  assert.ok(replying < plans.length, 'every session permits a reply — the plan is not gating anything');
  // Never force a reply every session: the majority must be read-only.
  assert.ok(replying / plans.length < 0.5, `${replying}/200 sessions permit replying — too many`);
});

test('dwell time grows with how much there is to read', () => {
  const short = dwellMsFor(thread(30), makeRng(7));
  const long = dwellMsFor(thread(2000), makeRng(7));
  assert.ok(long > short, `long thread dwelt ${long}ms, short ${short}ms`);
});

test('dwell time is clamped at both ends', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const tiny = dwellMsFor(thread(1), makeRng(seed));
    const huge = dwellMsFor(thread(200_000), makeRng(seed));
    assert.ok(tiny >= policy.minDwellMs.value, `${tiny} under the floor`);
    assert.ok(huge <= policy.maxDwellMs.value, `${huge} over the cap`);
  }
});

test('a reply candidate is read more thoroughly than a skim', () => {
  // Sized to sit under policy.maxDwellMs: at the cap both readings clamp to the same number
  // and the test would be measuring the clamp instead of the model.
  const skim = dwellMsFor(thread(600), makeRng(3));
  const careful = dwellMsFor(thread(600), makeRng(3), { thorough: true });
  assert.ok(careful > skim, `thorough ${careful}ms was not longer than skim ${skim}ms`);
  // The skim must be below the cap, or both readings clamp to the same value and the
  // comparison above proves nothing. A thorough read reaching the cap is legitimate.
  assert.ok(skim < policy.maxDwellMs.value, 'fixture skims at the clamp — resize it');
});

test('scrolling is not monotonic — a reader goes back up', () => {
  const anyBackwards = Array.from({ length: 60 }, (_, i) =>
    scrollPlan(makeRng(i + 1), 60_000)
  ).some((plan) => plan.some((s) => s.deltaY < 0));
  assert.ok(anyBackwards, 'no scroll plan ever scrolled back up');
});

test('scroll pauses are never uniform', () => {
  const plan = scrollPlan(makeRng(99), 90_000);
  const pauses = new Set(plan.map((s) => s.pauseMs));
  assert.ok(pauses.size > 1, 'every pause in the plan is identical');
});

test('the session ends when the budget or the thread cap is spent', () => {
  const rng = makeRng(5);
  assert.equal(
    nextMove(rng, { elapsedMs: 10, budgetMs: 10, threadsOpened: 0, maxThreads: 5, hasCandidate: false }),
    'end-session'
  );
  assert.equal(
    nextMove(rng, { elapsedMs: 0, budgetMs: 600_000, threadsOpened: 5, maxThreads: 5, hasCandidate: false }),
    'end-session'
  );
});

test('navigation is not a fixed sequence', () => {
  const rng = makeRng(11);
  const moves = new Set(
    Array.from({ length: 60 }, () =>
      nextMove(rng, { elapsedMs: 1000, budgetMs: 900_000, threadsOpened: 1, maxThreads: 20, hasCandidate: true })
    )
  );
  assert.ok(moves.size >= 3, `only ${moves.size} distinct moves in 60 draws — navigation is deterministic`);
});

test('delays have a floor and a tail', () => {
  const rng = makeRng(21);
  const samples = Array.from({ length: 500 }, () => skewedDelay(rng, 4000));
  assert.ok(Math.min(...samples) >= 250, 'a delay came in under the floor');
  assert.ok(Math.max(...samples) > 4000 * 1.5, 'no long pause ever occurred — the tail is missing');
});

test('chance() is honest at the extremes', () => {
  const rng = makeRng(4);
  assert.equal(chance(rng, 0), false);
  assert.equal(chance(rng, 1), true);
});

test('wordCount covers title, body and comments', () => {
  assert.equal(
    wordCount({ title: 'a b', body: 'c d e', comments: [{ author: null, body: 'f g', depth: 0 }] }),
    7
  );
});

/* ---------------- viewThread is bounded, added 2026-09-28 ---------------- */

/**
 * WHY. `policy.ts:80` states maxDwellMs (360_000) is a "cap so one very long thread cannot eat an
 * entire session". It did not cap that, for two reasons measured on a real 557-word / 5-comment
 * thread across 500 seeds:
 *
 *   - scroll pauses alone summed to 501s, already past the 360s "cap"
 *   - behavior.ts rolls an idle pause INSIDE the per-step loop, outside the dwell budget, with up
 *     to 119 steps each able to roll one — worst case total 53 minutes
 *
 * Observed 2026-09-28: draft d_7d762fa0f2b4_muksfd2v entered the pre-reply read at 05:19:39 and
 * had produced no decision 52 minutes later. It is the only draft the pipeline has ever produced
 * that clears every content gate, and the read stood between it and `publishComment`.
 *
 * `page.mouse.wheel` is also raced against a timeout. Its `.catch(() => {})` handles a REJECTION;
 * a promise that never settles is not a rejection, so the catch cannot end it. The read is
 * behavioural cover, not a correctness requirement, so a scroll that never lands is skipped.
 */
const fakePage = (wheel?: () => Promise<void>) => ({
  mouse: { wheel: wheel ?? (async () => { /* resolves at once */ }) }
});

const shortThread = {
  title: 'Checkout 502s after PHP 8.2 upgrade',
  body: 'admin-ajax.php returns 502 since the upgrade.',
  comments: [{ author: 'b', body: 'Check the error log first.', depth: 0 }]
};

test('a zero budget returns at once rather than walking the plan', async () => {
  const r = await viewThread(fakePage() as never, shortThread, makeRng(7), { thorough: true, budgetMs: 0 });
  assert.equal(r.steps, 0, 'no step may run once the budget is gone');
  assert.equal(r.truncated, true, 'and the result must SAY it was cut short, not imply a full read');
});

test('the budget bounds real elapsed time, which is what maxDwellMs claims to do', async () => {
  const started = Date.now();
  const r = await viewThread(fakePage() as never, shortThread, makeRng(11), { thorough: true, budgetMs: 300 });
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 3_000, `bounded by the budget, took ${elapsed}ms`);
  assert.equal(r.truncated, true);
});

test('a wheel that NEVER settles does not hang the read', async () => {
  /* The exact shape of the observed stall: an awaited page call that neither resolves nor rejects.
     Without the race this test never finishes, which is the point. */
  const started = Date.now();
  const r = await viewThread(
    fakePage(() => new Promise<void>(() => { /* never settles */ })) as never,
    shortThread, makeRng(3), { thorough: true, budgetMs: 400 }
  );
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 5_000, `a dead wheel must not block the read, took ${elapsed}ms`);
  assert.ok(r.steps >= 0);
});

test('a generous budget still completes normally and is not marked truncated', async () => {
  /* The guard against "fixed it by always truncating". A tiny thread with a big budget must finish
     its plan and report truncated: false. */
  const r = await viewThread(fakePage() as never, shortThread, makeRng(5), { budgetMs: 600_000 });
  assert.equal(r.truncated, false, 'a read that finished must not claim it was cut short');
  assert.ok(r.steps > 0, 'and it must actually have done something');
});

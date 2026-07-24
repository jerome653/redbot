/**
 * Part A — the behaviour engine.
 *
 * What this replaces: a flat `pause()` between every action, drawn uniformly from one range.
 * That produces a machine signature no matter how wide the range is — every delay equally
 * likely, no relationship between what is on screen and how long it takes, and an action
 * after every single pause.
 *
 * What this does instead:
 *   - dwell time is a function of how much text the thread actually contains;
 *   - scroll depth is partial and variable, and sometimes goes back up;
 *   - a proportion of thread views end with no action at all;
 *   - navigation is chosen by weight, so the same sequence does not repeat;
 *   - sessions have a length budget, and most of them end without replying.
 *
 * Two things this is NOT:
 *   1. Detection evasion. Nothing here hides what the traffic is, spoofs a fingerprint, or
 *      defeats a bot check — the browser is a real browser the operator signed into, and a
 *      reply is posted only after a person approves it. The goal is to *behave* like
 *      responsible use, and the honest reason a slow, partial, often-no-action reader is
 *      better is that it is gentler on the site and leaves room for a person to change
 *      their mind.
 *   2. A model of attention. Reading speed is a placeholder (policy.readingWordsPerMinute is
 *      marked provisional) and every rate below is declared, not observed.
 *
 * All randomness comes from src/rand.ts, so a session replays from its seed.
 */
import type { Page } from 'playwright';
import { policy } from './policy.js';
import { makeRng, sessionSeed, chance, uniformInt, skewedDelay, type Rng } from './rand.js';
import { sleep } from './pacing.js';
import type { Thread } from './types.js';

export type SessionKind = 'short' | 'medium';

export interface SessionPlan {
  kind: SessionKind;
  /** Replay this session's timings by setting REDBOT_SEED to this value. */
  seed: number;
  /** Wall-clock budget. The session ends when this is spent, whatever it was doing. */
  budgetMs: number;
  maxThreadsToOpen: number;
  /**
   * Whether this session is allowed to end in a reply at all.
   *
   * Decided up front, before anything is read, so the decision cannot be rationalised by
   * "but this thread was really good". Most sessions are read-only.
   */
  mayReply: boolean;
  startedAt: string;
}

export function planSession(kind: SessionKind, rng: Rng = makeRng(sessionSeed())): SessionPlan {
  const [lo, hi] = kind === 'short'
    ? [policy.shortSessionMs.value, policy.shortSessionMaxMs.value]
    : [policy.mediumSessionMs.value, policy.mediumSessionMaxMs.value];

  const budgetMs = uniformInt(rng, lo, hi);
  // Thread count follows the budget rather than being a separate knob: roughly one thread
  // per 2.5 minutes of budget, which leaves room for the dwell times below.
  const maxThreadsToOpen = Math.max(2, Math.round(budgetMs / 150_000));

  return {
    kind,
    seed: rng.seed,
    budgetMs,
    maxThreadsToOpen,
    mayReply: !chance(rng, policy.sessionsEndingWithoutReplyRate.value),
    startedAt: new Date().toISOString()
  };
}

/* ------------------------------------------------------------------ *
 * Reading
 * ------------------------------------------------------------------ */

export function wordCount(thread: Pick<Thread, 'title' | 'body' | 'comments'>): number {
  const parts = [thread.title, thread.body ?? '', ...thread.comments.map((c) => c.body)];
  return parts.join(' ').trim().split(/\s+/).filter(Boolean).length;
}

/**
 * How long to stay on a thread, from how much there is to read.
 *
 * A person does not read every word — `coverage` is the share they actually take in, and it
 * drops as the thread gets longer. Clamped at both ends by policy.
 */
export function dwellMsFor(
  thread: Pick<Thread, 'title' | 'body' | 'comments'>,
  rng: Rng,
  opts?: { thorough?: boolean }
): number {
  const words = wordCount(thread);
  const thorough = opts?.thorough ?? false;

  // Skimming falls off with length; a reply candidate is read much more carefully.
  const coverage = thorough
    ? Math.max(0.55, 1 - words / 6000)
    : Math.max(0.18, 0.75 - words / 4000);

  const wpm = policy.readingWordsPerMinute.value;
  const baseMs = (words * coverage) / wpm * 60_000;

  const shaped = skewedDelay(rng, Math.max(baseMs, policy.minDwellMs.value), {
    spread: Math.max(1500, baseMs * 0.3),
    heavyTailP: thorough ? 0.25 : 0.12
  });

  return Math.min(policy.maxDwellMs.value, Math.max(policy.minDwellMs.value, shaped));
}

export interface ScrollStep {
  /** Positive scrolls down, negative scrolls back up. */
  deltaY: number;
  pauseMs: number;
}

/**
 * A scroll pattern for one thread view.
 *
 * `depth` is the fraction of the thread reached — most views do not reach the bottom. The
 * occasional negative step is someone going back to re-read something.
 */
export function scrollPlan(rng: Rng, dwellMs: number, opts?: { thorough?: boolean }): ScrollStep[] {
  const thorough = opts?.thorough ?? false;
  const depth = thorough
    ? 0.7 + rng.next() * 0.3          // a reply candidate gets read most of the way down
    : 0.25 + rng.next() * 0.6;

  const steps = Math.max(2, Math.round((dwellMs / 1000 / 6) * depth * 2));
  const plan: ScrollStep[] = [];

  for (let i = 0; i < steps; i++) {
    const back = chance(rng, 0.14);
    plan.push({
      deltaY: back ? -uniformInt(rng, 200, 600) : uniformInt(rng, 350, 1100),
      pauseMs: skewedDelay(rng, dwellMs / steps, { spread: dwellMs / steps * 0.5, heavyTailP: 0.15 })
    });
  }
  return plan;
}

export interface ThreadViewResult {
  dwellMs: number;
  steps: number;
  /** True when the view included a pause with no interaction at all. */
  idled: boolean;
  /** True when the reader left before finishing — no action taken on this thread. */
  abandoned: boolean;
}

/**
 * Spend time on a thread the way a reader would.
 *
 * `thorough` is set when this thread is a reply candidate: the spec requires reading the
 * comments before replying, so the comment section is scrolled and dwelt on rather than
 * skimmed. Nothing is clicked and nothing is submitted here.
 */
export async function viewThread(
  page: Page,
  thread: Pick<Thread, 'title' | 'body' | 'comments'>,
  rng: Rng,
  opts?: { thorough?: boolean; onStep?: (i: number, total: number) => void }
): Promise<ThreadViewResult> {
  const thorough = opts?.thorough ?? false;
  const dwellMs = dwellMsFor(thread, rng, { thorough });
  const plan = scrollPlan(rng, dwellMs, { thorough });

  // A reply candidate is never abandoned — we are there to read it properly.
  const abandonAt = !thorough && chance(rng, policy.abandonThreadRate.value)
    ? uniformInt(rng, 1, Math.max(2, plan.length))
    : -1;

  let idled = false;
  let executed = 0;

  for (const [i, step] of plan.entries()) {
    if (abandonAt >= 0 && i >= abandonAt) {
      return { dwellMs, steps: executed, idled, abandoned: true };
    }

    // A pause with no interaction: the tab is open, nothing is happening.
    if (chance(rng, policy.idlePauseRate.value)) {
      idled = true;
      await sleep(skewedDelay(rng, 4500, { heavyTailP: 0.3, tailMult: 5 }));
    }

    await page.mouse.wheel(0, step.deltaY).catch(() => {});
    await sleep(step.pauseMs);
    executed++;
    opts?.onStep?.(i + 1, plan.length);
  }

  return { dwellMs, steps: executed, idled, abandoned: false };
}

/* ------------------------------------------------------------------ *
 * Navigation
 * ------------------------------------------------------------------ */

export type Move =
  | 'open-thread'
  | 'back-to-feed'
  | 'open-another-first'
  | 'idle'
  | 'end-session';

export interface NavState {
  elapsedMs: number;
  budgetMs: number;
  threadsOpened: number;
  maxThreads: number;
  /** Set once the session has a thread it intends to reply to. */
  hasCandidate: boolean;
}

/**
 * What to do next.
 *
 * Weighted rather than sequenced: `read -> read -> read -> reply` is a fingerprint even with
 * good timing, because the *order* never varies. The weights below change with how much of
 * the budget is left, so late-session behaviour differs from early-session behaviour without
 * either being scripted.
 */
export function nextMove(rng: Rng, state: NavState): Move {
  const left = state.budgetMs - state.elapsedMs;
  if (left <= 0) return 'end-session';
  if (state.threadsOpened >= state.maxThreads) return 'end-session';

  // Near the end of the budget, winding down becomes much more likely than starting something.
  const winding = left < state.budgetMs * 0.2;

  const weights: Array<[Move, number]> = [
    ['open-thread', winding ? 1 : 6],
    ['back-to-feed', 3],
    ['open-another-first', state.hasCandidate ? 3 : 1],
    ['idle', 2],
    ['end-session', winding ? 6 : 1]
  ];

  const total = weights.reduce((s, [, w]) => s + w, 0);
  let roll = rng.next() * total;
  for (const [move, w] of weights) {
    roll -= w;
    if (roll <= 0) return move;
  }
  return 'end-session';
}

/** Between-action pause. Replaces the flat `pause()` for behaviour-driven code paths. */
export async function humanPause(rng: Rng, baseMs = 4200): Promise<void> {
  await sleep(skewedDelay(rng, baseMs));
}

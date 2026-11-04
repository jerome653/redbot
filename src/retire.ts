/**
 * Retirement — a source the measurement says is dead, and the backlog it stacked up.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS, AND WHY IT IGNORES THE REASON COLUMN.
 *
 * Operator's words, 2026-11-04: "we retire sub reddits 1 week old or no longer in need so we
 * dont over-stack data and engine gets confused."
 *
 * Both halves of that were already happening by hand, and both were being done wrong.
 *
 * (a) THE SOURCE LIST. Two rows carried prose saying they had been switched off while
 *     `sources.enabled` was still 1 — "Disabled 2026-09-28: 0/62 threads in scope…" on
 *     r/SEO and "Disabled 2026-10-18: 0 post links in every cycle…" on
 *     r/Wordpress_Development. Nothing in src/ or tools/ writes those sentences, so a person
 *     typed them into the console's reason field and the flag never moved. Measured 2026-11-04,
 *     over the 7 days to that date: r/SEO produced 129 assessed threads, the MOST of any source
 *     on the list, and r/Wordpress_Development produced 0 threads and 0 assessments while
 *     logging `selector.miss` on every cycle. Acting on the prose would have switched off the
 *     best source and left the dead one collecting. So the verdict here is computed from the
 *     engine's own yield — assessed threads in the window — and the `why` column is written,
 *     never read.
 *
 * (b) THE BACKLOG. `redbot opportunity` loads the whole `threads` table every cycle and records
 *     "collected 1836, prefiltered 99" each time. Measured 2026-11-04: 1,913 threads, 1,415 of
 *     them older than 7 days, 1,274 of those with nothing ever drafted from them. Every pass
 *     re-reads all of it to reach the same answer, which is the over-stacking the operator
 *     means.
 *
 * ARCHIVE, NEVER DELETE (the standing bylaw, and 0012's own schema comment: "Off, not
 * deleted."). A retired source is `enabled = 0` plus a reason stating the measurement, through
 * the same `setSourceEnabled` path the console uses. A retired thread gets a row in
 * `thread_retirement` and keeps its own row, its comments, its gap analysis and its
 * assessments. Nothing here deletes anything, and both halves are reversible by hand.
 *
 * PURE. No database, no clock of its own, no model call — the two functions below take facts
 * and return verdicts, which is what lets the live rows above be tested as fixtures.
 * ---------------------------------------------------------------------------
 */
import type { SourceKind } from './db/sources.js';

/** A week, as the operator said it. One number, read by both halves and by the report. */
export const RETIREMENT_DAYS = 7;

const DAY_MS = 86_400_000;

/** Whole days between an ISO timestamp and `now`, or null when the timestamp is unusable. */
function daysSince(iso: string | null, now: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.floor((now - t) / DAY_MS);
}

/** The day part of an ISO timestamp — what goes in a reason a person reads. */
const onDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

export interface SourceYield {
  kind: SourceKind;
  value: string;
  enabled: boolean;
  /** When it joined the list. Null on a row that predates `created_at`. */
  createdAt: string | null;
  /** Assessed threads this source produced inside the window — the engine's own measure. */
  assessedInWindow: number;
}

export interface SourceRetirement {
  kind: SourceKind;
  value: string;
  /** The sentence written into `sources.why`. States the measurement and the date. */
  why: string;
}

/**
 * Which sources a week of measurement says are dead.
 *
 * Retired when ALL THREE hold: it is switched on, it has been on the list for at least
 * RETIREMENT_DAYS, and it produced zero assessed threads in the window.
 *
 * The two abstentions are deliberate and both are tested. A source with no `created_at` cannot
 * be shown to have had its week, and an unproved week is not a verdict. A source already off is
 * left alone, so re-running this never rewrites a reason somebody set by hand.
 */
export function sourcesToRetire(
  rows: readonly SourceYield[], now: number = Date.now()
): SourceRetirement[] {
  const today = onDay(now);
  const out: SourceRetirement[] = [];
  for (const s of rows) {
    if (!s.enabled) continue;
    if (s.assessedInWindow > 0) continue;
    const age = daysSince(s.createdAt, now);
    if (age == null || age < RETIREMENT_DAYS) continue;
    out.push({
      kind: s.kind,
      value: s.value,
      why:
        `Retired ${today}: 0 assessed threads in the ${RETIREMENT_DAYS} days to ${today}, ` +
        `on the list since ${s.createdAt?.slice(0, 10)} (${age} days). Measured from ` +
        'opportunity_assessments, not from this column. Off, not deleted — `redbot sources on` ' +
        'puts it back.'
    });
  }
  return out;
}

export interface ThreadFact {
  id: string;
  /** When it was collected. Null is "cannot date it", which is never grounds to retire. */
  collectedAt: string | null;
  hasDraft: boolean;
  hasPublishedReply: boolean;
  /** Still inside its observation window, so a checkpoint may yet be due on it. */
  observationDue: boolean;
}

export interface ThreadRetirement {
  id: string;
  why: string;
}

/**
 * Which stale threads the scan should stop re-reading.
 *
 * Retired when it is at least RETIREMENT_DAYS old AND it is not live work. Three things make it
 * live work and each is checked separately rather than inferred from the others: a draft exists,
 * a reply was published on it, or an observation checkpoint may still be due. A published reply
 * subsumes the first today — publishing goes through a draft — but the day that stops being true
 * the evidence must not quietly become retirable, so the predicate is its own.
 */
export function threadsToRetire(
  rows: readonly ThreadFact[], now: number = Date.now()
): ThreadRetirement[] {
  const today = onDay(now);
  const out: ThreadRetirement[] = [];
  for (const t of rows) {
    if (t.hasDraft || t.hasPublishedReply || t.observationDue) continue;
    const age = daysSince(t.collectedAt, now);
    if (age == null || age < RETIREMENT_DAYS) continue;
    out.push({
      id: t.id,
      why:
        `Retired ${today}: ${age} days old, nothing drafted from it, no reply published and no ` +
        'observation due. Skipped by the opportunity scan; the thread, its comments and its ' +
        'assessment stay on record.'
    });
  }
  return out;
}

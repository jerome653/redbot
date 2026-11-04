/**
 * `redbot retire`           — what a week of measurement says is dead. Changes NOTHING.
 * `redbot retire --apply`   — switch those sources off and set that backlog aside.
 *
 * The dry run is the default on purpose. The operator's instruction was to stop over-stacking
 * data, not to have the engine quietly decide its own source list behind them: the first form
 * prints the verdicts and the measurement behind each one, and nothing is written until somebody
 * has read it and typed `--apply`. Nothing in the unattended loop calls this.
 *
 * The rules live in src/retire.ts and are pure; the facts come from src/db/retirement.ts. This
 * file is the surface and the report, and holds no rule of its own.
 */
import { say } from '../log.js';
import { getPool, closePool, dbUnavailableReason } from '../db.js';
import {
  sourceYields, threadRetirementFacts, saveThreadRetirements, retiredThreadCount
} from '../db/retirement.js';
import {
  sourcesToRetire, threadsToRetire, RETIREMENT_DAYS,
  type SourceRetirement, type ThreadRetirement
} from '../retire.js';
import { switchSource } from '../sources.js';
import { OBSERVE_WINDOW_MS } from './observe.js';

export interface RetirementPreview {
  sources: SourceRetirement[];
  threads: ThreadRetirement[];
  /** How many threads the scan is ALREADY skipping, so a count can be read as a change. */
  alreadyRetired: number;
  threadsConsidered: number;
}

/**
 * What the next `--apply` would retire, computed read-only.
 *
 * Exported because `redbot insights` prints the one-line form of it — a person should meet this
 * number on a screen they already read, not only when they go looking for it.
 */
export async function retirementPreview(now: number = Date.now()): Promise<RetirementPreview> {
  const since = new Date(now - RETIREMENT_DAYS * 86_400_000).toISOString();
  const observeFrom = new Date(now - OBSERVE_WINDOW_MS).toISOString();
  const db = getPool();
  const facts = await threadRetirementFacts(db, observeFrom);
  return {
    sources: sourcesToRetire(await sourceYields(db, since), now),
    threads: threadsToRetire(facts, now),
    alreadyRetired: await retiredThreadCount(db),
    threadsConsidered: facts.length
  };
}

export async function retire(opts?: { apply?: boolean }): Promise<number> {
  say.head(`redbot retire${opts?.apply ? ' --apply' : ''}`);
  const unavailable = dbUnavailableReason();
  if (unavailable) { say.fail('The database is not available.'); say.step(unavailable); return 1; }

  try {
    const p = await retirementPreview();

    say.step(`Sources with 0 assessed threads in the last ${RETIREMENT_DAYS} days, on the list longer than that:`);
    if (!p.sources.length) say.step('  none — every source on the list produced something this week');
    for (const s of p.sources) {
      say.step(`  ${s.kind === 'search' ? `search "${s.value}"` : `r/${s.value}`}`);
      say.step(`      ${s.why}`);
    }

    say.info('');
    say.step(
      `Threads: ${p.threadsConsidered.toLocaleString()} in the scan, ` +
      `${p.threads.length.toLocaleString()} older than ${RETIREMENT_DAYS} days with no draft, ` +
      `no published reply and no observation due · ${p.alreadyRetired.toLocaleString()} already retired`
    );

    if (!opts?.apply) {
      say.info('');
      say.warn('Nothing was changed. This is the report.');
      say.step('Do it:  redbot retire --apply       (sources go off, not away; threads stay on record)');
      return 0;
    }

    /* Sources first, through the console's own write path, so the seed file is mirrored and the
       reason lands with the flag rather than after it. */
    let off = 0;
    for (const s of p.sources) {
      const r = await switchSource(s.kind, s.value, false, s.why);
      if (!r.ok) { say.warn(`${s.value}: ${r.error ?? 'could not switch it off'}`); continue; }
      off += 1;
    }

    const written = await saveThreadRetirements(getPool(), p.threads);

    say.info('');
    say.ok(`${off} source(s) switched off, ${written.toLocaleString()} thread(s) retired.`);
    say.step('Neither is a deletion: a source keeps its place and its reason, a thread keeps its row.');
    say.step('Undo a source:  redbot sources on <name>');
    /* Deliberately NOT written to `history`. Its `kind` column is a closed vocabulary (0024) and
       extending it means rebuilding the table, which is a migration of its own rather than a line
       in this one. `record()` with an unknown kind fails the CHECK and is swallowed, so writing it
       anyway would read as an audit trail while recording nothing. */
    return 0;
  } catch (e) {
    say.fail(e instanceof Error ? e.message : String(e));
    return 1;
  } finally {
    await closePool();
  }
}

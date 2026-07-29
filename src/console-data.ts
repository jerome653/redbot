/**
 * What the consoles read — from Postgres, in one place.
 *
 * **Why this module exists.** `src/store.ts` moved the domain into Postgres, but both console
 * servers (`tools/product/server.mjs`, `tools/operator/server.mjs`) kept reading
 * `data/drafts.json`, `data/threads.json`, `data/gaps.json` and `data/assessments.json` off
 * disk. Nothing writes those files any more, so the screens were rendering from dead files —
 * an empty console on a database with rows in it, which reads as "redbot did nothing" rather
 * than "the console is looking in the wrong place".
 *
 * The consoles are plain `.mjs` with no compile step, so the alternative was hand-written SQL
 * in two JavaScript files that must agree with each other and with the TypeScript row mappers
 * forever. This is that code once, typed, reusing the loaders `store.ts` and `src/db/*` already
 * have. The consoles import the compiled `dist/console-data.js` — they already depend on
 * `dist/` to spawn `dist/cli.js`, so this adds no new requirement.
 *
 * Read-only, deliberately. A console mutates through the CLI (`redbot job add`, `redbot
 * publish`), where the gates live. Nothing here writes.
 */
import { getPool, dbUnavailableReason } from './db.js';
import { loadThreads, loadGaps, loadAssessments, loadDrafts, loadHistory } from './store.js';
import { loadDraftsByIds } from './db/drafts.js';
import { loadThreadsFromDb } from './db/threads.js';
import { loadAssessmentsFromDb } from './db/analysis.js';
import {
  selectObservations, selectReviews, selectRegrets, selectInteractions, selectTrace, countLog
} from './db/logs.js';
import { selectCertifications } from './db/certifications.js';
import { loadAccountsFromDb } from './db/accounts.js';
import { loadAccountsFile, type AccountRecord } from './config.js';
import type { Thread, Draft, GapAnalysis, OpportunityAssessment, HistoryEntry } from './types.js';

export interface ConsoleDomain {
  drafts: Draft[];
  threads: Thread[];
  gaps: GapAnalysis[];
  assessments: OpportunityAssessment[];
  certifications: unknown[];
  history: HistoryEntry[];
  observations: unknown[];
  reviews: unknown[];
  regret: unknown[];
  interactions: unknown[];
  accounts: AccountRecord[];
  /**
   * Where `accounts` came from. The console shows this: a screen that silently fell back to a
   * stale seed file, having said nothing, is how you end up debugging the wrong copy.
   */
  accountsFrom: 'database' | 'seed-file';
  /** Null when the database answered. A sentence an operator can act on when it did not. */
  unavailable: string | null;
}

/** Everything a console screen needs, with nothing read from a file that Postgres now owns. */
export interface DomainScope {
  /** Load only these drafts and what hangs off them. Absent means every draft. */
  draftIds?: string[];
  /** Bound the history read. Absent means the whole log. */
  historyLimit?: number;
  /** Skip the append-only logs entirely — their figures come from src/db/summary.ts now. */
  skipLogs?: boolean;
}

export async function loadConsoleDomain(scope: DomainScope = {}): Promise<ConsoleDomain> {
  const empty: ConsoleDomain = {
    drafts: [], threads: [], gaps: [], assessments: [], certifications: [],
    history: [], observations: [], reviews: [], regret: [], interactions: [],
    accounts: [], accountsFrom: 'seed-file', unavailable: null
  };

  const reason = dbUnavailableReason();
  if (reason) {
    // Fails soft on the accounts half: the seed file still describes who exists, and a console
    // that can at least name the accounts is more useful than one showing nothing at all.
    return { ...empty, accounts: loadAccountsFile(), unavailable: reason };
  }

  try {
    const db = getPool();

    /**
     * SCOPED, not everything.
     *
     * This used to be eleven full table reads on every `/api/state`. The console shows one page
     * of drafts, and everything heavy hangs off those: their threads, their assessments, their
     * certifications. So the page's draft ids are resolved FIRST and the rest are fetched for
     * exactly those — three narrowed reads instead of four whole tables.
     *
     * The logs (observations, reviews, regret, interactions) are no longer read here at all.
     * Every figure that came from their length is now an aggregate in src/db/summary.ts, and
     * the rows themselves are served a page at a time by the screens that list them. Loading
     * them to count them was the last "read the table to render a number" left.
     *
     * `ids === null` means unscoped — the engine's own callers genuinely want every draft, and
     * only the console passes a page.
     */
    const ids = scope.draftIds ?? null;
    const drafts = ids ? await loadDraftsByIds(db, ids) : await loadDrafts();
    const threadIds = [...new Set(drafts.map((d) => d.threadId))];

    const [threads, gaps, assessments, certifications, history, dbAccounts] = await Promise.all([
      ids ? loadThreadsFromDb(db, threadIds) : loadThreads(),
      loadGaps(),
      ids ? loadAssessmentsFromDb(db, threadIds) : loadAssessments(),
      ids ? selectCertifications(db, { draftIds: ids }) : selectCertifications(db),
      /* History still answers "what happened" for the shell; bounded rather than whole. */
      scope.historyLimit ? loadHistory({ limit: scope.historyLimit }) : loadHistory(),
      loadAccountsFromDb(db)
    ]);

    const observations = scope.skipLogs ? [] : await selectObservations(db);
    const reviews = scope.skipLogs ? [] : await selectReviews(db);
    const regret = scope.skipLogs ? [] : await selectRegrets(db);
    const interactions = scope.skipLogs ? [] : await selectInteractions(db);

    // Same precedence as config.loadAccounts(): the database is the record, the file is the
    // seed you import from. An empty table means "not imported yet", not "nobody configured".
    const fromFile = dbAccounts.length ? [] : loadAccountsFile();

    return {
      drafts, threads, gaps, assessments, certifications, history,
      observations, reviews, regret, interactions,
      accounts: dbAccounts.length ? dbAccounts : fromFile,
      accountsFrom: dbAccounts.length ? 'database' : 'seed-file',
      unavailable: null
    };
  } catch (e) {
    return {
      ...empty,
      accounts: loadAccountsFile(),
      unavailable: `The database could not be read: ${e instanceof Error ? e.message : String(e)}`
    };
  }
}

/* ------------------------------------------------------------------ *
 * The append-only logs, one at a time.
 *
 * Separate from `loadConsoleDomain` on purpose: the operator console's log page auto-refreshes
 * every five seconds, and serving it from the full domain load would run eleven queries a tick
 * to answer a question about one table.
 * ------------------------------------------------------------------ */

/** The logs the console offers, and the table each one actually lives in now. */
export const LOG_TABLES: Record<string, string> = {
  history:        'redbot.history',
  observations:   'redbot.observations',
  reviews:        'redbot.reviews',
  regret:         'redbot.regret',
  interactions:   'redbot.interactions',
  trace:          'redbot.trace',
  certifications: 'redbot.certifications'
};

export interface LogRows {
  /** Null when this console does not serve a log by that name. */
  table: string | null;
  rows: unknown[];
  /** How many rows the table holds altogether, so a pager can say "of 12,480". */
  total?: number;
  offset?: number;
  limit?: number;
  unavailable: string | null;
}

/**
 * One log's page, oldest first — the order an append-only file had, which is the order the
 * viewer scrolls to the bottom of.
 *
 * `offset` counts BACK FROM THE NEWEST, not forward from the oldest. A log is read from its
 * end: page one is the last 400 events, page two the 400 before those. Offsetting from the
 * start would make page one the events from the day the machine was set up, which is not the
 * page anybody opens a log to see.
 */
export async function loadLogRows(name: string, limit = 400, offset = 0): Promise<LogRows> {
  const table = LOG_TABLES[name];
  if (!table) return { table: null, rows: [], unavailable: null };

  const reason = dbUnavailableReason();
  if (reason) return { table, rows: [], unavailable: reason };

  try {
    const db = getPool();
    /**
     * The limit reaches the DATABASE now.
     *
     * This was `rows.slice(-limit)` over a full table read — the right rows arrived, and
     * Postgres still serialised every row that came before them. That is the defect the
     * comment above this function predicted, and it is what made "the log has a limit" false
     * in the only sense that matters when a table gets big.
     */
    const t = { limit, offset };
    let rows: unknown[];
    switch (name) {
      case 'history':        rows = await loadHistory(t); break;
      case 'observations':   rows = await selectObservations(db, t); break;
      case 'reviews':        rows = await selectReviews(db, t); break;
      case 'regret':         rows = await selectRegrets(db, t); break;
      case 'interactions':   rows = await selectInteractions(db, t); break;
      case 'trace':          rows = await selectTrace(db, t); break;
      /* Certifications are a parent row plus five child tables; paging them means paging the
         parents and fetching children only for those. Left unbounded here deliberately rather
         than half-done — it is the one log this fix does not yet cover. */
      case 'certifications': rows = await selectCertifications(db); break;
      default:               rows = [];
    }
    // The total is what lets a pager say "of 12,480" instead of implying the page is the table.
    const total = await countLog(db, table).catch(() => rows.length);
    return { table, rows, total, offset, limit, unavailable: null };
  } catch (e) {
    return {
      table, rows: [],
      unavailable: `The database could not be read: ${e instanceof Error ? e.message : String(e)}`
    };
  }
}

/** Accounts alone, for the screens that only need to know who exists. */
export async function loadConsoleAccounts(): Promise<{
  accounts: AccountRecord[]; from: 'database' | 'seed-file'; unavailable: string | null;
}> {
  const reason = dbUnavailableReason();
  if (reason) return { accounts: loadAccountsFile(), from: 'seed-file', unavailable: reason };
  try {
    const rows = await loadAccountsFromDb(getPool());
    if (rows.length) return { accounts: rows, from: 'database', unavailable: null };
    return { accounts: loadAccountsFile(), from: 'seed-file', unavailable: null };
  } catch (e) {
    return {
      accounts: loadAccountsFile(), from: 'seed-file',
      unavailable: `The database could not be read: ${e instanceof Error ? e.message : String(e)}`
    };
  }
}

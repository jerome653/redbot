/**
 * Every figure the console shows, counted by the database.
 *
 * WHAT THIS FINISHES. `src/db/pages.ts` stopped the console SENDING whole tables; this stops it
 * READING them. The figures on those screens were all `array.length` or `array.filter().length`
 * over a full table load — "replies sent", "karma", "removals", "collected per subreddit". Page
 * the list without moving these, and the screen shows a page while its own header describes
 * twenty-five rows as though they were the whole record. That is worse than a slow console: it
 * is a confident wrong number.
 *
 * So each one becomes an aggregate. `count(*)` and `GROUP BY` are answered from the index
 * without returning rows, which is the difference between a figure that costs nothing and a
 * figure that costs the table.
 *
 * ONE ROUND TRIP EACH, and per-account figures come back as one grouped result rather than a
 * query per account: an operator with twelve accounts should not make the console do twelve
 * scans to fill in a card each.
 */
import type { Db } from '../db.js';

export interface AccountTally {
  handle: string;
  /**
   * Replies actually published as this account.
   *
   * `publish.ok`, NOT `reply`. The console counted `kind === 'reply'` and there is no such
   * history kind — `HistoryKind` (src/types.ts:133) has never contained one, and
   * `src/commands/reply.ts:379` records a landed reply as `publish.ok`. So this figure was
   * structurally zero: five published replies counted as none, on every screen, forever.
   * `src/health.ts:165` and `src/metrics.ts:159` both had it right, which is what makes it a
   * typo rather than a vocabulary disagreement.
   */
  published: number;
  /** How many measurements exist for it, which the card reports as "measurements". */
  observations: number;
  /** The most recent karma reading, or null where none was ever taken. */
  karma: { value: unknown; ts: string; vector: string | null; note: string | null } | null;
}

/**
 * Per-account figures, in two grouped queries rather than two per account.
 *
 * The karma reading is picked by highest `id`, not by `ts`. A checkpoint reading is written now
 * but can carry a back-dated timestamp (src/db/logs.ts says so at the top), so "the latest by
 * ts" is not always the last one recorded — and the card is reporting what redbot most recently
 * measured.
 *
 * That used to be spelled `DISTINCT ON (account) … ORDER BY account, id DESC`, which SQLite does
 * not have. `row_number() OVER (PARTITION BY account ORDER BY id DESC) = 1` is the same
 * selection, and it keeps the ordering key — `id`, deliberately, not `ts` — where a reader can
 * still see it. The AUTOINCREMENT on `observations.id` is what makes "highest id" mean "most
 * recently recorded"; without it SQLite would reuse a deleted rowid and this would silently
 * start picking the wrong row, which is why the schema test pins it.
 */
export async function accountTallies(db: Db): Promise<Map<string, AccountTally>> {
  const out = new Map<string, AccountTally>();
  const get = (handle: string): AccountTally => {
    let t = out.get(handle);
    if (!t) { t = { handle, published: 0, observations: 0, karma: null }; out.set(handle, t); }
    return t;
  };

  const obs = await db.query<{ account: string; n: number }>(
    `SELECT account, count(*) AS n FROM observations
      WHERE account IS NOT NULL GROUP BY account`
  );
  for (const r of obs.rows) get(r.account).observations = Number(r.n);

  const pub = await db.query<{ account: string; n: number }>(
    `SELECT account, count(*) AS n FROM history
      WHERE account IS NOT NULL AND kind = 'publish.ok' GROUP BY account`
  );
  for (const r of pub.rows) get(r.account).published = Number(r.n);

  const karma = await db.query<{
    account: string; value: unknown; ts: Date; vector: string | null; note: string | null;
  }>(
    `SELECT account, value, ts, vector, note FROM (
       SELECT account, value, ts, vector, note,
              row_number() OVER (PARTITION BY account ORDER BY id DESC) AS rn
         FROM observations
        WHERE account IS NOT NULL AND kind = 'karma'
     ) WHERE rn = 1`
  );
  for (const r of karma.rows) {
    get(r.account).karma = {
      value: r.value,
      ts: r.ts instanceof Date ? r.ts.toISOString() : String(r.ts),
      vector: r.vector,
      note: r.note
    };
  }

  return out;
}

/** Every handle that appears in the logs, configured or not — the union the console shows. */
export async function handlesInLogs(db: Db): Promise<string[]> {
  const r = await db.query<{ account: string }>(
    `SELECT account FROM observations WHERE account IS NOT NULL
     UNION
     SELECT account FROM history WHERE account IS NOT NULL`
  );
  return r.rows.map((x) => x.account);
}

/**
 * How many threads were collected from each subreddit.
 *
 * Returned twice, keyed both ways, because the console needs both and neither is derivable
 * from the other once it has left the database: `collected` keeps Reddit's own casing — that
 * is the real name of the place — while lookups are done lower-cased, since the same
 * subreddit reaches redbot as "WordPress" and "wordpress" depending on where it was read.
 */
export async function threadsBySubreddit(
  db: Db
): Promise<{ collected: Record<string, number>; collectedByKey: Record<string, number> }> {
  const r = await db.query<{ subreddit: string | null; n: number }>(
    'SELECT subreddit, count(*) AS n FROM threads GROUP BY subreddit'
  );
  const collected: Record<string, number> = {};
  const collectedByKey: Record<string, number> = {};
  for (const row of r.rows) {
    const name = row.subreddit || 'unknown';
    const n = Number(row.n);
    collected[name] = (collected[name] ?? 0) + n;
    const key = name.toLowerCase();
    collectedByKey[key] = (collectedByKey[key] ?? 0) + n;
  }
  return { collected, collectedByKey };
}

/**
 * How many threads each saved search has actually put on file.
 *
 * The subreddit tally above exists because a source reading "0 on file" beside sixteen of its
 * own threads reported the collector as having done nothing. A SEARCH row had no count at all,
 * which is the same question left unanswered — and it was the row where it mattered most:
 * until 2026-08-12 the console could only run the preview half of `search`, so every search
 * source collected exactly nothing and there was no figure anywhere that said so.
 *
 * Keyed lower-cased only, with no second casing. A subreddit has a canonical name that Reddit
 * owns; a query is free text a person typed, so there is nothing to preserve the casing of.
 */
export async function threadsByQuery(db: Db): Promise<Record<string, number>> {
  const r = await db.query<{ query: string | null; n: number }>(
    `SELECT query, count(*) AS n FROM threads WHERE query IS NOT NULL AND query <> '' GROUP BY query`
  );
  const byQuery: Record<string, number> = {};
  for (const row of r.rows) {
    const key = String(row.query ?? '').trim().toLowerCase();
    if (!key) continue;
    byQuery[key] = (byQuery[key] ?? 0) + Number(row.n);
  }
  return byQuery;
}

export interface ArgusSummary {
  runs: number;
  draftsChecked: number;
  byVerdict: Record<string, number>;
  topReasons: { rule: string; n: number }[];
  /** Claim counts for drafts certified more than once — the stability evidence. */
  claimSpread: number[][];
}

/**
 * How the fact-checker has performed, over the WHOLE record.
 *
 * This one cannot be page-derived under any circumstances: it is the console's answer to "can
 * Argus be trusted", and the evidence for that is every certification ever run, not the
 * twenty-five drafts currently on screen. Phase 16 measured the same draft certified twice on a
 * byte-identical build and getting different claim counts — `claimSpread` is what shows that,
 * and a spread computed from one page would understate it precisely when it mattered.
 */
export async function argusSummary(db: Db): Promise<ArgusSummary> {
  const head = await db.query<{ runs: string; drafts: string }>(
    `SELECT count(*) AS runs, count(DISTINCT draft_id) AS drafts
       FROM certifications`
  );
  const verdicts = await db.query<{ verdict: string; n: number }>(
    'SELECT verdict AS verdict, count(*) AS n FROM certifications GROUP BY verdict'
  );
  const reasons = await db.query<{ rule: string; n: number }>(
    `SELECT rule, count(*) AS n FROM certification_reasons
      GROUP BY rule ORDER BY count(*) DESC, rule LIMIT 5`
  );

  /* Claim counts per certification, for drafts that were certified more than once. Restricted
     in SQL to those drafts — the spread is meaningless for a draft checked once, and fetching
     every certification to discard the singletons is the read this file exists to avoid. */
  const spread = await db.query<{ draft_id: string; cert_id: number; n: number }>(
    `SELECT c.draft_id, c.id AS cert_id, count(cc.claim_id) AS n
       FROM certifications c
       LEFT JOIN certification_claims cc ON cc.cert_id = c.id
      WHERE c.draft_id IN (
        SELECT draft_id FROM certifications GROUP BY draft_id HAVING count(*) > 1
      )
      GROUP BY c.draft_id, c.id
      ORDER BY c.draft_id, c.id`
  );

  const byDraft = new Map<string, number[]>();
  for (const r of spread.rows) {
    const list = byDraft.get(r.draft_id) ?? [];
    list.push(Number(r.n));
    byDraft.set(r.draft_id, list);
  }

  const byVerdict: Record<string, number> = { REJECT: 0, ESCALATE: 0, CERTIFIED: 0 };
  for (const v of verdicts.rows) byVerdict[v.verdict] = Number(v.n);

  return {
    runs: Number(head.rows[0]?.runs ?? 0),
    draftsChecked: Number(head.rows[0]?.drafts ?? 0),
    byVerdict,
    topReasons: reasons.rows.map((r) => ({ rule: r.rule, n: Number(r.n) })),
    claimSpread: [...byDraft.values()]
  };
}

export interface ConsoleTotals {
  /** Replies published, all accounts. The figure the whole Results screen hangs off. */
  published: number;
  /** Drafts still waiting on a person — the queue, not the page. */
  pending: number;
  reviews: number;
  regret: number;
  removals: number;
  certifications: number;
}

/**
 * The handful of whole-record figures the shell and the Results screen report.
 *
 * One statement rather than six: these are all read together on every `/api/state`, and six
 * round trips to fill in one badge row is six waits a person notices.
 */
export async function consoleTotals(db: Db): Promise<ConsoleTotals> {
  const r = await db.query<Record<string, string>>(
    `SELECT (SELECT count(*) FROM history WHERE kind = 'publish.ok')          AS published,
            (SELECT count(*) FROM drafts WHERE status = 'pending')       AS pending,
            (SELECT count(*) FROM reviews)                               AS reviews,
            (SELECT count(*) FROM regret)                                AS regret,
            /* reply-marked-removed, NOT removal. Same defect as the publish.ok one above, and
               found the same way: observation_kind has no such value, so the console's "taken
               down" badge could never be anything but zero. src/commands/observe.ts:264 writes
               this kind when a moderator removal notice is seen, and src/health.ts:186 reads it
               correctly. Deleted is deliberately excluded -- the badge says "by a moderator",
               and a deletion is usually the author's own doing. */
            (SELECT count(*) FROM observations WHERE kind = 'reply-marked-removed') AS removals,
            (SELECT count(*) FROM certifications)                        AS certifications`
  );
  const row = r.rows[0] ?? {};
  const n = (k: string) => Number(row[k] ?? 0);
  return {
    published: n('published'), pending: n('pending'), reviews: n('reviews'),
    regret: n('regret'), removals: n('removals'), certifications: n('certifications')
  };
}

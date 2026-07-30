/**
 * The six append-only event logs.
 *
 * observations · reviews · regret · interactions · trace · confirmations
 *
 * All six are append-only and stay that way: no UPDATE, no DELETE, no updated_at,
 * no trigger. They are the record of what happened. The tables carry the same
 * vocabularies the TypeScript unions do (db/migrations/0009_event_logs.up.sql), so a
 * value the code cannot produce is a value the database will not store.
 *
 * Record shapes are unchanged from the JSONL era — every field maps to a column or,
 * where the source type is genuinely open (`Observation.value`), to jsonb. That
 * matters most for interactions: `src/interactions.ts` carries observation schema
 * v1.0 under ENGINE-FREEZE, and only its SINK moved.
 *
 * EVERY READER ORDERS BY `id`, NOT BY `ts`.
 *
 * `id` is the append order — the exact sequence the JSONL file preserved by being
 * appended to. `ts` is data the caller supplies, and the two can disagree: a record
 * written now may carry a back-dated timestamp (a checkpoint reading, a replayed
 * observation), and ordering by it silently re-sequences the log. Sorting an
 * append-only log by a field its writer chose is how "the last thing that happened"
 * stops meaning that.
 */
import type { Db } from '../db.js';
import type { Observation } from '../health.js';
import type { ReviewRecord, RegretRecord } from '../review.js';
import type { InteractionRecord } from '../interactions.js';
import type { TraceEvent } from '../trace.js';
import type { ConfirmationRecord } from '../confirm.js';

/**
 * How many rows a log reader returns, and from where.
 *
 * These selectors used to have no bound at all: the caller loaded the whole table and did
 * `rows.slice(-limit)`, which returned the right rows while still making Postgres serialise
 * every row that came before them. The comment above `loadLogRows` even said so — "if these
 * tables ever grow past an operator's own activity, the fix is a limit on the selectors".
 * This is that fix.
 */
export interface Tail { limit?: number; offset?: number }

/**
 * The SQL for "the newest N, still oldest-first".
 *
 * Two steps, and both matter. `ORDER BY id DESC LIMIT n` is what makes the database do the
 * work — it walks the primary key backwards and stops. But a log reads oldest-first, so the
 * page is reversed in memory AFTER it arrives. Reversing `limit` rows is nothing; ordering
 * the whole table ascending and then taking the tail is the thing being avoided.
 *
 * A limit of 0 or less means "no bound" — the callers inside the engine genuinely want every
 * row, and only the console passes a page size.
 */
function tail(t: Tail | undefined, params: unknown[]): { clause: string; params: unknown[] } {
  const limit = Math.floor(Number(t?.limit) || 0);
  if (limit <= 0) return { clause: 'ORDER BY id', params };
  const offset = Math.max(0, Math.floor(Number(t?.offset) || 0));
  return {
    clause: `ORDER BY id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    params: [...params, limit, offset]
  };
}

/** Put a DESC page back into append order. A no-op when the read was unbounded. */
function restore<T>(rows: T[], t: Tail | undefined): T[] {
  return (Math.floor(Number(t?.limit) || 0) > 0) ? rows.reverse() : rows;
}

/**
 * The tables this function may count. An ALLOW-LIST, not a pattern.
 *
 * The guard was `/^redbot\.[a-z_]+$/`. Dropping the schema prefix would have left
 * `/^[a-z_]+$/`, which accepts any identifier and therefore guards almost nothing, so the
 * translation names the tables instead.
 *
 * The name does originate in a request — `/api/page?table=…` — but it is NOT raw input by the
 * time it arrives: src/console-data.ts maps it through its own `LOG_TABLES` dictionary and
 * returns early on a miss, so what reaches here is always one of that module's constants. This
 * list must therefore stay in step with that map. It carries `certifications` for exactly that
 * reason; leaving it out was silent rather than loud, because the call site wraps this in
 * `.catch(() => rows.length)` and the only symptom would have been a pager reporting the size of
 * the page as the size of the table.
 */
const COUNTABLE_LOGS = new Set([
  'history', 'observations', 'reviews', 'regret',
  'interactions', 'trace', 'confirmations', 'certifications'
]);

/** How many rows the table holds altogether, so a pager can say "of 12,480". */
export async function countLog(db: Db, table: string): Promise<number> {
  if (!COUNTABLE_LOGS.has(table)) throw new Error(`refusing to count "${table}"`);
  const r = await db.query<{ n: number }>(`SELECT count(*) AS n FROM ${table}`);
  return Number(r.rows[0]?.n ?? 0);
}

/* ------------------------------------------------------------------ *
 * observations
 * ------------------------------------------------------------------ */

interface ObservationRow {
  ts: Date;
  account: string | null;
  kind: Observation['kind'];
  vector: Observation['vector'];
  permalink: string | null;
  checkpoint: NonNullable<Observation['checkpoint']> | null;
  value: unknown;
  note: string | null;
}

export async function insertObservation(db: Db, o: Observation): Promise<void> {
  await db.query(
    `INSERT INTO observations (ts, account, kind, vector, permalink, checkpoint, value, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [
      o.ts, o.account, o.kind, o.vector, o.permalink ?? null, o.checkpoint ?? null,
      // A karma count must stay a number and a notice must stay a string; jsonb keeps
      // both distinguishable instead of flattening them to text.
      o.value === undefined ? null : JSON.stringify(o.value),
      o.note ?? null
    ]
  );
}

export async function selectObservations(db: Db, t?: Tail): Promise<Observation[]> {
  const q = tail(t, []);
  const r = await db.query<ObservationRow>(
    `SELECT ts, account, kind, vector, permalink, checkpoint, value, note
       FROM observations ${q.clause}`, q.params
  );
  return restore(r.rows, t).map((x) => {
    const o: Observation = { ts: x.ts.toISOString(), account: x.account, kind: x.kind, vector: x.vector };
    if (x.permalink !== null) o.permalink = x.permalink;
    if (x.checkpoint !== null) o.checkpoint = x.checkpoint;
    if (x.value !== null) o.value = x.value as Observation['value'];
    if (x.note !== null) o.note = x.note;
    return o;
  });
}

/* ------------------------------------------------------------------ *
 * reviews
 * ------------------------------------------------------------------ */

interface ReviewRow {
  ts: Date;
  draft_id: string;
  thread_id: string;
  permalink: string;
  decision: ReviewRecord['decision'];
  reason_code: string;
  note: string;
  operator: string | null;
  review_seconds: number | null;
  total_seconds: number | null;
  edit_chars_before: number | null;
  edit_chars_after: number | null;
  edit_retained: number | null;  // was numeric(5,4) in Postgres, which pg returned as a string; SQLite REAL is a number
  edit_before: string | null;
  edit_after: string | null;
  quality: ReviewRecord['quality'] | null;
  gates: ReviewRecord['gates'] | null;
  novelty: ReviewRecord['novelty'] | null;
  contribution: ReviewRecord['contribution'] | null;
}

const j = (v: unknown) => (v === undefined || v === null ? null : JSON.stringify(v));

export async function insertReview(db: Db, r: ReviewRecord): Promise<void> {
  await db.query(
    `INSERT INTO reviews
       (ts, draft_id, thread_id, permalink, decision, reason_code, note, operator,
        review_seconds, total_seconds, edit_chars_before, edit_chars_after, edit_retained,
        edit_before, edit_after, quality, gates, novelty, contribution)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
    [
      r.ts, r.draftId, r.threadId, r.permalink, r.decision, r.reasonCode,
      r.note ?? '', r.operator ?? null,
      r.reviewSeconds ?? null, r.totalSeconds ?? null,
      r.edit?.charsBefore ?? null, r.edit?.charsAfter ?? null, r.edit?.retained ?? null,
      // The verbatim texts. Losing these was the Priority-2 evidence gap src/review.ts names.
      r.edit?.before ?? null, r.edit?.after ?? null,
      j(r.quality), j(r.gates), j(r.novelty), j(r.contribution)
    ]
  );
}

export async function selectReviews(db: Db, t?: Tail): Promise<ReviewRecord[]> {
  const q = tail(t, []);
  const r = await db.query<ReviewRow>(
    `SELECT ts, draft_id, thread_id, permalink, decision, reason_code, note, operator,
            review_seconds, total_seconds, edit_chars_before, edit_chars_after, edit_retained,
            edit_before, edit_after, quality, gates, novelty, contribution
       FROM reviews ${q.clause}`, q.params
  );
  return restore(r.rows, t).map((x) => {
    const out: ReviewRecord = {
      ts: x.ts.toISOString(),
      draftId: x.draft_id,
      threadId: x.thread_id,
      permalink: x.permalink,
      decision: x.decision,
      reasonCode: x.reason_code,
      note: x.note,
      operator: x.operator
    };
    if (x.review_seconds !== null) out.reviewSeconds = x.review_seconds;
    if (x.total_seconds !== null) out.totalSeconds = x.total_seconds;
    if (x.edit_chars_before !== null) {
      out.edit = {
        charsBefore: x.edit_chars_before,
        charsAfter: x.edit_chars_after ?? 0,
        retained: Number(x.edit_retained ?? 0),
        before: x.edit_before ?? '',
        after: x.edit_after ?? ''
      };
    }
    if (x.quality !== null) out.quality = x.quality;
    if (x.gates !== null) out.gates = x.gates;
    if (x.novelty !== null) out.novelty = x.novelty;
    if (x.contribution !== null) out.contribution = x.contribution;
    return out;
  });
}

/* ------------------------------------------------------------------ *
 * regret
 * ------------------------------------------------------------------ */

interface RegretRow {
  ts: Date;
  draft_id: string;
  thread_id: string;
  permalink: string;
  kind: RegretRecord['kind'];
  answer: string;
  category: NonNullable<RegretRecord['category']> | null;
  lessons: string;
  hours_after_publish: number;
  operator: string | null;
}

export async function insertRegret(db: Db, r: RegretRecord): Promise<void> {
  await db.query(
    `INSERT INTO regret
       (ts, draft_id, thread_id, permalink, kind, answer, category, lessons, hours_after_publish, operator)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [r.ts, r.draftId, r.threadId, r.permalink, r.kind, r.answer,
     r.category ?? null, r.lessons ?? '', r.hoursAfterPublish, r.operator ?? null]
  );
}

export async function selectRegrets(db: Db, t?: Tail): Promise<RegretRecord[]> {
  const q = tail(t, []);
  const r = await db.query<RegretRow>(
    `SELECT ts, draft_id, thread_id, permalink, kind, answer, category, lessons,
            hours_after_publish, operator
       FROM regret ${q.clause}`, q.params
  );
  return restore(r.rows, t).map((x) => {
    const out: RegretRecord = {
      ts: x.ts.toISOString(),
      draftId: x.draft_id,
      threadId: x.thread_id,
      permalink: x.permalink,
      kind: x.kind,
      answer: x.answer,
      lessons: x.lessons,
      hoursAfterPublish: Number(x.hours_after_publish),
      operator: x.operator
    };
    if (x.category !== null) out.category = x.category;
    return out;
  });
}

/* ------------------------------------------------------------------ *
 * interactions — observation schema v1.0, ENGINE-FREEZE. Sink only.
 * ------------------------------------------------------------------ */

interface InteractionRow {
  schema_version: string;
  ts: Date;
  kind: InteractionRecord['kind'];
  draft_id: string;
  thread_id: string;
  permalink: string;
  comment_permalink: string | null;
  comment_id: string | null;
  account: string | null;
  checkpoint: string | null;
  elapsed_minutes: number;
  vector: InteractionRecord['vector'];
  thread: InteractionRecord['thread'];
  self: InteractionRecord['self'];
  replies: InteractionRecord['replies'];
  note: string;
}

export async function insertInteraction(db: Db, r: InteractionRecord): Promise<void> {
  await db.query(
    `INSERT INTO interactions
       (schema_version, ts, kind, draft_id, thread_id, permalink,
        comment_permalink, comment_id, account, checkpoint, elapsed_minutes,
        vector, thread, self, replies, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [
      r.schemaVersion, r.ts, r.kind, r.draftId, r.threadId, r.permalink,
      r.commentPermalink, r.commentId, r.account, r.checkpoint, r.elapsedMinutes,
      // Observation schema v1.0 in full. `self: null` is meaningful — it means the
      // reply was not found at all — so it is stored as SQL NULL, not as an empty object.
      r.vector,
      JSON.stringify(r.thread),
      r.self === null ? null : JSON.stringify(r.self),
      JSON.stringify(r.replies ?? []),
      r.note ?? ''
    ]
  );
}

export async function selectInteractions(db: Db, t?: Tail): Promise<InteractionRecord[]> {
  const q = tail(t, []);
  const r = await db.query<InteractionRow>(
    `SELECT schema_version, ts, kind, draft_id, thread_id, permalink,
            comment_permalink, comment_id, account, checkpoint, elapsed_minutes,
            vector, thread, self, replies, note
       FROM interactions ${q.clause}`, q.params
  );
  return restore(r.rows, t).map((x) => ({
    schemaVersion: x.schema_version,
    ts: x.ts.toISOString(),
    kind: x.kind,
    draftId: x.draft_id,
    threadId: x.thread_id,
    permalink: x.permalink,
    commentPermalink: x.comment_permalink,
    commentId: x.comment_id,
    account: x.account,
    checkpoint: x.checkpoint,
    elapsedMinutes: Number(x.elapsed_minutes),
    vector: x.vector,
    thread: x.thread,
    self: x.self,
    replies: x.replies ?? [],
    note: x.note
  }));
}

/* ------------------------------------------------------------------ *
 * trace
 * ------------------------------------------------------------------ */

interface TraceRow {
  ts: Date;
  run_id: string;
  stage: TraceEvent['stage'];
  event: string;
  level: TraceEvent['level'];
  thread_id: string | null;
  draft_id: string | null;
  ms: number | null;
  data: Record<string, unknown> | null;
}

export async function insertTrace(db: Db, e: TraceEvent): Promise<void> {
  await db.query(
    `INSERT INTO trace (ts, run_id, stage, event, level, thread_id, draft_id, ms, data)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      e.ts, e.runId, e.stage, e.event, e.level,
      e.threadId ?? null, e.draftId ?? null, e.ms ?? null,
      e.data === undefined ? null : JSON.stringify(e.data)
    ]
  );
}

export async function selectTrace(db: Db, t?: Tail): Promise<TraceEvent[]> {
  const q = tail(t, []);
  const r = await db.query<TraceRow>(
    `SELECT ts, run_id, stage, event, level, thread_id, draft_id, ms, data
       FROM trace ${q.clause}`, q.params
  );
  return restore(r.rows, t).map((x) => {
    const e: TraceEvent = {
      ts: x.ts.toISOString(), runId: x.run_id, stage: x.stage, event: x.event, level: x.level
    };
    if (x.thread_id !== null) e.threadId = x.thread_id;
    if (x.draft_id !== null) e.draftId = x.draft_id;
    if (x.ms !== null) e.ms = x.ms;
    if (x.data !== null) e.data = x.data;
    return e;
  });
}

/* ------------------------------------------------------------------ *
 * confirmations
 * ------------------------------------------------------------------ */

interface ConfirmationRow {
  ts: Date;
  action: string;
  account: string;
  job_id: string | null;
  confirmed: boolean;
  source: ConfirmationRecord['source'];
  observed: string;
  permalink: string | null;
  visibility: NonNullable<ConfirmationRecord['visibility']>;
  ms: number;
  error: string | null;
}

export async function insertConfirmation(db: Db, r: ConfirmationRecord): Promise<void> {
  await db.query(
    `INSERT INTO confirmations
       (ts, action, account, job_id, confirmed, source, observed, permalink, visibility, ms, error)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      r.ts, r.action, r.account, r.jobId ?? null, r.confirmed, r.source,
      r.observed, r.permalink ?? null, r.visibility ?? 'unknown', r.ms, r.error ?? null
    ]
  );
}

export async function selectConfirmations(db: Db, t?: Tail): Promise<ConfirmationRecord[]> {
  const q = tail(t, []);
  const r = await db.query<ConfirmationRow>(
    `SELECT ts, action, account, job_id, confirmed, source, observed, permalink, visibility, ms, error
       FROM confirmations ${q.clause}`, q.params
  );
  return restore(r.rows, t).map((x) => {
    const c = {
      ts: x.ts.toISOString(),
      action: x.action,
      account: x.account,
      confirmed: x.confirmed,
      source: x.source,
      observed: x.observed,
      visibility: x.visibility,
      ms: x.ms
    } as ConfirmationRecord;
    if (x.job_id !== null) c.jobId = x.job_id;
    if (x.permalink !== null) c.permalink = x.permalink;
    if (x.error !== null) c.error = x.error;
    return c;
  });
}

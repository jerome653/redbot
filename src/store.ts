/**
 * Persistence. Postgres is the store.
 *
 * ---------------------------------------------------------------------------
 * The domain lives in the database (schema `redbot`, built by db/migrations/).
 * Threads, gap analyses, opportunity assessments, drafts and history are read
 * from and written to Postgres — not to data/*.json.
 *
 * Every function below is ASYNC. That is not a style choice: a network round
 * trip cannot be hidden behind a synchronous signature, and pretending
 * otherwise is how a store ends up with a cache that silently disagrees with
 * the database.
 *
 * The file helpers `readJson` / `writeJson` survive and are still exercised by
 * src/test/store.test.ts. They are no longer used for the domain, but the
 * things that are still files — session.json, the operator's own working
 * state — still need an atomic write that a crash cannot truncate.
 * ---------------------------------------------------------------------------
 */
import {
  readFileSync, writeFileSync, existsSync, renameSync,
  openSync, fsyncSync, closeSync
} from 'node:fs';
import { createHash } from 'node:crypto';
import { ensureData } from './config.js';
import { getPool, withTransaction } from './db.js';
import { upsertThreads, loadThreadsFromDb } from './db/threads.js';
import {
  upsertGapAnalyses, loadGapAnalyses,
  upsertAssessments, loadAssessmentsFromDb
} from './db/analysis.js';
import { upsertDraft, loadDraftsFromDb } from './db/drafts.js';
import { appendHistoryRow, loadHistoryFromDb } from './db/history.js';
import type {
  Thread, Draft, HistoryEntry, GapAnalysis, OpportunityAssessment
} from './types.js';

/** Per-process, monotonically increasing so two writers never share a temp filename. */
let writeSeq = 0;

/**
 * Read a JSON file, or the fallback when it does not exist.
 *
 * A file that EXISTS but does not parse is NOT downgraded to the fallback. The old code caught
 * the parse error, warned, and returned `[]` — then the next save did load→modify→write
 * and overwrote the file with a one-element array, destroying every prior (including published)
 * draft (evaluation M2). Instead the unreadable file is moved aside so nothing overwrites it,
 * and the read fails loudly. A missing file is still just "empty".
 */
export function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  const raw = readFileSync(path, 'utf8');
  try {
    return JSON.parse(raw) as T;
  } catch (e) {
    const aside = `${path}.corrupt-${Date.now()}`;
    try { renameSync(path, aside); } catch { /* best effort; the throw below still protects data */ }
    throw new Error(
      `${path} is not readable JSON — moved it to ${aside} and stopped, rather than overwrite it ` +
      `with empty data. (${e instanceof Error ? e.message : String(e)})`
    );
  }
}

/**
 * Write JSON atomically: a fresh unique temp file, flushed to disk, then renamed over the
 * target. The temp name carries the pid and a per-process counter so a concurrent writer in
 * another process cannot land on the same `${path}.tmp` and corrupt each other's write
 * (evaluation M1). The fsync before rename means a crash leaves either the old file or the
 * whole new one, never a truncated file.
 */
export function writeJson(path: string, value: unknown): void {
  ensureData();
  const tmp = `${path}.${process.pid}.${writeSeq++}.tmp`;
  const fd = openSync(tmp, 'w');
  try {
    writeFileSync(fd, JSON.stringify(value, null, 2), 'utf8');
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(tmp, path);
}

export function threadId(permalink: string): string {
  return createHash('sha1').update(permalink).digest('hex').slice(0, 12);
}

/* ---------- threads ---------- */

export async function loadThreads(): Promise<Thread[]> {
  return loadThreadsFromDb(getPool());
}

/**
 * Upsert by id, newest wins. Returns how many were new — the same contract the
 * JSON implementation had, and what `read` and `search` report to the operator.
 *
 * The count is taken inside the transaction, before the write, so a concurrent
 * collection cannot make it wrong.
 */
export async function saveThreads(incoming: Thread[]): Promise<number> {
  if (!incoming.length) return 0;
  return withTransaction(async (c) => {
    const ids = incoming.map((t) => t.id);
    const existing = await c.query<{ id: string }>(
      'SELECT id FROM threads WHERE id IN (SELECT j.value FROM json_each($1) j)', [JSON.stringify(ids)]
    );
    const known = new Set(existing.rows.map((r) => r.id));
    const added = ids.filter((id) => !known.has(id)).length;
    await upsertThreads(c, incoming);
    return added;
  });
}

/* ---------- analysis — RETIRED 2026-07-23 (D-01) ----------
 *
 * The Phase-1 triage path is gone. Nothing reads or writes `analysis.json`, and no
 * table was created for it. It holds 45 triage records including the one cited as
 * E-12; that file stays on disk as evidence. Evidence is not deleted because the
 * code that produced it was, and it is not resurrected into a new schema either.
 */

/* ---------- gap analyses (Phase 3) ---------- */

export async function loadGaps(): Promise<GapAnalysis[]> {
  return loadGapAnalyses(getPool());
}

export async function saveGaps(incoming: GapAnalysis[]): Promise<void> {
  if (!incoming.length) return;
  await withTransaction((c) => upsertGapAnalyses(c, incoming));
}

/* ---------- opportunity assessments (Phase 3) ---------- */

export async function loadAssessments(): Promise<OpportunityAssessment[]> {
  return loadAssessmentsFromDb(getPool());
}

export async function saveAssessments(incoming: OpportunityAssessment[]): Promise<void> {
  if (!incoming.length) return;
  await withTransaction((c) => upsertAssessments(c, incoming));
}

/* ---------- drafts ---------- */

export async function loadDrafts(): Promise<Draft[]> {
  return loadDraftsFromDb(getPool());
}

/**
 * Insert or update one draft.
 *
 * The read-modify-write that the JSON implementation needed is gone: this is a
 * single upsert, so two processes saving different drafts can no longer lose one
 * of them the way `loadDrafts(); modify; writeJson()` could.
 */
export async function saveDraft(draft: Draft): Promise<void> {
  await upsertDraft(getPool(), draft);
}

/* ---------- history (append-only) ---------- */

export async function appendHistory(entry: HistoryEntry): Promise<void> {
  await appendHistoryRow(getPool(), entry);
}

export async function loadHistory(t?: { limit?: number; offset?: number }): Promise<HistoryEntry[]> {
  return loadHistoryFromDb(getPool(), t);
}

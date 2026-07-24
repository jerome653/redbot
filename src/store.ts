/**
 * JSON persistence. Atomic write-and-rename so a kill mid-write cannot truncate a file —
 * the failure mode the Appilot CSV store had.
 */
import { readFileSync, writeFileSync, existsSync, renameSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { paths, ensureData } from './config.js';
import type {
  Thread, Draft, HistoryEntry, GapAnalysis, OpportunityAssessment
} from './types.js';

function readJson<T>(path: string, fallback: T): T {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    console.warn(`warning: ${path} is unreadable, starting from empty`);
    return fallback;
  }
}

function writeJson(path: string, value: unknown): void {
  ensureData();
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  renameSync(tmp, path);
}

export function threadId(permalink: string): string {
  return createHash('sha1').update(permalink).digest('hex').slice(0, 12);
}

/* ---------- threads ---------- */
export function loadThreads(): Thread[] {
  return readJson<Thread[]>(paths.threads, []);
}

/** Upsert by id, newest wins. Returns how many were new. */
export function saveThreads(incoming: Thread[]): number {
  const existing = loadThreads();
  const byId = new Map(existing.map((t) => [t.id, t]));
  let added = 0;
  for (const t of incoming) {
    if (!byId.has(t.id)) added++;
    byId.set(t.id, t);
  }
  writeJson(paths.threads, [...byId.values()]);
  return added;
}

/* ---------- analysis — RETIRED 2026-07-23 (D-01) ----------
 *
 * The Phase-1 triage path is gone. Nothing reads or writes `analysis.json`.
 *
 * The file itself is deliberately left on disk: it holds 45 triage records including the one
 * cited as E-12 (a `[Guide]` post scored 72/confidence 90 against its own rubric's 5). It is
 * evidence, not state, and evidence is not deleted because the code that produced it was.
 * No accessor survives — a reader would be a second decision path waiting to be re-wired.
 */

/* ---------- gap analyses (Phase 3) ---------- */
export function loadGaps(): GapAnalysis[] {
  return readJson<GapAnalysis[]>(paths.gaps, []);
}

export function saveGaps(incoming: GapAnalysis[]): void {
  const byId = new Map(loadGaps().map((g) => [g.threadId, g]));
  for (const g of incoming) byId.set(g.threadId, g);
  writeJson(paths.gaps, [...byId.values()]);
}

/* ---------- opportunity assessments (Phase 3) ---------- */
export function loadAssessments(): OpportunityAssessment[] {
  return readJson<OpportunityAssessment[]>(paths.assessments, []);
}

export function saveAssessments(incoming: OpportunityAssessment[]): void {
  const byId = new Map(loadAssessments().map((a) => [a.threadId, a]));
  for (const a of incoming) byId.set(a.threadId, a);
  writeJson(paths.assessments, [...byId.values()]);
}

/* ---------- drafts ---------- */
export function loadDrafts(): Draft[] {
  return readJson<Draft[]>(paths.drafts, []);
}

export function saveDraft(draft: Draft): void {
  const all = loadDrafts();
  const i = all.findIndex((d) => d.id === draft.id);
  if (i >= 0) all[i] = draft;
  else all.push(draft);
  writeJson(paths.drafts, all);
}

/* ---------- history (append-only) ---------- */
export function appendHistory(entry: HistoryEntry): void {
  ensureData();
  appendFileSync(paths.history, JSON.stringify(entry) + '\n', 'utf8');
}

export function loadHistory(): HistoryEntry[] {
  if (!existsSync(paths.history)) return [];
  return readFileSync(paths.history, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => {
      try { return JSON.parse(l) as HistoryEntry; } catch { return null; }
    })
    .filter((e): e is HistoryEntry => e !== null);
}

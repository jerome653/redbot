/**
 * Flat-file store. JSON Lines, one record per line, append-mostly.
 *
 * Chosen deliberately over a database: the working set is hundreds of rows, the whole
 * thing must be greppable and diffable by a human, and there are no npm deps.
 * Writes go to a temp file and rename, so a kill mid-write cannot truncate the store —
 * the failure mode the Appilot CSV approach has.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { ROOT } from './config.mjs';

const DATA_DIR = join(ROOT, 'data');
const DRAFTS = join(DATA_DIR, 'drafts.jsonl');
const SEEN = join(DATA_DIR, 'seen.json');

function ensureDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

/** Stable identity for a post across scans, independent of any platform id. */
export function naturalKey(post) {
  return createHash('sha1')
    .update(`${post.source}|${post.subreddit}|${(post.title || '').trim().toLowerCase()}`)
    .digest('hex')
    .slice(0, 16);
}

function atomicWrite(path, contents) {
  ensureDir();
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, contents, 'utf8');
  renameSync(tmp, path);
}

export function loadDrafts() {
  if (!existsSync(DRAFTS)) return [];
  return readFileSync(DRAFTS, 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l, i) => {
      try { return JSON.parse(l); }
      catch { console.warn(`skipping corrupt row ${i + 1} in drafts.jsonl`); return null; }
    })
    .filter(Boolean);
}

export function saveDrafts(rows) {
  atomicWrite(DRAFTS, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
}

export function upsertDraft(row) {
  const rows = loadDrafts();
  const i = rows.findIndex((r) => r.id === row.id);
  if (i >= 0) rows[i] = { ...rows[i], ...row, updatedAt: new Date().toISOString() };
  else rows.push({ ...row, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  saveDrafts(rows);
  return rows.find((r) => r.id === row.id);
}

export function loadSeen() {
  if (!existsSync(SEEN)) return {};
  try { return JSON.parse(readFileSync(SEEN, 'utf8')); }
  catch { return {}; }
}

export function markSeen(keys) {
  const seen = loadSeen();
  const now = new Date().toISOString();
  for (const k of keys) seen[k] = now;
  /* keep the file bounded — 90 days is far longer than any thread stays repliable */
  const cutoff = Date.now() - 90 * 86_400_000;
  for (const [k, v] of Object.entries(seen)) {
    if (new Date(v).getTime() < cutoff) delete seen[k];
  }
  atomicWrite(SEEN, JSON.stringify(seen, null, 2));
}

export const paths = { DATA_DIR, DRAFTS, SEEN };

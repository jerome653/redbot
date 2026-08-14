/**
 * Where redbot looks for threads.
 *
 * **The two defects this replaces.** `data/sources.json` was read in three places with
 * `readJson(path, null)` or a bare try/catch, and every one of them collapsed *the file is
 * absent* and *the file is corrupt* into the same answer:
 *
 *   - the console's "add a subreddit" button refused on a fresh install with "sources.json is
 *     missing" — the file it demanded is the file that button exists to create, the same
 *     bootstrap trap accounts.json had;
 *   - `src/commands/auto.ts` turned an unreadable file into `{subs: [], queries: []}` and
 *     reported "Nothing switched on in data/sources.json". The unattended loop then collected
 *     nothing, cycle after cycle, and said so in words that read like a configuration choice.
 *     A typo in that file bought you a bot that looked like it was running and was not.
 *
 * So the two states are kept apart here, once, and every caller inherits it:
 *   absent   → the empty state. Nothing configured yet; adding the first source works.
 *   corrupt  → FAILS CLOSED and says so. Never silently empty, never overwritten.
 *
 * `sources` is the system of record; the file is the seed you import from and the
 * fallback when the database is unreachable — the same precedence `config.loadAccounts` uses.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DATA } from './config.js';
import { getPool, dbUnavailableReason } from './db.js';
import {
  upsertSources, loadSourcesFromDb, getSource, deleteSource, countSources, setSourceEnabled,
  type SourceRecord, type SourceKind
} from './db/sources.js';

export type { SourceRecord, SourceKind };

export const sourcesPath = (): string => join(DATA, 'sources.json');

/** Reddit subreddit names are 2–21 of these. The same rule 0012 enforces in the database. */
const SUBREDDIT_RE = /^[A-Za-z0-9_]{2,21}$/;

export class SourcesError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SourcesError';
  }
}

/** The seed file's shape. `_limits` is prose with no table; it stays in the file. */
interface SourcesFile {
  subreddits?: Array<{ name: string; why?: string; enabled?: boolean }>;
  searches?: Array<{ query: string; why?: string; enabled?: boolean }>;
  _limits?: { maxThreadsPerRun?: number; note?: string };
  [key: string]: unknown;
}

/**
 * Read the seed file.
 *
 * Absent is `null` — the empty state, not an error. Corrupt THROWS, because the whole point
 * is that a config a person cannot read is not a config with nothing in it.
 */
export function readSourcesFile(): SourcesFile | null {
  const f = sourcesPath();
  if (!existsSync(f)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(f, 'utf8'));
  } catch {
    throw new SourcesError(
      `${f} is not readable JSON. Fix or delete it — refusing to treat an unreadable source ` +
      'list as an empty one, because that silently collects nothing.'
    );
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new SourcesError(`${f} is not a JSON object with "subreddits" and/or "searches".`);
  }
  return parsed as SourcesFile;
}

/** The seed file's sources, flattened. Throws if the file is corrupt; empty if absent. */
export function loadSourcesFile(): SourceRecord[] {
  const file = readSourcesFile();
  if (!file) return [];
  const out: SourceRecord[] = [];
  for (const s of file.subreddits ?? []) {
    if (s && typeof s.name === 'string' && s.name) {
      out.push({ kind: 'subreddit', value: s.name, why: s.why ?? null, enabled: s.enabled !== false });
    }
  }
  for (const s of file.searches ?? []) {
    if (s && typeof s.query === 'string' && s.query) {
      out.push({ kind: 'search', value: s.query, why: s.why ?? null, enabled: s.enabled !== false });
    }
  }
  return out;
}

export interface SourcesView {
  sources: SourceRecord[];
  from: 'database' | 'seed-file';
  /** Null when the database answered. A sentence an operator can act on when it did not. */
  unavailable: string | null;
}

/**
 * Every source, from the record.
 *
 * The database wins when it has rows. An empty table means "not imported yet", not "nobody
 * configured anything", so the seed file still answers on a machine that predates the table.
 */
export async function loadSources(): Promise<SourcesView> {
  const reason = dbUnavailableReason();
  if (reason) return { sources: loadSourcesFile(), from: 'seed-file', unavailable: reason };
  try {
    const rows = await loadSourcesFromDb(getPool());
    if (rows.length) return { sources: rows, from: 'database', unavailable: null };
    return { sources: loadSourcesFile(), from: 'seed-file', unavailable: null };
  } catch (e) {
    return {
      sources: loadSourcesFile(), from: 'seed-file',
      unavailable: `The database could not be read: ${e instanceof Error ? e.message : String(e)}`
    };
  }
}

/** What the collector should actually visit this cycle. Off sources are excluded. */
export async function enabledSources(): Promise<{ subs: string[]; queries: string[]; from: string }> {
  const { sources, from } = await loadSources();
  return {
    subs: sources.filter((s) => s.kind === 'subreddit' && s.enabled).map((s) => s.value),
    queries: sources.filter((s) => s.kind === 'search' && s.enabled).map((s) => s.value),
    from
  };
}

/**
 * Write the seed file from a full list, preserving `_limits` and anything else a person put
 * there. Called after every mutation so the offline fallback is true rather than stale.
 */
function writeSeedFile(sources: SourceRecord[]): void {
  // readSourcesFile throws on corrupt — the callers below validate before they get here, so
  // reaching this with an unreadable file would be a bug, not a user error.
  const existing = readSourcesFile() ?? {};
  const next: SourcesFile = { ...existing };
  next.subreddits = sources.filter((s) => s.kind === 'subreddit')
    .map((s) => ({ name: s.value, why: s.why ?? '', enabled: s.enabled }));
  next.searches = sources.filter((s) => s.kind === 'search')
    .map((s) => ({ query: s.value, why: s.why ?? '', enabled: s.enabled }));
  mkdirSync(DATA, { recursive: true });
  writeFileSync(sourcesPath(), JSON.stringify(next, null, 2), 'utf8');
}

export interface MutationResult {
  ok: boolean;
  error?: string;
  kind?: SourceKind;
  value?: string;
  storedIn?: 'database' | 'seed-file';
}

/**
 * Add a source.
 *
 * A fresh install has no file — that is the empty state, and this is what creates it. A file
 * that exists but will not parse stops the operation before anything is written anywhere, so
 * the table and the fallback cannot drift apart.
 */
export async function addSource(kind: SourceKind, rawValue: string, why?: string): Promise<MutationResult> {
  const value = String(rawValue ?? '').trim().replace(/^\/?r\//i, '');
  if (!value) return { ok: false, error: 'Nothing to add.' };
  if (kind === 'subreddit' && !SUBREDDIT_RE.test(value)) {
    return { ok: false, error: 'A subreddit name is 2–21 characters: letters, numbers or underscore.' };
  }
  if (value.length > 200) return { ok: false, error: 'That is too long to be a source.' };

  let onFile: SourceRecord[];
  try { onFile = loadSourcesFile(); }
  catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }

  const reason = dbUnavailableReason();
  if (reason) return { ok: false, error: `The database is not available, so this cannot be recorded.\n${reason}` };

  const already = await getSource(getPool(), kind, value);
  if (already) return { ok: false, error: `${value} is already on the list.` };
  if (onFile.some((s) => s.kind === kind && s.value.toLowerCase() === value.toLowerCase())) {
    return { ok: false, error: `${value} is already on the list.` };
  }

  const record: SourceRecord = { kind, value, why: why?.trim() || 'Added from the console.', enabled: true };
  await upsertSources(getPool(), [record]);

  // Mirror the whole record out, so the seed file is a true fallback and not a partial one.
  const all = await loadSourcesFromDb(getPool());
  writeSeedFile(all);
  return { ok: true, kind, value, storedIn: 'database' };
}

/**
 * Change a source in place — its value, its reason, or both.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT "remove then add".
 *
 * That was the only route before, and it is lossy in a way that is easy to miss: `addSource`
 * hard-codes `why` to "Added from the console." when none is given, so fixing a typo in a
 * keyphrase silently discarded the operator's stated reason for watching it. The reason is the
 * only record of INTENT a source carries — `sources.json` calls itself "configuration a person
 * writes" — and a rename is not a change of intent.
 *
 * It also fails badly halfway: a remove that succeeds followed by an add that is rejected (name
 * shape, duplicate, database gone) leaves the source deleted and nothing put back. So the new
 * value is validated to the SAME rules as `addSource` BEFORE anything is deleted, and the write
 * is a delete+upsert only once the input is known to be acceptable.
 *
 * Relevance is deliberately not a consideration here, exactly as it is not in `addSource`. What
 * is worth watching is the operator's call; the prefilter and the competence check decide what
 * happens to what comes back, and they do it later and visibly.
 */
export async function editSource(
  kind: SourceKind,
  rawOldValue: string,
  rawNewValue: string,
  why?: string
): Promise<MutationResult> {
  const oldValue = String(rawOldValue ?? '').trim().replace(/^\/?r\//i, '');
  const newValue = String(rawNewValue ?? '').trim().replace(/^\/?r\//i, '');
  if (!oldValue) return { ok: false, error: 'Nothing to change.' };
  if (!newValue) return { ok: false, error: 'A source needs a value.' };
  if (kind === 'subreddit' && !SUBREDDIT_RE.test(newValue)) {
    return { ok: false, error: 'A subreddit name is 2–21 characters: letters, numbers or underscore.' };
  }
  if (newValue.length > 200) return { ok: false, error: 'That is too long to be a source.' };

  try { loadSourcesFile(); }
  catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }

  const reason = dbUnavailableReason();
  if (reason) return { ok: false, error: `The database is not available, so this cannot be recorded.\n${reason}` };

  const existing = await getSource(getPool(), kind, oldValue);
  if (!existing) return { ok: false, error: 'Not on the list.' };

  /* Renaming onto a DIFFERENT source that already exists would silently merge two entries into
     one. Changing only the reason — same value, different `why` — is a legitimate edit and is
     allowed through. */
  const renaming = newValue.toLowerCase() !== oldValue.toLowerCase();
  if (renaming) {
    const clash = await getSource(getPool(), kind, newValue);
    if (clash) return { ok: false, error: `${newValue} is already on the list.` };
  }

  /* The reason survives a rename unless a new one was given. Losing it is the defect this
     function exists to prevent. */
  const record: SourceRecord = {
    kind,
    value: newValue,
    why: why?.trim() || existing.why || 'Added from the console.',
    enabled: existing.enabled
  };

  if (renaming) await deleteSource(getPool(), kind, oldValue);
  await upsertSources(getPool(), [record]);

  writeSeedFile(await loadSourcesFromDb(getPool()));
  return { ok: true, kind, value: newValue, storedIn: 'database' };
}

/**
 * Switch a source on or off.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS, WHEN THE COLUMN ALREADY DID.
 *
 * `sources.enabled` has always been the collector's filter (`enabledSources` above), but the
 * console never wrote it. Its switches lived in the browser's `localStorage` under
 * `redbot.src.<kind>.<id>`, and the column was read only as the DEFAULT for a key that was not
 * there yet — so the moment anybody touched a switch, the browser held one answer and the
 * database, the CLI, `redbot doctor` and the seed file held another. Collect obeyed the browser.
 * Everything that reports obeyed the record. A source could therefore read as ON everywhere a
 * person or a test would look while being skipped on every run, which is what turned a collect
 * into "looked through 4 places" over one place. The state was also keyed by NAME and outlived
 * the source: remove a search and its OFF key stayed behind, so re-adding that name months
 * later brought back a switch nobody set.
 *
 * One writer, one reader. The seed file is mirrored on the same call for the same reason every
 * other mutation here mirrors it — a fallback that disagrees with the record is worse than no
 * fallback, because it only ever gets used when nothing else can be consulted.
 */
export async function switchSource(
  kind: SourceKind, rawValue: string, enabled: boolean
): Promise<MutationResult> {
  const value = String(rawValue ?? '').trim().replace(/^\/?r\//i, '');
  if (!value) return { ok: false, error: 'Nothing to switch.' };

  try { loadSourcesFile(); }
  catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }

  const reason = dbUnavailableReason();
  if (reason) return { ok: false, error: `The database is not available, so this cannot be recorded.\n${reason}` };

  /* Refuse rather than create. A switch is a change to something that exists; inventing the row
     here would let a typo in the console add a source under the guise of turning one off. */
  const changed = await setSourceEnabled(getPool(), kind, value, enabled);
  if (!changed) return { ok: false, error: 'Not on the list.' };

  writeSeedFile(await loadSourcesFromDb(getPool()));
  return { ok: true, kind, value, storedIn: 'database' };
}

/** Remove a source from the record, and from the seed file with it. */
export async function removeSource(kind: SourceKind, rawValue: string): Promise<MutationResult> {
  const value = String(rawValue ?? '').trim();
  if (!value) return { ok: false, error: 'Nothing to remove.' };

  try { loadSourcesFile(); }
  catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }

  const reason = dbUnavailableReason();
  if (reason) return { ok: false, error: `The database is not available, so this cannot be recorded.\n${reason}` };

  const removed = await deleteSource(getPool(), kind, value);
  if (!removed) return { ok: false, error: 'Not on the list.' };

  writeSeedFile(await loadSourcesFromDb(getPool()));
  return { ok: true, kind, value, storedIn: 'database' };
}

/** Copy the seed file into the database. The file wins: import means "match this list". */
export async function importSources(): Promise<number> {
  const fromFile = loadSourcesFile();
  if (!fromFile.length) return 0;
  return upsertSources(getPool(), fromFile);
}

/** How many sources are on the record. */
export async function countSourcesInDb(): Promise<number> {
  return countSources(getPool());
}

/** Write the database back out to the seed file. */
export async function exportSources(): Promise<number> {
  const rows = await loadSourcesFromDb(getPool());
  writeSeedFile(rows);
  return rows.length;
}

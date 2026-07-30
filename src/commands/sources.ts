/**
 * `redbot sources`                    — where redbot looks for threads, and where that came from
 * `redbot sources add r/<name>`       — add a subreddit
 * `redbot sources add --search "<q>"` — add a saved search
 * `redbot sources rm <value>`         — take one off the list
 * `redbot sources import` / `export`  — move between the database and data/sources.json
 *
 * `sources` is the system of record; `data/sources.json` is the seed you import from
 * and the fallback when the database is unreachable — the same arrangement as `redbot accounts`.
 *
 * The distinction this surface exists to keep visible: an unreadable source list is NOT an
 * empty one. `auto` used to treat the two the same and collect nothing while reporting
 * "Nothing switched on", so `list` says which source answered, every time.
 */
import { say } from '../log.js';
import {
  loadSources, addSource, removeSource, importSources, exportSources, countSourcesInDb,
  sourcesPath, SourcesError
} from '../sources.js';
import { closePool, dbUnavailableReason } from '../db.js';

async function list(): Promise<number> {
  say.head('redbot sources');

  let view;
  try { view = await loadSources(); }
  catch (e) {
    // A corrupt seed file reaches here as a throw, and must read as broken rather than empty.
    say.fail(e instanceof SourcesError ? e.message : String(e));
    return 1;
  }

  if (view.unavailable) {
    say.warn('The database could not be read, so the seed file is answering.');
    say.step(view.unavailable);
  }

  if (!view.sources.length) {
    say.warn('Nothing configured — redbot has nowhere to look.');
    say.step('Add one:  redbot sources add r/WordPress');
    return 0;
  }

  const subs = view.sources.filter((s) => s.kind === 'subreddit');
  const queries = view.sources.filter((s) => s.kind === 'search');

  if (subs.length) {
    say.step('Subreddits');
    for (const s of subs) {
      say.step(`  ${s.enabled ? 'on ' : 'off'}  r/${s.value}${s.why ? `  — ${s.why}` : ''}`);
    }
  }
  if (queries.length) {
    say.step('Searches');
    for (const s of queries) {
      say.step(`  ${s.enabled ? 'on ' : 'off'}  "${s.value}"${s.why ? `  — ${s.why}` : ''}`);
    }
  }

  say.step('');
  const on = view.sources.filter((s) => s.enabled).length;
  say.ok(`${on} of ${view.sources.length} switched on · source of truth: ${
    view.from === 'database' ? 'sources' : `${sourcesPath()} (seed)`}`);
  if (view.from === 'seed-file' && !view.unavailable) {
    say.warn('None of these are in the database yet.');
    say.step('Import them:  redbot sources import');
  }
  return 0;
}

async function add(value: string | undefined, isSearch: boolean, why?: string): Promise<number> {
  if (!value) {
    say.fail('What should it collect? `redbot sources add r/WordPress` or `--search "<query>"`');
    return 1;
  }
  const r = await addSource(isSearch ? 'search' : 'subreddit', value, why);
  if (!r.ok) { say.fail(r.error ?? 'could not add that source'); return 1; }
  say.ok(`Added ${r.kind === 'search' ? `search "${r.value}"` : `r/${r.value}`} — switched on.`);
  return 0;
}

async function remove(value: string | undefined, isSearch: boolean): Promise<number> {
  if (!value) { say.fail('Which one? `redbot sources rm <name-or-query>`'); return 1; }
  const r = await removeSource(isSearch ? 'search' : 'subreddit', value);
  if (!r.ok) { say.fail(r.error ?? 'could not remove that source'); return 1; }
  say.ok(`Removed ${r.value}.`);
  return 0;
}

async function importCmd(): Promise<number> {
  say.head('redbot sources import');
  const reason = dbUnavailableReason();
  if (reason) { say.fail('The database is not available.'); say.step(reason); return 1; }
  let n: number;
  try { n = await importSources(); }
  catch (e) { say.fail(e instanceof SourcesError ? e.message : String(e)); return 1; }
  if (!n) { say.warn(`Nothing to import — ${sourcesPath()} lists no sources.`); return 1; }
  say.ok(`Imported ${n} source(s) into sources.`);
  return 0;
}

async function exportCmd(): Promise<number> {
  say.head('redbot sources export');
  const reason = dbUnavailableReason();
  if (reason) { say.fail('The database is not available.'); say.step(reason); return 1; }
  if (!(await countSourcesInDb())) {
    say.warn('The database lists no sources — refusing to write an empty seed file.');
    return 1;
  }
  const n = await exportSources();
  say.ok(`Wrote ${n} source(s) to ${sourcesPath()}.`);
  say.step('This file is a seed and a fallback, not the system of record.');
  return 0;
}

export async function sources(
  sub?: string, value?: string, opts: { search?: string | undefined; why?: string | undefined } = {}
): Promise<number> {
  // `--search "<q>"` carries its own value, so `add`/`rm` accept either form.
  const isSearch = typeof opts.search === 'string' && opts.search.length > 0;
  const target = isSearch ? opts.search : value;
  try {
    if (sub === undefined || sub === 'list') return await list();
    if (sub === 'add')    return await add(target, isSearch, opts.why);
    if (sub === 'rm' || sub === 'remove') return await remove(target, isSearch);
    if (sub === 'import') return await importCmd();
    if (sub === 'export') return await exportCmd();
    say.fail(`Unknown: "${sub}". One of: list, add, rm, import, export.`);
    return 1;
  } catch (e) {
    say.fail(e instanceof Error ? e.message : String(e));
    return 1;
  } finally {
    await closePool();
  }
}

/**
 * `redbot accounts`          — who redbot may post as, and where that answer came from
 * `redbot accounts import`   — copy data/accounts.json into the database
 * `redbot accounts export`   — write the database back out to data/accounts.json
 *
 * **Where accounts live.** `redbot.accounts` is the system of record; `data/accounts.json` is
 * the seed you import from, and the fallback when the database is not reachable. The console's
 * setup wizard writes both, so a person clicking buttons never has to know this command exists
 * — it is for the machine that already had a file before the database existed, and for looking
 * at which source is actually answering.
 *
 * No credentials pass through here. An account record is a handle, a role, a port and a
 * profile directory; the session lives in the Chrome profile and never in a column
 * (db/migrations/0002_accounts.up.sql). Secrets go in the vault — `redbot vault`.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import {
  DATA, accountsPath, loadAccountsFile, loadAccounts, forgetAccounts, primeAccounts, config
} from '../config.js';
import type { AccountRecord } from '../config.js';
import { say } from '../log.js';
import { getPool, closePool, dbUnavailableReason } from '../db.js';
import { upsertAccounts, loadAccountsFromDb, countAccounts, boundHandles } from '../db/accounts.js';
import { machineId } from '../machine.js';

function describe(a: AccountRecord, active: string | undefined, boundHere: Set<string> | null): void {
  const mark = a.handle.toLowerCase() === (active ?? '').toLowerCase() ? '→' : ' ';
  say.step(`${mark} ${a.handle}${a.role ? `  (${a.role})` : ''}`);
  /**
   * An account shared from another computer has a description but no browser here.
   *
   * Its port and folder are NOT printed in that case, deliberately. A number would still be
   * available — the pre-0013 column answers when no binding exists — but it is whichever
   * machine wrote the row first, not this one, and printing it under "this machine" is how
   * somebody ends up attaching to whatever holds that port here. Absent is the honest answer;
   * the line below says what to do about it.
   */
  if (boundHere && !boundHere.has(a.handle.toLowerCase())) {
    say.step('    not set up on this machine — sign in once here, from the console');
  } else {
    const where = a.debugPort ? `port ${a.debugPort}` : 'no port — cannot drive a browser';
    say.step(`    ${where}${a.profileDir ? `, profile ${a.profileDir}` : ''}`);
  }
  if (a.subreddits?.length) say.step(`    speaks in: ${a.subreddits.join(', ')}`);
}

async function list(): Promise<number> {
  say.head('redbot accounts');
  /* Named up front because everything below is answered FOR this machine: the description is
     shared, the browser binding is not. */
  say.step(`this machine: ${machineId()}`);

  const reason = dbUnavailableReason();
  let inDb = 0;
  let boundHere: Set<string> | null = null;
  if (!reason) {
    try { inDb = await countAccounts(getPool()); }
    catch (e) { say.warn(`The database could not be read: ${e instanceof Error ? e.message : String(e)}`); }
    // Null rather than empty on failure: "nothing is set up here" and "I could not tell" are
    // different answers, and only the first should print a warning against every account.
    try { boundHere = await boundHandles(getPool()); } catch { boundHere = null; }
  } else {
    say.warn('The database is not configured, so the seed file is answering.');
    say.step(reason);
  }

  const onFile = loadAccountsFile().length;
  const all = loadAccounts();

  if (!all.length) {
    say.warn('No accounts configured.');
    say.step('Set one up in the console, or write data/accounts.json and run: redbot accounts import');
    return 0;
  }

  for (const a of all) describe(a, config.llm.operator ? undefined : process.env.REDBOT_ACCOUNT, boundHere);

  say.step('');
  // Saying which source answered is the point of this command: a stale seed file that
  // disagrees with the database is exactly the confusion this reports rather than hides.
  say.ok(inDb ? `${inDb} in the database (the system of record).` : 'Answered from data/accounts.json.');
  if (inDb && onFile && inDb !== onFile) {
    say.warn(`data/accounts.json holds ${onFile} — it is a seed and is now out of date.`);
    say.step('Bring it back in line:  redbot accounts export');
  }
  if (!inDb && onFile) {
    say.warn('None of these are in the database yet.');
    say.step('Import them:  redbot accounts import');
  }
  return 0;
}

async function importFromFile(): Promise<number> {
  say.head('redbot accounts import');

  const reason = dbUnavailableReason();
  if (reason) { say.fail('The database is not available.'); say.step(reason); return 1; }

  const fromFile = loadAccountsFile();
  if (!fromFile.length) {
    say.warn(`Nothing to import — ${accountsPath()} holds no accounts.`);
    return 1;
  }

  // The file wins on a conflict: it is what a person wrote, and import is the verb that says
  // "make the database match it". Nothing is deleted — an account only in the database stays.
  const n = await upsertAccounts(getPool(), fromFile);
  forgetAccounts();
  await primeAccounts();

  say.ok(`Imported ${n} account(s) into redbot.accounts.`);
  for (const a of fromFile) say.step(`  ${a.handle}`);
  say.step('');
  say.step('The database is now the system of record. data/accounts.json stays as the seed.');
  /* The seed file is this computer's own, so importing it also claims each account's browser
     for this machine — that is the step that makes a second machine's ports its own rather
     than inherited from whichever machine wrote the row first. */
  say.step(`Their browsers are now recorded against this machine (${machineId()}).`);
  return 0;
}

async function exportToFile(): Promise<number> {
  say.head('redbot accounts export');

  const reason = dbUnavailableReason();
  if (reason) { say.fail('The database is not available.'); say.step(reason); return 1; }

  const rows = await loadAccountsFromDb(getPool());
  if (!rows.length) { say.warn('The database holds no accounts — refusing to write an empty seed file.'); return 1; }

  mkdirSync(DATA, { recursive: true });
  writeFileSync(accountsPath(), JSON.stringify({ accounts: rows }, null, 2), 'utf8');
  say.ok(`Wrote ${rows.length} account(s) to ${accountsPath()}.`);
  say.step('This file is a seed and a fallback, not the system of record.');
  return 0;
}

export async function accounts(sub?: string): Promise<number> {
  try {
    if (sub === undefined || sub === 'list') return await list();
    if (sub === 'import') return await importFromFile();
    if (sub === 'export') return await exportToFile();
    say.fail(`Unknown: "${sub}". One of: list, import, export.`);
    return 1;
  } catch (e) {
    say.fail(e instanceof Error ? e.message : String(e));
    return 1;
  } finally {
    await closePool();
  }
}

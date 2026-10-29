/**
 * `redbot reddit-login`                        — list stored logins (metadata only)
 * `redbot reddit-login set <handle> --email <e>` — store one, GATED on a confirmed live login
 * `redbot reddit-login get <handle>`           — is one stored? plus its metadata (never the password)
 * `redbot reddit-login rm <handle>`            — remove one
 *
 * Mirrors `redbot vault` deliberately (src/commands/vault.ts): the PASSWORD is read from stdin,
 * never from an argument, because a secret in argv lands in the shell history and in the process
 * list every other user on the machine can read:
 *
 *   PowerShell:  "my-password" | redbot reddit-login set jordangrowth --email me@example.com
 *   bash:        printf %s "my-password" | redbot reddit-login set jordangrowth --email me@example.com
 *
 * Nothing here ever prints a stored password. `get` reports only that a login EXISTS and when it
 * was stored — the same reasoning as vault having no `get`: a command whose output is a live
 * credential is a command that ends up in a screenshot or a support ticket.
 *
 * `set` runs the confirmed-login gate (src/reddit-credentials.ts putRedditLogin): it opens that
 * account's own browser, and refuses to store anything unless the signed-in user IS that handle.
 */
import { say } from '../log.js';
import {
  putRedditLogin, getRedditLogin, listRedditLogins, removeRedditLogin
} from '../reddit-credentials.js';
import { vaultReady, vaultUnavailableReason } from '../credentials.js';
import { closePool } from '../db.js';

/** Read the password from stdin. A TTY with nobody piping in would hang, so that is refused. */
async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    throw new Error(
      'Pipe the password in — it must not appear in a command line, where the shell history and ' +
      'the process list would both keep it:\n' +
      '  PowerShell:  "my-password" | redbot reddit-login set <handle> --email <email>\n' +
      '  bash:        printf %s "my-password" | redbot reddit-login set <handle> --email <email>'
    );
  }
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(Buffer.from(c));
  // A trailing newline comes from the pipe, not the password.
  return Buffer.concat(chunks).toString('utf8').trim();
}

function reportUnavailable(): number {
  say.fail('The vault is not available.');
  for (const line of (vaultUnavailableReason() ?? '').split('\n')) say.step(line);
  return 1;
}

async function list(): Promise<number> {
  say.head('redbot reddit-login');
  if (!vaultReady()) return reportUnavailable();

  const logins = await listRedditLogins();
  if (!logins.length) {
    say.warn('No logins stored.');
    say.step('Store one (after signing in):');
    say.step('  printf %s "<password>" | redbot reddit-login set <handle> --email <email>');
    return 0;
  }
  for (const l of logins) {
    say.step(`${l.handle}`);
    say.step(`    stored ${l.createdAt.slice(0, 10)}` +
             (l.lastUsedAt ? `, last used ${l.lastUsedAt.slice(0, 10)}` : ', never used'));
  }
  say.step('');
  say.ok(`${logins.length} login(s), sealed in the vault. The email and password are never printed.`);
  return 0;
}

async function set(handle: string | undefined, email: string | undefined): Promise<number> {
  if (!handle) { say.fail('Which account? `redbot reddit-login set <handle> --email <email>`'); return 1; }
  if (!email)  { say.fail('Which email? `redbot reddit-login set <handle> --email <email>`'); return 1; }
  if (!vaultReady()) return reportUnavailable();

  const password = await readStdin();
  if (!password) { say.fail('Nothing was piped in — refusing to store an empty password.'); return 1; }

  say.step(`Confirming the live login for "${handle}" — opening that account's browser and`);
  say.step('checking the signed-in user. Nothing is stored unless it matches.');
  // The default confirm is the real browser probe; it THROWS on no-session or wrong-account.
  await putRedditLogin(handle, { email, password });
  say.ok(`Confirmed signed in as "${handle}" and stored the login, sealed.`);
  say.step('Lose REDBOT_VAULT_KEY and this login cannot be recovered — it is not in the database.');
  return 0;
}

async function get(handle: string | undefined): Promise<number> {
  if (!handle) { say.fail('Which account? `redbot reddit-login get <handle>`'); return 1; }
  if (!vaultReady()) return reportUnavailable();

  // Existence + metadata only — read from the listing so nothing has to be decrypted, and the
  // password can never reach the terminal even by accident.
  const meta = (await listRedditLogins()).find((l) => l.handle === handle);
  if (!meta) {
    say.warn(`No login stored for "${handle}".`);
    return 1;
  }
  say.ok(`A login IS stored for "${handle}".`);
  say.step(`stored ${meta.createdAt.slice(0, 10)}` +
           (meta.lastUsedAt ? `, last used ${meta.lastUsedAt.slice(0, 10)}` : ', never used'));
  say.step('The email and password are not printed. Nothing here puts a credential on the terminal.');
  return 0;
}

async function remove(handle: string | undefined): Promise<number> {
  if (!handle) { say.fail('Which account? `redbot reddit-login rm <handle>`'); return 1; }
  if (!vaultReady()) return reportUnavailable();

  if (await removeRedditLogin(handle)) { say.ok(`Removed the login for "${handle}".`); return 0; }
  say.warn(`No login stored for "${handle}".`);
  return 1;
}

export async function redditLogin(
  sub?: string,
  handle?: string,
  opts: { email?: string } = {}
): Promise<number> {
  try {
    if (sub === undefined || sub === 'list') return await list();
    if (sub === 'set')                        return await set(handle, opts.email);
    if (sub === 'get')                        return await get(handle);
    if (sub === 'rm' || sub === 'remove')     return await remove(handle);
    say.fail(`Unknown: "${sub}". One of: list, set, get, rm.`);
    return 1;
  } catch (e) {
    say.fail(e instanceof Error ? e.message : String(e));
    return 1;
  } finally {
    // A CLI that leaves a pool open hangs instead of exiting.
    await closePool();
  }
}

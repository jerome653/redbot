/**
 * `redbot vault`                       — what secrets are stored, and under which key
 * `redbot vault set <name>`            — store a secret (read from stdin, never from argv)
 * `redbot vault rm <name>`             — remove one
 * `redbot vault check`                 — can the vault be opened at all?
 *
 * **Why the value never comes from an argument.** `redbot vault set anthropic_api_key sk-ant-...`
 * would put the key in the shell history file, in the process list every other user on the
 * machine can read, and in any shell transcript. It is read from stdin instead:
 *
 *   PowerShell:  "sk-ant-..." | redbot vault set anthropic_api_key
 *   bash:        printf %s "sk-ant-..." | redbot vault set anthropic_api_key
 *
 * Nothing here ever prints a stored secret. `list` shows the name, the four-character hint and
 * which key sealed it — enough to identify a credential, never enough to use one. There is
 * deliberately no `redbot vault get`: a command whose whole purpose is to put a live key on a
 * terminal is a command that will one day put it in a screenshot or a support ticket.
 */
import { say } from '../log.js';
import {
  putSecret, listSecrets, removeSecret, vaultReady, vaultUnavailableReason, keyFingerprint,
  SCOPE_GLOBAL
} from '../credentials.js';
import { closePool } from '../db.js';

/** Read the secret from stdin. A TTY with nobody piping into it would hang, so that is refused. */
async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    throw new Error(
      'Pipe the secret in — it must not appear in a command line, where the shell history and ' +
      'the process list would both keep it:\n' +
      '  PowerShell:  "sk-ant-..." | redbot vault set <name>\n' +
      '  bash:        printf %s "sk-ant-..." | redbot vault set <name>'
    );
  }
  const chunks: Buffer[] = [];
  for await (const c of process.stdin) chunks.push(Buffer.from(c));
  // Trailing newlines come from the pipe, not the secret — `echo` adds one and it is not
  // part of the key. Leading whitespace is stripped for the same reason.
  return Buffer.concat(chunks).toString('utf8').trim();
}

function reportUnavailable(): number {
  say.fail('The vault is not available.');
  for (const line of (vaultUnavailableReason() ?? '').split('\n')) say.step(line);
  return 1;
}

async function list(): Promise<number> {
  say.head('redbot vault');
  if (!vaultReady()) return reportUnavailable();

  const secrets = await listSecrets();
  if (!secrets.length) {
    say.warn('No secrets stored.');
    say.step('Store one:  printf %s "sk-ant-..." | redbot vault set anthropic_api_key');
    return 0;
  }

  const current = keyFingerprint();
  for (const s of secrets) {
    const where = s.scope === SCOPE_GLOBAL ? 'everyone on this machine' : `operator ${s.scope}`;
    const shown = s.hint ? `…${s.hint}` : '(too short to hint)';
    // A secret sealed under a key that is no longer the current one cannot be opened, and
    // saying so here is cheaper than discovering it mid-run.
    const stale = s.keyId === current ? '' : `  [sealed with key ${s.keyId} — NOT the key in use]`;
    say.step(`${s.name}  ${shown}  · ${where}${stale}`);
    say.step(`    stored ${s.createdAt.slice(0, 10)}` +
             (s.lastUsedAt ? `, last used ${s.lastUsedAt.slice(0, 10)}` : ', never used'));
  }
  say.step('');
  say.ok(`${secrets.length} secret(s), encrypted with the key fingerprinted ${current}.`);
  return 0;
}

async function set(name: string | undefined, scope: string): Promise<number> {
  if (!name) { say.fail('Which secret? `redbot vault set <name>`'); return 1; }
  if (!vaultReady()) return reportUnavailable();

  const value = await readStdin();
  if (!value) { say.fail('Nothing was piped in — refusing to store an empty secret.'); return 1; }

  await putSecret(name, value, scope);
  const where = scope === SCOPE_GLOBAL ? 'this machine' : `operator ${scope}`;
  say.ok(`Stored "${name}" for ${where}, encrypted.`);
  say.step(`Sealed with the key fingerprinted ${keyFingerprint()}.`);
  say.step('Lose REDBOT_VAULT_KEY and this secret cannot be recovered — it is not in the database.');
  return 0;
}

async function remove(name: string | undefined, scope: string): Promise<number> {
  if (!name) { say.fail('Which secret? `redbot vault rm <name>`'); return 1; }
  if (!vaultReady()) return reportUnavailable();

  if (await removeSecret(name, scope)) { say.ok(`Removed "${name}".`); return 0; }
  say.warn(`No secret named "${name}"${scope === SCOPE_GLOBAL ? '' : ` for operator ${scope}`}.`);
  return 1;
}

function check(): number {
  say.head('redbot vault check');
  if (!vaultReady()) return reportUnavailable();
  say.ok(`The vault key is present and usable (fingerprint ${keyFingerprint()}).`);
  say.step('Secrets are sealed with AES-256-GCM. The key is not in the database,');
  say.step('so a dump of redbot.credentials without it yields nothing.');
  return 0;
}

export async function vault(sub?: string, name?: string, scope = SCOPE_GLOBAL): Promise<number> {
  try {
    if (sub === undefined || sub === 'list') return await list();
    if (sub === 'set')   return await set(name, scope);
    if (sub === 'rm' || sub === 'remove') return await remove(name, scope);
    if (sub === 'check') return check();
    say.fail(`Unknown: "${sub}". One of: list, set, rm, check.`);
    return 1;
  } catch (e) {
    say.fail(e instanceof Error ? e.message : String(e));
    return 1;
  } finally {
    // A CLI that leaves a pool open hangs instead of exiting.
    await closePool();
  }
}

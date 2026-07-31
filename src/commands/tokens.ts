/**
 * `redbot tokens mint --admin-token-file <path> [--share-from <installId>]`
 *
 * Mints this install's dashboard tokens and seals them in the vault, so a person setting up a
 * second machine does not have to hand-assemble two curl calls and then paste two 68-character
 * strings into the right two boxes.
 *
 * WHY THE ADMIN TOKEN COMES FROM A FILE AND IS NEVER STORED.
 *
 * `REDBOT_ADMIN_TOKEN` mints and revokes tokens for EVERY install on the service. It is not this
 * app's secret and must not become one: a field for it on the Setup screen would station a
 * fleet-wide credential on every operator's desktop, where one stolen laptop compromises
 * everything rather than one install. So it is read from a path given at run time, used, and
 * dropped. Nothing writes it to the vault, to `push-state.json`, or to the run log.
 *
 * It is also not accepted as an argument. `src/commands/vault.ts` refuses a secret in argv
 * because the shell history and the process list both keep it; the same rule applies here, and a
 * path is not a secret.
 *
 * WHAT THIS DOES NOT ADD. Anybody holding the admin token can already mint with curl against the
 * documented admin routes. This is convenience, not a new capability — which is exactly why it is
 * safe to ship while an admin-token field would not be.
 */
import { readFileSync } from 'node:fs';
import { say } from '../log.js';
import { installId } from '../push/state.js';
import { syncUrl, SYNC_PUSH_TOKEN, SYNC_SHARE_TOKEN } from '../push/index.js';

/**
 * Read the admin token from a file.
 *
 * Accepts either a bare token or a `NAME=value` line, because that is what an operator actually
 * has on disk — and getting it wrong costs a `401 Unknown token`, which the service reports
 * identically for a malformed token and for one it has never seen. Measured while setting this
 * up: sending `REDBOT_ADMIN_TOKEN=<value>` as the bearer produced exactly that.
 */
export function readAdminToken(path: string): string {
  const raw = readFileSync(path, 'utf8').replace(/^﻿/, '').trim();
  if (!raw) throw new Error(`${path} is empty`);
  const value = raw.includes('=') ? raw.slice(raw.indexOf('=') + 1).trim() : raw;
  const unquoted = value.replace(/^["']|["']$/g, '');
  if (!unquoted) throw new Error(`${path} has a name but no value after the "="`);
  if (/\s/.test(unquoted)) throw new Error(`${path} does not look like a single token — it contains whitespace`);
  return unquoted;
}

interface MintOpts {
  adminTokenFile?: string | undefined;
  /** The install whose account list this machine should be allowed to READ. */
  shareFrom?: string | undefined;
  label?: string | undefined;
  /** Injected in tests. */
  fetchImpl?: typeof fetch;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function mint(opts: MintOpts): Promise<number> {
  say.head('redbot tokens mint');

  const base = syncUrl();
  if (!base) {
    say.fail('no dashboard endpoint — set it on the Setup screen, or REDBOT_SYNC_URL');
    return 1;
  }
  if (!opts.adminTokenFile) {
    say.fail('Usage: redbot tokens mint --admin-token-file <path> [--share-from <installId>]');
    say.step('The admin token is the SERVICE\'s secret. It is read from the file, used once,');
    say.step('and never stored — not in the vault, not on disk, not in the run log.');
    return 1;
  }

  let admin: string;
  try {
    admin = readAdminToken(opts.adminTokenFile);
  } catch (e) {
    say.fail(e instanceof Error ? e.message : String(e));
    return 1;
  }

  const id = installId();
  const doFetch = opts.fetchImpl ?? fetch;
  const url = base.replace(/\/+$/, '');
  const label = opts.label ?? 'redbot';
  say.step(`endpoint  ${url}`);
  say.step(`install   ${id}`);
  say.step('');

  const post = async (path: string, body: unknown): Promise<{ ok: boolean; status: number; json: any }> => {
    const res = await doFetch(`${url}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${admin}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000)
    });
    let json: any = null;
    try { json = await res.json(); } catch { /* the status carries the message */ }
    return { ok: res.ok, status: res.status, json };
  };

  const { putSecret } = await import('../credentials.js');
  let failed = false;

  /* ---- the ingest token, always, and always for THIS install ---- */
  const ing = await post('/v2/admin/installs', { installId: id, label });
  if (!ing.ok) {
    say.fail(`could not mint an ingest token — ${ing.status} ${ing.json?.message ?? ''}`);
    if (ing.status === 401) say.step('The admin token was not accepted. Check the file holds the value, not a NAME=value line.');
    failed = true;
  } else {
    const token = ing.json?.ingestToken ?? ing.json?.token;
    if (typeof token !== 'string' || !token) {
      say.fail('the service accepted the request but returned no ingest token');
      failed = true;
    } else {
      await putSecret(SYNC_PUSH_TOKEN, token);
      say.ok(`ingest token stored, sealed, ending ${token.slice(-4)}`);
    }
  }

  /* ---- the share token, only when asked, and scoped to somebody ELSE's install ---- */
  if (opts.shareFrom) {
    if (!UUID.test(opts.shareFrom)) {
      say.fail(`--share-from must be a UUID, got "${opts.shareFrom}"`);
      failed = true;
    } else if (opts.shareFrom.toLowerCase() === id.toLowerCase()) {
      /* Reading your own list is not sharing, and it is the mistake that produces an empty pull
         rather than an error — so it is refused with the reason rather than silently allowed. */
      say.fail('--share-from is this install\'s own id. A share token reads ANOTHER install\'s list;');
      say.step('use the id of the machine that owns the accounts.');
      failed = true;
    } else {
      const shr = await post('/v2/admin/share-tokens', {
        installId: opts.shareFrom, label: `${label}-reader`, ttlHours: 720
      });
      if (!shr.ok) {
        say.fail(`could not mint a share token — ${shr.status} ${shr.json?.message ?? ''}`);
        failed = true;
      } else {
        const token = shr.json?.shareToken ?? shr.json?.token;
        if (typeof token !== 'string' || !token) {
          say.fail('the service accepted the request but returned no share token');
          failed = true;
        } else {
          await putSecret(SYNC_SHARE_TOKEN, token);
          say.ok(`share token stored, sealed, ending ${token.slice(-4)} — reads ${opts.shareFrom}`);
          if (shr.json?.expiresAt) say.step(`  expires ${shr.json.expiresAt}`);
        }
      }
    }
  }

  say.step('');
  if (failed) return 1;
  say.ok('Done. Nothing was printed that a screenshot could leak, and the admin token was not stored.');
  say.step('The Setup screen will show each token by its last four characters.');
  return 0;
}

export async function tokens(sub: string | undefined, opts: MintOpts = {}): Promise<number> {
  if (sub === 'mint') return mint(opts);
  say.head('redbot tokens');
  say.step('mint   --admin-token-file <path> [--share-from <installId>] [--label <name>]');
  say.step('');
  say.step('Mints this install\'s dashboard tokens and seals them in the vault.');
  say.step('The admin token belongs to the SERVICE — it is read from the file, used, never stored.');
  return sub ? 1 : 0;
}

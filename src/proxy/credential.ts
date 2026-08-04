/**
 * The proxy username and password — the one part of an exit that is a secret.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A MODULE AND NOT TWO LINES AT EACH CALL SITE
 *
 * Three places need the credential — `proxy vet` when it seals one, the relay manager when it
 * starts a listener, and nothing else, ever — and each of them has to agree on two details that
 * are invisible at the call site and silently wrong if they drift:
 *
 *   1. THE SCOPE IS LOWER-CASED. `0011_credentials` CHECKs `scope NOT GLOB '*[^a-z0-9._-]*'` and
 *      src/credentials.ts refuses anything else, so sealing under "Striking_Mousse6841" throws
 *      while reading under "striking_mousse6841" quietly finds nothing. `proxyScope()` is the one
 *      conversion, and it lives in src/db/proxies.ts beside the table that uses it.
 *
 *   2. THE VALUE IS JSON. The vault stores one string per name, and an exit needs two fields. A
 *      "user:pass" string would break on the first password containing a colon — which is not
 *      hypothetical, providers generate them — so it is JSON, parsed strictly.
 *
 * NOTHING HERE LOGS, ECHOES OR RETURNS A CREDENTIAL IN AN ERROR. Every failure below names the
 * PROBLEM ("nothing is stored", "what is stored is not readable") and never the value. That is
 * the rule src/vault.ts and src/proxy/relay.ts already keep, and this module handles the same
 * bytes they do.
 */
import { getSecret, putSecret, removeSecret } from '../credentials.js';
import { proxyScope, PROXY_CREDENTIAL } from '../db/proxies.js';
import type { UpstreamProxy } from './relay.js';

/** Just the secret half — the host and port are not secret and live in `account_proxies`. */
export interface ProxyCredential {
  username: string;
  password: string;
}

/**
 * Seal an account's proxy credential.
 *
 * Refuses an empty half rather than storing it: a blank password earns a 407 on every request,
 * which surfaces to a person as "the internet is broken" — the single most expensive failure
 * this feature can produce, and the one `assertUsableUpstream` also exists to prevent.
 */
export async function saveProxyCredential(
  handle: string, cred: ProxyCredential
): Promise<void> {
  if (!cred.username || !cred.password) {
    throw new Error('A proxy credential needs both a username and a password.');
  }
  await putSecret(
    PROXY_CREDENTIAL,
    JSON.stringify({ username: cred.username, password: cred.password }),
    proxyScope(handle)
  );
}

/**
 * An account's proxy credential, or null when none is stored.
 *
 * Absence is null; something stored that cannot be READ throws — the same distinction
 * `getSecret` draws, and for the same reason: collapsing "your vault key changed" into "no
 * credential configured" sends the caller down a path that quietly does without one.
 */
export async function loadProxyCredential(handle: string): Promise<ProxyCredential | null> {
  const raw = await getSecret(PROXY_CREDENTIAL, proxyScope(handle));
  if (raw === null) return null;

  let parsed: unknown;
  try { parsed = JSON.parse(raw); }
  catch {
    throw new Error(
      `The stored proxy credential for ${handle} is not readable. Re-add it with \`redbot proxy vet ${handle}\`.`
    );
  }
  const o = parsed as Partial<ProxyCredential> | null;
  if (!o || typeof o.username !== 'string' || typeof o.password !== 'string' || !o.username || !o.password) {
    throw new Error(
      `The stored proxy credential for ${handle} is missing its username or password. `
      + `Re-add it with \`redbot proxy vet ${handle}\`.`
    );
  }
  return { username: o.username, password: o.password };
}

/** Forget it. True when there was one. Used when an account's exit is removed. */
export async function forgetProxyCredential(handle: string): Promise<boolean> {
  return removeSecret(PROXY_CREDENTIAL, proxyScope(handle));
}

/** Join the public half (from the row) and the secret half into what the relay dials. */
export function upstreamFrom(
  row: { host: string; port: number }, cred: ProxyCredential
): UpstreamProxy {
  return { host: row.host, port: row.port, username: cred.username, password: cred.password };
}

/**
 * The vault, as the rest of redbot uses it.
 *
 * src/vault.ts does the sealing. src/db/credentials.ts moves the bytes. This joins them into
 * the two operations anything else actually wants — put a secret in, get a secret out — so no
 * command, console or runner ever handles an IV, an auth tag or a pool.
 *
 * Naming: `SCOPE_GLOBAL` for machine-wide secrets, otherwise an operator name, so two
 * operators on one machine can hold different Anthropic keys without either seeing the other's.
 */
import { getPool } from './db.js';
import { seal, open, vaultReady, vaultUnavailableReason, keyFingerprint } from './vault.js';
import {
  putCredential, getCredential, listCredentials, deleteCredential, touchCredentialUsed,
  type CredentialSummary
} from './db/credentials.js';

export const SCOPE_GLOBAL = 'global';

/** The one name redbot itself looks up. Others may be stored; nothing else is read by default. */
export const ANTHROPIC_API_KEY = 'anthropic_api_key';

/**
 * A Webshare account API key, when an operator chooses to store one.
 *
 * OPTIONAL, and nothing in redbot's run path reads it — it powers one convenience only: listing
 * that account's US proxies on the Setup screen so the exit form can be auto-filled instead of
 * typed. The settled exit vendor is Proxy-Cheap static residential (PROXY-VENDOR-DECISION.md),
 * not Webshare — whose paid ISP tier carries a 20-IP minimum. This key is a shortcut for whoever
 * already has a Webshare account, never a dependency.
 */
export const WEBSHARE_API_KEY = 'webshare_api_key';

export { vaultReady, vaultUnavailableReason, keyFingerprint };
export type { CredentialSummary };

/**
 * The shape rule from 0011_credentials, enforced here too.
 *
 * Not because the database would accept a bad value — it would not — but because a CHECK
 * violation surfaces as a Postgres error about a constraint, and an operator who typed a
 * name with a space in it deserves to be told that instead.
 */
const NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

function assertName(kind: string, value: string): void {
  if (!NAME_RE.test(value)) {
    throw new Error(
      `"${value}" is not a usable ${kind}: lower-case letters, digits, dot, dash or underscore, starting with a letter or digit.`
    );
  }
}

/** Seal a secret and store it, replacing whatever was under that name. */
export async function putSecret(name: string, value: string, scope = SCOPE_GLOBAL): Promise<void> {
  assertName('credential name', name);
  assertName('scope', scope);
  await putCredential(getPool(), scope, name, seal(value));
}

/**
 * The secret, or null when there is none stored.
 *
 * Absence returns null; a secret that is present but cannot be opened THROWS. Those are
 * different situations and collapsing them would turn "your vault key is wrong" into "no key
 * configured", sending a caller down a path that quietly does without.
 */
export async function getSecret(name: string, scope = SCOPE_GLOBAL): Promise<string | null> {
  assertName('credential name', name);
  assertName('scope', scope);
  const sealed = await getCredential(getPool(), scope, name);
  if (!sealed) return null;
  const plaintext = open(sealed);
  await touchCredentialUsed(getPool(), scope, name);
  return plaintext;
}

/** What is in the vault — metadata only, never the sealed bytes. */
export async function listSecrets(): Promise<CredentialSummary[]> {
  return listCredentials(getPool());
}

/** Remove a secret. True if one was there. */
export async function removeSecret(name: string, scope = SCOPE_GLOBAL): Promise<boolean> {
  assertName('credential name', name);
  assertName('scope', scope);
  return deleteCredential(getPool(), scope, name);
}

/**
 * The Anthropic key, from the vault, for this operator or the machine.
 *
 * Operator scope first so a shared machine resolves to the key of whoever is running, then
 * global. Returns null rather than throwing when nothing is stored — src/config.ts decides
 * what to say about a missing key, because it also knows about the environment variable.
 */
export async function anthropicKeyFromVault(operator?: string | null): Promise<string | null> {
  if (!vaultReady()) return null;
  if (operator && NAME_RE.test(operator)) {
    const mine = await getSecret(ANTHROPIC_API_KEY, operator);
    if (mine) return mine;
  }
  return getSecret(ANTHROPIC_API_KEY, SCOPE_GLOBAL);
}

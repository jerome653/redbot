/**
 * Reddit-login credentials — a CONFIRMED-login layer on top of the vault.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT JUST `vault set`
 *
 * A Reddit email+password is only worth storing if it actually belongs to the handle it is
 * filed under. `redbot reddit-login set jordangrowth` typed while the browser is signed in as
 * someone else — or signed in as nobody — files a credential against the wrong account, and the
 * mistake is invisible until a sign-in fails at the worst moment. So this module refuses to
 * store anything until a LIVE check says the handle's own browser profile is signed in as that
 * exact handle.
 *
 * It adds NO crypto. Sealing, the master key, the name rule and the Postgres row all come from
 * src/vault.ts and src/credentials.ts unchanged — this is a thin, gated front door to them,
 * storing one JSON blob `{email,password}` under the name `reddit.<handle>`, scope global.
 *
 * The confirmation function is INJECTABLE (third parameter), defaulting to the real browser
 * probe. A test drives the gate with a fake and never needs a browser or a vault key; the
 * secret store is injectable for the same reason.
 * ---------------------------------------------------------------------------
 */
import {
  putSecret, getSecret, listSecrets, removeSecret, SCOPE_GLOBAL, type CredentialSummary
} from './credentials.js';

/** Every Reddit login is filed under this prefix, so one listSecrets call can find them all. */
export const REDDIT_PREFIX = 'reddit.';

/**
 * The SAME shape rule as src/credentials.ts NAME_RE, applied to the handle before it is built
 * into a secret name. A handle that could not be a credential name is refused here with a
 * message about the handle, rather than surfacing later as a constraint error about a row.
 */
const HANDLE_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** The decrypted credential — what getRedditLogin hands back and putRedditLogin seals. */
export interface RedditLogin {
  email: string;
  password: string;
}

/** Metadata only — never the sealed bytes, never the email or password. */
export interface RedditLoginSummary {
  handle: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
}

/**
 * The live "who is signed in" check. Returns the signed-in username for that handle's browser
 * profile, or null when no session is found. Injected in tests; the default opens the real
 * browser.
 */
export type RedditLoginConfirm = (handle: string) => Promise<{ signedInAs: string | null }>;

/**
 * The vault operations this module needs, as an interface so a test can supply an in-memory
 * stand-in. The default is the real credentials facade, so every production caller is unchanged.
 */
export interface SecretStore {
  putSecret: typeof putSecret;
  getSecret: typeof getSecret;
  listSecrets: typeof listSecrets;
  removeSecret: typeof removeSecret;
}

const realStore: SecretStore = { putSecret, getSecret, listSecrets, removeSecret };

/** Named so a caller can tell a refusal-to-store from a database or vault failure. */
export class RedditLoginError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RedditLoginError';
  }
}

/**
 * Validate the handle and build its secret name. Rejects an empty handle, upper-case, spaces,
 * or anything the credential name rule would refuse — and also a handle so long that
 * `reddit.<handle>` would overflow the 64-character name limit.
 */
function secretName(handle: string): string {
  if (typeof handle !== 'string' || !HANDLE_RE.test(handle)) {
    throw new RedditLoginError(
      `"${handle}" is not a usable handle: lower-case letters, digits, dot, dash or ` +
      'underscore, starting with a letter or digit.'
    );
  }
  const name = REDDIT_PREFIX + handle;
  if (!HANDLE_RE.test(name)) {
    throw new RedditLoginError(`"${handle}" is too long to file as a credential name.`);
  }
  return name;
}

/**
 * The real live probe: open that handle's own Chrome profile and ask who is signed in.
 *
 * Reuses the existing access path exactly — src/browser.ts `attach` (which refuses a headless
 * browser) and `whoAmI` (the signed-in flag read deterministically, not inferred from page
 * copy), the same probe src/probe-karma.ts trusts. The endpoint is that account's own debug
 * port from accounts.json when it is known, so the check reads the RIGHT browser.
 */
async function liveConfirm(handle: string): Promise<{ signedInAs: string | null }> {
  const [{ loadAccounts, config }, { attach, whoAmI }] = await Promise.all([
    import('./config.js'),
    import('./browser.js'),
  ]);
  const acct = loadAccounts().find((a) => a.handle.toLowerCase() === handle.toLowerCase());
  const endpoint = acct?.debugPort ? `http://127.0.0.1:${acct.debugPort}` : undefined;
  const s = await attach(endpoint);
  try {
    // whoAmI reads the shell, so we must be on the site before asking.
    await s.page.goto(`${config.redditBase}/`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    const me = await whoAmI(s.page);
    return { signedInAs: me.username };
  } finally {
    await s.close();
  }
}

/**
 * Seal a login under `reddit.<handle>`, global scope — but ONLY after a live check confirms
 * that handle's browser is signed in as that exact handle.
 *
 * HARD GATE. On no session, or a session signed in as anyone else, this THROWS and stores
 * nothing — the confirmation runs before a single byte is sealed. The handle comparison is
 * case-insensitive, because the site preserves the display case of a name this system files in
 * lower case.
 */
export async function putRedditLogin(
  handle: string,
  creds: RedditLogin,
  confirm: RedditLoginConfirm = liveConfirm,
  store: SecretStore = realStore
): Promise<void> {
  // Validate the handle FIRST — before the live check even runs, so a typo costs nothing.
  const name = secretName(handle);

  if (!creds || typeof creds.email !== 'string' || typeof creds.password !== 'string'
      || creds.email === '' || creds.password === '') {
    throw new RedditLoginError(`Refusing to store an empty email or password for "${handle}".`);
  }

  let who: { signedInAs: string | null };
  try {
    who = await confirm(handle);
  } catch (e) {
    throw new RedditLoginError(
      `Could not confirm the login for "${handle}" — the live check failed: ` +
      `${e instanceof Error ? e.message : String(e)}. Nothing was stored.`
    );
  }

  const signedInAs = who?.signedInAs ?? null;
  if (!signedInAs) {
    throw new RedditLoginError(
      `Refusing to store a login for "${handle}": no signed-in session was found ` +
      "in that account's browser. Sign in as that account first, then retry. " +
      'Nothing was stored.'
    );
  }
  if (signedInAs.toLowerCase() !== handle.toLowerCase()) {
    throw new RedditLoginError(
      `Refusing to store a login for "${handle}": the browser is signed in as ` +
      `"${signedInAs}", not "${handle}". It is the wrong account. Nothing was stored.`
    );
  }

  // Only now, with the login confirmed, is anything sealed.
  const payload = JSON.stringify({ email: creds.email, password: creds.password });
  await store.putSecret(name, payload, SCOPE_GLOBAL);
}

/** The stored login for a handle, decrypted, or null when there is none. */
export async function getRedditLogin(
  handle: string,
  store: SecretStore = realStore
): Promise<RedditLogin | null> {
  const name = secretName(handle);
  const raw = await store.getSecret(name, SCOPE_GLOBAL);
  if (raw == null) return null;

  let parsed: Partial<RedditLogin>;
  try {
    parsed = JSON.parse(raw) as Partial<RedditLogin>;
  } catch {
    throw new RedditLoginError(`The stored login for "${handle}" is not readable JSON.`);
  }
  if (!parsed || typeof parsed.email !== 'string' || typeof parsed.password !== 'string') {
    throw new RedditLoginError(
      `The stored login for "${handle}" is not the expected {email,password} shape.`
    );
  }
  return { email: parsed.email, password: parsed.password };
}

/**
 * Every stored login, as METADATA ONLY — handle plus timestamps. Never the sealed bytes,
 * never the email or password. Filters listSecrets to the `reddit.` names in global scope and
 * strips everything a UI has no business holding.
 */
export async function listRedditLogins(store: SecretStore = realStore): Promise<RedditLoginSummary[]> {
  const all: CredentialSummary[] = await store.listSecrets();
  return all
    .filter((s) => s.scope === SCOPE_GLOBAL && s.name.startsWith(REDDIT_PREFIX))
    .map((s) => ({
      handle: s.name.slice(REDDIT_PREFIX.length),
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      lastUsedAt: s.lastUsedAt,
    }));
}

/** Remove a handle's stored login. True if one was there. */
export async function removeRedditLogin(
  handle: string,
  store: SecretStore = realStore
): Promise<boolean> {
  const name = secretName(handle);
  return store.removeSecret(name, SCOPE_GLOBAL);
}

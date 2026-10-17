/**
 * Reading and writing an account's persona — the row migration 0022 added.
 *
 * ---------------------------------------------------------------------------
 * WHY `accounts` DID NOT ALREADY DO THIS, which is the whole reason the table exists.
 *
 * `accounts.role`, `accounts.speaks` and `accounts.knows` are stored, editable on the console
 * (src/console-accounts.ts EDITABLE), pushed to the dashboard (src/push/accounts.ts) — and read by
 * no prompt. `draftPrompt` took `(thread, reason, angle, gap, reference)` with no account at all.
 * Grepped 2026-10-16: outside console editing, sync and this directory, nothing read `.speaks` or
 * `.knows`. Thirteen accounts, one voice, because the voice was never a parameter.
 *
 * So this module's contract is narrower than "store some settings": EVERY FIELD IT RETURNS IS
 * RENDERED BY src/persona.ts. A field that reaches here and stops is the defect above repeating
 * itself with a newer column name.
 *
 * PORTABLE, like `account_proxies`. A persona travels with the account to any machine, so it is
 * keyed by handle alone with nothing machine-local in it — the split 0013 established.
 *
 * NOTHING IS INVENTED. `loadPersona` returns null for an account with no row, and the renderer
 * then produces nothing, leaving the base prompt exactly as it was. The alternative — a default
 * persona — is the `['WordPress']` subreddit default and the 'Asia/Manila' timezone default that
 * src/console-accounts.ts removed for the same reason: the build deciding who somebody else's
 * account is.
 */
import type { Db } from '../db.js';

/** The closed set from 0022's CHECK. Exported so the renderer and the validator share one list. */
export const REGISTERS = ['terse', 'plain', 'warm', 'technical'] as const;
export type Register = (typeof REGISTERS)[number];

export function isRegister(v: unknown): v is Register {
  return typeof v === 'string' && (REGISTERS as readonly string[]).includes(v);
}

/** What a persona looks like to everything outside this module. */
export interface AccountPersona {
  handle: string;
  /** Off without being deleted. A disabled persona is NOT applied — see `personaFor`. */
  enabled: boolean;
  displayName: string | null;
  bio: string | null;
  experienceYears: number | null;
  stack: string[];
  /** Two lower-case letters, e.g. 'us', 'gb'. Null when nobody set one. */
  localeFlavour: string | null;
  register: Register | null;
  /** Per-account ceiling on reply length in sentences, 1–6. Null falls back to the prompt's own. */
  maxSentences: number | null;
  quirks: string[];
  hedgeStyle: string | null;
  bannedPhrases: string[];
  avoidTopics: string[];
  createdAt: string;
  updatedAt: string;
}

/**
 * The row AS THE FACADE HANDS IT BACK, which is not the row as SQLite stores it.
 *
 * src/db.ts restores the Postgres-shaped type of every column by reading a marker the schema
 * already carries: `json_valid(col)` makes a column JSON and it arrives ALREADY PARSED, a
 * `col LIKE '____-__-__T%Z'` CHECK makes it a Date, and `col IN (0, 1)` makes it a boolean.
 * 0022 carries all three markers, so this interface has to describe the coerced shapes.
 *
 * MEASURED, not read off the comment. Written first with `stack: string` and `created_at: string`
 * — which compiles, because nothing types the seam — and the four JSON columns then read back as
 * empty arrays from rows that demonstrably held values: `redbot personas show ryangrowth12`
 * printed "banned (none)" while `SELECT banned_phrases` returned `["good luck","cheers"]`. The
 * cause was `strings()` requiring a string and being handed an array. This is the same class of
 * seam defect src/db/locations.ts documents at length — two halves built against one reality with
 * nothing typing the join — and it failed the same silent way: no throw, just empty.
 */
interface PersonaRow {
  handle: string;
  /** `enabled IN (0, 1)` -> the facade's `boolean` kind. Both shapes accepted below regardless. */
  enabled: boolean | number;
  display_name: string | null;
  bio: string | null;
  experience_years: number | null;
  /** `json_valid(stack)` -> arrives parsed. `string` only if a row predates the CHECK. */
  stack: string[] | string;
  locale_flavour: string | null;
  register: string | null;
  max_sentences: number | null;
  quirks: string[] | string;
  hedge_style: string | null;
  banned_phrases: string[] | string;
  avoid_topics: string[] | string;
  /** `created_at LIKE '____-__-__T%Z'` -> the facade's `date` kind, so these are Dates. */
  created_at: Date | string;
  updated_at: Date | string;
}

/**
 * A JSON array column as a list of non-empty strings.
 *
 * TWO INPUT SHAPES, AND BOTH ARE REAL. The facade parses a `json_valid`-CHECKed column before
 * this sees it, so the normal input is an ARRAY — which is what the first version of this
 * function did not accept, and what made every list read back empty. The string branch is the
 * fallback src/db.ts itself keeps: "if a row predates the CHECK, the raw text is kept rather
 * than the row being lost", so a hand-edited install can still hand text through.
 *
 * An unreadable list is an EMPTY list, never a throw: the renderer then omits that line, which is
 * the same outcome as nobody having filled it in. A persona is not worth losing an account over.
 */
function strings(raw: unknown): string[] {
  const arr: unknown = typeof raw === 'string'
    ? (() => { try { return JSON.parse(raw); } catch { return null; } })()
    : raw;
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((v): v is string => typeof v === 'string')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** A facade `date` column as the ISO string this module's callers print. */
function iso(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : String(v);
}

function toPersona(r: PersonaRow): AccountPersona {
  return {
    handle: r.handle,
    enabled: r.enabled === true || r.enabled === 1,
    displayName: r.display_name,
    bio: r.bio,
    experienceYears: Number.isInteger(r.experience_years) ? r.experience_years : null,
    stack: strings(r.stack),
    localeFlavour: r.locale_flavour,
    /* An unrecognised register is dropped rather than passed on. src/persona.ts maps the four
       names to concrete instructions; a fifth would render nothing and quietly mean "no voice",
       and null says that honestly. */
    register: isRegister(r.register) ? r.register : null,
    maxSentences: Number.isInteger(r.max_sentences) ? r.max_sentences : null,
    quirks: strings(r.quirks),
    hedgeStyle: r.hedge_style,
    bannedPhrases: strings(r.banned_phrases),
    avoidTopics: strings(r.avoid_topics),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at)
  };
}

const COLUMNS = `handle, enabled, display_name, bio, experience_years, stack, locale_flavour,
                 register, max_sentences, quirks, hedge_style, banned_phrases, avoid_topics,
                 created_at, updated_at`;

/** Every persona on record, ordered by handle. */
export async function loadPersonas(db: Db): Promise<AccountPersona[]> {
  const r = await db.query<PersonaRow>(`SELECT ${COLUMNS} FROM account_personas ORDER BY handle`);
  return r.rows.map(toPersona);
}

/**
 * One account's persona, or null when it has none.
 *
 * Case-insensitive on the handle, for the reason `loadAccountProxy` is: `REDBOT_ACCOUNT` is typed
 * by a person and `accounts.handle` is a case-SENSITIVE primary key, so an exact match here would
 * silently return "no persona" for `RyanGrowth12`.
 */
export async function loadPersona(db: Db, handle: string): Promise<AccountPersona | null> {
  const r = await db.query<PersonaRow>(
    `SELECT ${COLUMNS} FROM account_personas WHERE lower(handle) = lower($1)`,
    [handle]
  );
  const row = r.rows[0];
  return row ? toPersona(row) : null;
}

/** The fields a caller may set. Absent keys are left alone; `null` clears a nullable column. */
export interface PersonaPatch {
  enabled?: boolean;
  displayName?: string | null;
  bio?: string | null;
  experienceYears?: number | null;
  stack?: string[];
  localeFlavour?: string | null;
  register?: Register | null;
  maxSentences?: number | null;
  quirks?: string[];
  hedgeStyle?: string | null;
  bannedPhrases?: string[];
  avoidTopics?: string[];
}

/**
 * Create or amend one persona.
 *
 * AMEND, NOT REPLACE. A console form that posts three fields must not blank the other eight, and
 * a whole-row upsert does exactly that — the shape `updateConsoleAccount` already avoids by
 * reading the current row first. So the row is read, the patch is laid over it, and the result is
 * written; an absent key keeps what is stored.
 *
 * NO VALIDATION HERE BEYOND SHAPE. The bounds are the schema's — `register` in four values,
 * `max_sentences` 1–6, `experience_years` 0–50, the JSON columns arrays. Re-stating them in
 * TypeScript would be a second copy to keep in agreement, and the one that matters is the one the
 * database enforces: a bad value throws a CHECK failure here and the caller reports it. The
 * console validates before calling so the person gets a sentence rather than a constraint name.
 */
export async function savePersona(db: Db, handle: string, patch: PersonaPatch): Promise<AccountPersona> {
  const current = await loadPersona(db, handle);

  /**
   * THE HANDLE AS `accounts` SPELLS IT, resolved from `accounts` and not from the caller.
   *
   * `account_personas.handle` is a foreign key into a CASE-SENSITIVE primary key, and
   * `REDBOT_ACCOUNT`, a console form and a CLI argument are all typed by a person. Reading the
   * canonical spelling off the existing persona covers an AMEND and covers nothing else: the
   * FIRST insert has no persona to read it from.
   *
   * MEASURED by src/test/persona-store.test.ts the moment it was written: `savePersona(db,
   * 'persona_store_test', …)` against an account spelled `Persona_Store_Test` answered
   * `FOREIGN KEY constraint failed` — errcode 787 — because the fallback was the caller's string.
   * The comment at the INSERT already claimed this was handled. It was handled for the case that
   * had a row and for no other.
   *
   * Null when no such account exists. The INSERT then fails on the foreign key, which is the
   * correct outcome and a better one than inventing a spelling: a persona for an account that is
   * not configured is not a persona.
   */
  const canonical = await db.query<{ handle: string }>(
    'SELECT handle FROM accounts WHERE lower(handle) = lower($1)', [handle]
  );
  const key = current?.handle ?? canonical.rows[0]?.handle ?? handle;

  const pick = <T>(key: keyof PersonaPatch, fallback: T): T =>
    (patch[key] === undefined ? fallback : (patch[key] as unknown as T));

  const next = {
    enabled: pick<boolean>('enabled', current?.enabled ?? true),
    displayName: pick<string | null>('displayName', current?.displayName ?? null),
    bio: pick<string | null>('bio', current?.bio ?? null),
    experienceYears: pick<number | null>('experienceYears', current?.experienceYears ?? null),
    stack: pick<string[]>('stack', current?.stack ?? []),
    localeFlavour: pick<string | null>('localeFlavour', current?.localeFlavour ?? null),
    register: pick<Register | null>('register', current?.register ?? null),
    maxSentences: pick<number | null>('maxSentences', current?.maxSentences ?? null),
    quirks: pick<string[]>('quirks', current?.quirks ?? []),
    hedgeStyle: pick<string | null>('hedgeStyle', current?.hedgeStyle ?? null),
    bannedPhrases: pick<string[]>('bannedPhrases', current?.bannedPhrases ?? []),
    avoidTopics: pick<string[]>('avoidTopics', current?.avoidTopics ?? [])
  };

  await db.query(
    `INSERT INTO account_personas
       (handle, enabled, display_name, bio, experience_years, stack, locale_flavour,
        register, max_sentences, quirks, hedge_style, banned_phrases, avoid_topics)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (handle) DO UPDATE SET
       enabled          = EXCLUDED.enabled,
       display_name     = EXCLUDED.display_name,
       bio              = EXCLUDED.bio,
       experience_years = EXCLUDED.experience_years,
       stack            = EXCLUDED.stack,
       locale_flavour   = EXCLUDED.locale_flavour,
       register         = EXCLUDED.register,
       max_sentences    = EXCLUDED.max_sentences,
       quirks           = EXCLUDED.quirks,
       hedge_style      = EXCLUDED.hedge_style,
       banned_phrases   = EXCLUDED.banned_phrases,
       avoid_topics     = EXCLUDED.avoid_topics`,
    [
      /* `key`, never the caller's string — see the resolution above and the measurement in its
         comment. Inserting the caller's casing is refused by the foreign key, or, on a store that
         accepted it, would create a second persona for one account. */
      key,
      next.enabled ? 1 : 0,
      next.displayName, next.bio, next.experienceYears,
      JSON.stringify(next.stack),
      next.localeFlavour, next.register, next.maxSentences,
      JSON.stringify(next.quirks),
      next.hedgeStyle,
      JSON.stringify(next.bannedPhrases),
      JSON.stringify(next.avoidTopics)
    ]
  );

  const saved = await loadPersona(db, key);
  /* Read back rather than returned from the patch: `updated_at` is set by a trigger and the
     round trip is what proves the row is really there. A function that returns what it was
     asked to store is self-attestation with extra steps. */
  if (!saved) throw new Error(`the persona for ${handle} was written but could not be read back`);
  return saved;
}

/** Remove one persona. Returns whether a row was there to remove. */
export async function deletePersona(db: Db, handle: string): Promise<boolean> {
  const existing = await loadPersona(db, handle);
  if (!existing) return false;
  await db.query('DELETE FROM account_personas WHERE handle = $1', [existing.handle]);
  return true;
}

/**
 * Handing each account a voice no other account on the fleet has.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS FOR, as a measurement.
 *
 * Before migration 0022, `draftPrompt` took no account parameter, so thirteen accounts drafted
 * from one identical prompt: one register, one hedging vocabulary, one "two to four sentences",
 * one ban list. Four of the six comments published from them were removed by r/Wordpress
 * moderators, one with the public reply "Please don't post AI-generated comments."
 *
 * A persona COLUMN does not fix that on its own. Measured on the live rows 2026-10-16: 13
 * accounts, 7 with a `role` and a `speaks` line, 6 with neither, and `knows` empty on all 13 — so
 * left to hand-filling, most accounts would simply have no voice and would keep sharing the
 * default. The fix has to be a default that DIFFERS per account rather than one that is the same
 * for everybody.
 *
 * ---------------------------------------------------------------------------
 * THE ALLOCATION RULE, which is `allocateProfileDir`'s rule applied to voices.
 *
 * src/profiles.ts allocates a Chrome folder by walking names until one is not taken. Same shape
 * here: hash the handle to pick a STARTING slot in the table below, then walk forward to the first
 * slot no other account holds. That gives three properties at once —
 *
 *   deterministic   the same handle on an empty fleet always lands on the same voice, so a test
 *                   can assert it and a re-seed does not shuffle everybody
 *   collision-free  two accounts never share a (register, maxSentences) pair while slots remain
 *   stable          allocating for a new account never moves an existing one
 *
 * WHEN THE SLOTS RUN OUT, THIS RETURNS NULL rather than reusing one. Sixteen voices for a fleet
 * of thirteen is headroom, not a limit anybody is at; the seventeenth account is a real decision
 * about whether two accounts may write alike, and it belongs to the operator. Silently handing out
 * a duplicate is how the fleet-wide fingerprint came back.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS DOES NOT ALLOCATE, and will not.
 *
 * `bio` and `stack` — who the account actually is and what it actually works with. Those are
 * WRITTEN, by a person, or they are absent. `deriveBio` below builds one only out of
 * `accounts.role` and `accounts.speaks`, which an operator typed; with neither it returns null and
 * `missingBios` names the account so somebody can write one.
 *
 * That boundary is not fussiness. `accounts.subreddits` used to default to `['WordPress']` and
 * `accounts.timezone` to `'Asia/Manila'`, and both were removed from src/console-accounts.ts for
 * the same reason: the build deciding a fact about somebody else's account. A fabricated biography
 * is the same mistake with more words, and src/prompts.ts rule 2 forbids the output that would
 * come of it ("Never invent a personal experience").
 */
import type { Register } from './db/personas.js';
import type { PersonaPatch } from './db/personas.js';

/**
 * One voice: the axes a reader actually notices, set to values no other slot repeats.
 *
 * (register, maxSentences) is unique across the table by construction — four registers times
 * four lengths — and that pair is what `voiceKey` collides on. The hedge and the habit vary with
 * it so two accounts differ on four axes rather than two.
 *
 * THE HABITS ARE ALL SUBTRACTIVE. Every one says what this account does NOT write, or which of
 * several correct forms it picks. None asks for an error, because src/prompts.ts rule 3 forbids
 * that and src/persona.ts `screenQuirks` would refuse it anyway — a quirk table that had to be
 * filtered by its own consumer would be a trap for whoever edits it next.
 */
interface Voice {
  register: Register;
  maxSentences: number;
  hedgeStyle: string;
  quirks: string[];
  bannedPhrases: string[];
}

/**
 * Sixteen voices. Order is the allocation order after the hash, so it is not alphabetical or
 * grouped by register — adjacent slots differ on every axis, which matters because a fleet seeded
 * in one pass walks consecutive slots when hashes collide.
 */
const VOICES: Voice[] = [
  { register: 'terse', maxSentences: 1,
    hedgeStyle: "writes 'might be' and leaves it there",
    quirks: ['never opens with a greeting', 'no closing sentence at all'],
    bannedPhrases: ['hope this helps', 'feel free to'] },

  { register: 'plain', maxSentences: 3,
    hedgeStyle: "writes 'not sure, but' at the start of the guess",
    quirks: ['uses contractions throughout', 'never numbers a list'],
    bannedPhrases: ['happy to help', 'great question'] },

  { register: 'technical', maxSentences: 2,
    hedgeStyle: "writes 'I have not confirmed this' before the claim",
    quirks: ['names the exact setting rather than describing it', 'no analogies'],
    bannedPhrases: ['best practice', 'under the hood'] },

  { register: 'warm', maxSentences: 4,
    hedgeStyle: "writes 'I could be wrong here' after the suggestion",
    quirks: ['addresses the person as "you" throughout', 'one short acknowledgement, at the start only'],
    bannedPhrases: ['let me know', 'reach out'] },

  { register: 'terse', maxSentences: 2,
    hedgeStyle: "writes 'guessing' and names the guess",
    quirks: ['fragments where the subject is obvious', 'never restates the question'],
    bannedPhrases: ['as mentioned', 'to be fair'] },

  { register: 'technical', maxSentences: 4,
    hedgeStyle: "writes 'worth verifying' and says how",
    quirks: ['quotes version numbers exactly as the poster wrote them', 'no exclamation marks'],
    bannedPhrases: ['deep dive', 'leverage'] },

  { register: 'plain', maxSentences: 1,
    hedgeStyle: "writes 'probably' and stops",
    quirks: ['one sentence, always', 'no qualifying clause after the point'],
    bannedPhrases: ['in my experience', 'definitely'] },

  { register: 'warm', maxSentences: 2,
    hedgeStyle: "writes 'if I had to guess' before the guess",
    quirks: ['asks the clarifying question first when there is one', 'no sign-off'],
    bannedPhrases: ['good luck', 'cheers'] },

  { register: 'terse', maxSentences: 3,
    hedgeStyle: "writes 'unverified' next to the claim",
    quirks: ['no adverbs of emphasis', 'never uses em dashes'],
    bannedPhrases: ['simply', 'just do'] },

  { register: 'technical', maxSentences: 1,
    hedgeStyle: "writes 'assuming' and names the assumption",
    quirks: ['leads with the mechanism', 'one sentence, no second clause'],
    bannedPhrases: ['essentially', 'basically'] },

  { register: 'plain', maxSentences: 4,
    hedgeStyle: "writes 'I think' once, and not again in the same reply",
    quirks: ['no bold, no headings, ever', 'spells out numbers under ten'],
    bannedPhrases: ['at the end of the day', 'that said'] },

  { register: 'warm', maxSentences: 1,
    hedgeStyle: "writes 'not certain' before the suggestion",
    quirks: ['one sentence addressed to the person', 'no preamble'],
    bannedPhrases: ['no worries', 'absolutely'] },

  { register: 'terse', maxSentences: 4,
    hedgeStyle: "writes 'cannot tell from here' and names what would",
    quirks: ['no transitional phrases between sentences', 'never says "first" or "next"'],
    bannedPhrases: ['keep in mind', 'pro tip'] },

  { register: 'technical', maxSentences: 3,
    hedgeStyle: "writes 'reported, not measured' when citing something read",
    quirks: ['paths and filenames in backticks, nothing else', 'no rhetorical questions'],
    bannedPhrases: ['robust', 'seamless'] },

  { register: 'plain', maxSentences: 2,
    hedgeStyle: "writes 'might be worth checking' and names the check",
    quirks: ['never more than one clause per sentence', 'no parentheses'],
    bannedPhrases: ['makes sense', 'for sure'] },

  { register: 'warm', maxSentences: 3,
    hedgeStyle: "writes 'I would double-check this' before the answer",
    quirks: ['asks what they have already tried, when it is not stated', 'no lists'],
    bannedPhrases: ['you got this', 'happy to dig in'] }
];

/**
 * What two accounts must not share.
 *
 * The pair, not the whole voice: two accounts with the same register AND the same ceiling read as
 * one writer however their hedges differ, and nothing else in the table is unique on its own.
 * Exported so the fleet check and the allocator collide on exactly one definition.
 */
export function voiceKey(v: { register?: string | null; maxSentences?: number | null }): string {
  return `${v.register ?? '-'}/${v.maxSentences ?? '-'}`;
}

/** Every voice this module can hand out. Sixteen. */
export const VOICE_COUNT = VOICES.length;

/**
 * A stable, non-cryptographic hash of the handle — FNV-1a, 32-bit.
 *
 * Any stable hash would do; what matters is that it does not change between Node versions, which
 * `String.prototype.hashCode`-style arithmetic over char codes guarantees and a built-in hash
 * would not. Lower-cased first, because `accounts.handle` is case-sensitive and `REDBOT_ACCOUNT`
 * is typed by a person — `RyanGrowth12` and `ryangrowth12` must land on the same slot or a
 * re-seed would move the account.
 */
function hashHandle(handle: string): number {
  let h = 0x811c9dc5;
  const s = handle.toLowerCase();
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * The voice for one account, or null when every slot is held.
 *
 * `taken` is the set of `voiceKey`s other accounts already hold. Pass the keys of every OTHER
 * account; passing this account's own current key would make re-allocation walk past its own
 * voice and hand it a different one on every call.
 */
export function allocateVoice(handle: string, taken: Iterable<string>): Voice | null {
  const held = new Set<string>();
  for (const t of taken) if (typeof t === 'string' && t) held.add(t);

  const start = hashHandle(handle) % VOICES.length;
  for (let i = 0; i < VOICES.length; i++) {
    const v = VOICES[(start + i) % VOICES.length]!;
    if (!held.has(voiceKey(v))) return v;
  }
  /* Every slot held. Null, never a duplicate — see the header. */
  return null;
}

/**
 * A bio out of what an operator already typed, or null.
 *
 * `accounts.role` and `accounts.speaks` are hand-entered and are the only account-level text that
 * says what this identity does. Composed, not invented: with neither field this returns null and
 * the account is reported by `missingBios` rather than given a fabricated past.
 *
 * Present tense and no claimed events, because src/prompts.ts rule 2 forbids a reply that
 * references one and a bio written in the past tense is an invitation to.
 */
export function deriveBio(
  account: { role?: string | null; speaks?: string | null; knows?: string[] | null }
): string | null {
  const role = (account.role ?? '').trim();
  const speaks = (account.speaks ?? '').trim();
  const knows = (account.knows ?? []).map((k) => String(k).trim()).filter(Boolean);
  if (!role && !speaks && !knows.length) return null;

  const parts: string[] = [];
  if (role) parts.push(`Day to day this is ${role.toLowerCase()} work.`);
  if (speaks) parts.push(`The ground covered: ${speaks}.`);
  if (knows.length) parts.push(`Comfortable with ${knows.join(', ')}.`);
  parts.push('Answer from that and say plainly when a thread is outside it.');
  const bio = parts.join(' ');
  /* 0022 CHECKs `length(bio) <= 900`. Truncated at a word boundary rather than mid-token, and
     truncated HERE rather than letting the database refuse the row — a seeder that throws on a
     long `speaks` line would leave the account with no persona at all. */
  return bio.length <= 900 ? bio : bio.slice(0, bio.lastIndexOf(' ', 897)) + '…';
}

export interface SeedInput {
  handle: string;
  role?: string | null;
  speaks?: string | null;
  knows?: string[] | null;
  /** The account's own rooms, used only to decide nothing — carried so callers can log it. */
  subreddits?: string[] | null;
}

export interface SeedPlan {
  handle: string;
  patch: PersonaPatch;
  /** True when `deriveBio` had nothing to work from, so the persona ships without one. */
  bioMissing: boolean;
}

/**
 * What to write for a fleet, in one pass, without two accounts sharing a voice.
 *
 * ORDER IS FIXED — by handle, lower-cased — so the plan for a given fleet is the same whichever
 * order the caller read the accounts in. Without that, two runs over the same thirteen accounts
 * could hand out different voices and a "re-seed" would reshuffle the fleet.
 *
 * `existing` names accounts that already hold a voice. Their keys are reserved and they are NOT
 * in the returned plan: this never overwrites a persona somebody wrote.
 */
export function planFleetVoices(
  accounts: readonly SeedInput[],
  existing: ReadonlyMap<string, { register?: string | null; maxSentences?: number | null }> = new Map()
): { plans: SeedPlan[]; unallocated: string[] } {
  const taken = new Set<string>();
  for (const [, v] of existing) taken.add(voiceKey(v));

  const plans: SeedPlan[] = [];
  const unallocated: string[] = [];

  const ordered = [...accounts].sort((a, b) =>
    a.handle.toLowerCase().localeCompare(b.handle.toLowerCase()));

  for (const a of ordered) {
    if (existing.has(a.handle.toLowerCase())) continue;
    const voice = allocateVoice(a.handle, taken);
    if (!voice) { unallocated.push(a.handle); continue; }
    taken.add(voiceKey(voice));

    const bio = deriveBio(a);
    plans.push({
      handle: a.handle,
      bioMissing: bio === null,
      patch: {
        enabled: true,
        register: voice.register,
        maxSentences: voice.maxSentences,
        hedgeStyle: voice.hedgeStyle,
        quirks: voice.quirks,
        bannedPhrases: voice.bannedPhrases,
        /* Absent, not empty-string: 0022 allows NULL and `personaBlock` omits the line. An empty
           bio rendered as a blank line would read to the model as an instruction. */
        ...(bio === null ? {} : { bio }),
        /* NOT ALLOCATED, for the reason the header gives: nobody measured where these accounts
           are or what they run, and `stack` is a claim about the second. Left empty. */
        stack: [],
        avoidTopics: []
      }
    });
  }

  return { plans, unallocated };
}

/**
 * Accounts that would draft in a voice another account also has, or in no voice at all.
 *
 * THIS IS THE CHECK, and it is separate from the allocator on purpose: the allocator only governs
 * what IT hands out, and a persona can also be hand-edited through the console or by
 * `migrate.mjs sql`. Two accounts set to `terse/2` by hand is exactly the state this exists to
 * report, and the allocator would never have produced it.
 */
export function voiceCollisions(
  personas: readonly { handle: string; enabled: boolean; register?: string | null; maxSentences?: number | null }[],
  accountHandles: readonly string[]
): { shared: Array<{ key: string; handles: string[] }>; without: string[] } {
  const byKey = new Map<string, string[]>();
  const have = new Set<string>();

  for (const p of personas) {
    if (!p.enabled) continue;              // a disabled persona is not applied, so it cannot clash
    have.add(p.handle.toLowerCase());
    /* A persona with neither axis set draws no voice at all, so it is not a collision — it is an
       account with no voice, counted below. */
    if (!p.register && p.maxSentences === null) continue;
    const k = voiceKey(p);
    const list = byKey.get(k) ?? [];
    list.push(p.handle);
    byKey.set(k, list);
  }

  const shared = [...byKey.entries()]
    .filter(([, handles]) => handles.length > 1)
    .map(([key, handles]) => ({ key, handles: [...handles].sort() }))
    .sort((a, b) => a.key.localeCompare(b.key));

  const without = accountHandles
    .filter((h) => !have.has(h.toLowerCase()))
    .sort();

  return { shared, without };
}

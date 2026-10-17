/**
 * Turning one account's persona into prompt text, and checking the draft that comes back.
 *
 * ---------------------------------------------------------------------------
 * THE MEASUREMENT THIS ANSWERS.
 *
 * Four of the six comments this install published to r/Wordpress were removed by moderators, one
 * with the public reply "Please don't post AI-generated comments." At the time every account
 * drafted from the same text: `draftPrompt(thread, reason, angle, gap, reference)` — no account
 * parameter — so thirteen identities shared one register, one hedging vocabulary, one
 * "LENGTH: two to four sentences" and one ban list. `accounts.role`, `.speaks` and `.knows` were
 * stored, editable and pushed, and reached no prompt at all.
 *
 * A single authorial fingerprint across thirteen accounts is a property of the SYSTEM, not of any
 * one reply, and no amount of improving one reply changes it. So this module's job is to make the
 * accounts DIFFER from each other on the axes a reader actually notices: length, register,
 * hedging, and which words never appear.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS DOES NOT DO, stated here because it is the obvious wrong turn.
 *
 * It does not fake a human. src/prompts.ts rule 3 — "Never imitate human error on purpose. No
 * deliberate typos, no forced slang, no artificial casualness added to seem less
 * machine-written" — is NOT relaxed by a persona, and `rejectedQuirks` below refuses a quirk that
 * asks for one rather than passing it to the model. Rule 2, "Never invent a personal experience",
 * is likewise untouched: a bio says what an account WORKS WITH, which is what licenses it to
 * answer, and it is still forbidden from claiming a specific past event. Both rules are restated
 * inside the rendered block so the model reads them in the same breath as the persona.
 *
 * A typo'd reply from a karma-1 account is not less detectable than a clean one; it is a reply
 * that is wrong AND detectable. The axis worth moving is variance between accounts, not error
 * within one.
 * ---------------------------------------------------------------------------
 */
import type { AccountPersona, Register } from './db/personas.js';

/**
 * Each register as concrete instructions about sentences, not as an adjective.
 *
 * WHY A CLOSED MAP RATHER THAN PASSING THE WORD THROUGH. "Write in a terse register" is a word a
 * model interprets differently every call, which produces variance WITHIN an account and none
 * BETWEEN accounts — the opposite of what is wanted. These say what to do.
 *
 * Keyed by the same four values 0022 CHECKs, and src/test/persona.test.ts asserts the two lists
 * are identical, so a register added to the schema without instructions here fails a test instead
 * of silently rendering nothing.
 */
const REGISTER_RULES: Record<Register, string> = {
  terse:
    'Short declaratives. No preamble, no sign-off, no transitional phrases. Where a sentence can '
    + 'be a fragment and stay clear, let it be one. Never open by restating the question.',
  plain:
    'Ordinary unadorned sentences, the way a person types in a hurry but checks before sending. '
    + 'Contractions. No lists, no headings, no structure beyond sentences in a row.',
  warm:
    'Address the person, not the topic — "you" rather than "one". One short acknowledgement of '
    + 'what they are dealing with is allowed, at the start only, and never a compliment. Still no '
    + '"hope this helps" and still no sign-off.',
  technical:
    'Lead with the mechanism or the exact name of the thing. Use the precise term rather than the '
    + 'approachable one, and name versions, paths and settings exactly. No analogies.'
};

/**
 * Quirks this will not pass to the model, as lower-case substrings.
 *
 * `prompts.ts` rule 3 forbids deliberate human error, and a per-account quirks field is exactly
 * where somebody would try to re-enable it — so the refusal lives next to the field rather than
 * in a style note somewhere else. Substring matching is deliberately crude: it is a speed bump
 * against the obvious phrasings, not a parser, and `rejectedQuirks` RETURNS what it dropped so a
 * console can say so out loud rather than silently discarding what an operator typed.
 */
const FORBIDDEN_QUIRK_TERMS = [
  'typo', 'misspell', 'mispell', 'spelling mistake', 'spelling error',
  'grammar mistake', 'grammatical error', 'bad grammar',
  'slang', 'casual filler', 'deliberate mistake', 'on purpose mistake',
  'seem human', 'sound human', 'appear human', 'pass as human', 'look human',
  'less ai', 'less robotic', 'avoid detection', 'evade detection', 'bypass detection'
];

/** `{ kept, rejected }` — a quirk naming a forbidden technique is dropped, and named. */
export function screenQuirks(quirks: readonly string[]): { kept: string[]; rejected: string[] } {
  const kept: string[] = [];
  const rejected: string[] = [];
  for (const q of quirks) {
    const lower = q.toLowerCase();
    if (FORBIDDEN_QUIRK_TERMS.some((t) => lower.includes(t))) rejected.push(q);
    else kept.push(q);
  }
  return { kept, rejected };
}

/**
 * The persona that actually applies, or null.
 *
 * Null for three different facts, all of which mean "draft from the base prompt unchanged": no
 * row, `enabled = 0`, or a row with nothing in it. The third is the one worth naming — an empty
 * persona must not render a header with no content under it, because a model handed an empty
 * VOICE section treats the emptiness as an instruction.
 */
export function personaFor(persona: AccountPersona | null | undefined): AccountPersona | null {
  if (!persona || !persona.enabled) return null;
  const hasAnything =
    !!persona.displayName || !!persona.bio || persona.experienceYears !== null
    || persona.stack.length > 0 || !!persona.localeFlavour || !!persona.register
    || persona.maxSentences !== null || persona.quirks.length > 0 || !!persona.hedgeStyle
    || persona.bannedPhrases.length > 0 || persona.avoidTopics.length > 0;
  return hasAnything ? persona : null;
}

/**
 * How many sentences this account's replies may run to.
 *
 * `fallback` is the base prompt's own ceiling, passed in rather than duplicated here so the two
 * cannot drift. src/prompts.ts states four, and it states it for every account — which is the
 * uniformity this exists to break.
 */
export function sentenceCeiling(persona: AccountPersona | null | undefined, fallback = 4): number {
  const p = personaFor(persona);
  return p?.maxSentences ?? fallback;
}

const list = (items: readonly string[]): string => items.map((s) => `"${s}"`).join(', ');

/**
 * The block inserted into the drafting prompt, or `''` when no persona applies.
 *
 * Empty string, not a placeholder: the caller concatenates it, so an absent persona has to leave
 * the prompt byte-identical to what it was before 0022. That is what makes this change safe to
 * ship with eleven of thirteen accounts un-personalised.
 */
export function personaBlock(persona: AccountPersona | null | undefined): string {
  const p = personaFor(persona);
  if (!p) return '';

  const lines: string[] = [];

  /* IDENTITY FIRST, because it is what the rest qualifies. The display name is the name a reply
     may sign off with if the register calls for it — never the Reddit handle, which the reader can
     already see. */
  if (p.displayName) lines.push(`You are writing as ${p.displayName}.`);
  if (p.bio) lines.push(p.bio);
  if (p.experienceYears !== null) {
    lines.push(
      `${p.experienceYears} year(s) doing this work. That is context for what you can speak to — `
      + 'NOT a story to tell. Do not reference it in the reply.'
    );
  }
  if (p.stack.length) {
    lines.push(
      `What you actually work with: ${p.stack.join(', ')}. Answer from these where the thread `
      + 'touches them; say plainly when it does not.'
    );
  }
  if (p.localeFlavour) {
    lines.push(`Spelling and idiom: ${p.localeFlavour.toUpperCase()}. Keep it consistent.`);
  }

  const voice: string[] = [];
  if (p.register) voice.push(`${p.register.toUpperCase()} — ${REGISTER_RULES[p.register]}`);
  if (p.maxSentences !== null) {
    voice.push(
      `AT MOST ${p.maxSentences} sentence${p.maxSentences === 1 ? '' : 's'}. This replaces the `
      + 'length rule elsewhere in this prompt and it is a hard ceiling, not a target — fewer is '
      + 'better, and one is a complete answer when one answers it. Do not add a second point to '
      + 'fill the allowance.'
    );
  }
  if (p.hedgeStyle) {
    voice.push(
      `When you are not certain, say so like this: ${p.hedgeStyle}. Use your own phrasing for it, `
      + 'not the examples given elsewhere in this prompt.'
    );
  }

  const { kept, rejected } = screenQuirks(p.quirks);
  if (kept.length) {
    voice.push(`Habits to keep: ${kept.join('; ')}.`);
  }
  if (rejected.length) {
    /* Named in the prompt, not hidden. A silently dropped instruction is how an operator comes to
       believe a setting is in force; saying it was refused is cheaper than them finding out from
       the output. */
    voice.push(
      `${rejected.length} configured habit(s) were REFUSED and are not in force, because they ask `
      + 'for deliberate error or for output designed to read as human. Do not do those things.'
    );
  }

  if (p.bannedPhrases.length) {
    voice.push(
      `NEVER write these, in any form: ${list(p.bannedPhrases)}. This is checked mechanically `
      + 'after you, so a draft containing one is discarded unread.'
    );
  }

  const out: string[] = [];
  if (lines.length) out.push(`WHO IS WRITING THIS\n${lines.map((l) => `  ${l}`).join('\n')}`);
  if (voice.length) out.push(`HOW THIS ACCOUNT WRITES\n${voice.map((l) => `  - ${l}`).join('\n')}`);
  if (p.avoidTopics.length) {
    out.push(
      `THIS ACCOUNT DOES NOT ANSWER THESE, even when a gap exists — set "contribute" to false:\n`
      + p.avoidTopics.map((t) => `  - ${t}`).join('\n')
    );
  }

  /* The two rules a persona is most likely to be read as relaxing, restated where the model reads
     the persona rather than four hundred lines away. Neither is negotiable and both are already
     enforced downstream — this only removes the chance that a bio is read as permission. */
  out.push(
    'THE PERSONA DOES NOT RELAX TWO RULES\n'
    + '  - No invented experience. It says what you work with, never something that happened to\n'
    + '    you. No "I had this exact problem", no client stories, no numbers you did not measure.\n'
    + '  - No imitated human error. No deliberate typos, no forced slang, no casualness added to\n'
    + '    read as less machine-written. A wrong reply is worse than a tidy one.'
  );

  return `\n\n${out.join('\n\n')}\n`;
}

/**
 * Which of this account's banned phrases a draft contains.
 *
 * STATED IN THE PROMPT AND CHECKED AFTERWARDS, for the reason `checkWarmingComment` exists: a
 * prompt is a request and a check is a fact. Case-insensitive substring matching on purpose —
 * an operator banning "hope this helps" means the phrase however it is capitalised, and a
 * tokeniser would miss "Hope this helps!" for punctuation reasons nobody wants to debug.
 *
 * Returns the matched phrases as configured, so a caller can quote the ban rather than the draft.
 */
export function bannedPhraseHits(
  body: string, persona: AccountPersona | null | undefined
): string[] {
  const p = personaFor(persona);
  if (!p || !p.bannedPhrases.length || typeof body !== 'string' || !body) return [];
  const hay = body.toLowerCase();
  return p.bannedPhrases.filter((phrase) => {
    const needle = phrase.trim().toLowerCase();
    return needle.length > 0 && hay.includes(needle);
  });
}

/** The register names this module has instructions for. Asserted against 0022's CHECK in tests. */
export const RENDERED_REGISTERS = Object.keys(REGISTER_RULES) as Register[];

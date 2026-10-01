/**
 * Does this draft read like the last one? The gate nothing in this pipeline had.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS CATCHES THAT src/quality.ts CANNOT
 *
 * `assessQuality` judges ONE draft against ONE thread. It passed all six comments this install
 * published with ZERO issues — no clichés, 22–35 specificity hits each, 0 unhedged claims against
 * a budget of 4. By every per-draft check the system owns, those six were clean.
 *
 * Read as a SET they are one template. Measured 2026-10-01 across all six:
 *
 *   words        62  64  66  67  74  87     sd 8.5, range 25
 *   sentences     2   2   2   3   3   3     every one under 4
 *   opener       6/6 a deferral frame — "Before deciding…", "Before moving…", "Before picking…",
 *                "Before picking…", "Worth checking…", "Since you're…"
 *   body         5/6 "I'd check/pull/start" or "worth checking"
 *
 * Four of those six were removed by r/Wordpress moderators, one with the public reply
 * "Please don't post AI-generated comments." No single draft was detectable. The repetition was.
 *
 * `src/novelty.ts` does not cover this either: it compares a draft against the THREAD it answers,
 * for restated claims. Nothing anywhere compared a draft against what the account already posted.
 *
 * WHY src/quality.ts's OWN CADENCE CHECK COULD NOT FIRE: `uniform-rhythm` (quality.ts) requires
 * four or more sentences, and `src/prompts.ts:240` caps output at "two to four sentences" and in
 * practice delivers two or three. The one check aimed at machine cadence was unreachable for
 * every draft the drafting prompt can produce.
 * ---------------------------------------------------------------------------
 *
 * EVERY RULE HERE IS A COMPARISON BETWEEN TEXTS, NOT A JUDGEMENT ABOUT ONE.
 *
 * It cannot tell whether prose reads as machine-written — nothing mechanical can, and claiming
 * otherwise is measuring word patterns and calling it comprehension. It answers a narrower
 * question that IS decidable: has this account already opened a comment this way, at this length,
 * closing this way. A reader comparing two of our comments is doing exactly this comparison.
 */
import { policy } from './policy.js';

/** Words that carry no opener shape — skipped when reading the first content words. */
const OPENER_STOP = new Set([
  'a', 'an', 'the', 'and', 'but', 'so', 'then', 'also', 'just', 'well', 'ok', 'okay',
  'that', 'this', 'these', 'those', 'it', 'its', 'there', 'here'
]);

export interface RepetitionIssue {
  /** Which comparison fired. Stable, so a gate name can be composed from it. */
  rule: 'repeated-opener' | 'repeated-shape' | 'repeated-opening-word';
  detail: string;
}

/**
 * How many prior uses of the same opening word make the next one a template.
 *
 * TWO, so the draft under test would be the THIRD. Once is a coincidence and twice is a habit a
 * reader might not notice; three consecutive comments opening on the same word is the thing itself.
 * Hardcoded with its reason rather than added to src/policy.ts, matching the thresholds already in
 * src/quality.ts (500 words, 2.5-word spread, 3 bold spans) — policy.ts holds OPERATIONAL limits,
 * and this is a detector's sensitivity.
 *
 * Measured on the real run: this is the rule that catches the fifth comment. Its opener phrase
 * ("Before picking") was new and its sentence count differed from the two before it, so neither
 * other rule fired — while a reader was looking at a fourth consecutive "Before".
 */
const PRIOR_USES_BEFORE_TEMPLATE = 2;

export interface RepetitionReport {
  ok: boolean;
  issues: RepetitionIssue[];
  /** The normalised opener this draft would be remembered by. */
  opener: string;
  words: number;
  sentences: number;
  endsWithQuestion: boolean;
}

/** Sentences, the same way src/quality.ts counts them, so two modules cannot disagree. */
function sentencesOf(body: string): string[] {
  return body
    .replace(/```[\s\S]*?```/g, ' ')
    .split(/(?<=[.!?])\s+|\n{2,}/)
    .map((s) => s.trim())
    .filter((s) => s.split(/\s+/).length > 1);
}

/**
 * The opening move, normalised to the first two content words.
 *
 * TWO, not three, and the count is the whole design. Measured on the six: the first THREE content
 * words are all distinct ("before deciding between", "before moving domain", "before picking
 * between", "before picking from"), so a trigram rule catches NOTHING. The first two collapse
 * "Before picking between Forminator" and "Before picking from the options" onto the same key, and
 * the first one collapses four of six onto "before". Two is the narrowest window that groups the
 * real repetition without collapsing every sentence that happens to start with a common verb.
 */
export function openerOf(body: string): string {
  const words = (body.toLowerCase().match(/[a-z']+/g) ?? []).filter((w) => !OPENER_STOP.has(w));
  return words.slice(0, 2).join(' ');
}

/** The structural fingerprint, for the shape comparison. */
export interface ShapePrint {
  opener: string;
  words: number;
  sentences: number;
  endsWithQuestion: boolean;
}

export function shapeOf(body: string): ShapePrint {
  const prose = body.replace(/```[\s\S]*?```/g, ' ');
  const sentences = sentencesOf(body);
  return {
    opener: openerOf(body),
    words: prose.trim().split(/\s+/).filter(Boolean).length,
    sentences: sentences.length,
    endsWithQuestion: /\?\s*["')\]]*\s*$/.test(body.trim())
  };
}

/**
 * Is `body` a repeat of something this account recently posted?
 *
 * `previous` is MOST RECENT FIRST. Only the first `policy.repetitionWindow.value` entries are
 * compared: a template is a thing a reader notices across consecutive comments, and a comment from
 * forty posts ago is not what makes the current one recognisable.
 *
 * Returns block-severity issues only. A near-miss is reported as nothing rather than as a warning,
 * because src/autopublish.ts refuses on every advisory and a cadence hint is not grounds to refuse
 * a publish — the same reasoning that made `claim-budget` warn-only in src/quality.ts.
 */
export function assessRepetition(body: string, previous: readonly string[]): RepetitionReport {
  const mine = shapeOf(body);
  const window = previous.slice(0, policy.repetitionWindow.value);

  const issues: RepetitionIssue[] = [];

  /** The opening word alone — shape rather than phrasing. "Before deciding" and "Before moving"
      are the same move, and this is what both rules below key on. */
  const firstWord = (s: string) => openerOf(s).split(' ')[0] ?? '';

  /* ---- the opening move ---- */
  const openerHits = window.filter((p) => mine.opener !== '' && openerOf(p) === mine.opener);
  if (openerHits.length) {
    issues.push({
      rule: 'repeated-opener',
      detail:
        `opens "${mine.opener}…" and ${openerHits.length} of the last ${window.length} ` +
        `comment(s) from this account opened the same way — a reader seeing two of ours in a row ` +
        `sees the template, not the advice`
    });
  }

  /**
   * ---- the whole shape ----
   *
   * All THREE of opener-word, sentence count and closing move. Any one alone is ordinary: plenty
   * of real comments are three sentences, and plenty end in a question. Three together is the
   * fingerprint, and requiring all three is what keeps this from firing on ordinary English.
   *
   * The first opener WORD rather than the two-word opener, because this rule is about shape
   * rather than phrasing — "Before deciding" and "Before moving" are the same move.
   */
  const shapeHits = window.filter((p) => {
    const o = shapeOf(p);
    return firstWord(p) !== '' && firstWord(p) === firstWord(body)
      && o.sentences === mine.sentences
      && o.endsWithQuestion === mine.endsWithQuestion;
  });
  if (shapeHits.length && !openerHits.length) {
    issues.push({
      rule: 'repeated-shape',
      detail:
        `same opening word, same ${mine.sentences}-sentence length and same ` +
        `${mine.endsWithQuestion ? 'closing question' : 'closing statement'} as ` +
        `${shapeHits.length} of the last ${window.length} — vary the structure, not just the words`
    });
  }

  /**
   * ---- the opening word on its own ----
   *
   * The loosest of the three and the one that caught what the other two missed. Neither the phrase
   * nor the full shape repeated on the fifth comment of the real run, and a reader was nonetheless
   * looking at a fourth consecutive "Before". The first word is the most visible thing about a
   * comment in a list of comments, so it gets a rule that does not require anything else to agree.
   */
  const word = firstWord(body);
  const wordHits = word === '' ? 0 : window.filter((p) => firstWord(p) === word).length;
  if (wordHits >= PRIOR_USES_BEFORE_TEMPLATE && !openerHits.length && !shapeHits.length) {
    issues.push({
      rule: 'repeated-opening-word',
      detail:
        `opens on "${word}", and so did ${wordHits} of the last ${window.length} comment(s) from ` +
        `this account — this would be the ${wordHits + 1}${wordHits + 1 === 3 ? 'rd' : 'th'} in a row ` +
        `to start the same way`
    });
  }

  return {
    ok: issues.length === 0,
    issues,
    opener: mine.opener,
    words: mine.words,
    sentences: mine.sentences,
    endsWithQuestion: mine.endsWithQuestion
  };
}

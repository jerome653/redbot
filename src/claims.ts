/**
 * The claim budget — how many checkable assertions a draft is allowed to make unhedged.
 *
 * ## The observation this exists for
 *
 * Across the 16 certifications on record, Argus's two most frequent findings are
 * `fatal-contradiction` (117) and `overconfident-language` (101). The draft prompt already
 * asks for the opposite, in as many words: *"If you are not confident, say what you would
 * check and why, rather than guessing with confidence. An invented certainty is not."* The
 * model reads that instruction and writes confident prose anyway.
 *
 * The project's own decision log has the rule for this situation — *"mechanical over prompt:
 * every fix that held checked a fact the model does not control; every prompt revision
 * drifted."* Rewording the instruction a seventh time is the drift. Counting the assertions in
 * the output is the fact.
 *
 * ## What this measures, and what it does not
 *
 * It measures **stated certainty about software behaviour**, not truth. A draft can be inside
 * the budget and completely wrong, and a draft over the budget can be entirely correct. Those
 * are not failures of the check — no text-level check measures truth, and pretending otherwise
 * is the HRC-001 mistake one level up. What it does is bound how much a single reply asserts
 * without qualification, because every unhedged behavioural claim is a separate thing a human
 * reviewer has to independently verify, and reviewers do not scale.
 *
 * ## It would NOT have caught HRC-001, and that is worth stating outright
 *
 * MEASURED 2026-07-27 against the 12 real drafts. The false sentence in HRC-001 reads *"Big
 * single-row values like that are the ones most likely to get silently truncated during a SQL
 * import if it hits a size limit"* — hedged, by any reading, and wrong: MySQL raises
 * ER_NET_PACKET_TOO_LARGE and closes the connection. Hedging does not make a false mechanism
 * true, so a certainty budget cannot be the answer to a truth problem.
 *
 * Across all 12 drafts the highest unhedged count is 2, against a budget of 4. **This check
 * fires on nothing currently on disk.** It therefore reports rather than blocks — a
 * `provisional` number with no evidence relating assertion count to correctness has no
 * business refusing to publish anything, and this pipeline's problem is that it publishes
 * nothing, not that it publishes too freely. It exists to make reviewer load visible now and
 * to give something to correlate against outcomes once replies have any.
 *
 * ## Why hedged sentences are free
 *
 * "wp_mail returns true even when delivery fails" and "I'd check whether wp_mail is returning
 * true even though delivery failed" carry the same information. The first commits the poster
 * to a fact; the second commits them to a diagnostic step. Only the first can be wrong in
 * public. So the budget counts the first and ignores the second, which pushes drafts toward
 * the shape the prompt already asked for — and, not incidentally, toward the shape Reddit
 * readers actually find useful.
 */
import { policy } from './policy.js';

/** Verbs and constructions that assert how software behaves. */
const BEHAVIOURAL: RegExp[] = [
  // state changes and outcomes
  /\b(?:throws?|raises?|returns?|inserts?|truncates?|drops?|deletes?|overwrites?|corrupts?)\b/i,
  /\b(?:causes?|triggers?|prevents?|breaks?|fixes?|resolves?|blocks?)\b/i,
  // storage and location assertions — the HRC-001 class.
  // "is|are|isn't|aren't stored": the first version of this matched only `is` and therefore
  // missed "Custom CSS and Additional CSS often aren't stored the same way", which is the
  // exact sentence shape it was written for.
  /\b(?:is|are|isn'?t|aren'?t|was|were)\s+(?:\w+\s+)?(?:stored|saved|written|kept|held)\b/i,
  /\b(?:stores?|saves?|writes?)\s+(?:it|them|the|this)\b/i,
  // absolutes
  /\b(?:always|never|guaranteed|invariably|in every case)\b/i,
  // bare futures about behaviour: "this will fail", "that will prevent"
  /\bwill\s+(?:not\s+)?[a-z]+\b/i,
  // definitional assertions about a named thing
  /\b(?:is|are)\s+(?:a|an|the)?\s*(?:server-side|client-side|hard|soft)?\s*(?:limit|default|maximum|minimum|constant|hook|filter)\b/i
];

/**
 * Hedges. Intentionally a superset of the craft gate's list — the craft gate counts hedges as
 * one register signal among many, whereas here a hedge is the whole difference between an
 * assertion and a diagnostic step, so the reading has to be generous or the budget punishes
 * sentences that were written exactly as asked.
 */
const HEDGED: RegExp[] = [
  /\b(?:likely|probably|usually|typically|often|generally|normally|commonly|in most cases)\b/i,
  /\b(?:might|may|could|should|can)\b/i,
  /\bI(?:'d| would)\b/i,
  /\b(?:worth|try) (?:checking|a look|ruling out)\b/i,
  /\b(?:if|unless|assuming|provided)\b/i,
  /\b(?:seems?|appears?|sounds? like|suggests?)\b/i,
  /\b(?:depends on|not sure|can'?t tell|my guess|in my experience)\b/i,
  /\b(?:check|confirm|verify|rule out|look at)\b/i,
  /\?/
];

export interface ClaimSentence {
  text: string;
  hedged: boolean;
}

export interface ClaimReport {
  /** Sentences asserting software behaviour, hedged or not. */
  behavioural: ClaimSentence[];
  /** Those making the assertion without qualification — what the budget is spent on. */
  unhedged: ClaimSentence[];
  budget: number;
  overBudget: boolean;
}

/**
 * Split on sentence enders, keeping fenced code out of it entirely: a code block is a
 * demonstration, not a claim, and its punctuation is not sentence structure.
 */
function sentences(body: string): string[] {
  return body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function assessClaims(body: string): ClaimReport {
  const behavioural: ClaimSentence[] = [];

  for (const text of sentences(body)) {
    if (!BEHAVIOURAL.some((re) => re.test(text))) continue;
    behavioural.push({ text, hedged: HEDGED.some((re) => re.test(text)) });
  }

  const unhedged = behavioural.filter((s) => !s.hedged);
  const budget = policy.unhedgedClaimBudget.value;

  return { behavioural, unhedged, budget, overBudget: unhedged.length > budget };
}

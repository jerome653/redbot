/**
 * Operational limits, and where each one came from.
 *
 * Phase 2 engineering principle: **every operational limit must be measured before being
 * encoded as policy.** Most of the limits redbot needs have NOT been measured yet — there
 * has never been a published reply, so no removal rate, no per-account posting ceiling and
 * no long-run stability figure exists.
 *
 * Deleting the limits until they are measured would be worse: the system would have no
 * ceiling at all. So each limit carries its provenance, and `redbot policy` prints the split.
 * A number marked `provisional` is a deliberately conservative placeholder that must not be
 * quoted as a finding, and the readiness report reads this table rather than restating it.
 *
 *   measured    — derived from a recorded observation in this repo, with the evidence path
 *   declared    — a human decision (a rule we chose to follow), not an observation
 *   provisional — a placeholder chosen to be safe; replace once the pilot produces data
 */

export type Provenance = 'measured' | 'declared' | 'provisional';

export interface Limit {
  readonly value: number;
  readonly unit: string;
  readonly provenance: Provenance;
  readonly why: string;
  /** Path to the evidence, for `measured`. */
  readonly evidence?: string;
}

const L = (
  value: number,
  unit: string,
  provenance: Provenance,
  why: string,
  evidence?: string
): Limit => ({ value, unit, provenance, why, ...(evidence ? { evidence } : {}) });

export const policy = {
  /* ---------------- pacing ---------------- */

  /**
   * The one genuinely measured envelope. DEFECT-02: ~75 page loads in a few minutes produced
   * HTTP 429; 9.5 loads/min ran clean afterwards.
   */
  maxPageLoadsPerMinute: L(
    9.5, 'page loads/min', 'measured',
    'sustained reading at this rate did not trigger 429 after the DEFECT-02 fix',
    'qa/evidence/phase8-*.log'
  ),

  /* ---------------- session shape ---------------- */

  shortSessionMs: L(5 * 60_000, 'ms', 'declared', 'a short visit is 5-10 minutes'),
  shortSessionMaxMs: L(10 * 60_000, 'ms', 'declared', 'upper bound of a short visit'),
  mediumSessionMs: L(15 * 60_000, 'ms', 'declared', 'a normal visit is 15-30 minutes'),
  mediumSessionMaxMs: L(30 * 60_000, 'ms', 'declared', 'upper bound of a normal visit'),

  /**
   * How often a session ends without a reply. Deliberately high: a system that replies every
   * time it looks at Reddit does not behave like a person who reads Reddit.
   */
  sessionsEndingWithoutReplyRate: L(
    0.55, 'fraction of sessions', 'declared',
    'most visits to a forum end without commenting; never force a reply'
  ),

  /* ---------------- reading ---------------- */

  readingWordsPerMinute: L(
    240, 'words/min', 'provisional',
    'scan-reading rate used to size dwell time; not measured against a real operator'
  ),
  minDwellMs: L(6_000, 'ms', 'declared', 'never leave a thread faster than a person could read the title and first paragraph'),
  /**
   * Raised from 240s on 2026-07-23: at 240s a thorough read of a 1200-word thread and a skim
   * of the same thread both hit the cap, so "read it properly before replying" collapsed into
   * "read it the same as everything else". The cap exists to stop one thread eating a whole
   * session, and 6 minutes still does that against a 15-30 minute session.
   */
  maxDwellMs: L(360_000, 'ms', 'provisional', 'cap so one very long thread cannot eat an entire session'),
  idlePauseRate: L(0.18, 'fraction of thread views', 'declared', 'people stop mid-thread and do nothing'),
  abandonThreadRate: L(0.22, 'fraction of opened threads', 'declared', 'people open threads they end up not caring about'),

  /* ---------------- account ceilings ---------------- */

  /**
   * From ACCOUNT-WARMING.md Stage 1. A DECLARED rule, not an observation — we have not
   * measured what these accounts can actually sustain, because they have posted nothing.
   */
  maxRepliesPerDay: L(3, 'replies/day', 'declared', 'ACCOUNT-WARMING Stage 1: 2-4 comments a day, maximum'),
  minMinutesBetweenReplies: L(
    45, 'minutes', 'provisional',
    'spacing between replies; Reddit new-account rate limiting is documented at 5-10 min but has not been measured here'
  ),
  maxReadsPerDay: L(120, 'threads/day', 'provisional', 'reading ceiling; the 429 envelope constrains rate, not daily volume'),
  maxSearchesPerDay: L(20, 'searches/day', 'provisional', 'search is heavier than feed reading and less measured'),

  /* ---------------- health thresholds ---------------- */

  cautionKarmaBelow: L(10, 'karma', 'declared', 'a single-digit-karma account trips new-account filters'),
  cautionAccountAgeDays: L(7, 'days', 'declared', 'ACCOUNT-WARMING: age minimums are typically 7-30 days'),

  rateLimitCooldownMs: L(
    30 * 60_000, 'ms', 'provisional',
    'measured recovery from the one observed 429 was under 5 minutes; 30 is a deliberate over-correction'
  ),
  removalCooldownMs: L(
    24 * 60 * 60_000, 'ms', 'declared',
    'one observed removal stops posting for a day so a person can look at why'
  ),
  removalsBeforeStop: L(2, 'observed removals', 'declared', 'two removals is a pattern, not noise — stop and reassess'),
  loginFailuresBeforeStop: L(2, 'failures', 'declared', 'repeated auth failure may be a suspension; stop rather than probe'),

  /* ---------------- publishing gates ---------------- */

  /**
   * The contribution floor — the only one, since 2026-07-23 (D-01).
   *
   * Replaced `minConfidenceToPublish` (70) and `minScoreToPublish` (60). Both were floors under
   * numbers the Phase-1 triage model chose for itself, and both cited "the analyze rubric" —
   * the rubric DEFECT-12 showed the model skipping. 40 is one fillable `unanswered` gap and
   * nothing else: the smallest case that still describes a real contribution.
   */
  minOpportunityToPublish: L(
    40, 'opportunity 0-100', 'declared',
    'one fillable unanswered gap and nothing else — the smallest thing worth a stranger appearing'
  ),
  maxThreadAgeHoursToPublish: L(
    72, 'hours', 'declared',
    'a reply on a 4-day-old thread is not read; it is a footprint'
  ),

  /* ---------------- citation check (Argus Phase 10) ---------------- */

  /**
   * When a corpus card counts as holding material on a claim. Both conditions apply.
   *
   * `provisional`, not `declared`, and the distinction is the point: there is no labelled set
   * of claim/card pairs to tune against, so these two numbers were chosen to be conservative
   * and have never been measured for precision or recall. Loosening them widens what gets
   * escalated to a person; tightening them widens what gets rejected as invented. Neither
   * direction is currently defensible from evidence, so neither number may be quoted as a
   * finding until the pilot produces adjudicated cases.
   */
  citationMinTerms: L(
    3, 'distinct claim terms', 'provisional',
    'two shared words between a claim and a card is a coincidence; not measured'
  ),
  citationMinCoverage: L(
    0.5, 'fraction of claim terms', 'provisional',
    'a card matching under half a claim is about something adjacent; not measured'
  ),

  /* ---------------- claim budget (craft gate) ---------------- */

  /**
   * How many unhedged assertions about software behaviour one reply may make.
   *
   * `provisional`. Four is a judgement, not a measurement: no labelled set exists relating
   * assertion count to whether a reply was correct, and one will not exist until published
   * replies have outcomes. What IS measured is the condition it responds to — 101
   * `overconfident-language` and 117 `fatal-contradiction` findings across the 16
   * certifications on record, produced by a prompt that already asks for hedging in writing.
   *
   * The number is a ceiling on how much unverified certainty one reply puts in public, and
   * therefore on how much a human reviewer has to independently check. It is not a claim that
   * five assertions are wrong and four are right.
   */
  unhedgedClaimBudget: L(
    4, 'unhedged behavioural assertions per reply', 'provisional',
    'each unhedged claim is a separate thing the reviewer must verify alone; not measured'
  )
} as const;

export type PolicyKey = keyof typeof policy;

export function limitsByProvenance(): Record<Provenance, PolicyKey[]> {
  const out: Record<Provenance, PolicyKey[]> = { measured: [], declared: [], provisional: [] };
  for (const key of Object.keys(policy) as PolicyKey[]) {
    out[policy[key].provenance].push(key);
  }
  return out;
}

/** Every limit that is still a placeholder. The readiness report lists these as unknowns. */
export function provisionalLimits(): Array<{ key: PolicyKey; limit: Limit }> {
  return (Object.keys(policy) as PolicyKey[])
    .filter((k) => policy[k].provenance === 'provisional')
    .map((key) => ({ key, limit: policy[key] }));
}

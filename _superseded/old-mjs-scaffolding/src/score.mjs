/**
 * Engagement scoring.
 *
 * Answers one question: "is this thread actually alive right now?" — because a reply
 * to a dead thread is wasted effort no matter how good it is.
 *
 * Note on tiers: the Appilot user guide defines tier by engagement (70+/40-69/<40)
 * while the prompt bundled in its APK defines tier by topic. Two different meanings,
 * one field name. Here `tier` means engagement, always, and topic lives in `category`.
 */

/** Raw signals -> 0..100. Deliberately simple and explainable; no magic. */
export function scorePost(post, scoring) {
  const ageHours = Math.max(0.05, (Date.now() - new Date(post.createdAt).getTime()) / 3_600_000);
  const ups = Math.max(0, post.upvotes ?? 0);
  const comments = Math.max(0, post.commentCount ?? 0);

  /* velocity: engagement per hour, so a 2-hour-old post with 40 upvotes beats a
     2-day-old post with 60 */
  const raw = (ups * scoring.upvoteWeight + comments * scoring.commentWeight) / ageHours;

  /* recency decay: even a fast thread goes cold */
  const decay = Math.pow(0.5, ageHours / scoring.velocityHalfLifeHours);

  /* log compression keeps a single viral post from swamping the scale */
  const compressed = Math.log10(1 + raw) / Math.log10(1 + 200);
  const score = Math.round(Math.min(100, Math.max(0, compressed * 100 * (0.35 + 0.65 * decay))));

  return {
    score,
    signals: {
      ageHours: Number(ageHours.toFixed(2)),
      upvotes: ups,
      comments,
      velocityPerHour: Number(raw.toFixed(2)),
      decay: Number(decay.toFixed(3))
    }
  };
}

export function tierOf(score, breaks) {
  if (score >= breaks.tier1) return 1;
  if (score >= breaks.tier2) return 2;
  return 3;
}

/**
 * Suggested wait before a human replies, in minutes.
 *
 * This is advice printed on the card, NOT a scheduler. Nothing in this system
 * posts anything, so nothing here needs to fire on a timer.
 */
export function suggestedDelayMinutes(tier) {
  return { 1: 5, 2: 30, 3: 60 }[tier] ?? 60;
}

export function enrich(post, scoring) {
  const { score, signals } = scorePost(post, scoring);
  const tier = tierOf(score, scoring.tierBreaks);
  return { ...post, score, signals, tier, suggestedDelayMinutes: suggestedDelayMinutes(tier) };
}

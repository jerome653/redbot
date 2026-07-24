/**
 * Phase 3 — does the draft actually add anything?
 *
 * A model asked to justify its own output will justify it. So the draft's `whatNew` claim is
 * not trusted: it is tested against `covered`, the list of claims the gap analyzer extracted
 * from the thread BEFORE the draft existed.
 *
 * **This is a proxy and is labelled as one everywhere it surfaces.** It compares content
 * words. Two sentences can share vocabulary and say opposite things ("disable the plugins" /
 * "do not disable the plugins"), and two can share none and mean the same. What it reliably
 * catches is the common failure — a reply that walks back over ground the thread already
 * covered, in the thread's own words. The person at the approval prompt decides the rest.
 */

const STOP = new Set([
  'about','after','also','and','are','because','been','before','being','but','can','could','did',
  'does','doing','down','each','even','every','first','for','from','get','gets','getting','had',
  'has','have','having','here','how','into','its','just','like','make','makes','may','might',
  'more','most','much','need','needs','not','off','once','one','only','other','out','over','own',
  'same','see','should','since','some','still','such','than','that','the','their','them','then',
  'there','these','they','this','those','through','too','try','trying','until','use','used','using',
  'very','was','were','what','when','where','which','while','who','why','will','with','would','you',
  'your','yours','check','checking','look','looking','thing','things','some','something','anything'
]);

function contentWords(text: string): Set<string> {
  const words = (text.toLowerCase().match(/[a-z0-9_][a-z0-9_.\-/]{2,}/g) ?? [])
    .map((w) => w.replace(/[.\-/]+$/, ''))
    .filter((w) => w.length >= 4 && !STOP.has(w));
  return new Set(words);
}

/** Share of the covered claim's content words that also appear in the draft. */
export function overlapRatio(claim: string, draft: string): number {
  const a = contentWords(claim);
  if (!a.size) return 0;
  const b = contentWords(draft);
  let hits = 0;
  for (const w of a) if (b.has(w)) hits++;
  return hits / a.size;
}

export interface NoveltyResult {
  ok: boolean;
  issues: string[];
  /** Highest overlap seen, for the reports. */
  maxOverlap: number;
  /** Per-claim overlap, so a borderline call can be inspected rather than argued about. */
  overlaps: Array<{ claim: string; ratio: number }>;
}

/**
 * `RESTATES` is the threshold at which a draft is treated as repeating a claim.
 *
 * Chosen, not measured — 0.7 means seven in ten of the claim's distinctive words reappear in
 * the reply. It is listed as a provisional limit and should be re-fitted once the review
 * dataset has enough approved and rejected drafts to check it against operator judgement.
 */
export const RESTATES = 0.7;

export function checkNovelty(
  draftBody: string,
  whatNew: string,
  covered: string[]
): NoveltyResult {
  const overlaps = covered.map((claim) => ({ claim, ratio: overlapRatio(claim, draftBody) }));
  const issues: string[] = [];

  for (const { claim, ratio } of overlaps) {
    if (ratio >= RESTATES) {
      issues.push(
        `restates a claim already on the thread (${Math.round(ratio * 100)}% word overlap, proxy): "${claim.slice(0, 90)}"`
      );
    }
  }

  // The stated contribution must also not be a restatement of the covered ground.
  if (whatNew.trim()) {
    for (const claim of covered) {
      const r = overlapRatio(claim, whatNew);
      if (r >= RESTATES) {
        issues.push(
          `the stated contribution matches an existing claim (${Math.round(r * 100)}% overlap, proxy): "${claim.slice(0, 90)}"`
        );
      }
    }
  } else {
    issues.push('no contribution was stated — the draft does not say what it adds');
  }

  const maxOverlap = overlaps.reduce((m, o) => Math.max(m, o.ratio), 0);
  return { ok: issues.length === 0, issues, maxOverlap, overlaps };
}

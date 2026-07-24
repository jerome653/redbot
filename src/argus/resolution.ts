/**
 * Phase 7 — resolution detection.
 *
 * Runs BEFORE opportunity analysis and is entirely deterministic: string matching over the post
 * body and the comment authors. No model is consulted, because the model already failed at this.
 *
 * OBSERVED FAILURE (HRC-001-A, 2026-07-23): thread f11d8de68709. The post body contained
 *
 *     "UPDATE:
 *      I downloaded the Updraft database file and extracted it. It was very big so I gave it
 *      to Claude and it found all the CSS."
 *
 * and the original poster replied "Yes this worked" and "Thanks this is what I did" beneath two
 * separate comments. The gap analyzer read all of it and returned `alreadyAnswered: false`. The
 * opportunity engine scored the thread 62/100, a draft was generated, and it passed all twenty
 * gates before a human caught it.
 *
 * `alreadyAnswered` was the only signal in the system for "this thread is finished", and it was
 * a model's judgement. This module replaces that judgement with a match on the asker's own
 * words, which is the one thing about resolution that is not a matter of opinion.
 *
 * When resolution is detected, the opportunity score is forced to zero. Only an explicit human
 * override continues.
 */
import type { Thread } from '../types.js';
import type { ResolutionSignal, ResolutionVerdict } from './types.js';

/**
 * Markers of an author declaring their own problem solved.
 *
 * Deliberately narrow. "Thanks" alone is politeness, not resolution — it appears under answers
 * that did not work. Each pattern below requires the asker to say the thing is DONE.
 */
const RESOLUTION_PATTERNS: Array<{ re: RegExp; note: string }> = [
  { re: /^\s*(?:\*\*)?\s*UPDATE\s*[:!\-–]/im, note: 'post carries an UPDATE section' },
  { re: /^\s*(?:\*\*)?\s*(?:EDIT|SOLVED|RESOLVED|FIXED)\s*[:!\-–]/im, note: 'post carries an EDIT/SOLVED marker' },
  { re: /\b(?:solved|resolved|fixed)\s+it\b/i, note: 'declared solved' },
  { re: /\bthis\s+(?:worked|fixed\s+it|did\s+it|was\s+it)\b/i, note: 'confirmed a fix worked' },
  { re: /\bthat\s+(?:worked|fixed\s+it|did\s+it|was\s+it)\b/i, note: 'confirmed a fix worked' },
  { re: /\bworked\s+(?:for\s+me|perfectly|a\s+treat)\b/i, note: 'confirmed a fix worked' },
  { re: /\bfound\s+(?:it|the\s+(?:issue|problem|cause))\b/i, note: 'found the cause' },
  { re: /\bthis\s+is\s+what\s+i\s+did\b/i, note: 'adopted the suggested fix' },
  { re: /\bissue\s+(?:is\s+)?(?:fixed|resolved|sorted)\b/i, note: 'issue reported fixed' },
  { re: /\bnever\s*mind\b/i, note: 'asker withdrew the question' },
  { re: /\bgot\s+it\s+(?:working|sorted|fixed)\b/i, note: 'reported working' },
  { re: /\ball\s+(?:sorted|good\s+now)\b/i, note: 'reported sorted' },
  { re: /\bmanaged\s+to\s+(?:fix|solve|recover)\b/i, note: 'reported fixed' },
  { re: /\bturned\s+out\s+(?:to\s+be|it\s+was)\b/i, note: 'cause identified' }
];

/** Politeness that is NOT resolution. Checked so the patterns above stay honest. */
const NOT_RESOLUTION = [
  /^\s*thanks?(?:\s+(?:a\s+lot|so\s+much|mate|all))?[!.\s]*$/i,
  /\bthanks?,?\s+i'?ll\s+(?:try|check|have\s+a\s+look)/i,
  /\bwill\s+(?:try|test|check)\s+(?:this|that)\b/i
];

function context(text: string, index: number, len: number): string {
  const from = Math.max(0, index - 60);
  const to = Math.min(text.length, index + len + 60);
  return text.slice(from, to).replace(/\s+/g, ' ').trim();
}

/**
 * Detect operator-declared resolution.
 *
 * `byOriginalPoster` matters more than the wording: a bystander saying "this worked" is weaker
 * evidence than the asker saying it. Both are recorded; only the asker's own declaration, or an
 * UPDATE/SOLVED marker in the post itself, sets `resolved`.
 */
export function detectResolution(thread: Thread): ResolutionVerdict {
  const signals: ResolutionSignal[] = [];
  const author = (thread.author ?? '').toLowerCase();

  /* ---- the post body ---- */
  const body = thread.body ?? '';
  for (const { re, note } of RESOLUTION_PATTERNS) {
    const m = re.exec(body);
    if (!m) continue;
    signals.push({
      where: 'post-body',
      matched: m[0].trim(),
      context: `${note}: …${context(body, m.index, m[0].length)}…`,
      byOriginalPoster: true          // the body IS the asker
    });
  }

  /* ---- comments ---- */
  for (const c of thread.comments) {
    const commenter = (c.author ?? '').toLowerCase();
    const isOp = Boolean(author) && commenter === author;

    if (NOT_RESOLUTION.some((re) => re.test(c.body.trim()))) continue;

    for (const { re, note } of RESOLUTION_PATTERNS) {
      const m = re.exec(c.body);
      if (!m) continue;
      signals.push({
        where: isOp ? 'op-reply' : 'comment',
        matched: m[0].trim(),
        context: `${note}: …${context(c.body, m.index, m[0].length)}…`,
        byOriginalPoster: isOp
      });
      break;   // one signal per comment is enough
    }
  }

  const authoritative = signals.filter((s) => s.byOriginalPoster);
  const resolved = authoritative.length > 0;

  const detail = resolved
    ? `the asker declared this resolved — ${authoritative.length} signal(s) from the original poster` +
      (signals.length > authoritative.length
        ? `, plus ${signals.length - authoritative.length} from other commenters`
        : '')
    : signals.length
      ? `${signals.length} resolution-shaped signal(s), none from the original poster — not treated as resolved`
      : 'no resolution signal found';

  return { resolved, signals, detail };
}

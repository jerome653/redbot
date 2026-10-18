/**
 * Fix-and-recheck, the pure half: take out of a REJECTED draft every sentence that carries a claim
 * the certification proved false, and say exactly why when that cannot be done safely.
 *
 * Jerome, 2026-10-18: a draft whose certification found a claim proven false gets that claim taken
 * out and is certified ONCE more. 24 of 34 production drafts carried a fatal-contradiction.
 *
 * DELETION, NEVER REWRITING. A model asked to rewrite the reply can restate the refuted claim in new
 * words, and the re-certification has no way to link the new wording back to the claim it already
 * refuted. Deleting the sentence that holds the claim's own quote cannot reintroduce it. Measured by
 * the plan critic on the July log: a refuted claim's quote appears verbatim in the body 79 of 82
 * times, a dependent's 31 of 32 — so locating by quote is the common case, and the misses refuse.
 *
 * Nothing here touches the database, the browser or a model; src/refuted-recheck.ts does the I/O.
 */
import type { Certification } from './argus/types.js';

/** The hard rules a deletion can answer: a claim proven false, and claims resting on it. */
export const STRIP_RULES: ReadonlySet<string> = new Set(['fatal-contradiction', 'invalidated-dependency']);
/** Present alongside them without stopping the strip. The re-certification judges these again. */
export const SOFT_RULES: ReadonlySet<string> = new Set([
  'overconfident-language', 'low-confidence-as-fact', 'no-provenance', 'falsifiable-claim-weak-evidence'
]);
/**
 * What is left must still be a reply: at least this many sentences (disclosure lines not counted)…
 * One, not two: replayed on cardinal's 24 drafts carrying a refuted claim (18 Oct), a floor of 2
 * refused 16 of them and let 6 through; 1 lets 10 through. The drafting prompt writes one-sentence
 * replies itself, and a remainder still faces the 40% share below, the draft-time length check,
 * the re-certification and the publish bar.
 */
export const MIN_SENTENCES = 1;
/** …and at least this share of the original length. */
export const MIN_KEEP_RATIO = 0.4;
/** A quote shorter than this, once normalised, matches too much of any body to locate a claim by. */
const MIN_QUOTE = 8;

/** On unless REDBOT_STRIP_REFUTED=0. Each strip costs one more certification (12-19 model calls). */
export function stripRefutedEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.REDBOT_STRIP_REFUTED !== '0';
}

/** A REJECT that names a claim proven false. Anything else has nothing to strip, so nothing is refused. */
export function hasRefutedClaim(cert: Certification | undefined): boolean {
  return cert?.verdict === 'REJECT' && cert.reasons.some((r) => r.rule === 'fatal-contradiction');
}

export type Eligibility = { ok: true; refuted: string[]; dependents: string[] } | { ok: false; why: string };

export function stripEligibility(cert: Certification | undefined): Eligibility {
  if (!cert) return { ok: false, why: 'the draft has no certification' };
  if (cert.verdict !== 'REJECT') return { ok: false, why: `the verdict is ${cert.verdict}, not REJECT` };
  const hard = [...new Set(cert.reasons.map((r) => r.rule))].filter((r) => !STRIP_RULES.has(r) && !SOFT_RULES.has(r));
  if (hard.length) return { ok: false, why: `${hard.join(', ')} cannot be fixed by deleting a sentence` };
  const fatal = cert.reasons.filter((r) => r.rule === 'fatal-contradiction');
  if (!fatal.length) return { ok: false, why: 'no claim was proven false' };
  if (fatal.some((r) => !r.claimId)) return { ok: false, why: 'a fatal contradiction names no claim' };
  const refuted = [...new Set(fatal.map((r) => r.claimId!))];

  /* Everything resting on a refuted claim, transitively, by the certification's own graph — plus the
     checker's own invalidations of it, which name the same claims by the first failed root found. */
  const gone = new Set(refuted);
  for (let grew = true; grew;) {
    grew = false;
    for (const c of cert.claims) {
      if (!gone.has(c.id) && c.dependsOn.some((d) => gone.has(d))) { gone.add(c.id); grew = true; }
    }
  }
  for (const v of cert.invalidated) if (refuted.includes(v.becauseOf)) gone.add(v.claimId);
  return { ok: true, refuted, dependents: [...gone].filter((id) => !refuted.includes(id)) };
}

/* ------------------------------------------------------------------ *
 * Sentences, with their offsets in the body
 * ------------------------------------------------------------------ */

export interface Span { start: number; end: number }

const FENCE = /```[\s\S]*?(?:```|$)/g;
const LIST_MARK = /^[ \t]*(?:[-*+>]|\d+[.)])[ \t]+/;
const MARK_ONLY = /^[ \t]*(?:[-*+>]|\d+[.)])[ \t]*$/;
/**
 * A boundary needs whitespace after it, so a URL ("…/6.4.2/") and a version number ("6.4.2") can
 * never be cut: neither contains a space. Inline code can, so it is masked before boundaries are found.
 */
const NO_SPLIT = /`[^`\n]*`/g;
const BOUNDARY = /[.!?]+["'”’)\]]*(?=\s)/g;
const ABBREV = /(?:^|[\s(])(?:e\.g|i\.e|etc|vs|cf|approx|incl)\.$/i;

/** Every sentence in the body, in order. A fenced code block is one unit; a list marker is not prose. */
export function sentenceSpans(body: string): Span[] {
  const out: Span[] = [];
  const push = (s: number, e: number) => {
    while (s < e && /\s/.test(body[s]!)) s++;
    while (e > s && /\s/.test(body[e - 1]!)) e--;
    if (e > s) out.push({ start: s, end: e });
  };
  const prose = (from: number, to: number) => {
    for (let s = from; s <= to;) {
      let e = body.indexOf('\n', s);
      if (e === -1 || e > to) e = to;
      const line = body.slice(s, e);
      const masked = line.replace(NO_SPLIT, (m) => '_'.repeat(m.length));
      let start = LIST_MARK.exec(line)?.[0].length ?? 0;
      for (const m of masked.matchAll(BOUNDARY)) {
        const end = m.index + m[0].length;
        if (m.index < start || ABBREV.test(masked.slice(start, end))) continue;
        push(s + start, s + end);
        start = end;
      }
      push(s + start, e);
      s = e + 1;
    }
  };
  let pos = 0;
  for (const m of body.matchAll(FENCE)) {
    prose(pos, m.index);
    out.push({ start: m.index, end: m.index + m[0].length });
    pos = m.index + m[0].length;
  }
  prose(pos, body.length);
  return out;
}

/* ------------------------------------------------------------------ *
 * Finding a quote
 * ------------------------------------------------------------------ */

/**
 * Case, runs of whitespace and dashes folded; markdown `*`/backticks and every quote mark dropped, with
 * offsets back. Quote marks go because the claim extractor changes them: in the July log every quote
 * miss was 'not indexed' for "not indexed", or "sticky sidebar" quoted without its marks.
 */
function fold(s: string): { text: string; at: number[] } {
  let text = '';
  const at: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (c === '*' || c === '`' || QUOTE_MARK.test(c)) continue;
    if (/\s/.test(c)) {
      if (text && !text.endsWith(' ')) { text += ' '; at.push(i); }
      continue;
    }
    const f = c === '–' || c === '—' ? '-' : c.toLowerCase();
    text += f.length === 1 ? f : c;
    at.push(i);
  }
  return { text, at };
}

const QUOTE_MARK = /["'‘’“”]/;

/** A quote as searchable fragments: split at any ellipsis, wrapping brackets and end punctuation off. */
function fragments(quote: string): string[] {
  return quote.split(/\.{3}|…/)
    .map((f) => fold(f).text.trim().replace(/^[(\[]+|[)\].,;:!?]+$/g, '').trim())
    .filter((f) => f.length >= MIN_QUOTE);
}

/** Letters and digits only: what a restatement in other punctuation or spacing still shares. */
const bare = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

/* ------------------------------------------------------------------ *
 * The plan
 * ------------------------------------------------------------------ */

export interface StripInput {
  body: string;
  /** Every certification of this draft, oldest first. Only the LAST one is read. */
  certs: Certification[];
  /** Lines that must survive untouched — the disclosure lines. */
  protect?: readonly string[];
  /** True when this draft was itself cut by a strip. It is never cut again. */
  fromStrip?: boolean;
  minSentences?: number;
  minKeepRatio?: number;
}

export type StripPlan =
  | { ok: true; body: string; removed: number; quotes: string[] }
  | { ok: false; why: string };

export function planStrip(input: StripInput): StripPlan {
  const no = (why: string): StripPlan => ({ ok: false, why });
  if (input.fromStrip) return no('this draft is already the product of a strip');
  const cert = input.certs[input.certs.length - 1];
  const e = stripEligibility(cert);
  if (!e.ok) return no(e.why);

  const { body } = input;
  const spans = sentenceSpans(body);
  const folded = fold(body);
  const guarded = new Set<Span>();
  for (const line of input.protect ?? []) {
    for (let i = body.indexOf(line); line && i !== -1; i = body.indexOf(line, i + 1)) {
      for (const s of spans) if (s.start < i + line.length && i < s.end) guarded.add(s);
    }
  }

  const doomed = new Set<Span>();
  const quotes: string[] = [];
  const refutedFragments: string[] = [];
  for (const id of [...e.refuted, ...e.dependents]) {
    const claim = cert!.claims.find((c) => c.id === id);
    const frags = claim ? fragments(claim.sourceQuote) : [];
    if (!frags.length) return no(`quote of claim ${id} not found in the body: it is missing or too short to locate`);
    for (const f of frags) {
      let found = 0;
      for (let i = folded.text.indexOf(f); i !== -1; i = folded.text.indexOf(f, i + 1)) {
        const from = folded.at[i]!, to = folded.at[i + f.length - 1]! + 1;
        for (const s of spans) {
          if (s.start < to && from < s.end) { doomed.add(s); found++; }
        }
      }
      if (!found) return no(`quote of claim ${id} not found in the body: "${claim!.sourceQuote.slice(0, 80)}"`);
    }
    if (e.refuted.includes(id)) refutedFragments.push(...frags);
    if (!quotes.includes(claim!.sourceQuote)) quotes.push(claim!.sourceQuote);
  }
  if ([...doomed].some((s) => guarded.has(s))) return no('it would remove the disclosure line');

  /* Delete back to front so earlier offsets stay valid. A sentence takes the spaces after it on its
     line with it; a line left holding only a list marker goes, and blank runs fold to one. */
  let out = body;
  for (const s of [...doomed].sort((a, b) => b.start - a.start)) {
    let end = s.end;
    while (end < out.length && (out[end] === ' ' || out[end] === '\t')) end++;
    out = out.slice(0, s.start) + out.slice(end);
  }
  out = out.split('\n').filter((l) => !MARK_ONLY.test(l)).map((l) => l.trimEnd())
    .join('\n').replace(/\n{3,}/g, '\n\n').trim();

  for (const f of refutedFragments) {
    if (bare(out).includes(bare(f))) return no(`the refuted claim is still in the body after deletion: "${f.slice(0, 80)}"`);
  }
  for (const line of input.protect ?? []) {
    if (line && body.includes(line) && !out.includes(line)) return no('it would remove the disclosure line');
  }
  const minSentences = input.minSentences ?? MIN_SENTENCES;
  const minKeepRatio = input.minKeepRatio ?? MIN_KEEP_RATIO;
  const left = sentenceSpans(out).filter((s) => !(input.protect ?? []).some((p) => p && out.slice(s.start, s.end).includes(p))).length;
  if (left < minSentences) return no(`only ${left} sentence(s) would be left (the floor is ${minSentences})`);
  if (out.length < minKeepRatio * body.trim().length) {
    return no(`only ${Math.floor((100 * out.length) / body.trim().length)}% of the original length would be left (the floor is ${Math.round(100 * minKeepRatio)}%)`);
  }
  return { ok: true, body: out, removed: doomed.size, quotes };
}

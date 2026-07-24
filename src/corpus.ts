/**
 * Ground-truth corpora — human-authored reference material a claim can be checked against.
 *
 * ## Why this is narrow, and deliberately so
 *
 * The obvious idea is "connect redbot to the SGEN knowledge base so replies are grounded in
 * something other than model memory". Measured 2026-07-24 against
 * `_KB-CANONICAL.json` (3,544 cards):
 *
 *   cards mentioning WordPress    17   — every one of them is "SGEN does not do that":
 *                                        import/migrate, plugins, themes, where wp-admin is
 *   cards mentioning mysql         2
 *   updraft / elementor / woocommerce / jquery   0
 *
 * redbot answers WordPress questions in r/WordPress. The KB's coverage of that claim space is
 * effectively zero, so as a knowledge source it would return either nothing (useless) or a
 * weakly-related SGEN card that then steers a public reply toward the product — which is the
 * exact spam signal `config.brand.forbidMention` exists to suppress. And a "no supporting
 * source" flag over WordPress claims would be true ~100% of the time, which is DEFECT-15
 * again: a flag that is almost always true is not a filter.
 *
 * So a corpus is not consulted to write anything, and it does not vouch for claims outside
 * what it covers. It has a **jurisdiction** — the claims it is entitled to rule on — and it
 * is silent everywhere else. The SGEN KB's jurisdiction is claims about SGEN: if a draft ever
 * asserts something about the product, that assertion must match a published, public,
 * human-authored card, or it does not go out. That is a real failure this prevents
 * (a fabricated SGEN capability stated in public) and it fires rarely, which is what makes it
 * worth having.
 *
 * ## Rules this obeys
 *
 * - **Human-authored only.** Model output must never become an answer key — feeding Argus's
 *   own refutations back as ground truth is HRC-001 one level up.
 * - **Public only.** Cards marked INTERNAL are excluded, because a citation check that reads
 *   internal material can surface it in a review package that gets pasted somewhere.
 * - **Code adjudicates.** Retrieval is deterministic term overlap. No model call, no
 *   embedding, no ranking the model can influence.
 * - **Missing corpus fails closed**, and says so. A corpus that could not be read is not the
 *   same as a corpus that found nothing.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { DATA, ROOT } from './config.js';
import { policy } from './policy.js';

/* ------------------------------------------------------------------ *
 * Configuration
 * ------------------------------------------------------------------ */

export interface CorpusConfig {
  /** Stable id, cited in verdicts. */
  id: string;
  /** How to name it in operator-facing prose. */
  label: string;
  /** Path to the JSON file. Relative paths resolve from the repo root. */
  path: string;
  /** Dotted path to the array of cards inside that JSON. Empty string = the file is the array. */
  cardsAt: string;
  /** Which card fields carry the id, the question and the body. */
  fields: { id: string; question: string; content: string };
  /** Field/value pairs a card must match to be usable. */
  require: Record<string, string>;
  /**
   * Claim-text patterns that put a claim inside this corpus's jurisdiction. A claim matching
   * none of these is not ruled on — silence, not approval.
   */
  jurisdiction: string[];
  note?: string;
}

/**
 * The built-in corpus set. `data/corpora.json` replaces it wholesale when present.
 *
 * The SGEN KB lives outside this repository on purpose — redbot is a public repo and the KB
 * is SGEN-internal material. The relative path is the checkout layout on the machine that
 * owns both; anywhere else the corpus is simply unavailable, which is handled explicitly.
 */
export const BUILT_IN_CORPORA: CorpusConfig[] = [
  {
    id: 'sgen-kb',
    label: 'the SGEN knowledge base',
    path: '../../Knowledge/10-Knowledge-Base/_KB-CANONICAL.json',
    cardsAt: 'cards',
    fields: { id: 'kb_id', question: 'question', content: 'content' },
    require: { status: 'published-live', classification: 'PUBLIC' },
    jurisdiction: ['\\bsgen\\b'],
    note:
      'Human-authored support cards about the SGEN product. Jurisdiction is claims about ' +
      'SGEN only — it knows nothing about WordPress and does not pretend to.'
  }
];

export const corporaPath = join(DATA, 'corpora.json');

export class CorpusError extends Error {}

function loadConfigs(): CorpusConfig[] {
  if (!existsSync(corporaPath)) return BUILT_IN_CORPORA;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(corporaPath, 'utf8'));
  } catch (e) {
    throw new CorpusError(`data/corpora.json is not readable JSON (${(e as Error).message})`);
  }
  const list = (raw as { corpora?: unknown })?.corpora;
  if (!Array.isArray(list)) throw new CorpusError('data/corpora.json must contain a "corpora" array');
  for (const c of list as CorpusConfig[]) {
    if (!c.id || !c.path || !c.fields?.id) throw new CorpusError(`corpus entry is missing id/path/fields.id`);
    for (const src of c.jurisdiction ?? []) {
      try { new RegExp(src, 'i'); }
      catch (e) { throw new CorpusError(`corpus "${c.id}" jurisdiction ${JSON.stringify(src)}: ${(e as Error).message}`); }
    }
  }
  return list as CorpusConfig[];
}

/* ------------------------------------------------------------------ *
 * Retrieval — deterministic, explainable, no model involved
 * ------------------------------------------------------------------ */

/**
 * Words too common to carry meaning. Kept short and English-generic: a stoplist tuned to one
 * subject would quietly become part of the domain profile.
 */
const STOP = new Set([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'your', 'with', 'that', 'this', 'from',
  'have', 'has', 'had', 'was', 'were', 'will', 'would', 'can', 'could', 'should', 'been',
  'they', 'them', 'their', 'there', 'then', 'than', 'when', 'what', 'which', 'who', 'how',
  'why', 'all', 'any', 'its', 'it\'s', 'into', 'onto', 'out', 'off', 'only', 'also', 'just',
  'get', 'gets', 'got', 'use', 'used', 'using', 'via', 'per', 'own', 'one', 'two', 'does',
  'did', 'doing', 'do', 'if', 'in', 'on', 'at', 'to', 'of', 'or', 'is', 'as', 'be', 'by',
  'an', 'a', 'no', 'so', 'up', 'we', 'us', 'my', 'me', 'i'
]);

export function terms(text: string): string[] {
  return [...new Set(
    text.toLowerCase()
      .split(/[^a-z0-9_.-]+/)
      .map((w) => w.replace(/^[.\-_]+|[.\-_]+$/g, ''))
      .filter((w) => w.length >= 3 && !STOP.has(w))
  )];
}

export interface CorpusCard {
  id: string;
  question: string;
  content: string;
  /** Lower-cased searchable text, built once. */
  haystack: string;
}

export interface LoadedCorpus {
  config: CorpusConfig;
  /** null when the file could not be read — the caller must fail closed, not proceed. */
  cards: CorpusCard[] | null;
  unavailable?: string;
  jurisdiction: RegExp[];
  resolvedPath: string;
  /** So a review package can say which snapshot ruled. */
  fileModified?: string;
}

function dig(obj: unknown, path: string): unknown {
  if (!path) return obj;
  return path.split('.').reduce<unknown>((o, k) => (o == null ? o : (o as Record<string, unknown>)[k]), obj);
}

function loadOne(cfg: CorpusConfig): LoadedCorpus {
  const resolvedPath = isAbsolute(cfg.path) ? cfg.path : join(ROOT, cfg.path);
  const jurisdiction = (cfg.jurisdiction ?? []).map((s) => new RegExp(s, 'i'));

  if (!existsSync(resolvedPath)) {
    return {
      config: cfg, cards: null, jurisdiction, resolvedPath,
      unavailable: `not found at ${resolvedPath}`
    };
  }

  try {
    const parsed = JSON.parse(readFileSync(resolvedPath, 'utf8'));
    const rows = dig(parsed, cfg.cardsAt);
    if (!Array.isArray(rows)) {
      return { config: cfg, cards: null, jurisdiction, resolvedPath, unavailable: `no array at "${cfg.cardsAt}"` };
    }

    const cards: CorpusCard[] = [];
    for (const r of rows as Array<Record<string, unknown>>) {
      let ok = true;
      for (const [k, v] of Object.entries(cfg.require)) {
        if (String(r[k] ?? '') !== v) { ok = false; break; }
      }
      if (!ok) continue;

      const id = String(r[cfg.fields.id] ?? '');
      const question = String(r[cfg.fields.question] ?? '');
      const content = typeof r[cfg.fields.content] === 'string'
        ? (r[cfg.fields.content] as string)
        : JSON.stringify(r[cfg.fields.content] ?? '');
      if (!id) continue;
      cards.push({ id, question, content, haystack: `${question}\n${content}`.toLowerCase() });
    }

    return {
      config: cfg, cards, jurisdiction, resolvedPath,
      fileModified: statSync(resolvedPath).mtime.toISOString()
    };
  } catch (e) {
    return {
      config: cfg, cards: null, jurisdiction, resolvedPath,
      unavailable: `unreadable (${(e as Error).message.slice(0, 120)})`
    };
  }
}

let cache: LoadedCorpus[] | null = null;

/** Every configured corpus, loaded once per process. */
export function corpora(): LoadedCorpus[] {
  if (!cache) cache = loadConfigs().map(loadOne);
  return cache;
}

/** Test seam — reload after writing a config in a temp directory. */
export function resetCorpora(): void { cache = null; }

/* ------------------------------------------------------------------ *
 * Support lookup
 * ------------------------------------------------------------------ */

export interface SupportHit {
  cardId: string;
  question: string;
  /** Claim terms this card actually contains, so a reviewer can see WHY it matched. */
  matched: string[];
  /** matched / meaningful claim terms. */
  coverage: number;
}

/**
 * How much of a claim's vocabulary a card must contain before the card counts as holding
 * material on that claim. Both conditions are required: a ratio alone lets a two-word claim
 * match on one word, and a count alone lets a long claim match on a fraction of itself.
 *
 * Sourced from `policy.ts`, where both are recorded as **provisional** — placeholders chosen
 * to be conservative, never measured for precision or recall, and not quotable as findings.
 */
export const SUPPORT_MIN_TERMS = policy.citationMinTerms.value;
export const SUPPORT_MIN_COVERAGE = policy.citationMinCoverage.value;

export function findSupport(claimText: string, c: LoadedCorpus, limit = 3): SupportHit[] {
  if (!c.cards) return [];
  const want = terms(claimText);
  if (!want.length) return [];

  const hits: SupportHit[] = [];
  for (const card of c.cards) {
    const matched = want.filter((t) => card.haystack.includes(t));
    if (matched.length < SUPPORT_MIN_TERMS) continue;
    const coverage = matched.length / want.length;
    if (coverage < SUPPORT_MIN_COVERAGE) continue;
    hits.push({ cardId: card.id, question: card.question, matched, coverage });
  }

  return hits
    .sort((a, b) => b.coverage - a.coverage || b.matched.length - a.matched.length || a.cardId.localeCompare(b.cardId))
    .slice(0, limit);
}

/** Corpora whose jurisdiction covers this claim. Empty means nobody rules on it. */
export function claimsJurisdiction(claimText: string): LoadedCorpus[] {
  return corpora().filter((c) => c.jurisdiction.some((re) => re.test(claimText)));
}

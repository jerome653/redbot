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
  /**
   * Whether this corpus has standing to ADJUDICATE, i.e. whether Argus Rules 9/10/11 may rule
   * on its jurisdiction. Defaults to true. A corpus with `rules: false` is still retrieved
   * from — it can inform drafting — it simply cannot reject anything.
   *
   * MEASURED 2026-07-27, replaying `wordpress-primary` over all 216 logged claims: 194 out of
   * jurisdiction, 6 `covered`, **16 `uncited`**. Rule 9 turns `uncited` into a REJECT, so those
   * 16 were read by hand. About five are correct kills of the HRC-001 class ("Exceeding
   * max_allowed_packet triggers the truncation condition" — the manual says the server raises
   * ER_NET_PACKET_TOO_LARGE and closes the connection). The other eleven are **true** claims
   * that simply clear no card at the 0.5 term-coverage bar: "WordPress Customize section
   * includes an Additional CSS text area", "the wp_mail_failed action hook is triggered when
   * wp_mail() fails".
   *
   * A gate that rejects more true claims than false ones is not a gate, and this pipeline has
   * published nothing — tightening it further is the opposite of the problem. So the corpus
   * ships without standing and earns it later, on evidence, once its coverage is wide enough
   * that `uncited` means "we hold the reference material and it does not say this" rather than
   * "we happen not to have that card". Flipping this to true touches a frozen surface's
   * behaviour and needs a recorded exception in ENGINE-FREEZE.md.
   */
  rules?: boolean;
  /**
   * Whether this corpus may be read FROM when drafting a public reply. Defaults to false —
   * opting in is explicit, because the cost of the wrong corpus here is a reply that drifts
   * toward whatever the corpus is about.
   *
   * The SGEN KB is deliberately not a drafting source. Its own header records why: it holds 17
   * cards mentioning WordPress and every one says SGEN does not do that thing, so retrieving
   * from it while answering a WordPress question surfaces weakly-related product cards and
   * steers the reply toward the product — the exact signal `config.brand.forbidMention` exists
   * to suppress. It keeps full standing to ADJUDICATE claims about SGEN; that is a different
   * job and it is good at it.
   */
  draftable?: boolean;
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
  },
  /**
   * Primary documentation for the handful of WordPress and MySQL subjects redbot actually
   * argues about.
   *
   * **Jurisdiction is derived from the cards, not from the domain.** That distinction is the
   * whole design. Rule 9 turns `uncited` into a REJECT, so a corpus that claimed WordPress
   * generally would put nearly every claim in jurisdiction, hold nothing on most of them, and
   * reject them — DEFECT-15 inverted, and a tighter handbrake on a pipeline that has published
   * nothing. So each pattern below names a subject this corpus holds a card on, and the corpus
   * is silent everywhere else.
   *
   * Scope was measured, not guessed: across all 216 claims in `data/certifications.jsonl` the
   * recurring technical subjects are max_allowed_packet (9), wp_options (6), admin-ajax.php (4),
   * wp_mail (3), wp-cli (3), WP_DEBUG/WP_DEBUG_LOG. Two of these cards state facts that Argus
   * derived adversarially during HRC-001 and a human reviewer missed — that error 1153 is
   * raised rather than the row silently truncated, and that Additional CSS is keyed on the
   * theme slug — but they are held here on the authority of the published sources they quote,
   * never on Argus's. Model output as ground truth is HRC-001 one level up.
   *
   * `src/test/corpus-jurisdiction.test.ts` fails if any pattern here matches no card.
   */
  {
    id: 'wordpress-primary',
    label: 'WordPress and MySQL primary documentation',
    path: 'ground-truth/corpora/wordpress-primary.json',
    cardsAt: 'cards',
    fields: { id: 'id', question: 'question', content: 'content' },
    require: { verified: 'primary' },
    // Retrieval only, for now. See `rules` on CorpusConfig for the measurement behind this.
    rules: false,
    // …but it IS the corpus drafting reads from. That is the whole point of adding it.
    draftable: true,
    jurisdiction: [
      'max_allowed_packet',
      'er_net_packet_too_large|\\berror\\s*1153\\b',
      '\\bwp_debug\\b',
      '\\bwp_mail\\b',
      'custom_css|additional css',
      '\\bmysqldump\\b'
    ],
    note:
      'Quoted primary documentation (dev.mysql.com, developer.wordpress.org). Rules only on ' +
      'the subjects it holds cards for; silent on the rest of WordPress.'
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

/* ------------------------------------------------------------------ *
 * Reference lookup — retrieval for DRAFTING, not for adjudication
 * ------------------------------------------------------------------ */

export interface ReferenceHit {
  corpusId: string;
  cardId: string;
  question: string;
  content: string;
  /** Which of the subject's terms this card contains, so the choice is explainable. */
  matched: string[];
  /** Summed rarity of the matched terms. Reported so a weak match is visible as weak. */
  score: number;
  /** The matched terms that carried the score, rarest first — the reason this card is here. */
  distinctive: string[];
}

/**
 * How much a shared term counts for, by how rare it is across the drafting corpora.
 *
 * MEASURED 2026-07-27, and the reason this exists. Ranking by raw count of shared terms put
 * four SGEN customer-support cards (GMB reviews, billing) at the top for the HRC-001 thread
 * "Custom CSS missing after Updraft restore", matching on *after*, *site*, *way*, *back*,
 * *something*. The eight primary-documentation cards that actually cover the subject did not
 * appear at all, and 56 of 58 collected threads "found a source" — a signal true 97% of the
 * time, which is DEFECT-15 exactly.
 *
 * Rarity fixes it mechanically rather than by extending the stoplist, which would have been a
 * hand-tuned list drifting out of date the moment the corpus changed. A term in most cards
 * scores near zero; `max_allowed_packet`, appearing in two cards out of eight, dominates.
 * Standard inverse document frequency, computed from the loaded cards, cached with them.
 */
let idfCache: Map<string, number> | null = null;

function idf(): Map<string, number> {
  if (idfCache) return idfCache;
  const df = new Map<string, number>();
  let n = 0;
  for (const c of draftingCorpora()) {
    for (const card of c.cards ?? []) {
      n++;
      for (const t of new Set(terms(card.haystack))) df.set(t, (df.get(t) ?? 0) + 1);
    }
  }
  const map = new Map<string, number>();
  for (const [t, d] of df) map.set(t, Math.log((n + 1) / (d + 1)));
  idfCache = map;
  return map;
}

/**
 * Minimum summed rarity before a card is worth showing.
 *
 * Chosen against the real 58-thread corpus so that "nothing relevant" stays empty — the
 * honest, common outcome for a narrow corpus — rather than always returning the four
 * least-bad cards. Recorded here as provisional: it is calibrated, not derived.
 */
export const REFERENCE_MIN_SCORE = 2.0;

/**
 * Cards worth putting in front of the drafter for a given subject.
 *
 * Deliberately NOT `findSupport`. That function answers "does this card vouch for this claim?"
 * and is tuned for a one-sentence claim: three shared terms and half the claim's vocabulary.
 * A thread title plus body plus eight comments runs to hundreds of terms, so a coverage ratio
 * over it is meaningless — every card would score near zero and retrieval would return nothing.
 *
 * This answers the weaker, different question: "is this card ABOUT something the thread is
 * about?" It ranks by how many of the subject's terms a card contains. The weaker question is
 * the honest one for drafting, because the cards are handed over as reference material a human
 * wrote — never as support for a claim, which is a judgement `findSupport` exists to make and
 * this one deliberately does not.
 *
 * Deterministic: term overlap, stable tie-break, no model call, no embedding. Same inputs, same
 * cards, every run.
 */
export function findReference(subject: string, limit = 4): ReferenceHit[] {
  const want = terms(subject);
  if (!want.length) return [];
  const weight = idf();

  const hits: ReferenceHit[] = [];
  for (const c of draftingCorpora()) {
    /**
     * The corpus only opens if the SUBJECT is inside its jurisdiction.
     *
     * MEASURED 2026-07-27. Rarity weighting alone still fired on 41 of 58 threads, and the
     * matches were nonsense: "Podcast Plugin Recommendation" pulled the max_allowed_packet
     * card on *able, allow, want*. Inverse document frequency over eight cards cannot measure
     * how common a word is in English — "able" appears in one card of eight and therefore
     * scores as rare.
     *
     * The fix is the one competence.ts already arrived at from the other direction: generic
     * vocabulary only counts when an anchor is present. The anchors are already written down
     * and already tested — they are the corpus's jurisdiction patterns, and
     * corpus-standing.test.ts proves each of them matches a real card. A thread that never
     * mentions max_allowed_packet, wp_mail, wp_debug, custom_css/Additional CSS, mysqldump or
     * error 1153 gets nothing, which for a corpus this narrow is the correct answer almost
     * every time.
     */
    if (!c.jurisdiction.some((re) => re.test(subject))) continue;

    for (const card of c.cards ?? []) {
      const matched = want.filter((t) => card.haystack.includes(t));
      // Two terms is the floor: one shared word between a card and a thread is a coincidence.
      if (matched.length < 2) continue;

      const scored = matched
        .map((t) => ({ t, w: weight.get(t) ?? 0 }))
        .sort((a, b) => b.w - a.w || a.t.localeCompare(b.t));
      const score = scored.reduce((sum, s) => sum + s.w, 0);
      // Below the floor the card is only sharing common English with the thread. Returning it
      // anyway is what made retrieval fire on 56 of 58 threads.
      if (score < REFERENCE_MIN_SCORE) continue;

      hits.push({
        corpusId: c.config.id,
        cardId: card.id,
        question: card.question,
        content: card.content,
        matched,
        score,
        distinctive: scored.filter((s) => s.w > 0).slice(0, 5).map((s) => s.t)
      });
    }
  }

  return hits
    .sort((a, b) => b.score - a.score || a.cardId.localeCompare(b.cardId))
    .slice(0, limit);
}

/**
 * Corpora whose jurisdiction covers this claim AND which have standing to rule on it. Empty
 * means nobody rules on it.
 *
 * `rules === false` is excluded here rather than inside Argus on purpose: standing is a
 * property of the corpus, and certify.ts is a frozen surface. A retrieval-only corpus is
 * invisible to Phases 9/10/11 and cannot reject, escalate, or certify anything.
 */
export function claimsJurisdiction(claimText: string): LoadedCorpus[] {
  return corpora().filter(
    (c) => c.config.rules !== false && c.jurisdiction.some((re) => re.test(claimText))
  );
}

/**
 * Every corpus that can be READ FROM, whether or not it may rule. This is the seam drafting
 * uses: a corpus with no adjudicating standing can still put a quoted primary source in front
 * of the drafter, which is the point of having one at all.
 *
 * ENGINE-FREEZE.md lists retrieval explicitly under "What is NOT frozen".
 */
export function retrievalCorpora(): LoadedCorpus[] {
  return corpora().filter((c) => c.cards !== null);
}

/**
 * The corpora a public reply may be drafted from. Opt-in via `draftable`, so adding a corpus
 * for adjudication never silently starts steering what redbot writes.
 */
export function draftingCorpora(): LoadedCorpus[] {
  return retrievalCorpora().filter((c) => c.config.draftable === true);
}

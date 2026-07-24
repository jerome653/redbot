/**
 * The subject matter redbot claims to know — as data, not as source code.
 *
 * **Why this exists.** Until now "WordPress" was welded into two places: the six strings in
 * `config.expertise` (which the drafting prompt reads) and the regex tables in
 * `competence.ts` (which the mechanical in-scope check reads). Those two lists have to agree
 * — the competence check exists precisely because the model over-claims against the
 * expertise list — and keeping two hardcoded tables in agreement is a defect waiting to
 * happen. It also meant a second subject area could not be tried without editing compiled
 * source.
 *
 * So the profile moves to `data/domain.json`, alongside `accounts.json`: configuration a
 * person writes. The built-in profile below is the WordPress one, unchanged, and it is what
 * loads when no file is present.
 *
 * **The 58-thread corpus is the only production evidence there is, and the benchmark derives
 * from it.** So the default profile must stay byte-equivalent to the hardcoded tables it
 * replaces — every pattern, every ordering quirk, every hard-won false-positive fix. There
 * is a test that asserts exactly that (`domain.test.ts`), because a silent drift here
 * invalidates the corpus without failing anything.
 *
 * **A profile is a proxy, and stays labelled as one.** Vocabulary matching cannot tell
 * whether an answer would be correct; it catches threads whose subject matter never touches
 * the declared stack at all. That is the whole claim.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA } from './config.js';

/* ------------------------------------------------------------------ *
 * Shape
 * ------------------------------------------------------------------ */

export interface DomainProfile {
  /** Short id, used in output and in the trace. */
  name: string;
  /** Human sentences describing what we can genuinely help with. Feeds the drafting prompt. */
  expertise: string[];
  /**
   * Vocabulary per declared area, as regex sources. Grouped so a thread that only mentions a
   * single generic term does not read as in-scope on that alone.
   */
  areas: Record<string, string[]>;
  /**
   * The area whose presence anchors generic infrastructure vocabulary as ours.
   *
   * Every other declared area ("hosting", "performance", "security") is really
   * "<anchor> hosting", "<anchor> performance". Read alone, that vocabulary matches any
   * deployment question — measured 2026-07-23, "Vue/Nuxt + Laravel API deployment" scored
   * 92/100 on `hosting` + `performance` alone. So when a competing platform is named, this
   * area must appear too.
   *
   * Set to null for a profile with no such centre; the competing-platform rule then only
   * disqualifies threads with no declared area at all.
   */
  anchorArea: string | null;
  /** Platforms that are emphatically not the declared stack, as regex sources. */
  otherPlatforms: string[];
  /** Minimum distinct declared areas for a thread to read as ours. */
  minAreas: number;
}

/** A compiled profile — regex sources turned into matchers exactly once, at load. */
export interface CompiledDomain {
  name: string;
  expertise: string[];
  areas: Array<{ name: string; patterns: RegExp[] }>;
  anchorArea: string | null;
  otherPlatforms: RegExp[];
  minAreas: number;
  /** Where this profile came from, so output can say so rather than imply a default is a choice. */
  source: 'built-in' | 'data/domain.json';
}

/* ------------------------------------------------------------------ *
 * The built-in profile — WordPress, exactly as it was hardcoded
 *
 * Every comment below records a false positive that was measured, not imagined. Deleting one
 * costs a candidate; the notes stay with the patterns so a future edit knows what it is
 * undoing.
 * ------------------------------------------------------------------ */

export const WORDPRESS_PROFILE: DomainProfile = {
  name: 'wordpress',

  expertise: [
    'WordPress core, themes and plugin conflicts',
    'site performance, caching and database load',
    'hosting, deployment and migrations',
    'security cleanup after a compromise',
    'WooCommerce and scaling an e-commerce build',
    'page builders and why they misbehave'
  ],

  areas: {
    wordpress: [
      '\\bwordpress\\b', '\\bwp[-_](?:admin|config|content|cli|json)\\b', '\\bwp\\b',
      '\\bgutenberg\\b', '\\bpermalink', '\\bshortcode', '\\bwp[-_]?cron\\b',
      '\\bacf\\b|advanced custom fields', '\\byoast\\b', '\\bmultisite\\b', '\\bwoocommerce\\b'
    ],
    pluginsThemes: [
      '\\bplugins?\\b',
      // "theme tokens" and "theme color" are CSS vocabulary, not WordPress themes. Measured
      // 2026-07-23: a Safari CSS thread read as in-scope on "theme tokens" alone.
      '\\bthemes?\\b(?![- ](?:token|colou?r|switch))',
      '\\bchild theme\\b', '\\bpage builder',
      '\\belementor\\b', '\\bdivi\\b', '\\bbeaver builder\\b', '\\bbricks\\b'
    ],
    performance: [
      '\\bcach(?:e|ing)\\b', '\\bttfb\\b', '\\bcore web vitals\\b', '\\bpage ?speed\\b',
      '\\bopcache\\b', '\\bredis\\b', '\\bmemcached\\b', '\\bcdn\\b',
      '\\bslow(?:ing|ness)?\\b', '\\bquery (?:time|performance|monitor)\\b', '\\bdatabase\\b', '\\bmysql\\b'
    ],
    hosting: [
      '\\bhosting\\b', '\\bcpanel\\b', '\\bnginx\\b', '\\bapache\\b', '\\bphp[-_]fpm\\b',
      '\\bstaging\\b', '\\bmigrat(?:e|ion|ing)\\b', '\\bbackups?\\b', '\\bsftp?\\b',
      '\\bssl\\b', '\\bdns\\b', '\\bserver\\b', '\\b50[023]\\b', '\\bhtaccess\\b'
    ],
    security: [
      '\\bmalware\\b', '\\bhacked\\b', '\\bbackdoor\\b',
      // "the best compromise" is ordinary English. Only the past participle carries the
      // security sense, and it cost a false positive to learn that.
      '\\bcompromised\\b',
      '\\bbrute[- ]force\\b', '\\bfirewall\\b', '\\bwordfence\\b', '\\bsucuri\\b', '\\bsql injection\\b'
    ],
    ecommerce: [
      '\\bwoocommerce\\b', '\\bcheckout\\b', '\\bshopping cart\\b',
      // Bare "order" and "product" are among the most common words in English — "rendering
      // order" scored a CSS thread as e-commerce. Only the compound forms mean the shop.
      '\\border (?:id|number|status|total|confirmation|email)\\b',
      '\\bproduct (?:page|catalogue|catalog|variations?|import|feed|grid)\\b',
      '\\bstripe\\b', '\\bpaypal\\b'
    ]
  },

  anchorArea: 'wordpress',

  otherPlatforms: [
    '\\bshopify\\b', '\\bliquid\\b', '\\bwix\\b', '\\bsquarespace\\b', '\\bwebflow\\b',
    '\\bdrupal\\b', '\\bjoomla\\b', '\\bghost\\b', '\\bnext\\.?js\\b', '\\breact\\b',
    '\\bvue\\b', '\\bsvelte\\b', '\\bdjango\\b', '\\brails\\b', '\\blaravel\\b'
  ],

  /**
   * A single area was originally enough when no competing platform was named. Measured
   * 2026-07-23: that let a CSS-in-JS class-naming thread through on the word "cache".
   * One shared word is a coincidence; two is a subject.
   */
  minAreas: 2
};

/* ------------------------------------------------------------------ *
 * Loading
 * ------------------------------------------------------------------ */

export class DomainProfileError extends Error {}

export const domainPath = join(DATA, 'domain.json');

/**
 * Validate before compiling. A malformed profile is an error, never a silent fallback to the
 * built-in one — a person who wrote `data/domain.json` and got WordPress behaviour anyway
 * would have no way to tell.
 */
export function validateProfile(raw: unknown, where: string): DomainProfile {
  const fail = (m: string): never => { throw new DomainProfileError(`${where}: ${m}`); };

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('must be a JSON object');
  const p = raw as Record<string, unknown>;

  if (typeof p.name !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,31}$/i.test(p.name)) {
    fail('name must be a short identifier (letters, digits, dot, dash, underscore)');
  }

  if (!Array.isArray(p.expertise) || !p.expertise.length ||
      !p.expertise.every((e) => typeof e === 'string' && e.trim())) {
    fail('expertise must be a non-empty array of non-empty strings');
  }

  if (!p.areas || typeof p.areas !== 'object' || Array.isArray(p.areas)) fail('areas must be an object');
  const areas = p.areas as Record<string, unknown>;
  const areaNames = Object.keys(areas);
  if (!areaNames.length) fail('areas must declare at least one area');
  for (const [name, patterns] of Object.entries(areas) as Array<[string, unknown[]]>) {
    if (!Array.isArray(patterns) || !patterns.length) fail(`area "${name}" must list at least one pattern`);
    for (const src of patterns) {
      if (typeof src !== 'string' || !src.trim()) fail(`area "${name}" has a non-string pattern`);
      try { new RegExp(src as string, 'i'); }
      catch (e) { fail(`area "${name}" pattern ${JSON.stringify(src)} is not a valid regex: ${(e as Error).message}`); }
    }
  }

  if (p.anchorArea !== null && typeof p.anchorArea !== 'string') fail('anchorArea must be an area name or null');
  if (typeof p.anchorArea === 'string' && !areaNames.includes(p.anchorArea)) {
    fail(`anchorArea "${p.anchorArea}" is not one of the declared areas (${areaNames.join(', ')})`);
  }

  if (!Array.isArray(p.otherPlatforms)) fail('otherPlatforms must be an array (it may be empty)');
  for (const src of p.otherPlatforms as unknown[]) {
    if (typeof src !== 'string' || !src.trim()) fail('otherPlatforms has a non-string pattern');
    try { new RegExp(src as string, 'i'); }
    catch (e) { fail(`otherPlatforms pattern ${JSON.stringify(src)} is not a valid regex: ${(e as Error).message}`); }
  }

  if (typeof p.minAreas !== 'number' || !Number.isInteger(p.minAreas) || p.minAreas < 1) {
    fail('minAreas must be a positive integer');
  }

  return p as unknown as DomainProfile;
}

export function compileProfile(p: DomainProfile, source: CompiledDomain['source']): CompiledDomain {
  return {
    name: p.name,
    expertise: p.expertise,
    areas: Object.entries(p.areas).map(([name, patterns]) => ({
      name,
      patterns: patterns.map((src) => new RegExp(src, 'i'))
    })),
    anchorArea: p.anchorArea,
    otherPlatforms: p.otherPlatforms.map((src) => new RegExp(src, 'i')),
    minAreas: p.minAreas,
    source
  };
}

function load(): CompiledDomain {
  if (!existsSync(domainPath)) return compileProfile(WORDPRESS_PROFILE, 'built-in');

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(domainPath, 'utf8'));
  } catch (e) {
    throw new DomainProfileError(
      `data/domain.json is not readable JSON (${(e as Error).message}). Fix it or delete it to fall back to the built-in ${WORDPRESS_PROFILE.name} profile.`
    );
  }

  // `_doc` and `_note` keys are conventional in this project's data files; strip nothing else.
  return compileProfile(validateProfile(raw, 'data/domain.json'), 'data/domain.json');
}

/** The active profile. Loaded once — a profile that changed mid-run would split a corpus. */
export const domain: CompiledDomain = load();

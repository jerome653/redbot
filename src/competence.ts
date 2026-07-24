/**
 * Is this thread inside the competence we actually claim?
 *
 * **Why this exists.** The gap analyzer returns a `fillable` flag per gap, meaning "someone
 * with the declared competence could close this". Measured on the first real run
 * (2026-07-23): **65 of 67 gaps came back fillable — 97%.** Threads about Shopify Liquid
 * architecture, an unspecified "MCP-Server", and generic webhook de-duplication were all
 * marked fillable against a competence list that is entirely WordPress, hosting, performance,
 * security and WooCommerce.
 *
 * A flag that is true 97% of the time is not a filter. And it cannot be fixed by rewording the
 * prompt — the same lesson as DEFECT-12: a judgement a model is asked to make is a judgement
 * it can skip, so the check has to be made of something the model does not control.
 *
 * So this module asks a narrower question that IS mechanical: does the thread's own text use
 * the vocabulary of the areas we claim? It cannot tell whether an answer would be correct. It
 * reliably catches the case observed above — a thread whose subject matter never touches the
 * declared stack at all.
 *
 * **This is a proxy and is labelled as one wherever it surfaces.** A WordPress question that
 * happens to use none of these words will be scored out; that costs one candidate. A reply
 * posted confidently outside our competence costs credibility, which is the expensive one.
 *
 * **The vocabulary itself now lives in `domain.ts`** — as data, so a second subject area does
 * not require editing this file. The rules below are subject-independent; only the word lists
 * and the anchor area change per profile. The built-in profile is the WordPress one this
 * module was written against, so the 58-thread corpus still measures the same thing.
 */
import { domain } from './domain.js';
import type { CompiledDomain } from './domain.js';

export interface CompetenceResult {
  /** Distinct declared areas the thread's vocabulary touches. */
  areas: string[];
  /** Non-declared platforms named in the thread. */
  otherPlatforms: string[];
  /** areas.length >= MIN_AREAS, or the anchor rule below. */
  inScope: boolean;
  detail: string;
}

/** Minimum distinct declared areas for a thread to read as ours. Set by the active profile. */
export const MIN_AREAS = domain.minAreas;

/** Assess against the active profile. This is what the pipeline calls. */
export function assessCompetence(text: string): CompetenceResult {
  return assessCompetenceWith(text, domain);
}

/**
 * Assess against an explicitly supplied profile.
 *
 * Exists so the rules can be tested against more than one profile without the test having to
 * mutate a module-level singleton — a profile that could change mid-process would split a
 * corpus, so `domain` is deliberately loaded once and never reassigned.
 */
export function assessCompetenceWith(text: string, profile: CompiledDomain): CompetenceResult {
  const domain = profile;

  const areas = domain.areas
    .filter(({ patterns }) => patterns.some((re) => re.test(text)))
    .map(({ name }) => name);

  const otherPlatforms = domain.otherPlatforms
    .filter((re) => re.test(text))
    .map((re) => re.source.replace(/\\b|\\\.|\?/g, '').replace(/[()]/g, ''));

  let inScope: boolean;
  let detail: string;

  /**
   * Every non-anchor area in a profile is really "<anchor> hosting", "<anchor> performance",
   * "<anchor> security". Read on their own, their vocabulary is generic enough that any
   * deployment question matches it.
   *
   * Measured 2026-07-23: "Vue/Nuxt + Laravel API deployment" scored 92/100 and was assessed
   * "contribute" on `hosting` + `performance` alone. So when a thread names a competing
   * platform, the anchor area is required before its generic infrastructure vocabulary counts
   * as ours. A profile with `anchorArea: null` declares that it has no such centre, and then
   * a competing platform only disqualifies a thread with no declared area at all.
   */
  const anchored = domain.anchorArea === null || areas.includes(domain.anchorArea);

  if (otherPlatforms.length && !anchored) {
    inScope = false;
    detail =
      `names ${otherPlatforms.join(', ')} with no ${domain.anchorArea} anchor — ` +
      `${areas.length ? `the ${areas.join('/')} vocabulary here is generic infrastructure, not ours` : 'nothing of ours in it'}`;
  } else if (areas.length >= domain.minAreas) {
    inScope = true;
    detail = `touches ${areas.length} declared areas (${areas.join(', ')})`;
    if (otherPlatforms.length) detail += `; also names ${otherPlatforms.join(', ')}, anchored by ${domain.anchorArea}`;
  } else if (areas.length >= 1) {
    // A single area was originally enough when no competing platform was named. Measured
    // 2026-07-23: that let a CSS-in-JS class-naming thread through on the word "cache".
    // One shared word is a coincidence; two is a subject.
    inScope = false;
    detail = otherPlatforms.length
      ? `only ${areas.length} declared area (${areas.join(', ')}) against ${otherPlatforms.join(', ')} — this is a ${otherPlatforms[0]} question`
      : `only ${areas.length} declared area (${areas.join(', ')}) — one shared word is a coincidence, not a subject`;
  } else {
    inScope = false;
    detail = otherPlatforms.length
      ? `no declared area; the subject is ${otherPlatforms.join(', ')}`
      : 'the thread uses none of the vocabulary of the declared areas';
  }

  return { areas, otherPlatforms, inScope, detail };
}

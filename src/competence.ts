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
 */

/**
 * Vocabulary of the declared areas in config.expertise. Grouped so a thread that only mentions
 * a single generic term ("php") does not read as in-scope on that alone.
 */
const AREAS: Record<string, RegExp[]> = {
  wordpress: [
    /\bwordpress\b/i, /\bwp[-_](?:admin|config|content|cli|json)\b/i, /\bwp\b/i,
    /\bgutenberg\b/i, /\bpermalink/i, /\bshortcode/i, /\bwp[-_]?cron\b/i,
    /\bacf\b|advanced custom fields/i, /\byoast\b/i, /\bmultisite\b/i, /\bwoocommerce\b/i
  ],
  pluginsThemes: [
    /\bplugins?\b/i,
    // "theme tokens" and "theme color" are CSS vocabulary, not WordPress themes. Measured
    // 2026-07-23: a Safari CSS thread read as in-scope on "theme tokens" alone.
    /\bthemes?\b(?![- ](?:token|colou?r|switch))/i,
    /\bchild theme\b/i, /\bpage builder/i,
    /\belementor\b/i, /\bdivi\b/i, /\bbeaver builder\b/i, /\bbricks\b/i
  ],
  performance: [
    /\bcach(?:e|ing)\b/i, /\bttfb\b/i, /\bcore web vitals\b/i, /\bpage ?speed\b/i,
    /\bopcache\b/i, /\bredis\b/i, /\bmemcached\b/i, /\bcdn\b/i,
    /\bslow(?:ing|ness)?\b/i, /\bquery (?:time|performance|monitor)\b/i, /\bdatabase\b/i, /\bmysql\b/i
  ],
  hosting: [
    /\bhosting\b/i, /\bcpanel\b/i, /\bnginx\b/i, /\bapache\b/i, /\bphp[-_]fpm\b/i,
    /\bstaging\b/i, /\bmigrat(?:e|ion|ing)\b/i, /\bbackups?\b/i, /\bsftp?\b/i,
    /\bssl\b/i, /\bdns\b/i, /\bserver\b/i, /\b50[023]\b/i, /\bhtaccess\b/i
  ],
  security: [
    /\bmalware\b/i, /\bhacked\b/i, /\bbackdoor\b/i,
    // "the best compromise" is ordinary English. Only the past participle carries the
    // security sense, and it cost a false positive to learn that.
    /\bcompromised\b/i,
    /\bbrute[- ]force\b/i, /\bfirewall\b/i, /\bwordfence\b/i, /\bsucuri\b/i, /\bsql injection\b/i
  ],
  ecommerce: [
    /\bwoocommerce\b/i, /\bcheckout\b/i, /\bshopping cart\b/i,
    // Bare "order" and "product" are among the most common words in English — "rendering
    // order" scored a CSS thread as e-commerce. Only the compound forms mean the shop.
    /\border (?:id|number|status|total|confirmation|email)\b/i,
    /\bproduct (?:page|catalogue|catalog|variations?|import|feed|grid)\b/i,
    /\bstripe\b/i, /\bpaypal\b/i
  ]
};

/**
 * Platforms that are emphatically NOT the declared stack. Their presence does not disqualify
 * on its own — a WordPress thread may mention migrating from Wix — but a thread that names one
 * of these and nothing from the areas above is somebody else's question.
 */
const OTHER_PLATFORMS = [
  /\bshopify\b/i, /\bliquid\b/i, /\bwix\b/i, /\bsquarespace\b/i, /\bwebflow\b/i,
  /\bdrupal\b/i, /\bjoomla\b/i, /\bghost\b/i, /\bnext\.?js\b/i, /\breact\b/i,
  /\bvue\b/i, /\bsvelte\b/i, /\bdjango\b/i, /\brails\b/i, /\blaravel\b/i
];

export interface CompetenceResult {
  /** Distinct declared areas the thread's vocabulary touches. */
  areas: string[];
  /** Non-declared platforms named in the thread. */
  otherPlatforms: string[];
  /** areas.length >= 2, or 1 area with no competing platform. */
  inScope: boolean;
  detail: string;
}

/** Minimum distinct declared areas for a thread to read as ours. */
export const MIN_AREAS = 2;

export function assessCompetence(text: string): CompetenceResult {
  const areas = Object.entries(AREAS)
    .filter(([, patterns]) => patterns.some((re) => re.test(text)))
    .map(([name]) => name);

  const otherPlatforms = OTHER_PLATFORMS
    .filter((re) => re.test(text))
    .map((re) => re.source.replace(/\\b|\\\.|\?/g, '').replace(/[()]/g, ''));

  let inScope: boolean;
  let detail: string;

  /**
   * Every area in config.expertise is WordPress-centric — "hosting", "performance" and
   * "security" mean WordPress hosting, WordPress performance, WordPress security. Read on
   * their own, their vocabulary is generic enough that any deployment question matches it.
   *
   * Measured 2026-07-23: "Vue/Nuxt + Laravel API deployment" scored 92/100 and was assessed
   * "contribute" on `hosting` + `performance` alone. So when a thread names a competing
   * platform, a WordPress anchor is required before its generic infrastructure vocabulary
   * counts as ours.
   */
  const wordpressAnchor = areas.includes('wordpress');

  if (otherPlatforms.length && !wordpressAnchor) {
    inScope = false;
    detail =
      `names ${otherPlatforms.join(', ')} with no WordPress anchor — ` +
      `${areas.length ? `the ${areas.join('/')} vocabulary here is generic infrastructure, not ours` : 'nothing of ours in it'}`;
  } else if (areas.length >= MIN_AREAS) {
    inScope = true;
    detail = `touches ${areas.length} declared areas (${areas.join(', ')})`;
    if (otherPlatforms.length) detail += `; also names ${otherPlatforms.join(', ')}, anchored by WordPress`;
  } else if (areas.length === 1) {
    // A single area was originally enough when no competing platform was named. Measured
    // 2026-07-23: that let a CSS-in-JS class-naming thread through on the word "cache".
    // One shared word is a coincidence; two is a subject.
    inScope = false;
    detail = otherPlatforms.length
      ? `only one declared area (${areas[0]}) against ${otherPlatforms.join(', ')} — this is a ${otherPlatforms[0]} question`
      : `only one declared area (${areas[0]}) — one shared word is a coincidence, not a subject`;
  } else {
    inScope = false;
    detail = otherPlatforms.length
      ? `no declared area; the subject is ${otherPlatforms.join(', ')}`
      : 'the thread uses none of the vocabulary of the declared areas';
  }

  return { areas, otherPlatforms, inScope, detail };
}

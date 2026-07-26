/**
 * Part C — reply quality.
 *
 * src/disclosure.ts is the SAFETY gate: it answers "would posting this embarrass or expose
 * the operator?" This module is the CRAFT gate: it answers "is this a reply a competent
 * engineer would willingly post under their own name?"
 *
 * They are deliberately separate. Safety failures are absolute — a leaked path or a brand
 * mention is wrong regardless of how good the answer is. Craft failures are about whether
 * the reply earns its place in the thread.
 *
 * **What a mechanical check can and cannot do.** It cannot judge technical correctness, and
 * it cannot confirm that the reply answers the question that was actually asked. Anything
 * claiming otherwise is measuring word patterns and calling it comprehension. So this module
 * checks what is genuinely checkable — specificity, length, register, hedging, clichés — and
 * returns an explicit `humanChecklist` of what remains for the person approving it. The
 * approval prompt prints that list rather than implying the machine already decided.
 */
import type { Thread } from './types.js';
import { assessClaims } from './claims.js';

export type Severity = 'block' | 'warn';

export interface QualityIssue {
  severity: Severity;
  code: string;
  message: string;
}

export interface QualityMetrics {
  words: number;
  sentences: number;
  avgSentenceWords: number;
  /** Uniform sentence length is a stronger machine tell than any single phrase. */
  sentenceLengthSpread: number;
  /** Concrete tokens from the thread that reappear in the reply. */
  specificityHits: number;
  technicalHits: number;
  hedges: number;
  cliches: string[];
  secondPerson: number;
  headings: number;
  boldSpans: number;
}

export interface QualityReport {
  ok: boolean;
  issues: QualityIssue[];
  metrics: QualityMetrics;
  /** Judgements no regex can make. Printed at the approval prompt, unanswered by the machine. */
  humanChecklist: string[];
}

/**
 * Phrases that mark text as machine-written to a reader who reads a lot of it. Kept to
 * strong signals — a list that flags ordinary English produces warnings people learn to
 * ignore, which is worse than no list.
 */
const CLICHES: Array<[RegExp, string]> = [
  [/\bdelve\s+into\b/i, 'delve into'],
  [/\bit(?:'s| is) worth noting\b/i, "it's worth noting"],
  [/\bin today'?s\s+\w+\s+(?:landscape|world|environment)\b/i, "in today's … landscape"],
  [/\bnavigat(?:e|ing) the complexit/i, 'navigating the complexities'],
  [/\ba robust\s+(?:solution|approach|framework)\b/i, 'a robust solution'],
  [/\bleverag(?:e|ing)\b/i, 'leverage (as a verb)'],
  [/\bseamless(?:ly)?\b/i, 'seamless'],
  [/\bgame[- ]chang(?:er|ing)\b/i, 'game-changer'],
  [/\bunlock(?:ing)? the (?:power|potential)\b/i, 'unlock the potential'],
  [/\belevate your\b/i, 'elevate your'],
  [/\ba testament to\b/i, 'a testament to'],
  [/\bat the end of the day\b/i, 'at the end of the day'],
  [/\bgreat question\b/i, 'great question'],
  [/\byou'?re not alone\b/i, "you're not alone"],
  [/\blet'?s dive in\b/i, "let's dive in"],
  [/\bin conclusion\b/i, 'in conclusion'],
  [/\bfirst and foremost\b/i, 'first and foremost'],
  [/\bthe key (?:is|here is) to\b/i, 'the key is to'],
  [/\bI hope (?:this|that) (?:helps|answers)\b/i, 'I hope this helps'],
  [/\bhappy (?:to help|hunting|coding)\b/i, 'happy to help/hunting/coding'],
  [/\bbest of luck\b/i, 'best of luck']
];

/** Words that add length without adding information. */
const PADDING: Array<[RegExp, string]> = [
  [/\bit(?:'s| is) important to (?:note|remember|understand)\b/i, "it's important to note"],
  [/\bas (?:I |we )?mentioned (?:above|earlier)\b/i, 'as mentioned above'],
  [/\bin order to\b/i, 'in order to → to'],
  [/\bdue to the fact that\b/i, 'due to the fact that → because'],
  [/\bthere are (?:a number|several|many) of\b/i, 'there are several …'],
  [/\bthat (?:being |having been )?said\b.*\bhowever\b/i, 'stacked hedge connectives']
];

/** Marks of stated uncertainty. Their absence matters only when the triage was unsure. */
const HEDGES: RegExp[] = [
  /\b(?:likely|probably|usually|typically|often|generally|in most cases)\b/i,
  /\bI(?:'d| would) (?:check|start|look|try|guess)\b/i,
  /\b(?:might|may|could) be\b/i,
  /\bworth checking\b/i,
  /\bif (?:that(?:'s| is) not it|it isn'?t)\b/i,
  /\bcan'?t tell (?:from|without)\b/i,
  /\bdepends on\b/i,
  /\bmy guess\b/i
];

const STOPWORDS = new Set([
  'about','after','again','against','also','because','been','before','being','below','between','both',
  'cannot','could','does','doing','down','during','each','error','even','ever','every','from','further',
  'get','getting','goes','going','have','having','help','here','hers','herself','himself','into','issue',
  'itself','just','keep','know','like','look','made','make','many','more','most','much','must','need',
  'only','other','ours','ourselves','out','over','own','page','post','really','same','see','should',
  'since','site','some','still','such','than','that','their','theirs','them','themselves','then','there',
  'these','they','thing','things','this','those','through','time','tried','try','under','until','using',
  'very','want','was','way','well','were','what','when','where','which','while','who','whom','why','will',
  'with','without','work','working','would','your','yours','yourself','anyone','someone','something',
  'please','thanks','thank','anybody','everything','wordpress','website','websites','problem','problems'
]);

const TOKEN = /[A-Za-z0-9_][A-Za-z0-9_.\-/]{2,}/g;

/** Looks like a thing rather than a word: has a digit, a dot, a slash, a dash or an underscore. */
function isTechnical(tok: string): boolean {
  return /[0-9]/.test(tok) || /[._\-/]/.test(tok);
}

function tokens(text: string): string[] {
  return (text.toLowerCase().match(TOKEN) ?? [])
    // Trailing punctuation is part of the sentence, not the token. Without this,
    // "admin-ajax.php." in the question and "admin-ajax.php" in the answer are two
    // different strings and the specificity check reads a precise reply as generic.
    .map((t) => t.replace(/[.\-/]+$/, ''))
    .filter((t) => t.length >= 4 && !STOPWORDS.has(t));
}

function sentencesOf(body: string): string[] {
  return body
    .replace(/```[\s\S]*?```/g, ' ')          // code blocks are not prose
    .split(/(?<=[.!?])\s+|\n{2,}/)
    .map((s) => s.trim())
    .filter((s) => s.split(/\s+/).length > 1);
}

export interface QualityContext {
  thread?: Pick<Thread, 'title' | 'body' | 'comments'> | undefined;
}

export function assessQuality(body: string, ctx: QualityContext = {}): QualityReport {
  const issues: QualityIssue[] = [];
  const prose = body.replace(/```[\s\S]*?```/g, ' ');
  const words = prose.trim().split(/\s+/).filter(Boolean).length;
  const sentences = sentencesOf(body);
  const lengths = sentences.map((s) => s.split(/\s+/).length);
  const avg = lengths.length ? lengths.reduce((a, b) => a + b, 0) / lengths.length : 0;
  const spread = lengths.length > 1
    ? Math.sqrt(lengths.reduce((s, l) => s + (l - avg) ** 2, 0) / lengths.length)
    : 0;

  /* ---- clichés ---- */
  const cliches = CLICHES.filter(([re]) => re.test(body)).map(([, name]) => name);
  for (const c of cliches) {
    issues.push({ severity: 'block', code: 'cliche', message: `AI-register phrase: "${c}"` });
  }

  /* ---- padding ---- */
  for (const [re, name] of PADDING) {
    if (re.test(body)) issues.push({ severity: 'warn', code: 'padding', message: `padding: ${name}` });
  }

  /* ---- specificity: does the reply engage with THIS thread ---- */
  let specificityHits = 0;
  let technicalHits = 0;
  if (ctx.thread) {
    const threadText = [ctx.thread.title, ctx.thread.body ?? '', ...ctx.thread.comments.map((c) => c.body)].join(' ');
    const threadTokens = new Set(tokens(threadText));
    const replyTokens = new Set(tokens(body));
    for (const t of replyTokens) {
      if (!threadTokens.has(t)) continue;
      specificityHits++;
      if (isTechnical(t)) technicalHits++;
    }
    // A reply that shares no concrete vocabulary with the thread is a generic answer wearing
    // the thread as a hat. One technical token, or three plain ones, is the floor.
    if (technicalHits === 0 && specificityHits < 3) {
      issues.push({
        severity: 'block',
        code: 'generic',
        message:
          `reply shares almost no specific vocabulary with the thread ` +
          `(${specificityHits} overlapping terms, ${technicalHits} technical) — it reads as a generic answer`
      });
    }
  }

  /* ---- length ---- */
  if (words > 500) {
    issues.push({ severity: 'block', code: 'too-long', message: `${words} words — past what anyone reads in a comment; cut it` });
  } else if (words > 350) {
    issues.push({ severity: 'warn', code: 'long', message: `${words} words — long for a comment, check nothing is padding` });
  }
  if (words < 25) {
    issues.push({ severity: 'block', code: 'too-short', message: `${words} words — too thin to be worth posting` });
  }

  /* ---- claim budget ---- */
  /**
   * How much unverified certainty this reply puts in public.
   *
   * This is the one gate that deliberately disagrees with the rest of the module. Everything
   * else here rewards specificity and confident, concrete prose, because that is what a good
   * reply reads like. But specificity about how software behaves is exactly what nothing in
   * this pipeline can verify, and it is where HRC-001 went wrong: fluent, specific, correctly
   * hedged in register, and false.
   *
   * **Warn only, deliberately.** It was written as a block-at-double-budget gate and the
   * measurement retired that before it shipped: across all 12 real drafts the highest unhedged
   * count is 2 against a budget of 4, so the block could never fire, and the one real failure
   * on record (HRC-001) was *hedged* and false — a certainty budget is not a truth check. A
   * provisional number with nothing behind it does not get to refuse a publish on a pipeline
   * whose defect is that it has never published anything.
   */
  const claims = assessClaims(body);
  if (claims.overBudget) {
    issues.push({
      severity: 'warn',
      code: 'claim-budget',
      message:
        `${claims.unhedged.length} unhedged claims about how software behaves (budget ${claims.budget}) — ` +
        `each is something you would have to defend under your own name: ` +
        `"${claims.unhedged[0]!.text.slice(0, 60)}…"`
    });
  }

  /* ---- register ---- */
  const secondPerson = (body.match(/\byou(?:'re|r|rs)?\b/gi) ?? []).length;
  if (secondPerson === 0 && words > 60) {
    issues.push({
      severity: 'warn',
      code: 'impersonal',
      message: 'never addresses the person who asked — reads as an article, not a reply'
    });
  }

  const headings = (body.match(/^#{1,6}\s/gm) ?? []).length;
  const boldSpans = (body.match(/\*\*[^*]+\*\*/g) ?? []).length;
  if (headings > 0) {
    issues.push({ severity: 'warn', code: 'document-formatting', message: `${headings} markdown heading(s) — comments do not have headings` });
  }
  if (boldSpans > 3) {
    issues.push({ severity: 'warn', code: 'bold-heavy', message: `${boldSpans} bold spans — reads as a formatted document` });
  }

  if (lengths.length >= 4 && spread < 2.5) {
    issues.push({
      severity: 'warn',
      code: 'uniform-rhythm',
      message: `every sentence is nearly the same length (spread ${spread.toFixed(1)} words) — the flattest machine tell there is`
    });
  }

  /**
   * Hedges are counted and reported, but no longer gate.
   *
   * RETIRED 2026-07-23 with the Phase-1 path (D-01). The `false-certainty` block fired when
   * triage confidence was under 70 and the reply hedged nothing. Its only input was the model's
   * self-reported confidence in its own reading of a title — the field DEFECT-12 returned as 90
   * for a post its own rubric scores 5. A gate keyed to that measures the model's mood.
   *
   * The failure it aimed at — prose more certain than the evidence behind it — is Argus Phase 8
   * (`src/argus/epistemic.ts`), which compares each claim's language against the certainty its
   * provenance supports and computes the verdict in code. That check has fired in production;
   * this one never did.
   */
  const hedges = HEDGES.filter((re) => re.test(body)).length;

  const metrics: QualityMetrics = {
    words,
    sentences: sentences.length,
    avgSentenceWords: Number(avg.toFixed(1)),
    sentenceLengthSpread: Number(spread.toFixed(1)),
    specificityHits,
    technicalHits,
    hedges,
    cliches,
    secondPerson,
    headings,
    boldSpans
  };

  return {
    ok: !issues.some((i) => i.severity === 'block'),
    issues,
    metrics,
    humanChecklist: [
      'Is it technically correct? No mechanical check can tell you this.',
      'Does it answer the question that was actually asked, not an adjacent one?',
      'Would you post it under your own account, to people who know the subject?',
      'If it is wrong, is it wrong in a way you could defend as a reasonable read?'
    ]
  };
}

/**
 * Phase 3 deliverables, generated from the files on disk.
 *
 * Written by a program rather than by hand for one reason: a hand-written report can round a
 * number, and a generated one cannot. Where there is no data the report says so with the
 * sample size attached — `no data (0 samples)`, never a percentage over an empty set.
 *
 * Reports are rewritten in place on every run, so the file on disk always matches the data.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './config.js';
import { loadThreads, loadGaps, loadAssessments, loadDrafts } from './store.js';
import {
  loadReviews, summarizeReviews, REJECT_REASONS, EDIT_REASONS, APPROVE_REASONS, reviewsPath,
  loadRegrets, summarizeRegret
} from './review.js';
import { loadObservations } from './health.js';
import { assessQuality } from './quality.js';
import { MIN_OPPORTUNITY_SCORE } from './opportunity.js';
import { RESTATES } from './novelty.js';
import { prefilter } from './commands/opportunity.js';
import type { GapAnalysis } from './types.js';

export const reportsDir = join(ROOT, 'reports');

const pct = (n: number, d: number): string =>
  d === 0 ? 'no data (0 samples)' : `${n}/${d} (${Math.round((n / d) * 100)}%)`;

const stamp = (): string => new Date().toISOString().slice(0, 10);

function write(name: string, body: string): string {
  mkdirSync(reportsDir, { recursive: true });
  const path = join(reportsDir, name);
  writeFileSync(path, body, 'utf8');
  return path;
}

/* ------------------------------------------------------------------ */

export function opportunityReport(): string {
  const threads = loadThreads();
  const { keep, dropped } = prefilter(threads);
  const assessments = loadAssessments();
  const contribute = assessments.filter((a) => a.verdict === 'contribute');

  const dropReasons = new Map<string, number>();
  for (const d of dropped) {
    const key = /past the/.test(d.why) ? 'thread too old'
      : /outside the pilot set/.test(d.why) ? 'subreddit outside the pilot set'
      : /age unknown/.test(d.why) ? 'age could not be established'
      : 'nothing is being asked';
    dropReasons.set(key, (dropReasons.get(key) ?? 0) + 1);
  }

  const rows = assessments
    .slice()
    .sort((a, b) => b.score - a.score)
    .map((a) => `| ${a.score} | ${a.verdict} | ${a.title.replace(/\|/g, '\\|').slice(0, 58)} | ${a.reasons[0]?.replace(/\|/g, '\\|').slice(0, 88) ?? ''} |`)
    .join('\n');

  return write('opportunity-report.md', `# Opportunity Report

**Generated:** ${stamp()} · **Corpus:** ${threads.length} collected threads

The Opportunity Engine decides where a knowledgeable person could add something. It is
mechanical over the gap analysis — no model chooses this score.

## Funnel

| Stage | Count | |
|---|---|---|
| Collected | ${threads.length} | every thread on disk |
| Passed the mechanical prefilter | ${keep.length} | ${pct(keep.length, threads.length)} |
| Assessed (gap analysis run) | ${assessments.length} | a model call each |
| **Worth contributing to** | **${contribute.length}** | ${pct(contribute.length, assessments.length)} of assessed · floor ${MIN_OPPORTUNITY_SCORE}/100 |

### Why threads were dropped before costing a model call

${dropReasons.size
  ? [...dropReasons.entries()].sort((a, b) => b[1] - a[1]).map(([why, n]) => `- **${n}** — ${why}`).join('\n')
  : '- none dropped'}

The prefilter exists so a model call is never spent re-discovering something already on disk.

## Every assessed thread

| Score | Verdict | Thread | Leading reason |
|---|---|---|---|
${rows || '| — | — | nothing assessed | — |'}

## Reading this

A low contribution rate is the expected result, not a fault. The bar is "a knowledgeable
person could add something a stranger would be glad to read". Most threads do not clear it,
and a system that found an opportunity everywhere would have found none.
`);
}

/* ------------------------------------------------------------------ */

export function knowledgeGapReport(): string {
  const gaps = loadGaps();
  const kinds = new Map<string, number>();
  let fillable = 0;
  let answered = 0;

  for (const g of gaps) {
    if (g.alreadyAnswered) answered++;
    for (const gap of g.gaps) {
      kinds.set(gap.kind, (kinds.get(gap.kind) ?? 0) + 1);
      if (gap.fillable) fillable++;
    }
  }

  const totalGaps = [...kinds.values()].reduce((a, b) => a + b, 0);
  const meanCovered = gaps.length
    ? (gaps.reduce((s, g) => s + g.covered.length, 0) / gaps.length).toFixed(1)
    : 'no data';
  const meanHeadroom = gaps.length
    ? Math.round(gaps.reduce((s, g) => s + g.headroom, 0) / gaps.length)
    : null;

  const detail = (g: GapAnalysis): string => `### ${g.title.slice(0, 74)}

\`${g.threadId}\` · headroom **${g.headroom}**${g.alreadyAnswered ? ' · **already answered**' : ''}

**What the asker needs:** ${g.question}

**Already said (${g.covered.length}):**
${g.covered.length ? g.covered.map((c) => `- ${c}`).join('\n') : '- nothing of technical substance'}

**Missing (${g.gaps.length}):**
${g.gaps.length ? g.gaps.map((x) => `- \`${x.kind}\`${x.fillable ? '' : ' *(not fillable from our competence)*'} — ${x.what}`).join('\n') : '- nothing identified'}
`;

  return write('knowledge-gap-report.md', `# Knowledge Gap Report

**Generated:** ${stamp()} · **Threads analyzed:** ${gaps.length}

What each discussion already contains, and what it is missing. Produced **before** any draft
exists — a reply written first and justified afterwards will always find a justification.

## Totals

| | |
|---|---|
| Threads analyzed | ${gaps.length} |
| Threads already adequately answered | ${answered} (${pct(answered, gaps.length)}) |
| Gaps found | ${totalGaps} |
| Gaps fillable from declared competence | ${fillable} (${pct(fillable, totalGaps)}) |
| Mean claims already on a thread | ${meanCovered} |
| Mean headroom | ${meanHeadroom ?? 'no data'} |

### Gaps by kind

| Kind | Count | Meaning |
|---|---|---|
${[
  ['unanswered', 'nobody addressed this part of the question'],
  ['partial', 'addressed, but stops before the step that resolves it'],
  ['incorrect', 'a claim in the comments is wrong'],
  ['unverified', 'asserted with no way given to confirm it'],
  ['missing-diagnostic', 'nobody asked for the information that separates the causes']
].map(([k, meaning]) => `| \`${k}\` | ${kinds.get(k as string) ?? 0} | ${meaning} |`).join('\n')}

## The headroom score is recomputed locally

The model returns gaps **and** a headroom number. The number is thrown away and recalculated
from the gaps it just reported, using the published bands. Same reasoning as DEFECT-12: a band
a model is asked to compute is a band it can skip, and a score derived from the evidence
cannot disagree with the evidence.

## Per-thread analysis

${gaps.length ? gaps.map(detail).join('\n') : '_No gap analyses on record._'}
`);
}

/* ------------------------------------------------------------------ */

export function draftQualityReport(): string {
  const drafts = loadDrafts();
  const threads = loadThreads();
  const reviews = loadReviews();
  const summary = summarizeReviews(reviews);

  const withContribution = drafts.filter((d) => d.contribution?.whatNew);
  const noveltyFlagged = drafts.filter((d) => (d.noveltyIssues?.length ?? 0) > 0);
  const lintClean = drafts.filter((d) => d.lintIssues.length === 0);

  const rows = drafts.map((d) => {
    const t = threads.find((x) => x.id === d.threadId);
    const q = assessQuality(d.body, { thread: t });
    const blocks = q.issues.filter((i) => i.severity === 'block').length;
    return `| \`${d.id.slice(0, 18)}\` | ${d.status} | ${q.metrics.words} | ${q.metrics.specificityHits} (${q.metrics.technicalHits}t) | ${q.metrics.hedges} | ${blocks} | ${d.lintIssues.length} | ${d.noveltyIssues?.length ?? '—'} | ${d.contribution ? 'yes' : 'no'} |`;
  }).join('\n');

  return write('draft-quality-report.md', `# Draft Quality Report

**Generated:** ${stamp()} · **Drafts on record:** ${drafts.length}

## The contract

Every Phase 3 draft must state three things before it is shown to anyone:

1. **why this thread is worth replying to**
2. **what new information the reply contributes**
3. **why the reply is better than remaining silent**

The model may decline. Declining is recorded as \`draft.declined\` and is a correct outcome —
a thread with nothing to add should produce no draft.

The third statement is not taken on trust. \`whatNew\` and the body are both tested against the
claims the gap analyzer extracted **before** the draft existed. Overlap at or above
**${Math.round(RESTATES * 100)}%** of a claim's content words marks the draft a restatement and blocks publishing.

> The overlap test is a **proxy** and is labelled as one everywhere it appears. It compares
> content words. Two sentences can share vocabulary and mean opposite things. What it reliably
> catches is a reply walking back over the thread's own ground in the thread's own words.

## Totals

| | |
|---|---|
| Drafts | ${drafts.length} |
| Carrying a stated contribution | ${withContribution.length} (${pct(withContribution.length, drafts.length)}) |
| Clean against the safety linter | ${lintClean.length} (${pct(lintClean.length, drafts.length)}) |
| Flagged as restating the thread | ${noveltyFlagged.length} (${pct(noveltyFlagged.length, drafts.length)}) |

## Operator verdicts

| | |
|---|---|
| Decided | ${summary.total} |
| Approved as written | ${summary.approved} |
| Approved after editing | ${summary.edited} |
| Rejected | ${summary.rejected} |
| **Publishable rate** (approved + edited) | ${summary.publishableRate === null ? 'no data (0 samples)' : pct(summary.approved + summary.edited, summary.total)} |
| **As-written rate** (no editing at all) | ${summary.asWrittenRate === null ? 'no data (0 samples)' : pct(summary.approved, summary.total)} |
| Mean text retained through an edit | ${summary.meanRetention === null ? 'no data (0 samples)' : Math.round(summary.meanRetention * 100) + '%'} |

${summary.total === 0
  ? '> **No draft has been decided at the Phase 3 prompt yet.** The success criterion "replies a\n> human is willing to publish with little or no editing" is therefore **unmeasured**, and no\n> figure in this section should be quoted as if it were.'
  : ''}

## Per-draft

| Draft | Status | Words | Specificity | Hedges | Craft blocks | Lint | Novelty | Contribution |
|---|---|---|---|---|---|---|---|---|
${rows || '| — | — | — | — | — | — | — | — | — |'}
`);
}

/* ------------------------------------------------------------------ */

export function operatorReviewDataset(): string {
  const reviews = loadReviews();
  const s = summarizeReviews(reviews);

  const vocab = (name: string, r: Record<string, string>) =>
    `### ${name}\n\n| Code | Meaning | Recorded |\n|---|---|---|\n` +
    Object.entries(r)
      .map(([code, meaning]) => `| \`${code}\` | ${meaning} | ${s.byReason.find((x) => x.code === code)?.count ?? 0} |`)
      .join('\n');

  return write('operator-review-dataset.md', `# Operator Review Dataset

**Generated:** ${stamp()} · **Records:** ${reviews.length} · **File:** \`data/reviews.jsonl\` (gitignored)

Every decision made at the approval prompt, with a structured reason. One JSON object per
line, appended, never rewritten.

## Why it exists

1. It turns "the drafts are pretty good" into a number with a denominator.
2. Rejection codes indict a specific stage — a run of \`already-covered\` is a gap-analyzer
   problem, \`inaccurate\` is a drafting-prompt problem, \`tone\` is a craft-gate problem.
3. It is the only way to re-fit the thresholds that are currently **declared rather than
   measured** — the novelty overlap floor (${Math.round(RESTATES * 100)}%) and the triage confidence floor — against
   real human judgement.

## Schema

| Field | Meaning |
|---|---|
| \`ts\` | when the decision was made |
| \`draftId\` / \`threadId\` / \`permalink\` | what was being judged |
| \`decision\` | \`approved\` · \`edited\` · \`rejected\` |
| \`reasonCode\` | one of the fixed vocabularies below |
| \`note\` | operator's free text, may be empty |
| \`operator\` | the signed-in Reddit account at decision time |
| \`edit\` | chars before/after and the share of content words retained |
| \`quality\` | craft metrics snapshot **at decision time** |
| \`gates\` | which gates passed, and which blocked |
| \`novelty\` | overlap against the thread's existing claims |
| \`contribution\` | the case the draft made for itself |

Snapshots are taken at decision time on purpose: changing a threshold later must not silently
rewrite the history of what a person was actually looking at.

## Counts

| | |
|---|---|
| Total decisions | ${s.total} |
| Approved | ${s.approved} |
| Edited then approved | ${s.edited} |
| Rejected | ${s.rejected} |

${vocab('Rejection reasons', REJECT_REASONS)}

${vocab('Edit reasons', EDIT_REASONS)}

${vocab('Approval reasons', APPROVE_REASONS)}

${reviews.length === 0
  ? '## Status\n\n**The dataset is empty.** The capture path is built and wired into `redbot reply`,\nbut no draft has been decided at the Phase 3 prompt. Every rate derived from it is therefore\n`no data (0 samples)`, and is reported that way rather than omitted.'
  : `## Records\n\n${reviews.map((r) => `- \`${r.ts}\` **${r.decision}** \`${r.reasonCode}\` — ${r.note || '(no note)'}`).join('\n')}`}
`);
}

/* ------------------------------------------------------------------ */

export function firstLiveInteractionReport(): string {
  const published = loadDrafts().filter((d) => d.status === 'published');
  const observations = loadObservations();

  if (!published.length) {
    return write('first-live-interaction.md', `# First Live Interaction Report

**Generated:** ${stamp()}

## Status: NOT EXECUTED

**Replies published to Reddit, all time: 0.** Nothing in this report is a prediction of what
would have happened.

### What is complete

The whole path up to the submit click: collect → gap analysis → opportunity → draft with a
stated contribution → novelty check → 19 fail-closed gates → the approval prompt, which now
also captures a structured review reason.

### What is not, and why

\`redbot reply\` refuses a non-interactive stdin. That refusal is deliberate and load-bearing —
it is the mechanism that makes every published word attributable to a person, and DEFECT-08
was exactly the case where that gate failed open and a stray newline would have published.
It cannot be satisfied by an agent, and satisfying it on a person's behalf would defeat its
only purpose.

So the last step needs a human at a terminal:

    node dist/cli.js reply <draftId>

### What will be recorded when it runs

| Checkpoint | Signed in | Signed out |
|---|---|---|
| immediate | visible · notice · score · replies | visible / not visible |
| 1 h | same | same |
| 24 h | same | same |
| 7 d | same | same |

Observable facts only. A comment that a logged-out browser did not render is recorded as
\`reply-absent-signed-out\` — not as shadowbanned, filtered, or caught by automod. None of
those are observable from outside, and recording a guess as an observation would poison the
one dataset that is supposed to be trustworthy.

Observations on record so far: **${observations.length}**.
`);
  }

  const d = published[0]!;
  const mine = observations.filter((o) => o.permalink === (d.commentPermalink ?? d.publishedUrl));
  const rows = mine.map((o) =>
    `| ${o.checkpoint ?? '—'} | ${o.vector} | \`${o.kind}\` | ${String(o.value ?? '')} | ${o.note ?? ''} |`
  ).join('\n');

  return write('first-live-interaction.md', `# First Live Interaction Report

**Generated:** ${stamp()} · **Status: EXECUTED**

## The reply

| | |
|---|---|
| Thread | ${d.title} |
| Permalink | ${d.commentPermalink ?? d.publishedUrl ?? d.permalink} |
| Published | ${d.decidedAt ?? 'unknown'} |
| Model | ${d.model} |

${d.contribution ? `### The case it made for itself

- **why this thread** — ${d.contribution.whyThread}
- **what is new** — ${d.contribution.whatNew}
- **why not silent** — ${d.contribution.whyNotSilent}
` : ''}
### The reply as published

> ${d.body.split('\n').join('\n> ')}

## Observations

| Checkpoint | Vector | Kind | Value | Note |
|---|---|---|---|---|
${rows || '| — | — | none recorded yet | — | — |'}

Observable facts only. Nothing here infers a cause, a moderator action, or a platform
decision — those are not visible from outside and are not recorded as if they were.
`);
}

/* ------------------------------------------------------------------ */

/**
 * Phase E — the production evidence log.
 *
 * One case study per real interaction: the thread, why it was selected, the gap, the reply,
 * the outcome, the observations, and the lessons.
 *
 * **It stores nothing.** Every field is joined from logs that are already append-only —
 * assessments, gaps, drafts, reviews, observations, regret. That is deliberate under the MVP
 * freeze: a new writable store would be a new place for the record to diverge from what
 * happened. Regenerating this file can never invent a case, because it cannot write one.
 *
 * The release rule says no further infrastructure work until ten interactions are logged and
 * reviewed, and that future work must cite a case here. So the count at the top of this file
 * is the gate, and it is computed rather than asserted.
 */
export function evidenceLog(): string {
  const drafts = loadDrafts();
  const threads = loadThreads();
  const gaps = loadGaps();
  const assessments = loadAssessments();
  const reviews = loadReviews();
  const regrets = loadRegrets();
  const observations = loadObservations();
  const rs = summarizeRegret(regrets);

  // A case is any draft a person decided on — published or not. A rejection is evidence too.
  const decidedIds = new Set(reviews.map((r) => r.draftId));
  const cases = drafts.filter((d) => decidedIds.has(d.id) || d.status === 'published');
  const published = drafts.filter((d) => d.status === 'published');

  const body = cases.map((d, i) => {
    const t = threads.find((x) => x.id === d.threadId);
    const g = gaps.find((x) => x.threadId === d.threadId);
    const a = assessments.find((x) => x.threadId === d.threadId);
    const rv = reviews.filter((x) => x.draftId === d.id);
    const rg = regrets.filter((x) => x.draftId === d.id);
    const url = d.commentPermalink ?? d.publishedUrl ?? d.permalink;
    const obs = observations.filter((o) => o.permalink === url);

    return `## Case ${i + 1} — ${d.title.slice(0, 70)}

| | |
|---|---|
| Thread | ${d.permalink} |
| Subreddit | r/${t?.subreddit ?? '?'} |
| Draft | \`${d.id}\` |
| Status | **${d.status}** |
| Published at | ${d.status === 'published' ? (d.decidedAt ?? 'unknown') : '—'} |

### Why it was selected

${a ? `Opportunity **${a.score}/100** — ${a.verdict}\n\n${a.reasons.map((r) => `- ${r}`).join('\n')}` : '_No assessment on record (drafted before the Opportunity Engine existed)._'}

### The gap it was meant to fill

${g
  ? `**What the asker needed:** ${g.question}\n\n**Already said (${g.covered.length}):**\n${g.covered.map((c) => `- ${c}`).join('\n') || '- nothing of substance'}\n\n**Missing:**\n${g.gaps.map((x) => `- \`${x.kind}\` — ${x.what}`).join('\n') || '- none identified'}`
  : '_No gap analysis on record._'}

### The case the draft made for itself

${d.contribution
  ? `- **why this thread** — ${d.contribution.whyThread}\n- **what is new** — ${d.contribution.whatNew}\n- **why not silent** — ${d.contribution.whyNotSilent}`
  : '_Drafted before the contribution contract existed._'}

### The reply

> ${d.body.split('\n').join('\n> ')}

### Operator verdict

${rv.length
  ? rv.map((r) => `- **${r.decision}** \`${r.reasonCode}\`${r.note ? ` — ${r.note}` : ''}${r.edit ? ` (kept ${Math.round(r.edit.retained * 100)}% of the text)` : ''}`).join('\n')
  : '_Not decided at the approval prompt._'}

### Standing behind it

${rg.length
  ? rg.map((r) => `- \`${r.kind}\` at ${r.hoursAfterPublish}h — **${r.answer}**${r.category ? ` (${r.category})` : ''}${r.lessons ? `\n  - lessons: ${r.lessons}` : ''}`).join('\n')
  : '_No standalone or regret check recorded._'}

### Observations

${obs.length
  ? `| Checkpoint | Vector | Kind | Value |\n|---|---|---|---|\n${obs.map((o) => `| ${o.checkpoint ?? '—'} | ${o.vector} | \`${o.kind}\` | ${String(o.value ?? '')} |`).join('\n')}`
  : '_None recorded._'}
`;
  }).join('\n---\n\n');

  return write('evidence-log.md', `# Production Evidence Log

**Generated:** ${stamp()} · **Cases:** ${cases.length} · **Published:** ${published.length}

Append-only in substance: every field is joined from logs that are only ever appended to.
This file stores nothing of its own and therefore cannot invent a case.

## Release gate

> No additional infrastructure work begins until **ten** real interactions have been completed
> and reviewed.

**${published.length} of 10 published.** ${published.length >= 10
  ? 'The gate is met — run the retrospective using only the evidence below.'
  : `${10 - published.length} to go. Until then, any engineering proposal must cite a case in this file, and there ${cases.length === 1 ? 'is' : 'are'} ${cases.length}.`}

## Human Regret

The question that outranks every automated score here: *would a knowledgeable person still be
comfortable having their name on this, after seeing how it landed?*

| | |
|---|---|
| Publish-time "would you post this yourself" asked | ${rs.standaloneAsked} |
| …answered yes | ${rs.standaloneYes} |
| 24h regret checks asked | ${rs.regretAsked} |
| Yes, unchanged | ${rs.unchanged} |
| Yes, but I'd edit it | ${rs.wouldEdit} |
| No, I'd delete it | ${rs.wouldDelete} |
| **Stand-behind rate** | ${rs.standBehindRate === null ? '**no data (0 samples)**' : `${Math.round(rs.standBehindRate * 100)}% (n=${rs.regretAsked})`} |

${rs.byCategory.length ? `### Where the problems were\n\n${rs.byCategory.map((c) => `- **${c.category}** — ${c.count}`).join('\n')}` : ''}

${cases.length ? '' : '_No case studies yet. A case is created when a person decides on a draft — publishing is not required, because a rejection is evidence too._'}

${body}
`);
}

export function generateAll(): string[] {
  return [
    opportunityReport(),
    knowledgeGapReport(),
    draftQualityReport(),
    operatorReviewDataset(),
    firstLiveInteractionReport(),
    evidenceLog()
  ];
}

export { reviewsPath };

/**
 * `redbot draft [threadId]`
 *
 * Generates a reply for a thread the Opportunity Engine said was worth replying to, runs it
 * through the linter and the novelty check, and stores it as a pending draft. Nothing is
 * posted here.
 *
 * Phase 3 changed the entry condition. Drafting used to start from the triage score, which
 * measured how interesting a thread looked. It now starts from a gap analysis — what the
 * discussion is missing — and refuses outright when no fillable gap was found. The model is
 * also required to state what it is adding, and that statement is tested against the claims
 * the thread already contained rather than believed.
 *
 * Three outcomes, all normal:
 *   drafted            a gap existed, the model filled it, the draft passed novelty
 *   model declined     the model was asked to make the case and would not — recorded, no draft
 *   restatement        the draft repeated the thread; saved with the issue, publishing blocked
 */
import {
  loadThreads, loadDrafts, saveDraft, loadGaps, loadAssessments
} from '../store.js';
import { complete, extractJson } from '../llm.js';
import { draftPrompt } from '../prompts.js';
import { lintDraft } from '../disclosure.js';
import { checkNovelty } from '../novelty.js';
import { assessQuality } from '../quality.js';
import { findReference } from '../corpus.js';
import { config, selectedAccount } from '../config.js';
import { trace } from '../trace.js';
import { record, say } from '../log.js';
import type { Draft } from '../types.js';
import { NOTHING_TO_DO } from '../exit-codes.js';

interface RawDraft {
  contribute?: unknown;
  whyThread?: unknown;
  whatNew?: unknown;
  whyNotSilent?: unknown;
  body?: unknown;
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

export async function draft(threadIdArg?: string): Promise<number> {
  say.head('redbot draft');

  const threads = await loadThreads();
  const gaps = await loadGaps();
  const assessments = await loadAssessments();

  if (!assessments.length) {
    /* Nothing assessed is nothing to draft — not a failure. This is the console's "write"
       button, so returning 1 painted it red for an install that simply had not scored yet. */
    say.warn('No opportunity assessments on record.');
    say.step('Score what has been collected first:  redbot opportunity');
    return NOTHING_TO_DO;
  }

  const drafted = new Set((await loadDrafts()).map((d) => d.threadId));

  const candidates = assessments
    .filter((a) => a.verdict === 'contribute')
    .filter((a) => (threadIdArg ? a.threadId === threadIdArg : !drafted.has(a.threadId)))
    .sort((a, b) => b.score - a.score);

  const pick = candidates[0];
  if (!pick) {
    say.warn(
      threadIdArg
        ? `No "contribute" assessment for thread ${threadIdArg}. Run \`redbot opportunity\`, or accept the skip.`
        : 'No un-drafted thread is worth contributing to. That is a valid outcome — collect more rather than lowering the bar.'
    );
    return 1;
  }

  const thread = threads.find((t) => t.id === pick.threadId);
  const gap = gaps.find((g) => g.threadId === pick.threadId);
  if (!thread) {
    say.fail(`Thread ${pick.threadId} is assessed but missing from threads.json.`);
    return 1;
  }
  if (!gap) {
    say.fail(`Thread ${pick.threadId} has no gap analysis. Run \`redbot opportunity\` again.`);
    return 1;
  }

  say.step(`Thread     : ${thread.title}`);
  say.step(`Opportunity: ${pick.score}/100 — ${pick.verdict}`);
  for (const r of pick.reasons) say.step(`             ${r}`);
  if (pick.thesis) {
    say.step(`Why reply  : ${pick.thesis.whyThread}`);
    say.step(`What is new: ${pick.thesis.whatNew}`);
  }
  say.step(`Already said: ${gap.covered.length} claim(s) the draft must not restate`);

  /**
   * Reference material, retrieved before the model is asked anything.
   *
   * The subject is the thread as posted — title and body — not the comments. The comments are
   * what other people believe about it, and retrieving against them would pull cards matching
   * someone else's wrong guess as readily as the actual problem.
   *
   * Empty is the normal outcome and is printed as such: the corpus is narrow by design, so
   * most threads touch nothing it holds. "0 sources" on screen is the honest signal that this
   * draft rests entirely on model memory, which is the condition that produced HRC-001.
   */
  const reference = findReference(`${thread.title}\n${thread.body}`);
  say.step(
    reference.length
      ? `Sources    : ${reference.length} — ${reference.map((r) => r.cardId).join(', ')}`
      : 'Sources    : none — nothing in the reference corpora covers this thread, so every ' +
        'factual claim below comes from model memory'
  );
  say.step(`Drafting with ${config.llm.draftModel}…`);

  let raw: string;
  try {
    raw = await complete({
      prompt: draftPrompt(
        thread,
        pick.thesis?.whyThread ?? 'a gap was identified in the discussion',
        pick.thesis?.whatNew ?? 'answer the question directly',
        { question: gap.question, covered: gap.covered, gaps: gap.gaps },
        reference
      ),
      model: config.llm.draftModel,
      maxTokens: 1600,
      temperature: 0.5
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    say.fail(msg);
    await record('error', `draft failed for ${thread.id}: ${msg}`);
    return 1;
  }

  let parsed: RawDraft;
  try {
    parsed = extractJson<RawDraft>(raw);
  } catch {
    say.fail('The model did not return the required JSON. Nothing saved.');
    await record('error', `draft for ${thread.id} returned unparseable output`, { head: raw.slice(0, 200) });
    return 1;
  }

  /* ---- the model is allowed to decline, and declining is recorded ---- */
  if (parsed.contribute !== true || !str(parsed.body)) {
    const why = str(parsed.whyNotSilent) || str(parsed.whyThread) || '(no reason given)';
    say.ok('The model declined to draft — it could not make the case for replying.');
    say.step(`Reason: ${why}`);
    say.step('That is a result, not a failure. Nothing was saved.');
    await record('draft.declined', `model declined to draft for ${thread.id}`, {
      threadId: thread.id, why, opportunityScore: pick.score
    });
    trace('draft', 'draft.declined', {
      why, opportunityScore: pick.score, headroom: gap.headroom, covered: gap.covered.length
    }, { threadId: thread.id, level: 'warn' });
    return 0;
  }

  const body = str(parsed.body);
  const contribution = {
    whyThread: str(parsed.whyThread),
    whatNew: str(parsed.whatNew),
    whyNotSilent: str(parsed.whyNotSilent)
  };

  const lint = lintDraft(body);
  const novelty = checkNovelty(body, contribution.whatNew, gap.covered);
  const quality = assessQuality(body, { thread });

  const saved: Draft = {
    id: `d_${thread.id}_${Date.now().toString(36)}`,
    threadId: thread.id,
    permalink: thread.permalink,
    title: thread.title,
    body,
    contribution,
    noveltyIssues: novelty.issues,
    hasDisclosure: lint.hasDisclosure,
    lintIssues: lint.issues,
    createdAt: new Date().toISOString(),
    model: config.llm.draftModel,
    // Recorded when known, omitted when not. `selectedAccount()` returns null in the
    // single-profile case, and an absent field is the honest representation of that.
    ...(selectedAccount()?.handle ? { account: selectedAccount()!.handle } : {}),
    status: 'pending'
  };
  await saveDraft(saved);

  say.info('\n--- the case for replying ---');
  say.info(`  why this thread : ${contribution.whyThread}`);
  say.info(`  what is new     : ${contribution.whatNew}`);
  say.info(`  why not silent  : ${contribution.whyNotSilent}`);
  say.info('\n--- draft ---\n');
  say.info(body);
  say.info('\n-------------\n');

  const m = quality.metrics;
  say.step(`Craft   : ${m.words} words · specificity ${m.specificityHits} (${m.technicalHits} technical) · ${m.hedges} hedge(s)`);
  say.step(`Novelty : max overlap with an existing claim ${Math.round(novelty.maxOverlap * 100)}% (proxy)`);

  if (!lint.ok) {
    say.warn('Linter flagged this draft:');
    for (const i of lint.issues) say.warn(`  - ${i}`);
  }
  if (!novelty.ok) {
    say.warn('Novelty check flagged this draft:');
    for (const i of novelty.issues) say.warn(`  - ${i}`);
  }
  for (const i of quality.issues) {
    if (i.severity === 'block') say.warn(`  - quality: ${i.message}`);
  }
  if (lint.ok && novelty.ok && quality.ok) say.ok('Passes the linter, the novelty check and the craft gate.');

  say.step(`Draft id: ${saved.id}`);
  say.step('Next: redbot reply');

  await record('draft', `drafted for "${thread.title.slice(0, 60)}"`, {
    draftId: saved.id,
    threadId: thread.id,
    lintOk: lint.ok,
    noveltyOk: novelty.ok,
    maxOverlap: Number(novelty.maxOverlap.toFixed(2)),
    qualityOk: quality.ok,
    opportunityScore: pick.score,
    // Which human-authored sources were in front of the model when it wrote this. An empty
    // list is the fact worth having on the record, not an omission: it says the draft is
    // unsourced, and lets a later analysis split contradiction rates by grounded vs not.
    sources: reference.map((r) => r.cardId)
  });

  trace('draft', 'draft.created', {
    lintOk: lint.ok,
    lintIssues: lint.issues,
    noveltyOk: novelty.ok,
    noveltyIssues: novelty.issues,
    maxOverlap: Number(novelty.maxOverlap.toFixed(2)),
    qualityOk: quality.ok,
    qualityBlocks: quality.issues.filter((i) => i.severity === 'block').map((i) => i.code),
    words: quality.metrics.words,
    specificity: quality.metrics.specificityHits,
    technical: quality.metrics.technicalHits,
    hedges: quality.metrics.hedges,
    opportunityScore: pick.score,
    coveredClaims: gap.covered.length
  }, { threadId: thread.id, draftId: saved.id });

  return 0;
}

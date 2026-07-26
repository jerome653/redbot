/**
 * Part D — the safety gates.
 *
 * One pure function that decides whether a reply may be published. Pure on purpose: it takes
 * facts already gathered (lint result, live thread state, identity, health) and returns a
 * decision, so the whole matrix is testable without a browser and without touching Reddit.
 *
 * Every gate fails CLOSED. A gate that cannot establish its fact blocks — "we could not tell
 * whether this thread is locked" is a refusal, not a shrug. DEFECT-08 was an approval path
 * that resolved ambiguity in favour of posting; the rule that came out of it is that
 * ambiguity resolves to silence.
 *
 * This runs twice in `redbot reply`: once before the human is asked (so nobody is asked to
 * approve something that cannot be posted), and once immediately before the submit click
 * with a freshly probed page (so a thread locked during the review is caught).
 */
import { lintDraft } from './disclosure.js';
import { assessQuality, type QualityReport } from './quality.js';
import { policy } from './policy.js';
import { isQuestionShaped, currentAgeHours } from './select.js';
import { MIN_OPPORTUNITY_SCORE } from './opportunity.js';
import type { HealthVerdict } from './health.js';
import type { WindowVerdict } from './window.js';
import type { ThreadState } from './reddit/thread-state.js';
import type { Identity } from './browser.js';
import type { Draft, Thread, OpportunityAssessment } from './types.js';

export interface GateBlock {
  gate: string;
  reason: string;
}

export interface GateResult {
  allow: boolean;
  blocks: GateBlock[];
  warnings: string[];
  quality: QualityReport;
}

export interface GateInput {
  draft: Draft;
  thread?: Thread | undefined;
  /**
   * The Opportunity Engine's assessment — the ONLY thing that satisfies the triage gate since
   * the Phase-1 path was retired (D-01). There is no second source to fall back to,
   * deliberately: the fallback is what hid E-17.
   */
  assessment?: OpportunityAssessment | undefined;
  /** Result of whoAmI() on the live page. null when identity was never established. */
  identity?: Identity | null | undefined;
  /** Which account we believe we are acting as. A mismatch is a hard stop. */
  expectedAccount?: string | null | undefined;
  health: HealthVerdict;
  /**
   * The timing verdict for the selected account — quiet hours and the per-account daily
   * ceiling. Passed in (not computed here) so this function stays pure and browser-free. When
   * present and refusing, it blocks. Absent means "no account selected", the single-profile
   * case, which this gate does not police — the global daily cap still runs via `health`.
   * Before this existed, `checkWindow` had exactly one caller (`auto`), so the interactive
   * publish path enforced neither quiet hours nor the per-account ceiling (evaluation H7).
   */
  window?: WindowVerdict | null | undefined;
  /** Live page probe. null before the page has been read — blocks. */
  threadState?: ThreadState | null | undefined;
  /** Every draft on disk, for cross-run duplicate detection. */
  allDrafts?: Draft[] | undefined;
  /**
   * Require the draft to state what it contributes (Phase 3 contract). Off by default so
   * drafts generated before the contract existed are judged on the gates they were written
   * under, rather than blocked by a rule that post-dates them.
   */
  requireContribution?: boolean | undefined;
  now?: Date | undefined;
}

export function evaluateGates(input: GateInput): GateResult {
  const blocks: GateBlock[] = [];
  const warnings: string[] = [];
  const now = input.now ?? new Date();

  /* ---- 1. the linter ---- */
  const lint = lintDraft(input.draft.body);
  if (!lint.ok) {
    for (const issue of lint.issues) blocks.push({ gate: 'linter', reason: issue });
  }

  /* ---- 2. craft ---- */
  const quality = assessQuality(input.draft.body, { thread: input.thread });
  for (const i of quality.issues) {
    if (i.severity === 'block') blocks.push({ gate: `quality:${i.code}`, reason: i.message });
    else warnings.push(`quality:${i.code} — ${i.message}`);
  }

  /* ---- 2b. does it actually add anything (Phase 3) ---- */
  // The draft's own claim about what it contributes is not evidence. `noveltyIssues` is the
  // result of testing that claim against the gap analysis taken before the draft existed.
  for (const issue of input.draft.noveltyIssues ?? []) {
    blocks.push({ gate: 'novelty', reason: issue });
  }
  if (input.requireContribution && !input.draft.contribution?.whatNew) {
    blocks.push({
      gate: 'novelty',
      reason: 'the draft never states what it adds — a reply that cannot say that should not be posted'
    });
  }

  /* ---- 3. identity ---- */
  if (!input.identity) {
    blocks.push({ gate: 'identity', reason: 'identity was never established on the live page' });
  } else if (!input.identity.loggedIn) {
    blocks.push({ gate: 'identity', reason: `not signed in (${input.identity.via})` });
  } else if (!input.identity.username) {
    blocks.push({
      gate: 'identity',
      reason: `signed in, but the account name could not be read (${input.identity.via}) — ` +
              `publishing as an unknown account is not acceptable`
    });
  } else if (input.expectedAccount && input.identity.username.toLowerCase() !== input.expectedAccount.toLowerCase()) {
    blocks.push({
      gate: 'identity',
      reason: `signed in as ${input.identity.username}, expected ${input.expectedAccount} — wrong account`
    });
  } else if (
    input.draft.account &&
    input.identity.username.toLowerCase() !== input.draft.account.toLowerCase()
  ) {
    /**
     * The draft was written FOR a specific account and this is a different one.
     *
     * The check above compares the browser against the account we intend to act as; this one
     * compares it against the account the reply was written for. They are different questions
     * and only the second catches the case that matters once drafts are per-account: a reply
     * composed in one account's voice, about a subject that account is credible on, sent from
     * another. Accounts differ in role, subject list and standing on each subreddit, so this is
     * not bookkeeping — it is who the reader thinks is talking.
     *
     * Drafts predating the field carry no account and skip this entirely.
     */
    blocks.push({
      gate: 'identity',
      reason:
        `this draft was written for ${input.draft.account}, but the browser is signed in as ` +
        `${input.identity.username} — re-draft it for this account rather than sending it as someone else`
    });
  }

  /* ---- 4. was this thread judged worth replying to ---- */
  /**
   * PRODUCTION OBSERVATION 2026-07-23, draft d_c9bd9366f6b9_mrwiupf2: pre-flight returned
   * `[triage] no analysis on record`. The thread had been gap-analyzed and assessed at 80/100
   * by the Opportunity Engine, but never seen by the Phase-1 `analyze` step that wrote
   * analysis.json — and this gate only knew about the latter. Every thread on the newer path
   * was silently unpublishable (E-17).
   *
   * The first repair taught this gate to accept EITHER record. That removed the symptom and
   * kept the cause: two stages answering one question, drifting apart by default. On
   * 2026-07-23 the Phase-1 path was retired outright (D-01) and this gate has a single
   * authority. A thread with no assessment is not publishable — there is nothing else to ask.
   */
  const assessment = input.assessment;

  if (!assessment) {
    blocks.push({
      gate: 'triage',
      reason: 'no opportunity assessment on record — run `redbot opportunity` for this thread'
    });
  } else {
    if (assessment.verdict !== 'contribute') {
      blocks.push({
        gate: 'triage',
        reason: `the Opportunity Engine said "${assessment.verdict}" — ${assessment.reasons[0] ?? 'not worth replying to'}`
      });
    }
    if (assessment.score < MIN_OPPORTUNITY_SCORE) {
      blocks.push({
        gate: 'priority',
        reason: `opportunity ${assessment.score} is below the floor of ${MIN_OPPORTUNITY_SCORE}`
      });
    }
  }

  /* ---- 5. is anyone actually asking ---- */
  // DEFECT-12: triage scored a "[Guide]" post 72/90 despite GATE A putting a guide at 5.
  // Checked here too, not only in `select`, so the publish path cannot inherit a bad score.
  //
  // A missing thread is a refusal, not a skip. Two gates below (question-shape, recency) are
  // derived from the thread; if the thread record is gone, neither can be established, and
  // every other unestablished fact in this function blocks. They used to vanish silently when
  // `thread` was undefined, so a draft whose thread had been cleared skipped both (evaluation
  // L2). Fail closed instead: no thread, no publish.
  if (!input.thread) {
    blocks.push({
      gate: 'no-thread',
      reason: 'the thread this draft answers is not on record — cannot check that it is still a live question'
    });
  } else {
    const shape = isQuestionShaped(input.thread);
    if (!shape.pass) {
      blocks.push({ gate: 'not-a-question', reason: shape.detail });
    }
  }

  /* ---- 6. thread age, as it stands now ---- */
  // Was `thread.ageMinutes / 60`, which is the age at COLLECTION time. See currentAgeHours()
  // for the observation: that let a stale thread through the ceiling it was meant to stop.
  // `now` is threaded in rather than left to the wall clock: this function claims to be pure,
  // and until 2026-07-27 it was not — `currentAgeHours` read `Date.now()`, so the same inputs
  // produced a different verdict depending on the day the gates ran.
  const hours = input.thread ? currentAgeHours(input.thread, now.getTime()) : null;
  if (hours != null) {
    if (hours > policy.maxThreadAgeHoursToPublish.value) {
      blocks.push({
        gate: 'stale-thread',
        reason: `thread is ${Math.round(hours)}h old, past the ${policy.maxThreadAgeHoursToPublish.value}h limit — a reply there is a footprint, not a contribution`
      });
    }
  } else if (input.thread) {
    warnings.push('thread age unknown — could not check recency');
  }

  /* ---- 6-9. live page state ---- */
  const ts = input.threadState;
  if (!ts) {
    blocks.push({ gate: 'thread-state', reason: 'the thread page was not probed — refusing to publish blind' });
  } else {
    if (ts.locked) blocks.push({ gate: 'locked', reason: 'thread is locked' });
    if (ts.archived) blocks.push({ gate: 'archived', reason: 'thread is archived' });
    if (ts.ownCommentPresent) {
      blocks.push({ gate: 'duplicate', reason: 'this account already has a comment on this thread' });
    }
    if (!ts.composerPresent && !ts.locked && !ts.archived) {
      blocks.push({ gate: 'no-composer', reason: 'the comment composer is not reachable on this page' });
    }
    for (const u of ts.unknown) {
      blocks.push({ gate: 'unknown-state', reason: `could not establish: ${u}` });
    }
    for (const a of ts.anomalies) {
      blocks.push({ gate: 'unexpected-ui', reason: a });
    }
  }

  /* ---- duplicate across runs, independent of the page ---- */
  const others = (input.allDrafts ?? []).filter(
    (d) => d.id !== input.draft.id && d.threadId === input.draft.threadId
  );
  // `approved` counts too, not only `published`: a draft flips to `approved` on disk in the
  // instant before the submit click, and a comment that actually landed can be mis-recorded
  // `failed` when confirmation misfires (evaluation H2). Treating a prior approved/published
  // draft for the same thread as a duplicate closes the re-post window either way.
  if (others.some((d) => d.status === 'published' || d.status === 'approved')) {
    blocks.push({ gate: 'duplicate', reason: 'a draft for this thread has already been approved or published in a previous run' });
  }

  /* ---- account health ---- */
  if (!input.health.mayPublish) {
    const until = input.health.resumeAt ? ` until ${input.health.resumeAt}` : '';
    blocks.push({
      gate: 'health',
      reason: `account health is ${input.health.state}${until} — ${input.health.reasons[0] ?? 'blocked'}`
    });
  } else if (input.health.state === 'Caution') {
    for (const r of input.health.reasons) warnings.push(`health — ${r}`);
  }

  /* ---- account timing: quiet hours and the per-account daily ceiling ---- */
  if (input.window && !input.window.allowed) {
    blocks.push({ gate: 'window', reason: input.window.detail });
  }

  /* ---- Argus certification, if this draft was fact-checked ---- */
  // A REJECT is a hard block: the certify command's own contract is "a REJECT never reaches the
  // approval prompt", but nothing enforced it — the verdict was written to certifications.jsonl
  // and never read on the publish path (evaluation H6). ESCALATE and "never certified" are
  // surfaced to the human rather than blocked: both are cases a person is meant to judge.
  const cert = input.draft.certification;
  if (cert?.verdict === 'REJECT') {
    blocks.push({
      gate: 'certification',
      reason: `Argus rejected this draft on ${cert.at} (${cert.fatalContradictions} fatal contradiction(s)) — re-draft rather than publish`
    });
  } else if (cert?.verdict === 'ESCALATE') {
    warnings.push('Argus escalated this draft — a person who knows the subject must confirm the facts before it goes out');
  } else if (!cert) {
    warnings.push('this draft has not been fact-checked — run `redbot certify` before publishing');
  }

  /* ---- draft freshness: a draft written long ago describes a thread that has moved on ---- */
  // Fail closed on an unparseable createdAt: `Number.isFinite(NaN)` is false, so the old guard
  // SKIPPED the gate when the date could not be read — the one shape where "we can't tell how
  // old this draft is" waved it through instead of refusing (evaluation L1).
  const draftAgeH = (now.getTime() - Date.parse(input.draft.createdAt)) / 3_600_000;
  if (!Number.isFinite(draftAgeH)) {
    blocks.push({
      gate: 'stale-draft',
      reason: `draft createdAt "${input.draft.createdAt}" is not a readable date — cannot establish the draft is fresh`
    });
  } else if (draftAgeH > 24) {
    blocks.push({
      gate: 'stale-draft',
      reason: `draft was written ${Math.round(draftAgeH)}h ago — the thread has moved since; re-draft it`
    });
  }

  return { allow: blocks.length === 0, blocks, warnings, quality };
}

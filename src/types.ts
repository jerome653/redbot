export interface Thread {
  id: string;              // stable local id (hash of permalink)
  permalink: string;
  title: string;
  subreddit: string;
  author: string | null;
  upvotes: number | null;
  commentCount: number | null;
  ageText: string | null;   // as Reddit shows it, e.g. "3 hr. ago"
  ageMinutes: number | null; // parsed, for ranking freshness
  body: string | null;
  comments: Comment[];
  collectedAt: string;
  source: 'read' | 'search';
  query?: string;
}

export interface Comment {
  author: string | null;
  body: string;
  depth: number;
}

/*
 * `Opportunity` — the Phase-1 triage record — was DELETED 2026-07-23 (D-01).
 *
 * It carried four model self-assessments consumed as inputs: `worthwhile`, `score`,
 * `confidence` and `answerableWithoutPitch`. That is D-11, the project's most repeated failure
 * pattern, and it is now absent from the type graph rather than merely unused. The shape is
 * preserved in `_superseded/phase1-triage/analyze.ts`.
 */

/**
 * What the existing discussion already contains, and what it is missing.
 *
 * Produced BEFORE any draft exists. The order matters: a reply written first and justified
 * afterwards will always find a justification.
 */
export interface GapAnalysis {
  threadId: string;
  permalink: string;
  title: string;
  /** What the asker actually needs to know, in one line. */
  question: string;
  /** Claims already made in the visible comments. The "do not repeat" list. */
  covered: string[];
  gaps: Gap[];
  /** True when the thread is answered well enough that another reply adds nothing. */
  alreadyAnswered: boolean;
  /** 0-100 — how much room is left for a genuinely useful technical contribution. */
  headroom: number;
  analyzedAt: string;
  model: string;
}

export interface Gap {
  kind: 'unanswered' | 'partial' | 'incorrect' | 'unverified' | 'missing-diagnostic';
  what: string;
  /** Whether someone with the declared expertise could actually fill it. */
  fillable: boolean;
}

/**
 * The case for replying, made before the reply is written. If these three cannot be stated,
 * there is nothing to contribute and the correct action is silence.
 */
export interface ContributionThesis {
  whyThread: string;
  whatNew: string;
  whyNotSilent: string;
}

export interface OpportunityAssessment {
  threadId: string;
  permalink: string;
  title: string;
  verdict: 'contribute' | 'skip';
  /** 0-100, derived from the gap analysis and thread signals — not a model's free choice. */
  score: number;
  thesis: ContributionThesis | null;
  reasons: string[];
  assessedAt: string;
}

export interface Draft {
  id: string;
  threadId: string;
  permalink: string;
  title: string;
  body: string;
  /** The draft's own account of what it adds. Checked against `covered`, not taken on trust. */
  contribution?: ContributionThesis;
  /** Covered claims this draft appears to restate. Non-empty blocks publishing. */
  noveltyIssues?: string[];
  hasDisclosure: boolean;
  lintIssues: string[];
  createdAt: string;
  model: string;
  status: 'pending' | 'approved' | 'rejected' | 'published' | 'failed';
  /**
   * The Argus verdict, persisted onto the draft by `redbot certify` so the publish gate can
   * consult it. Before this existed the certification was written only to certifications.jsonl
   * and the reports, and the publish path never read it — a REJECT could still be approved and
   * posted (evaluation H6). A REJECT here is a hard publish block; ESCALATE and "never certified"
   * are surfaced as warnings the human sees at the approval prompt.
   */
  certification?: {
    verdict: 'CERTIFIED' | 'ESCALATE' | 'REJECT';
    at: string;
    claims: number;
    fatalContradictions: number;
  };
  publishedUrl?: string;
  /** Permalink of the posted comment itself — what the Part F checkpoints look at. */
  commentPermalink?: string;
  commentId?: string;
  decidedAt?: string;
}

export type HistoryKind =
  | 'login'
  /** an attempted sign-in that Reddit refused — feeds the health state machine */
  | 'login.fail'
  | 'read'
  /** a committed collection — threads entered the corpus */
  | 'search'
  /**
   * A look that collected nothing. Separate from `search` on purpose: history feeds the
   * health state machine and the reliability metrics, and counting a preview as a collection
   * would inflate both with runs that never touched a thread.
   */
  | 'search.preview'
  /**
   * RETIRED 2026-07-23 (D-01) — no code emits this any more. The member survives so the 7
   * `analyze` lines already in history.jsonl still parse. Removing it would not delete the
   * lines; it would only stop them being readable.
   */
  | 'analyze'
  /** Phase 3: what the discussion already contains and what it is missing */
  | 'gap'
  /** Phase 3: contribute-or-skip, decided before any draft exists */
  | 'opportunity'
  /**
   * `redbot auto` — the unattended pipeline, which stops at the fact-check and never
   * publishes. Recorded under its own kinds so an unattended cycle is always
   * distinguishable in the history from the same steps run by a person.
   */
  | 'auto.cycle'
  /** a cycle that declined to act: quiet hours, daily ceiling, or nothing configured */
  | 'auto.skip'
  | 'auto.error'
  | 'draft'
  /** Phase 3: the model was asked to make the case for replying and would not */
  | 'draft.declined'
  /** Phase 3: an operator's structured verdict on a draft */
  | 'review'
  | 'approve'
  | 'reject'
  | 'publish.attempt'
  | 'publish.ok'
  | 'publish.fail'
  /** HTTP 429 or a block page, seen live. The one measured operational limit we have. */
  | 'ratelimit'
  /** a selector list resolved to nothing — the leading indicator of Reddit markup drift */
  | 'selector.miss'
  /** a safety gate refused to publish, with the failing gate named */
  | 'gate.block'
  /** behaviour-engine session lifecycle, for the reliability metrics in Part G */
  | 'session.start'
  | 'session.end'
  | 'session.view'
  /** a post-publication checkpoint reading (Part F) */
  | 'observe'
  | 'error';

export interface HistoryEntry {
  ts: string;
  kind: HistoryKind;
  /** which Reddit account the action was taken as */
  account: string | null;
  subreddit?: string | null;
  threadUrl?: string | null;
  /** permalink of what we posted, once it lands */
  permalink?: string | null;
  status?: 'ok' | 'failed' | 'blocked' | 'unknown';
  summary: string;
  data?: Record<string, unknown>;
}

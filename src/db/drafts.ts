/**
 * drafts.
 *
 * The one table with a publish invariant welded into it: a draft whose certification
 * verdict is REJECT can never hold status 'published' (reject_is_never_published,
 * db/migrations/0006_drafts.up.sql). If a write here ever violates that, the database
 * refuses it — which is the point. Evaluation H6 was exactly that write succeeding.
 */
import type { Db } from '../db.js';
import type { Draft } from '../types.js';

interface DraftRow {
  id: string;
  thread_id: string;
  permalink: string;
  title: string;
  body: string;
  contribution_why_thread: string | null;
  contribution_what_new: string | null;
  contribution_why_not_silent: string | null;
  novelty_issues: string[];
  has_disclosure: boolean;
  lint_issues: string[];
  created_at: Date;
  model: string;
  account: string | null;
  status: Draft['status'];
  cert_verdict: 'CERTIFIED' | 'ESCALATE' | 'REJECT' | null;
  cert_at: Date | null;
  cert_claims: number | null;
  cert_fatal_contradictions: number | null;
  published_url: string | null;
  comment_permalink: string | null;
  comment_id: string | null;
  decided_at: Date | null;
}

function toDraft(r: DraftRow): Draft {
  const d: Draft = {
    id: r.id,
    threadId: r.thread_id,
    permalink: r.permalink,
    title: r.title,
    body: r.body,
    hasDisclosure: r.has_disclosure,
    lintIssues: r.lint_issues,
    createdAt: r.created_at.toISOString(),
    model: r.model,
    status: r.status
  };
  if (r.contribution_why_thread !== null) {
    d.contribution = {
      whyThread: r.contribution_why_thread,
      whatNew: r.contribution_what_new ?? '',
      whyNotSilent: r.contribution_why_not_silent ?? ''
    };
  }
  if (r.novelty_issues.length) d.noveltyIssues = r.novelty_issues;
  if (r.account !== null) d.account = r.account;
  if (r.cert_verdict !== null && r.cert_at !== null) {
    d.certification = {
      verdict: r.cert_verdict,
      at: r.cert_at.toISOString(),
      claims: r.cert_claims ?? 0,
      fatalContradictions: r.cert_fatal_contradictions ?? 0
    };
  }
  if (r.published_url !== null) d.publishedUrl = r.published_url;
  if (r.comment_permalink !== null) d.commentPermalink = r.comment_permalink;
  if (r.comment_id !== null) d.commentId = r.comment_id;
  if (r.decided_at !== null) d.decidedAt = r.decided_at.toISOString();
  return d;
}

const SELECT = `
  SELECT id, thread_id, permalink, title, body,
         contribution_why_thread, contribution_what_new, contribution_why_not_silent,
         novelty_issues, has_disclosure, lint_issues, created_at, model, account, status,
         cert_verdict, cert_at, cert_claims, cert_fatal_contradictions,
         published_url, comment_permalink, comment_id, decided_at
    FROM redbot.drafts`;

export async function upsertDraft(db: Db, d: Draft): Promise<void> {
  await db.query(
    `INSERT INTO redbot.drafts
       (id, thread_id, permalink, title, body,
        contribution_why_thread, contribution_what_new, contribution_why_not_silent,
        novelty_issues, has_disclosure, lint_issues, created_at, model, account, status,
        cert_verdict, cert_at, cert_claims, cert_fatal_contradictions,
        published_url, comment_permalink, comment_id, decided_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
     ON CONFLICT (id) DO UPDATE SET
       thread_id                   = EXCLUDED.thread_id,
       permalink                   = EXCLUDED.permalink,
       title                       = EXCLUDED.title,
       body                        = EXCLUDED.body,
       contribution_why_thread     = EXCLUDED.contribution_why_thread,
       contribution_what_new       = EXCLUDED.contribution_what_new,
       contribution_why_not_silent = EXCLUDED.contribution_why_not_silent,
       novelty_issues              = EXCLUDED.novelty_issues,
       has_disclosure              = EXCLUDED.has_disclosure,
       lint_issues                 = EXCLUDED.lint_issues,
       created_at                  = EXCLUDED.created_at,
       model                       = EXCLUDED.model,
       account                     = EXCLUDED.account,
       status                      = EXCLUDED.status,
       cert_verdict                = EXCLUDED.cert_verdict,
       cert_at                     = EXCLUDED.cert_at,
       cert_claims                 = EXCLUDED.cert_claims,
       cert_fatal_contradictions   = EXCLUDED.cert_fatal_contradictions,
       published_url               = EXCLUDED.published_url,
       comment_permalink           = EXCLUDED.comment_permalink,
       comment_id                  = EXCLUDED.comment_id,
       decided_at                  = EXCLUDED.decided_at`,
    [
      d.id, d.threadId, d.permalink, d.title, d.body,
      d.contribution?.whyThread ?? null,
      d.contribution?.whatNew ?? null,
      d.contribution?.whyNotSilent ?? null,
      d.noveltyIssues ?? [], d.hasDisclosure, d.lintIssues ?? [],
      d.createdAt, d.model, d.account ?? null, d.status,
      d.certification?.verdict ?? null,
      d.certification?.at ?? null,
      d.certification?.claims ?? null,
      d.certification?.fatalContradictions ?? null,
      d.publishedUrl ?? null, d.commentPermalink ?? null,
      d.commentId ?? null, d.decidedAt ?? null
    ]
  );
}

export async function loadDraftsFromDb(db: Db): Promise<Draft[]> {
  const r = await db.query<DraftRow>(`${SELECT} ORDER BY created_at, id`);
  return r.rows.map(toDraft);
}

/**
 * Just these drafts.
 *
 * The console assembles a review card per draft — its certification, its thread, its
 * assessment — and it only ever shows one page of them. Loading every draft to project
 * twenty-five was the expensive half of `/api/state`.
 *
 * An empty id list returns nothing WITHOUT going to the database: `= ANY('{}')` is a valid
 * query that scans and matches nothing, and the round trip is pure waste on a fresh install
 * where there are no drafts at all.
 */
export async function loadDraftsByIds(db: Db, ids: string[]): Promise<Draft[]> {
  if (!ids.length) return [];
  const r = await db.query<DraftRow>(`${SELECT} WHERE id = ANY($1) ORDER BY created_at, id`, [ids]);
  return r.rows.map(toDraft);
}

export async function countDrafts(db: Db): Promise<number> {
  const r = await db.query<{ n: string }>('SELECT count(*)::text AS n FROM redbot.drafts');
  return Number(r.rows[0]?.n ?? 0);
}

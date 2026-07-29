/**
 * Certifications — Argus, across seven tables.
 *
 * APPEND-ONLY EVIDENCE, and there is deliberately no unique key on draft_id. The
 * same draft certified five times on a byte-identical build produced claim counts of
 * 0, 0, 12, 12 and 16 (DEV-HANDOVER trap 3). Every run is its own record; a schema
 * that stored one certification per draft would assert a determinism the engine has
 * been measured not to have.
 *
 * A certification is written in ONE transaction. The parent row and its claims,
 * contradictions, epistemic issues, verdict reasons, invalidations and resolution
 * signals either all land or none do — a half-written certification is a verdict
 * whose evidence disagrees with it, which is worse than no record at all.
 */
import type { Db } from '../db.js';
import { withTransaction } from '../db.js';
import type { Certification } from '../argus/types.js';

export async function insertCertification(c: Certification): Promise<number> {
  return withTransaction(async (tx) => {
    const parent = await tx.query<{ id: string }>(
      `INSERT INTO redbot.certifications
         (draft_id, thread_id, verdict, certified_at, model, model_analyze, model_draft,
          resolution_resolved, resolution_detail, refutation_ran, citations)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING id::text AS id`,
      [
        c.draftId, c.threadId, c.verdict, c.certifiedAt, c.model,
        c.models?.analyze ?? null, c.models?.draft ?? null,
        c.resolution.resolved, c.resolution.detail,
        // EB-40: distinguishes a refutation that completed and found nothing from one
        // that timed out. They produce different verdicts, so the set is recorded rather
        // than inferred from which claims were attacked.
        c.refutationRan ?? null,
        c.citations === undefined ? null : JSON.stringify(c.citations)
      ]
    );
    const certId = Number(parent.rows[0]!.id);

    // Claims first: contradictions, epistemic issues and invalidations all reference
    // (cert_id, claim_id), so the database will reject any of them that names a claim
    // this run did not actually extract.
    for (const cl of c.claims) {
      await tx.query(
        `INSERT INTO redbot.certification_claims
           (cert_id, claim_id, text, type, evidence_class, evidence_detail, confidence, depends_on, source_quote)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [certId, cl.id, cl.text, cl.type, cl.evidenceClass, cl.evidenceDetail,
         cl.confidence, cl.dependsOn ?? [], cl.sourceQuote]
      );
    }

    for (const x of c.contradictions) {
      await tx.query(
        `INSERT INTO redbot.certification_contradictions
           (cert_id, claim_id, kind, statement, evidence_class, evidence_detail, fatal)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [certId, x.claimId, x.kind, x.statement, x.evidenceClass, x.evidenceDetail, x.fatal]
      );
    }

    for (const e of c.epistemic) {
      await tx.query(
        `INSERT INTO redbot.certification_epistemic_issues
           (cert_id, claim_id, language_certainty, supported_certainty, quote, detail)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [certId, e.claimId, e.languageCertainty, e.supportedCertainty, e.quote, e.detail]
      );
    }

    for (const r of c.reasons) {
      await tx.query(
        `INSERT INTO redbot.certification_reasons (cert_id, rule, claim_id, detail)
         VALUES ($1,$2,$3,$4)`,
        [certId, r.rule, r.claimId ?? null, r.detail]
      );
    }

    for (const v of c.invalidated) {
      await tx.query(
        `INSERT INTO redbot.certification_invalidations (cert_id, claim_id, because_of)
         VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
        [certId, v.claimId, v.becauseOf]
      );
    }

    for (const s of c.resolution.signals ?? []) {
      await tx.query(
        `INSERT INTO redbot.certification_resolution_signals
           (cert_id, where_found, matched, context, by_original_poster)
         VALUES ($1,$2,$3,$4,$5)`,
        [certId, s.where, s.matched, s.context, s.byOriginalPoster]
      );
    }

    return certId;
  });
}

/* ------------------------------------------------------------------ *
 * Reading
 *
 * Six queries and an in-memory join rather than one wide join: a certification with
 * 16 claims, 16 contradictions and 16 epistemic issues would fan out to 4096 rows,
 * and every scalar on the parent would be repeated across all of them.
 * ------------------------------------------------------------------ */

type Row = Record<string, unknown>;

const group = <T>(rows: T[], key: (r: T) => number): Map<number, T[]> => {
  const m = new Map<number, T[]>();
  for (const r of rows) {
    const k = key(r);
    const list = m.get(k) ?? [];
    list.push(r);
    m.set(k, list);
  }
  return m;
};

export interface CertScope {
  /** Only certifications for these drafts — the ones on the page being assembled. */
  draftIds?: string[];
  /** Or the newest N, for the log viewer. Ignored when `draftIds` is given. */
  limit?: number;
  offset?: number;
}

/**
 * Certifications, with all six of their child tables.
 *
 * THIS IS SEVEN QUERIES, and unscoped it is seven full table scans — the heaviest read the
 * console performs, because a single certification fans out into claims, contradictions,
 * epistemic issues, reasons, invalidations and resolution signals. It was the last thing here
 * still reading everything.
 *
 * Scoping happens in two steps and cannot be done in one: the children are keyed by `cert_id`,
 * which is not known until the parents have been chosen. So the parents are narrowed first —
 * by draft, or to a page — and every child query is then restricted to exactly those ids.
 */
export async function selectCertifications(db: Db, scope: CertScope = {}): Promise<Certification[]> {
  const byDraft = Array.isArray(scope.draftIds);
  if (byDraft && !scope.draftIds?.length) return [];

  const limit = Math.floor(Number(scope.limit) || 0);
  const paged = !byDraft && limit > 0;
  const offset = Math.max(0, Math.floor(Number(scope.offset) || 0));

  const parents = await db.query<Row>(
    `SELECT id, draft_id, thread_id, verdict, certified_at, model, model_analyze, model_draft,
            resolution_resolved, resolution_detail, refutation_ran, citations
       FROM redbot.certifications
      ${byDraft ? 'WHERE draft_id = ANY($1)' : ''}
      ${paged ? 'ORDER BY id DESC LIMIT $1 OFFSET $2' : 'ORDER BY id'}`,
    byDraft ? [scope.draftIds] : (paged ? [limit, offset] : [])
  );
  if (paged) parents.rows.reverse();          // a log reads oldest-first within its page
  if (!parents.rows.length) return [];

  /* The children, restricted to the parents actually selected. `= ANY($1)` on the primary-key
     side of each foreign key, so these are index lookups rather than scans. */
  const ids = parents.rows.map((p) => Number(p.id));
  const only = 'WHERE cert_id = ANY($1)';
  const [claims, contras, epis, reasons, invalid, signals] = await Promise.all([
    db.query<Row>(`SELECT cert_id, claim_id, text, type, evidence_class, evidence_detail,
                          confidence, depends_on, source_quote
                     FROM redbot.certification_claims ${only} ORDER BY cert_id, claim_id`, [ids]),
    db.query<Row>(`SELECT cert_id, claim_id, kind, statement, evidence_class, evidence_detail, fatal
                     FROM redbot.certification_contradictions ${only} ORDER BY id`, [ids]),
    db.query<Row>(`SELECT cert_id, claim_id, language_certainty, supported_certainty, quote, detail
                     FROM redbot.certification_epistemic_issues ${only} ORDER BY id`, [ids]),
    db.query<Row>(`SELECT cert_id, rule, claim_id, detail
                     FROM redbot.certification_reasons ${only} ORDER BY id`, [ids]),
    db.query<Row>(`SELECT cert_id, claim_id, because_of
                     FROM redbot.certification_invalidations ${only} ORDER BY cert_id, claim_id`, [ids]),
    db.query<Row>(`SELECT cert_id, where_found, matched, context, by_original_poster
                     FROM redbot.certification_resolution_signals ${only} ORDER BY id`, [ids])
  ]);

  const cid = (r: Row) => Number(r.cert_id);
  const byClaims = group(claims.rows, cid);
  const byContras = group(contras.rows, cid);
  const byEpis = group(epis.rows, cid);
  const byReasons = group(reasons.rows, cid);
  const byInvalid = group(invalid.rows, cid);
  const bySignals = group(signals.rows, cid);

  return parents.rows.map((p) => {
    const id = Number(p.id);
    const c: Certification = {
      draftId: p.draft_id as string,
      threadId: p.thread_id as string,
      verdict: p.verdict as Certification['verdict'],
      certifiedAt: (p.certified_at as Date).toISOString(),
      model: p.model as string,
      claims: (byClaims.get(id) ?? []).map((r) => ({
        id: r.claim_id as string,
        text: r.text as string,
        type: r.type as never,
        evidenceClass: r.evidence_class as never,
        evidenceDetail: r.evidence_detail as string,
        confidence: r.confidence as never,
        dependsOn: (r.depends_on as string[]) ?? [],
        sourceQuote: r.source_quote as string
      })),
      contradictions: (byContras.get(id) ?? []).map((r) => ({
        claimId: r.claim_id as string,
        kind: r.kind as never,
        statement: r.statement as string,
        evidenceClass: r.evidence_class as never,
        evidenceDetail: r.evidence_detail as string,
        fatal: r.fatal as boolean
      })),
      epistemic: (byEpis.get(id) ?? []).map((r) => ({
        claimId: r.claim_id as string,
        languageCertainty: r.language_certainty as never,
        supportedCertainty: r.supported_certainty as never,
        quote: r.quote as string,
        detail: r.detail as string
      })),
      reasons: (byReasons.get(id) ?? []).map((r) => ({
        rule: r.rule as string,
        ...(r.claim_id === null ? {} : { claimId: r.claim_id as string }),
        detail: r.detail as string
      })),
      invalidated: (byInvalid.get(id) ?? []).map((r) => ({
        claimId: r.claim_id as string,
        becauseOf: r.because_of as string
      })),
      resolution: {
        resolved: p.resolution_resolved as boolean,
        detail: p.resolution_detail as string,
        signals: (bySignals.get(id) ?? []).map((r) => ({
          where: r.where_found as never,
          matched: r.matched as string,
          context: r.context as string,
          byOriginalPoster: r.by_original_poster as boolean
        }))
      }
    };
    if (p.model_analyze !== null) {
      c.models = { analyze: p.model_analyze as string, draft: (p.model_draft as string) ?? '' };
    }
    if (p.refutation_ran !== null) c.refutationRan = p.refutation_ran as string[];
    if (p.citations !== null) c.citations = p.citations as Certification['citations'];
    return c;
  });
}

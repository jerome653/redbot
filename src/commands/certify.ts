/**
 * `redbot certify [draftId] [--override]`
 *
 * Runs Argus over a draft and writes the operator review package.
 *
 * This sits between drafting and human review. A REJECT never reaches the approval prompt; an
 * ESCALATE reaches it carrying the specific question a person has to answer. Human review
 * remains mandatory in all three cases — Argus exists to improve that review, not to replace it.
 */
import { loadDrafts, loadThreads, saveDraft } from '../store.js';
import { runCertification } from '../argus/pipeline.js';
import { reviewPackage, generateArgusReports } from '../argus/reports.js';
import { record, say } from '../log.js';
import { autoBackup } from '../backup.js';

export async function certifyCmd(draftIdArg?: string, opts?: { override?: boolean }): Promise<number> {
  say.head('redbot certify — Argus');

  const drafts = await loadDrafts();
  const pending = drafts.filter((d) => d.status === 'pending');
  const target = draftIdArg ? drafts.find((d) => d.id === draftIdArg) : pending[pending.length - 1];

  if (!target) {
    say.warn(draftIdArg ? `No draft with id ${draftIdArg}.` : 'No pending drafts to certify.');
    return 1;
  }

  const thread = (await loadThreads()).find((t) => t.id === target.threadId);
  if (!thread) {
    say.fail(`Thread ${target.threadId} is missing from threads.json — cannot certify without it.`);
    return 1;
  }

  say.step(`Draft  : ${target.id}`);
  say.step(`Thread : ${thread.title.slice(0, 70)}`);
  if (opts?.override) say.warn('--override: continuing past a resolved thread on explicit human instruction.');

  const cert = await runCertification(target, thread, {
    verbose: true,
    ...(opts?.override ? { override: true } : {})
  });

  /**
   * Persist the verdict onto the draft so the publish gate can consult it. Before this, the
   * certification existed only in certifications.jsonl and the reports, and `redbot reply`
   * never read it — a REJECT could still be approved and posted (evaluation H6). Written even
   * on REJECT/ESCALATE: the gate needs to see exactly those.
   */
  target.certification = {
    verdict: cert.verdict,
    at: cert.certifiedAt,
    claims: cert.claims.length,
    fatalContradictions: cert.contradictions.filter((c) => c.fatal).length
  };
  await saveDraft(target);

  const pkg = reviewPackage(cert, target, thread.title);
  await generateArgusReports();

  say.info('');
  // say.ok/warn/fail already prefix their own marker — adding another produced "X   X   REJECT".
  if (cert.verdict === 'CERTIFIED') say.ok(cert.verdict);
  else if (cert.verdict === 'ESCALATE') say.warn(cert.verdict);
  else say.fail(cert.verdict);

  for (const r of cert.reasons) {
    const text = `  [${r.rule}]${r.claimId ? ` ${r.claimId}` : ''} ${r.detail}`;
    if (cert.verdict === 'REJECT') say.fail(text);
    else say.warn(text);
  }

  say.info('');
  say.step(`Claims        : ${cert.claims.length}`);
  say.step(`Contradictions: ${cert.contradictions.length} (${cert.contradictions.filter((c) => c.fatal).length} fatal)`);
  say.step(`Overconfident : ${cert.epistemic.length}`);
  say.step(`Invalidated   : ${cert.invalidated.length}`);
  say.info('');
  say.ok(pkg.replace(/.*[/\\]reports[/\\]/, 'reports/'));

  await record('gate.block', `argus ${cert.verdict} for ${target.id}`, {
    draftId: target.id,
    verdict: cert.verdict,
    rules: cert.reasons.map((r) => r.rule),
    claims: cert.claims.length
  });

  /**
   * EB-28 / D-04. A certification is expensive to produce — 12 to 19 model calls, minutes of
   * wall clock — and it is evidence that cannot be recreated identically. Snapshot it now.
   * Never fatal: a backup problem must not turn a completed certification into a failure.
   */
  const backup = autoBackup();
  if (!backup.ok) say.warn(`evidence backup skipped — ${backup.detail}`);

  if (cert.verdict === 'REJECT') {
    say.step('Not publishable. Reject it at the prompt so the reason enters the review dataset.');
    return 1;
  }
  if (cert.verdict === 'ESCALATE') {
    say.step('Needs a person who knows the subject. Read the package before the draft.');
    return 0;
  }
  say.step('Supported — a human still reviews it. `redbot reply` next.');
  return 0;
}

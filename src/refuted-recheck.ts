/**
 * Fix-and-recheck, the I/O half (the pure half is src/refuted-strip.ts).
 *
 * After a REJECT that a deletion can answer, the sentences carrying the refuted claims are taken
 * out, the shorter body runs the same checks a fresh draft runs, and it is saved as a NEW draft and
 * certified exactly ONCE. The original is marked `rejected`. Any doubt keeps the original REJECT and
 * records why, so the worst this step can do is cost one certification and publish nothing.
 */
import { loadDrafts, saveDraft, loadGaps, loadAccountPersona, appendHistory } from './store.js';
import { getPool } from './db.js';
import { selectCertifications } from './db/certifications.js';
import { strippedFrom } from './db/history.js';
import { loadThreadsFromDb } from './db/threads.js';
import { config, selectedAccount } from './config.js';
import { lintDraft } from './disclosure.js';
import { checkNovelty } from './novelty.js';
import { loadDraftChecks, draftBlocks, newDraftId } from './commands/draft.js';
import { planStrip } from './refuted-strip.js';
import { record, say } from './log.js';
import type { Draft } from './types.js';

type Prepared = { why: string } | { old: Draft; next: Draft; removed: number; quotes: string[] };

async function prepare(draftId: string): Promise<Prepared> {
  const drafts = await loadDrafts();
  const old = drafts.find((d) => d.id === draftId);
  if (!old) return { why: 'the draft is missing' };
  if (old.status !== 'pending') return { why: `the draft is already ${old.status}` };

  const db = getPool();
  const plan = planStrip({
    body: old.body,
    certs: await selectCertifications(db, { draftIds: [draftId] }),
    protect: [config.brand.disclosureLine, config.aiDisclosureLine],
    fromStrip: (await strippedFrom(db, draftId)) !== null
  });
  if (!plan.ok) return { why: plan.why };

  const [thread] = await loadThreadsFromDb(db, [old.threadId]);
  if (!thread) return { why: 'its thread is missing' };
  const lint = lintDraft(plan.body);
  if (lint.hasDisclosure !== old.hasDisclosure) return { why: 'the disclosure check would change' };
  const gap = (await loadGaps()).find((g) => g.threadId === old.threadId);
  const novelty = gap ? checkNovelty(plan.body, old.contribution?.whatNew ?? '', gap.covered).issues : (old.noveltyIssues ?? []);
  const checks = await loadDraftChecks(thread, await loadAccountPersona(selectedAccount()?.handle));
  const blocked = draftBlocks(checks, plan.body, novelty);
  if (blocked.length) return { why: `the shorter reply would be blocked by ${blocked.map((b) => b.gate).join(', ')}` };

  /* The existing id scheme, one millisecond on if that id is somehow taken — an upsert onto the
     original's id would overwrite the evidence this step is meant to keep. */
  let at = Date.now();
  while (drafts.some((d) => d.id === newDraftId(old.threadId, at))) at++;
  const next: Draft = {
    id: newDraftId(old.threadId, at), threadId: old.threadId, permalink: old.permalink, title: old.title,
    body: plan.body,
    ...(old.contribution ? { contribution: old.contribution } : {}),
    noveltyIssues: novelty, hasDisclosure: lint.hasDisclosure, lintIssues: lint.issues,
    createdAt: new Date().toISOString(), model: old.model,
    ...(old.account ? { account: old.account } : {}),
    status: 'pending'
  };
  return { old, next, removed: plan.removed, quotes: plan.quotes };
}

/**
 * Returns the id the publish decision should run on: the new draft's when a strip happened, the
 * original's otherwise. `certify` is certifyCmd in production and a stub in tests.
 */
export async function recheckWithoutRefuted(
  draftId: string, certify: (id: string) => Promise<number>
): Promise<string> {
  let p: Prepared;
  try { p = await prepare(draftId); } catch (e) { p = { why: e instanceof Error ? e.message : String(e) }; }
  if ('why' in p) {
    say.step(`Refuted-claim strip refused for ${draftId}: ${p.why}. The original verdict stands.`);
    await record('draft.rewrite', `refuted-claim strip refused for ${draftId}`, { stage: 'refuted', from: draftId, refused: p.why });
    return draftId;
  }
  const { old, next, removed, quotes } = p;

  /* THE LINK FIRST, and through appendHistory rather than record(): record() swallows a failed
     write, and this row is what stops the new draft from ever being stripped again. If it cannot be
     written, nothing else is either. */
  await appendHistory({
    ts: new Date().toISOString(), kind: 'draft.rewrite', account: old.account ?? null, threadUrl: old.permalink,
    summary: `removed ${removed} sentence(s) carrying a refuted claim from ${old.id}`,
    data: { stage: 'refuted', from: old.id, to: next.id, removed, quotes }
  });
  await saveDraft(next);
  await saveDraft({ ...old, status: 'rejected', decidedAt: new Date().toISOString() });
  say.step(`Refuted-claim strip: removed ${removed} sentence(s) from ${old.id}; fact-checking ${next.id} once more…`);
  await certify(next.id);
  return next.id;
}

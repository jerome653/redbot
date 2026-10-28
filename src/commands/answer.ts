/**
 * Draft a reply-back: one answer to one person who replied to our comment (src/reply-back.ts).
 *
 * It DRAFTS ONLY. The saved draft goes to `factCheckThenPublish` like every other comment, so
 * certification, the REDDIT publish bar, the gates (spacing, ceiling, health, warming pace, the
 * reply-level duplicate and age rules) and the karma floor decide — never this file. The checks
 * here only stop a body the gate would refuse anyway from costing a certification run.
 */
import { loadThreads, loadDrafts, saveDraft, loadAccountPersona } from '../store.js';
import { complete, extractJson } from '../llm.js';
import { replyBackPrompt } from '../prompts.js';
import { bannedPhraseHits } from '../persona.js';
import { lintDraft } from '../disclosure.js';
import { checkWarmingComment } from '../warming.js';
import { config } from '../config.js';
import { record, say } from '../log.js';
import { replyBackDraftId, type UnansweredReply } from '../reply-back.js';
import type { Draft } from '../types.js';

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

export async function replyBackDraft(c: UnansweredReply, account: string): Promise<{ draftId: string | null; why: string }> {
  const ours = (await loadDrafts()).find((d) => d.id === c.draftId);
  const thread = (await loadThreads()).find((t) => t.id === c.threadId);
  if (!ours || !thread) return { draftId: null, why: 'our comment or its thread is no longer on record' };

  const persona = await loadAccountPersona(account);
  let parsed: { decline?: unknown; why?: unknown; comment?: unknown };
  try {
    parsed = extractJson(await complete({
      prompt: replyBackPrompt(thread, ours.body, { author: c.author, body: c.body }, persona),
      model: config.llm.draftModel, maxTokens: 500, temperature: 0.5
    }));
  } catch (e) {
    return { draftId: null, why: `model call failed: ${e instanceof Error ? e.message : String(e)}` };
  }
  const body = str(parsed.comment);
  if (parsed.decline === true || !body) {
    await record('draft.declined', `reply-back declined for ${c.parentThingId}`, { threadId: c.threadId, account, replyBack: true, parentThingId: c.parentThingId });
    return { draftId: null, why: `declined — ${str(parsed.why) || 'nothing useful to add'}` };
  }

  /* Same three pre-checks the warmup applies; the gate applies them again. */
  const lint = lintDraft(body);
  const warm = checkWarmingComment(body);
  const banned = bannedPhraseHits(body, persona);
  const why = [...lint.issues, ...warm.issues.map((i) => i.rule), ...banned.map((p) => `persona: "${p}"`)];
  if (!lint.ok || !warm.ok || banned.length) {
    await record('gate.block', `reply-back refused before saving for ${c.parentThingId}`, { account, rules: why, replyBack: true });
    return { draftId: null, why: `refused before saving: ${why.join(', ')}` };
  }

  const saved: Draft = {
    id: replyBackDraftId(c.parentThingId, c.draftId),
    threadId: c.threadId, permalink: ours.permalink, title: ours.title, body,
    hasDisclosure: lint.hasDisclosure, lintIssues: lint.issues,
    createdAt: new Date().toISOString(), model: config.llm.draftModel, account, status: 'pending'
  };
  await saveDraft(saved);
  say.ok(`Saved ${saved.id} — an answer to u/${c.author}.`);
  await record('draft', `reply-back drafted for ${c.parentThingId}`, {
    draftId: saved.id, threadId: c.threadId, account, replyBack: true, parentDraftId: c.draftId, parentThingId: c.parentThingId
  });
  return { draftId: saved.id, why: 'saved' };
}

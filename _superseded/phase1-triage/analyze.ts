/**
 * `redbot analyze`
 *
 * Scores collected threads for reply-worthiness. Batched, because a Claude CLI call costs
 * about 28 seconds and doing 25 threads one at a time would take 11 minutes.
 */
import { loadThreads, loadOpportunities, saveOpportunities } from '../store.js';
import { complete, extractJson } from '../llm.js';
import { analyzeBatchPrompt } from '../prompts.js';
import { config } from '../config.js';
import { record, say } from '../log.js';
import type { Opportunity, Thread } from '../types.js';

interface Verdict {
  index: number;
  worthwhile: boolean;
  priority: number;
  confidence: number;
  category: string;
  reason: string;
  angle: string;
  answerableWithoutPitch: boolean;
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function analyze(force = false): Promise<number> {
  say.head('redbot analyze');

  const threads = loadThreads();
  if (!threads.length) {
    say.warn('No threads collected yet. Run `redbot read <subreddit>` first.');
    return 1;
  }

  const existing = loadOpportunities();
  const done = new Set(existing.map((o) => o.threadId));
  const todo = force ? threads : threads.filter((t) => !done.has(t.id));

  if (!todo.length) {
    say.ok('Everything already analyzed. Use --force to redo.');
    return 0;
  }

  const batches = chunk(todo, config.llm.analyzeBatchSize);
  say.step(
    `${todo.length} thread(s) in ${batches.length} batch(es) via ${config.llm.provider} ` +
    `(${config.llm.analyzeModel})`
  );

  const results: Opportunity[] = [];
  let failed = 0;

  for (const [bi, batch] of batches.entries()) {
    const started = Date.now();
    try {
      const raw = await complete({
        prompt: analyzeBatchPrompt(batch),
        model: config.llm.analyzeModel,
        maxTokens: 2000,
        temperature: 0.2
      });
      const verdicts = extractJson<Verdict[]>(raw);
      if (!Array.isArray(verdicts)) throw new Error('model did not return an array');

      for (const v of verdicts) {
        const t: Thread | undefined = batch[v.index];
        if (!t) continue;
        results.push({
          threadId: t.id,
          permalink: t.permalink,
          title: t.title,
          worthwhile: Boolean(v.worthwhile),
          score: Math.max(0, Math.min(100, Number(v.priority) || 0)),
          confidence: Math.max(0, Math.min(100, Number(v.confidence) || 0)),
          category: String(v.category ?? 'uncategorised'),
          reason: String(v.reason ?? ''),
          angle: String(v.angle ?? ''),
          answerableWithoutPitch: Boolean(v.answerableWithoutPitch),
          analyzedAt: new Date().toISOString(),
          model: config.llm.analyzeModel
        });
      }
      const secs = ((Date.now() - started) / 1000).toFixed(1);
      say.step(`  batch ${bi + 1}/${batches.length}: ${verdicts.length} scored in ${secs}s`);
    } catch (e) {
      failed += batch.length;
      say.warn(`  batch ${bi + 1}/${batches.length} failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (results.length) saveOpportunities(results);

  const usable = results
    .filter((o) => o.worthwhile && o.answerableWithoutPitch)
    .sort((a, b) => b.score - a.score);

  say.ok(`${results.length} analyzed, ${usable.length} worth answering${failed ? `, ${failed} failed` : ''}.`);

  for (const o of usable.slice(0, 5)) {
    say.step(`  ${String(o.score).padStart(3)}  conf ${String(o.confidence).padStart(3)}  ${o.category.padEnd(22)} ${o.title.slice(0, 48)}`);
    if (o.angle) say.step(`       angle: ${o.angle.slice(0, 84)}`);
  }
  if (usable.length) say.step('Next: redbot draft');

  record('analyze', `${results.length} analyzed, ${usable.length} worthwhile`, {
    subreddit: null, analyzed: results.length, worthwhile: usable.length, failed, provider: config.llm.provider
  });

  return results.length ? 0 : 1;
}

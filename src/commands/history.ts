/**
 * `redbot history [n]`
 *
 * Prints the local activity log — everything redbot did, in order.
 */
import { loadHistory, loadDrafts } from '../store.js';
import { say } from '../log.js';

export async function history(limitArg?: string): Promise<number> {
  const limit = Number(limitArg) > 0 ? Number(limitArg) : 40;
  const entries = await loadHistory();

  say.head('redbot history');

  if (!entries.length) {
    say.warn('Nothing recorded yet.');
    return 0;
  }

  for (const e of entries.slice(-limit)) {
    const when = e.ts.replace('T', ' ').slice(0, 19);
    say.info(`${when}  ${e.kind.padEnd(16)} ${e.summary}`);
  }

  const drafts = await loadDrafts();
  const counts = drafts.reduce<Record<string, number>>((acc, d) => {
    acc[d.status] = (acc[d.status] ?? 0) + 1;
    return acc;
  }, {});

  say.info('');
  say.step(
    `Drafts: ${drafts.length} total` +
    (Object.keys(counts).length
      ? ` (${Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')})`
      : '')
  );
  say.step(`Log entries: ${entries.length}`);
  return 0;
}

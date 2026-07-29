import { appendHistory } from './store.js';
import type { HistoryKind, HistoryEntry } from './types.js';

/** The account the current run is acting as. Set once per run, stamped on every entry. */
let currentAccount: string | null = null;
export function setAccount(name: string | null): void { currentAccount = name; }
export function getAccount(): string | null { return currentAccount; }

const KNOWN = ['account', 'subreddit', 'threadUrl', 'permalink', 'status'] as const;

/**
 * Anything not a known HistoryEntry field is tucked into `data`, so callers can pass
 * whatever context is useful without the log schema fighting them.
 */
export async function record(kind: HistoryKind, summary: string, extra: Record<string, unknown> = {}): Promise<void> {
  const entry: HistoryEntry = {
    ts: new Date().toISOString(),
    kind,
    account: (extra.account as string | null | undefined) ?? currentAccount,
    summary
  };
  const data: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(extra)) {
    if (k === 'account') continue;
    if ((KNOWN as readonly string[]).includes(k)) (entry as unknown as Record<string, unknown>)[k] = v;
    else data[k] = v;
  }
  if (Object.keys(data).length) entry.data = data;
  await appendHistory(entry);
}

export const say = {
  info: (m: string) => console.log(m),
  step: (m: string) => console.log(`  ${m}`),
  ok: (m: string) => console.log(`  OK  ${m}`),
  warn: (m: string) => console.warn(`  !   ${m}`),
  fail: (m: string) => console.error(`  X   ${m}`),
  head: (m: string) => console.log(`\n${m}\n${'-'.repeat(m.length)}`)
};

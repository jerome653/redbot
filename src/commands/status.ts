/**
 * Read-only reporting commands: health, metrics, policy, select.
 *
 * None of them touch Reddit. They exist so the state that gates publishing can be inspected
 * before a person is standing at the approval prompt.
 */
import { health } from '../health.js';
import { computeMetrics, formatRate } from '../metrics.js';
import { policy, limitsByProvenance, type PolicyKey } from '../policy.js';
import { rankCandidates } from '../select.js';
import { loadReviews, summarizeReviews } from '../review.js';
import { generateAll } from '../reports.js';
import { computeInsights } from '../insights.js';
import { loadThreads, loadAssessments } from '../store.js';
import { say } from '../log.js';

/* ------------------------------------------------------------------ */

export function healthCmd(account?: string): number {
  const v = health(account ?? null);
  say.head(`redbot health — ${v.state}`);

  const c = v.counters;
  say.step(`Account        : ${c.account ?? '(all accounts in the log)'}`);
  say.step(`May publish    : ${v.mayPublish ? 'yes' : 'NO'}${v.resumeAt ? ` (resumes ${v.resumeAt})` : ''}`);
  say.info('');
  say.step(`Reads today    : ${c.readsToday}`);
  say.step(`Searches today : ${c.searchesToday}`);
  say.step(`Replies today  : ${c.repliesToday} / ${policy.maxRepliesPerDay.value}`);
  say.step(`Avg session    : ${c.avgSessionMs == null ? 'no data' : Math.round(c.avgSessionMs / 1000) + 's'}`);
  say.step(`Avg dwell      : ${c.avgDwellMs == null ? 'no data' : Math.round(c.avgDwellMs / 1000) + 's'}`);
  say.step(`429s (24h)     : ${c.rateLimitHits24h}`);
  say.step(`Login failures : ${c.loginFailures24h}`);
  say.step(`Removals (30d) : ${c.removalsObserved30d}   observed, not inferred`);
  say.step(`Absent to a signed-out browser (30d): ${c.absentSignedOut30d}`);
  say.step(`Account age    : ${c.accountAgeDays == null ? 'never measured' : c.accountAgeDays + ' days'}`);
  say.step(`Karma          : ${c.karma == null ? 'never measured' : c.karma}`);
  say.info('');
  for (const r of v.reasons) say.step(`- ${r}`);
  return 0;
}

/* ------------------------------------------------------------------ */

export function metricsCmd(asJson = false): number {
  const m = computeMetrics();
  if (asJson) {
    console.log(JSON.stringify(m, null, 2));
    return 0;
  }

  say.head('redbot metrics');
  say.step(`Window: ${m.window.from ?? '—'} → ${m.window.to ?? '—'} (${m.window.days} days, ${m.sessions.distinctDays} with a session)`);
  say.info('');
  say.step('Sessions');
  say.step(`  started/completed : ${m.sessions.started}/${m.sessions.completed}`);
  say.step(`  success rate      : ${formatRate(m.sessions.successRate)}`);
  say.step(`  average duration  : ${m.sessions.avgDurationMs == null ? 'no data' : Math.round(m.sessions.avgDurationMs / 1000) + 's'}`);
  say.info('');
  say.step('Drafts');
  say.step(`  generated         : ${m.drafts.generated} (${m.drafts.lintClean} lint-clean)`);
  say.step(`  approval rate     : ${formatRate(m.drafts.approvalRate)}`);
  say.info('');
  say.step('Publishing');
  say.step(`  attempts          : ${m.publishing.attempts}`);
  say.step(`  success rate      : ${formatRate(m.publishing.successRate)}`);
  say.step(`  blocked by gates  : ${m.publishing.blockedByGates}`);
  say.info('');
  say.step('Reliability');
  say.step(`  page loads        : ${m.reliability.pageLoads}`);
  say.step(`  429s              : ${m.reliability.rateLimitHits} (${formatRate(m.reliability.rateLimitPer100Loads)} per 100 loads)`);
  say.step(`  selector misses   : ${m.reliability.selectorMisses}`);
  say.step(`  browser crashes   : ${m.reliability.browserCrashes}`);
  say.step(`  errors            : ${m.reliability.errors}`);
  say.info('');
  say.step('Login');
  say.step(`  successes/failures: ${m.login.successes}/${m.login.failures}`);
  say.step(`  longest clean run : ${m.login.longestCleanRunDays == null ? 'no data' : m.login.longestCleanRunDays + ' days with a session'}`);
  say.info('');
  say.warn('Rates over small samples are printed with their denominator on purpose. A 1/1 is not 100%.');
  return 0;
}

/* ------------------------------------------------------------------ */

export function policyCmd(): number {
  say.head('redbot policy — operational limits and where they came from');
  const groups = limitsByProvenance();

  const show = (title: string, keys: PolicyKey[], note: string) => {
    say.info('');
    say.step(`${title} (${keys.length})  — ${note}`);
    for (const k of keys) {
      const l = policy[k];
      say.step(`  ${k} = ${l.value} ${l.unit}`);
      say.step(`      ${l.why}${l.evidence ? `  [${l.evidence}]` : ''}`);
    }
  };

  show('MEASURED', groups.measured, 'derived from a recorded observation in this repo');
  show('DECLARED', groups.declared, 'a rule we chose to follow — a decision, not a finding');
  show('PROVISIONAL', groups.provisional, 'placeholders. Do not quote these as results');

  say.info('');
  say.warn(
    `${groups.provisional.length} of ${groups.measured.length + groups.declared.length + groups.provisional.length} ` +
    `limits are still placeholders. The pilot exists to replace them with measurements.`
  );
  return 0;
}

/* ------------------------------------------------------------------ */

export function reviewCmd(): number {
  const reviews = loadReviews();
  const s = summarizeReviews(reviews);

  say.head(`redbot review — ${s.total} decision(s) on record`);

  if (!s.total) {
    say.warn('The review dataset is empty. It fills as drafts are decided at `redbot reply`.');
    say.step('Until then, every rate derived from it reads "no data (0 samples)" — by design.');
    return 0;
  }

  say.step(`Approved as written : ${s.approved}`);
  say.step(`Approved after edit : ${s.edited}`);
  say.step(`Rejected            : ${s.rejected}`);
  say.step(`Publishable rate    : ${s.publishableRate === null ? 'no data' : Math.round(s.publishableRate * 100) + '%'} (n=${s.total})`);
  say.step(`As-written rate     : ${s.asWrittenRate === null ? 'no data' : Math.round(s.asWrittenRate * 100) + '%'} (n=${s.total})`);
  if (s.meanRetention !== null) {
    say.step(`Text kept per edit  : ${Math.round(s.meanRetention * 100)}%`);
  }

  say.info('');
  say.step('By reason:');
  for (const r of s.byReason) say.step(`  ${String(r.count).padStart(3)}  ${r.decision}: ${r.code}`);
  return 0;
}

export function insightsCmd(): number {
  const i = computeInsights();
  say.head('redbot insights — where the pipeline is losing candidates');

  say.step('Funnel');
  let prev: number | null = null;
  for (const f of i.funnel) {
    const drop = prev !== null && prev > 0 ? ` (${Math.round((f.count / prev) * 100)}% of previous)` : '';
    say.step(`  ${String(f.count).padStart(4)}  ${f.stage.padEnd(20)}${drop}  — ${f.note}`);
    prev = f.count;
  }

  say.info('');
  say.step(`Improvement signals (${i.signals.length})`);
  if (!i.signals.length) say.step('  none — not enough has run to say anything useful');
  for (const s of i.signals) {
    const tag = s.severity === 'act' ? 'ACT ' : s.severity === 'watch' ? 'WATCH' : 'INFO';
    const line = `  [${tag}] ${s.stage}: ${s.finding}`;
    if (s.severity === 'act') say.warn(line);
    else say.step(line);
    say.step(`          evidence: ${s.evidence}`);
  }

  if (i.timings.length) {
    say.info('');
    say.step('Stage timings');
    for (const t of i.timings.slice(0, 8)) {
      say.step(`  ${t.stage}:${t.event} — n=${t.count} median ${t.medianMs}ms max ${t.maxMs}ms`);
    }
  }

  say.info('');
  say.step(`${i.traceEvents} trace event(s) across ${i.runs} run(s) — data/trace.jsonl`);
  return 0;
}

export function reportCmd(): number {
  say.head('redbot report');
  const paths = generateAll();
  for (const p of paths) say.ok(p.replace(/.*[/\\]reports[/\\]/, 'reports/'));
  say.info('');
  say.step('Reports are regenerated from the files on disk every run — never hand-edited.');
  return 0;
}

export function selectCmd(showAll = false): number {
  const candidates = rankCandidates(loadThreads(), loadAssessments());
  if (!candidates.length) {
    say.warn('Nothing assessed yet. Run `redbot read` then `redbot opportunity`.');
    return 1;
  }

  const eligible = candidates.filter((c) => c.eligible);
  say.head(`redbot select — ${eligible.length} eligible of ${candidates.length} assessed`);

  const shown = showAll ? candidates : candidates.slice(0, Math.max(5, eligible.length));

  for (const c of shown) {
    say.info('');
    say.step(`${c.eligible ? '✓' : '✗'} ${c.title.slice(0, 72)}`);
    say.step(`   r/${c.subreddit} · opportunity ${c.score} · ${c.threadId}`);
    say.step(`   ${c.permalink}`);
    for (const crit of c.criteria) {
      say.step(`     ${crit.pass ? 'pass' : 'FAIL'}  ${crit.name}${crit.proxy ? ' (proxy)' : ''} — ${crit.detail}`);
    }
  }

  say.info('');
  if (!eligible.length) {
    say.warn('No thread passes every criterion. That is a valid outcome — read more rather than relaxing one.');
    return 1;
  }
  const top = eligible[0]!;
  say.ok(`Pilot pick: ${top.threadId} — ${top.title.slice(0, 60)}`);
  say.step(`Next: redbot draft ${top.threadId}   then   redbot reply`);
  return 0;
}

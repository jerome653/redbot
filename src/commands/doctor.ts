/**
 * `redbot doctor` — is the installation itself sound?
 *
 * Distinct from `redbot health`, and the distinction matters:
 *
 *   redbot health   is the ACCOUNT well? (karma, removals, cooldowns — Reddit-facing)
 *   redbot doctor   is the INSTALL well? (build, auth, data integrity, secrets, staleness)
 *
 * A green account on a stale build is not a working system, and the failure mode that
 * produces — running yesterday's compiled code against today's source and believing the
 * result — is exactly the kind that survives a test suite.
 *
 * Exit code is 1 if any check FAILs, so this can gate a run.
 */
import { existsSync, statSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, DATA, paths, config, claudeConfigDir, OperatorAuthError } from '../config.js';
import { isBrowserUp } from '../browser.js';
import { policy, limitsByProvenance } from '../policy.js';
import { loadDrafts, loadThreads, loadGaps, loadAssessments } from '../store.js';
import { loadObservations } from '../health.js';
import { loadReviews, loadRegrets } from '../review.js';
import { loadTrace } from '../trace.js';
import { say } from '../log.js';
import { hoursSinceLastBackup, listSnapshots } from '../backup.js';

type Status = 'PASS' | 'WARN' | 'FAIL';

interface Check {
  name: string;
  status: Status;
  detail: string;
}

/**
 * The ACTIVE rules in a .gitignore — non-blank lines that are not comments.
 *
 * The secret-protection check used to substring-match the whole file, including its comment
 * header, which happens to quote `data/chrome-profile/Default/Cookies`. So deleting the real
 * ignore rule still "passed" because the comment about it survived (evaluation M6). Matching
 * only active rules means a pattern has to actually be in force, not merely mentioned.
 */
export function gitignoreActivePatterns(text: string): string[] {
  return text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0 && !l.startsWith('#'));
}

/** Newest mtime under a directory tree, recursively. */
function newestMtime(dir: string, ext: string): number {
  let newest = 0;
  const walk = (d: string): void => {
    for (const entry of readdirSync(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(ext)) newest = Math.max(newest, statSync(full).mtimeMs);
    }
  };
  try { walk(dir); } catch { /* missing directory is reported by its own check */ }
  return newest;
}

export async function doctor(): Promise<number> {
  say.head('redbot doctor');
  const checks: Check[] = [];
  const add = (name: string, status: Status, detail: string) => checks.push({ name, status, detail });

  /* ---- runtime ---- */
  const major = Number(process.versions.node.split('.')[0]);
  add('node version', major >= 20 ? 'PASS' : 'FAIL', `${process.versions.node} (needs >= 20)`);

  /* ---- build freshness: the check that catches "I fixed it but ran the old code" ---- */
  const distDir = join(ROOT, 'dist');
  if (!existsSync(distDir)) {
    add('build', 'FAIL', 'dist/ does not exist — run `npm run build`');
  } else {
    const srcNewest = newestMtime(join(ROOT, 'src'), '.ts');
    const distNewest = newestMtime(distDir, '.js');
    const stale = srcNewest > distNewest;
    const drift = Math.round((srcNewest - distNewest) / 1000);
    add(
      'build freshness',
      stale ? 'FAIL' : 'PASS',
      stale
        ? `source is ${drift}s newer than the build — you are running old code. Run \`npm run build\``
        : 'compiled output is newer than every source file'
    );
  }

  /* ---- data integrity ---- */
  if (!existsSync(DATA)) {
    add('data directory', 'WARN', `${DATA} does not exist yet — created on first write`);
  } else {
    const counts: string[] = [];
    let broken = 0;
    for (const [label, file] of [
      ['threads', paths.threads], ['analysis', paths.analysis], ['gaps', paths.gaps],
      ['assessments', paths.assessments], ['drafts', paths.drafts]
    ] as const) {
      if (!existsSync(file)) { counts.push(`${label} 0`); continue; }
      try {
        const parsed = JSON.parse(readFileSync(file, 'utf8')) as unknown[];
        counts.push(`${label} ${Array.isArray(parsed) ? parsed.length : '?'}`);
      } catch {
        broken++;
        counts.push(`${label} UNREADABLE`);
      }
    }
    add('data files', broken ? 'FAIL' : 'PASS', counts.join(' · '));

    const stray = readdirSync(DATA).filter((f) => f.endsWith('.tmp'));
    add(
      'atomic writes',
      stray.length ? 'WARN' : 'PASS',
      stray.length ? `${stray.length} leftover .tmp file(s) — a write was interrupted` : 'no interrupted writes'
    );
  }

  /* ---- secrets: the DEFECT-01 guard ---- */
  const gitignore = join(ROOT, '.gitignore');
  if (!existsSync(gitignore)) {
    add('secret protection', 'FAIL', 'no .gitignore — Chrome profiles and session cookies are committable');
  } else {
    const text = readFileSync(gitignore, 'utf8');
    const active = gitignoreActivePatterns(text);
    const required = ['data/chrome-profile', 'data/operators', 'data/*.json', 'data/*.jsonl'];
    // Match against active rules only — a pattern that appears solely in a comment does not count.
    const missing = required.filter((r) => !active.some((line) => line.includes(r)));
    add(
      'secret protection',
      missing.length ? 'FAIL' : 'PASS',
      missing.length ? `.gitignore is missing: ${missing.join(', ')}` : `all ${required.length} required patterns present`
    );
  }

  /* ---- evidence backup (EB-28 / D-04) ---- */
  {
    const snaps = listSnapshots();
    const hrs = hoursSinceLastBackup();
    if (!snaps.length) {
      add('evidence backup', 'FAIL',
        'no snapshot exists — the evidence is on one machine with no copy. Run `redbot backup`');
    } else if (hrs != null && hrs > 24) {
      add('evidence backup', 'WARN',
        `newest snapshot is ${Math.round(hrs)}h old (${snaps.length} total) — run \`redbot backup\``);
    } else {
      add('evidence backup', 'PASS', `${snaps.length} snapshot(s), newest ${hrs == null ? 'unknown age' : Math.round(hrs) + 'h old'}`);
    }
  }

  /* ---- llm auth ---- */
  try {
    const dir = claudeConfigDir();
    const exists = existsSync(dir);
    add(
      'llm operator',
      exists ? 'PASS' : 'WARN',
      `${config.llm.provider} · operator "${config.llm.operator ?? '(unset)'}" · ${dir}${exists ? '' : ' (directory missing — sign in there first)'}`
    );
  } catch (e) {
    add('llm operator', e instanceof OperatorAuthError ? 'FAIL' : 'WARN',
      e instanceof Error ? e.message.split('\n')[0]! : String(e));
  }

  /* ---- browser ---- */
  const up = await isBrowserUp();
  add('debuggable chrome', up ? 'PASS' : 'WARN',
    up ? `reachable at ${config.browser.cdpEndpoint}` : `nothing at ${config.browser.cdpEndpoint} — reading and publishing will refuse`);

  /* ---- pipeline staleness ---- */
  const drafts = loadDrafts();
  const pending = drafts.filter((d) => d.status === 'pending');
  const stalePending = pending.filter((d) => Date.now() - Date.parse(d.createdAt) > 24 * 3_600_000);
  add(
    'pending drafts',
    stalePending.length ? 'WARN' : 'PASS',
    pending.length
      ? `${pending.length} pending, ${stalePending.length} older than 24h (the stale-draft gate will refuse those)`
      : 'none pending'
  );

  const threads = loadThreads();
  const freshThreads = threads.filter(
    (t) => t.ageMinutes != null && t.ageMinutes / 60 <= policy.maxThreadAgeHoursToPublish.value
  ).length;
  add(
    'corpus freshness',
    freshThreads === 0 && threads.length > 0 ? 'WARN' : 'PASS',
    `${freshThreads} of ${threads.length} collected threads are inside the ${policy.maxThreadAgeHoursToPublish.value}h window`
  );

  /* ---- observation debt ---- */
  const published = drafts.filter((d) => d.status === 'published');
  const observations = loadObservations();
  if (published.length) {
    const due = published.filter((d) => {
      const hours = (Date.now() - Date.parse(d.decidedAt ?? d.createdAt)) / 3_600_000;
      const seen = observations.filter((o) => o.permalink === (d.commentPermalink ?? d.publishedUrl)).length;
      return hours >= 1 && seen < 2;
    });
    add('observation debt', due.length ? 'WARN' : 'PASS',
      due.length ? `${due.length} published repl(y/ies) are due a checkpoint — run \`redbot observe\`` : 'all checkpoints up to date');
  } else {
    add('observation debt', 'PASS', 'nothing published, nothing to observe');
  }

  /* ---- operator-judgement debt ---- */
  // The 24h regret check is the highest-value signal in the system and the easiest to forget,
  // because nothing breaks when it is skipped. Surfacing it here is the only reminder there is.
  const regrets = loadRegrets();
  const regretDue = published.filter((d) => {
    const hours = (Date.now() - Date.parse(d.decidedAt ?? d.createdAt)) / 3_600_000;
    return hours >= 24 && !regrets.some((r) => r.draftId === d.id && r.kind === 'regret');
  });
  const standaloneDue = published.filter(
    (d) => !regrets.some((r) => r.draftId === d.id && r.kind === 'standalone')
  );
  add(
    'operator judgement',
    regretDue.length || standaloneDue.length ? 'WARN' : 'PASS',
    published.length
      ? `${standaloneDue.length} publish-time check(s) and ${regretDue.length} 24h regret check(s) outstanding — run \`redbot regret\``
      : 'nothing published, nothing to stand behind yet'
  );

  /* ---- measurement debt ---- */
  const prov = limitsByProvenance();
  add(
    'measured limits',
    prov.provisional.length > prov.measured.length ? 'WARN' : 'PASS',
    `${prov.measured.length} measured · ${prov.declared.length} declared · ${prov.provisional.length} provisional placeholders`
  );

  const reviews = loadReviews();
  add(
    'review dataset',
    reviews.length === 0 ? 'WARN' : 'PASS',
    reviews.length
      ? `${reviews.length} operator decision(s) recorded`
      : 'empty — draft quality is unmeasured until drafts are decided at the approval prompt'
  );

  /* ---- telemetry ---- */
  const events = loadTrace();
  add('telemetry', events.length ? 'PASS' : 'WARN',
    events.length ? `${events.length} trace event(s) across ${new Set(events.map((e) => e.runId)).size} run(s)` : 'no trace events yet');

  /* ---- report ---- */
  const pad = Math.max(...checks.map((c) => c.name.length));
  for (const c of checks) {
    const line = `${c.name.padEnd(pad)}  ${c.detail}`;
    if (c.status === 'PASS') say.ok(line);
    else if (c.status === 'WARN') say.warn(line);
    else say.fail(line);
  }

  const fails = checks.filter((c) => c.status === 'FAIL').length;
  const warns = checks.filter((c) => c.status === 'WARN').length;
  say.info('');
  say.step(`${checks.length - fails - warns} pass · ${warns} warn · ${fails} fail`);
  if (fails) say.fail('Something is wrong with the installation. Fix the FAILs before trusting a run.');

  return fails ? 1 : 0;
}

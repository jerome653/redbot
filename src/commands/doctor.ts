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
import { corpora } from '../corpus.js';
import { say } from '../log.js';
import { hoursSinceLastBackup, listSnapshots } from '../backup.js';
import { checkRequirements } from '../requirements.js';

/**
 * `N/A` exists because of a specific trap, not for tidiness.
 *
 * Two checks here can only be answered inside a DEVELOPMENT CHECKOUT: build freshness compares
 * `src/*.ts` mtimes against `dist/*.js`, and secret protection reads `.gitignore`. A packaged
 * install has neither — it ships `dist/` and no source tree, and it is not a git working tree at
 * all.
 *
 * Left alone, each failed in its own wrong direction. Build freshness silently PASSED: the mtime
 * walk swallows a missing directory and returns 0, so `stale = 0 > distNewest` is false and the
 * check reported "compiled output is newer than every source file" while comparing against
 * nothing — a green light that could never go red, which is precisely the failure commit 1daa598
 * exists to prevent. Secret protection went the other way and FAILED, telling every installed
 * copy that "Chrome profiles and session cookies are committable" when there is no repository to
 * commit them to.
 *
 * So neither may be PASS and neither may be FAIL. `N/A` is counted separately in the verdict
 * line, so a check that did not run cannot inflate the pass count either.
 */
type Status = 'PASS' | 'WARN' | 'FAIL' | 'N/A';

interface Check {
  name: string;
  status: Status;
  detail: string;
}

/**
 * Is this a development checkout rather than an installed copy?
 *
 * `.git` is the signal, not the absence of `dist/` — a developer who has not built yet is still
 * in a checkout, and a packaged app always has `dist/`. Checked with existsSync rather than by
 * shelling out to git: this must work on a machine with no git installed, which an installed
 * copy generally is.
 */
function isCheckout(): boolean {
  return existsSync(join(ROOT, '.git'));
}

/**
 * The build-freshness verdict, as a pure function of the four facts it depends on.
 *
 * Extracted from `doctor()` so the three branches — no build, packaged build, real comparison —
 * can be tested without constructing a fake directory tree. `gitignoreActivePatterns` above is
 * exported for exactly the same reason, and the bug it was extracted after is the same shape:
 * a check whose verdict nobody could exercise.
 */
export function buildFreshness(
  hasDist: boolean, hasSrc: boolean, srcNewest: number, distNewest: number
): Check {
  if (!hasDist) {
    return { name: 'build', status: 'FAIL', detail: 'dist/ does not exist — run `npm run build`' };
  }
  if (!hasSrc) {
    /* A packaged install. There is nothing to compare the build against, so this check cannot be
       answered — and must not answer anyway. See the note on Status above: reporting PASS here is
       how a build check becomes a green light that cannot go red. */
    return {
      name: 'build freshness', status: 'N/A',
      detail: 'packaged build — no source tree to compare against'
    };
  }
  const stale = srcNewest > distNewest;
  const drift = Math.round((srcNewest - distNewest) / 1000);
  return {
    name: 'build freshness',
    status: stale ? 'FAIL' : 'PASS',
    detail: stale
      ? `source is ${drift}s newer than the build — you are running old code. Run \`npm run build\``
      : 'compiled output is newer than every source file'
  };
}

/** The four required rules. Named here so the test and the check cannot disagree about them. */
export const REQUIRED_IGNORES = ['data/chrome-profile', 'data/operators', 'data/*.json', 'data/*.jsonl'];

/**
 * The secret-protection verdict, as a pure function of the two facts it depends on.
 *
 * `gitignore` is the file's text, or null when there is no file. `checkout` is whether this is a
 * git working tree. The pairing matters: absent-file means two completely different things in the
 * two cases, and conflating them is what made this check FAIL on every installed copy.
 */
export function secretProtection(gitignore: string | null, checkout: boolean): Check {
  if (gitignore === null) {
    if (!checkout) {
      /* An installed copy: no repository, so nothing can be committed and there is no rule to
         check. This is NOT a pass — the guard did not run — and it is emphatically not a FAIL. The
         risk this check exists for is a DEVELOPMENT risk. */
      return {
        name: 'secret protection', status: 'N/A',
        detail: 'not a git checkout — nothing here can be committed'
      };
    }
    /* A checkout with the file deleted. Still a real failure, and the reason this is not simply
       skipped whenever the file is absent. */
    return {
      name: 'secret protection', status: 'FAIL',
      detail: 'no .gitignore — Chrome profiles and session cookies are committable'
    };
  }
  const active = gitignoreActivePatterns(gitignore);
  // Match against active rules only — a pattern that appears solely in a comment does not count.
  const missing = REQUIRED_IGNORES.filter((r) => !active.some((line) => line.includes(r)));
  return {
    name: 'secret protection',
    status: missing.length ? 'FAIL' : 'PASS',
    detail: missing.length
      ? `.gitignore is missing: ${missing.join(', ')}`
      : `all ${REQUIRED_IGNORES.length} required patterns present`
  };
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
  const srcDir = join(ROOT, 'src');
  const hasDist = existsSync(distDir);
  const hasSrc = existsSync(srcDir);
  {
    const r = buildFreshness(
      hasDist, hasSrc,
      hasSrc ? newestMtime(srcDir, '.ts') : 0,
      hasDist ? newestMtime(distDir, '.js') : 0
    );
    add(r.name, r.status, r.detail);
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
  {
    const gitignore = join(ROOT, '.gitignore');
    const text = existsSync(gitignore) ? readFileSync(gitignore, 'utf8') : null;
    const r = secretProtection(text, isCheckout());
    add(r.name, r.status, r.detail);
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

  /* ---- can it run at all? the shared requirement set ----
   *
   * From src/requirements.ts, which the console's /api/setup also serves. Before this, "is the
   * install ready" had two answers that disagreed: the console checked four conditions and never
   * mentioned Chrome, while doctor checked sixteen and failed on it. One list, two readers.
   *
   * A BLOCKING requirement is a FAIL and an ADVISORY one is a WARN, which is the same severity
   * doctor already gave these individually — `debuggable chrome` was a WARN when nothing was
   * listening, and a missing operator a FAIL. The mapping preserves that rather than reclassifying
   * anything.
   */
  {
    const reqs = await checkRequirements();
    for (const r of reqs) {
      add(r.id === 'llm' ? 'llm operator' : r.id === 'browser' ? 'debuggable chrome' : r.id,
        r.ok ? 'PASS' : (r.tier === 'blocking' ? 'FAIL' : 'WARN'),
        r.detail);
    }
  }

  /* ---- llm auth: where the credentials actually live ----
   *
   * The requirement above answers "is a model reachable"; this answers "and out of which
   * directory", which is what a person needs when it is not. Kept separate for that reason.
   */
  try {
    const dir = claudeConfigDir();
    const exists = existsSync(dir);
    add(
      'llm config dir',
      exists ? 'PASS' : 'WARN',
      `${config.llm.provider} · operator "${config.llm.operator ?? '(unset)'}" · ${dir}${exists ? '' : ' (directory missing — sign in there first)'}`
    );
  } catch (e) {
    add('llm config dir', e instanceof OperatorAuthError ? 'FAIL' : 'WARN',
      e instanceof Error ? e.message.split('\n')[0]! : String(e));
  }

  /* ---- browser ----
   *
   * `debuggable chrome` and `headed browser` now come from the shared requirement set above; what
   * remains here is only what that set does not answer. The endpoint is still resolved behind a
   * guard, because `config.browser.cdpEndpoint` can REFUSE: it used to answer 127.0.0.1:9222
   * whenever no account was selected — a port a real, unrelated browser often holds — and throws a
   * `NoAccountError` instead now.
   */
  let endpoint: string | null = null;
  try {
    endpoint = config.browser.cdpEndpoint;
  } catch { /* already reported by the `account` requirement above */ }

  const up = endpoint ? await isBrowserUp(endpoint) : false;

  /**
   * Is that browser HEADED?
   *
   * This check exists because of the shape of failure it prevents, not because of a bug that
   * happened here. A headless browser is reachable, answers CDP perfectly, and passes every
   * check above — and Reddit serves it a **block page delivered as HTTP 200 with the block in
   * the body**, so a naive status check reads it as success. Measured twice on 2026-07-27:
   * headless got the block page and never cleared the anonymous interstitial; headed Chrome on
   * the very same profile signed straight in.
   *
   * The consequence is the one worth guarding against: on a server, or anywhere without a
   * display, redbot would *appear* to run. Jobs queue, the scheduler ticks, the suite is green,
   * and every Reddit action silently fails. An installation that looks healthy while its
   * dependency is not connected is exactly how a deployment gets believed.
   *
   * So this is a FAIL, not a warning. redbot is a workstation tool; that is not a limitation to
   * design around, it is the choice that took reading from 0 threads to 25.
   */
  if (up) {
    let ua: string | null = null;
    try {
      const r = await fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(2500) });
      if (r.ok) ua = ((await r.json()) as { 'User-Agent'?: string })['User-Agent'] ?? null;
    } catch { /* unreachable is already reported by the check above */ }

    if (ua === null) {
      add('headed browser', 'WARN', 'could not read the browser user-agent — cannot tell whether it is headless');
    } else if (/headless/i.test(ua)) {
      add('headed browser', 'FAIL',
        'the attached browser is HEADLESS — Reddit answers it with a block page served as HTTP 200, ' +
        'so reads return nothing and every action fails silently. Attach a headed Chrome; redbot ' +
        'cannot run on a server or any display-less host.');
    } else {
      add('headed browser', 'PASS', 'headed — Reddit serves browsers, not clients');
    }
  }

  /* ---- pipeline staleness ---- */
  const drafts = await loadDrafts();
  const pending = drafts.filter((d) => d.status === 'pending');
  const stalePending = pending.filter((d) => Date.now() - Date.parse(d.createdAt) > 24 * 3_600_000);
  add(
    'pending drafts',
    stalePending.length ? 'WARN' : 'PASS',
    pending.length
      ? `${pending.length} pending, ${stalePending.length} older than 24h (the stale-draft gate will refuse those)`
      : 'none pending'
  );

  const threads = await loadThreads();
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
  const observations = await loadObservations();
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
  const regrets = await loadRegrets();
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

  /* ----------------------------------------------------------------
   * Reference corpora (Argus Phase 10)
   *
   * The citation check fails closed: a corpus that cannot be read escalates every claim in
   * its jurisdiction rather than passing it. That is the right behaviour and it is also
   * invisible — the run still completes, the verdict is still produced, and nothing says the
   * check did not actually happen. The corpora live OUTSIDE this repository (the SGEN KB is
   * a sibling checkout), so a moved folder is the expected way for this to break.
   * ---------------------------------------------------------------- */
  const corpusList = corpora();
  if (!corpusList.length) {
    add('reference corpora', 'WARN', 'none configured — no claim can be checked against written material');
  } else {
    const broken = corpusList.filter((c) => !c.cards);
    add(
      'reference corpora',
      broken.length ? 'WARN' : 'PASS',
      broken.length
        ? `${broken.map((c) => `${c.config.id} ${c.unavailable}`).join('; ')} — claims in its jurisdiction will escalate, unchecked`
        : corpusList.map((c) => `${c.config.id}: ${c.cards!.length} cards`).join(' · ')
    );
  }

  /* ---- measurement debt ---- */
  const prov = limitsByProvenance();
  add(
    'measured limits',
    prov.provisional.length > prov.measured.length ? 'WARN' : 'PASS',
    `${prov.measured.length} measured · ${prov.declared.length} declared · ${prov.provisional.length} provisional placeholders`
  );

  const reviews = await loadReviews();
  add(
    'review dataset',
    reviews.length === 0 ? 'WARN' : 'PASS',
    reviews.length
      ? `${reviews.length} operator decision(s) recorded`
      : 'empty — draft quality is unmeasured until drafts are decided at the approval prompt'
  );

  /* ---- telemetry ---- */
  const events = await loadTrace();
  add('telemetry', events.length ? 'PASS' : 'WARN',
    events.length ? `${events.length} trace event(s) across ${new Set(events.map((e) => e.runId)).size} run(s)` : 'no trace events yet');

  /* ---- report ---- */
  const pad = Math.max(...checks.map((c) => c.name.length));
  for (const c of checks) {
    const line = `${c.name.padEnd(pad)}  ${c.detail}`;
    if (c.status === 'PASS') say.ok(line);
    else if (c.status === 'WARN') say.warn(line);
    else if (c.status === 'N/A') say.step(`n/a ${line}`);
    else say.fail(line);
  }

  const fails = checks.filter((c) => c.status === 'FAIL').length;
  const warns = checks.filter((c) => c.status === 'WARN').length;
  const skipped = checks.filter((c) => c.status === 'N/A').length;
  const passes = checks.filter((c) => c.status === 'PASS').length;
  say.info('');
  /* Counted explicitly rather than as `checks.length - fails - warns`, which was the old
     arithmetic and would have silently counted every N/A as a pass — reintroducing the exact
     inflation the N/A state was added to prevent. The skipped count is only shown when there is
     one, so a development checkout's output is unchanged. */
  say.step(
    `${passes} pass · ${warns} warn · ${fails} fail` +
    (skipped ? ` · ${skipped} n/a` : '')
  );
  if (fails) say.fail('Something is wrong with the installation. Fix the FAILs before trusting a run.');

  return fails ? 1 : 0;
}

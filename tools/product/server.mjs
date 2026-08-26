/**
 * redbot — product console.
 *
 * The operator workstation at tools/operator/ answers "is the engine sound".
 * This answers the only question an operator actually has: **should this reply go out?**
 *
 * NOT read-only. This header used to assert the opposite of all three points below — that the
 * file only read, ran nothing, published nothing, and held no command surface or allow-list —
 * and every clause of that was contradicted inside this same file. The operator console
 * carried the same false self-description on /api/settings until `readOnly: false` replaced
 * it. A comment that overstates a security boundary is worse than no comment: it invites the
 * next reader to skip the guard they were about to add. So, plainly:
 *
 *   1. It reads AND WRITES — accounts.json, sources.json, decisions.jsonl and approvals/,
 *      through writeFileSync / appendFileSync / mkdirSync / rmSync imported below.
 *   2. It EXECUTES, behind a fixed allow-list: `PUBLIC_ACTIONS`, enforced on /api/run and
 *      published by /api/actions. `spawn` runs dist/cli.js for an action, again for the
 *      `auto` loop, and taskkill to stop a browser.
 *   3. It PUBLISHES. /api/publish → `publish()` refuses anything but the exact word SEND,
 *      then writes a single-use five-minute approval token that `takeConsoleApproval`
 *      (src/ask.ts) spends on one `redbot reply`.
 *
 * What actually holds the line is the machine boundary, not read-only-ness: `originIsLocal`
 * refuses cross-origin requests and `server.listen` binds 127.0.0.1 only. There is no
 * authentication behind that — "you are on this computer" IS the security model, so do not
 * widen either guard without first replacing it with one.
 *
 * Two rules that DO still hold:
 *
 *   - Figures come from Postgres at request time, through the typed row mappers in dist/ (see
 *     the `domain` note below). Nothing is cached between requests, so this file cannot invent
 *     a figure the database does not contain. (data/*.jsonl is read only for legacy decision
 *     history.)
 *   - Absent evidence is reported as absent, never as zero-meaning-fine. "Never measured"
 *     and "measured 0" are different states and are rendered differently.
 *
 * data/operators/ holds credentials next to evidence: it is read to list and select operators,
 * and no credential path is ever served by /api/operators.
 *
 * Deliberately no `:line` citations in this header. The claim it replaced rotted precisely
 * because same-file line numbers shift under every edit above them; the symbol names above are
 * pinned by tests in server.test.mjs instead. Cross-file refs (src/ask.ts) are fine — those
 * only move when that file moves.
 */
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, existsSync, statSync, readdirSync, appendFileSync, mkdirSync, createWriteStream, rmSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { exitPosture } from './exit-posture.mjs';
import { fleetProblems } from './fleet-posture.mjs';
import { runError, runNote, NOTHING_TO_DO } from './run-outcome.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');

/**
 * The running version, read once, from the one file that is authoritative about it.
 *
 * Never fatal: a console that will not start because it could not read its own version number is
 * worse than a header that says nothing. `null` renders as no version rather than as "unknown",
 * which would be a claim.
 */
const APP_VERSION = (() => {
  try { return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version ?? null; }
  catch { return null; }
})();
/**
 * Same `REDBOT_DATA` override src/config.ts:23 documents, for the same reason: this console
 * WRITES (accounts.json, sources.json, decisions.jsonl, approvals/), so a test that exercises
 * those endpoints against the real data/ would be injecting into the operator's own evidence.
 * Unset in normal operation — the console a person opens still reads and writes data/.
 */
const DATA = process.env.REDBOT_DATA ? join(process.env.REDBOT_DATA) : join(ROOT, 'data');
/**
 * Which build this is — `live`, `source`, or a variant name like `dev`.
 *
 * Set by electron/main.mjs from `app.isPackaged` and `app.getName()`. Absent when the console is
 * run on its own (`node tools/product/server.mjs`), which is neither an install nor the desktop
 * shell, and is reported as nothing rather than guessed at.
 *
 * This exists because two windows that look identical are two windows you can act in by mistake.
 * The data behind them is genuinely separate — Electron derives `userData` from the product name,
 * so a variant build has its own database — and a person editing the wrong one has no way to tell
 * until the change does not appear where they expected it.
 */
const APP_BUILD = process.env.REDBOT_BUILD || null;

/**
 * A working directory that EXISTS ON DISK, for every spawn below.
 *
 * When this console runs inside the packaged desktop app, ROOT resolves inside
 * `resources/app.asar` — an archive, not a directory. `spawn()` with that as cwd fails, and the
 * error names the EXECUTABLE rather than the cwd, which sends you looking in the wrong place.
 *
 * `existsSync(ROOT)` cannot detect it: Electron patches fs to report an asar path as a directory,
 * so the archive has to be recognised by name. Reading files out of it is fine — that is what asar
 * is for — so only the cwd needs a real path, and DATA is one the app has already provisioned.
 */
const PACKAGED = /[\\/]app\.asar([\\/]|$)/.test(ROOT);
const SPAWN_CWD = PACKAGED ? DATA : ROOT;

const portArg = process.argv.indexOf('--port');
const PORT = portArg > -1 ? Number(process.argv[portArg + 1]) : 7902;

/**
 * The domain comes from Postgres, not from data/*.json.
 *
 * `src/store.ts` moved threads, drafts, gap analyses, assessments and history into the
 * database; this console went on reading the JSON files, which nothing writes any more. The
 * screens were rendering dead files — an empty console on a database with rows in it.
 *
 * Imported from dist/ rather than reimplemented in SQL here: this file already depends on
 * dist/cli.js (it spawns it for every action), and one typed implementation shared with the
 * operator console cannot drift from the row mappers the way two hand-written copies would.
 *
 * A dynamic import so a missing build is a message an operator can act on, rather than an
 * unexplained module-not-found before the server has printed anything.
 */
let domain = null, consoleAccounts = null, createAccountImpl = null, updateAccountImpl = null,
    deleteAccountImpl = null, changePortImpl = null, suggestPortImpl = null,
    portStatusImpl = null, stopBrowserImpl = null, setUpHereImpl = null, adoptProfileImpl = null,
    inspectPortsImpl = null, orphanBrowsersImpl = null, debugPortRange = null,
    boundHandlesImpl = null, machineImpl = null, pagesApi = null, summaryApi = null,
    selectAccountImpl = null, selectedHandleImpl = null,
    dbStatus = null, dbPing = null, sourcesApi = null, requirementsApi = null, configApi = null,
    updateApi = null, pushApi = null, pushStateApi = null, pushSchedulerApi = null,
    pushClientApi = null, pushAccountsApi = null, dependenciesApi = null, profilesApi = null,
    proxiesApi = null, relayApi = null, alignApi = null, exitApi = null, webshareApi = null;

/**
 * The push scheduler lives HERE rather than in the Electron shell.
 *
 * This process already holds the database open, so a push reads through the same connection
 * instead of opening a second one against the same file. It is also the only process that knows
 * when a run finishes — which is the trigger that carries information, because it is the one
 * moment the numbers change.
 */
let pushScheduler = null;
/**
 * The vault, for the Setup screen.
 *
 * Same rule as `src/commands/vault.ts`: a secret goes IN and is never handed back out. Nothing
 * reached from here returns a stored value — `listSecrets()` answers with the name, the
 * four-character hint and which master key sealed it, which identifies a credential without
 * being usable as one.
 */
let vaultApi = null;
try {
  const [d, a, db, src, cred, ports, dbAccounts, machine, pages, sum, pre, dbProxies, relay, align, relayCore, proxyCred, webshare] = await Promise.all([
    import('../../dist/console-data.js'),
    import('../../dist/console-accounts.js'),
    import('../../dist/db.js'),
    import('../../dist/sources.js'),
    import('../../dist/credentials.js'),
    import('../../dist/ports.js'),
    import('../../dist/db/accounts.js'),
    import('../../dist/machine.js'),
    import('../../dist/db/pages.js'),
    import('../../dist/db/summary.js'),
    import('../../dist/db/prefilter.js'),
    import('../../dist/db/proxies.js'),
    import('../../dist/proxy/manager.js'),
    /* Cheap to load: this module only imports Playwright INSIDE `alignBrowser`, so the console
       pays for it when a proxied browser opens and never before. */
    import('../../dist/proxy/align.js'),
    /* The upstream validity rule, so the console refuses a malformed exit in the SAME words the
       relay would — two definitions of "usable" is how a form accepts what the relay rejects. */
    import('../../dist/proxy/relay.js'),
    import('../../dist/proxy/credential.js'),
    /* Webshare: an OPTIONAL convenience — turning a stored API key into a US-proxy list the exit
       form can be filled from. No network happens here; only when /api/webshare/proxies is asked. */
    import('../../dist/proxy/webshare.js')
  ]);
  domain = d.loadConsoleDomain;
  consoleAccounts = d.loadConsoleAccounts;
  createAccountImpl = a.createConsoleAccount;
  updateAccountImpl = a.updateConsoleAccount;
  deleteAccountImpl = a.deleteConsoleAccount;
  changePortImpl = a.changeAccountPort;
  suggestPortImpl = a.suggestFreePort;
  portStatusImpl = ports.statusForAccounts;
  stopBrowserImpl = ports.stopAccountBrowser;
  /* Orphan reclamation — see `/api/browsers/orphans`. Bound here beside the other port helpers
     so the console and the CLI decide ownership with one implementation, not two. */
  inspectPortsImpl = ports.inspectPorts;
  orphanBrowsersImpl = ports.orphanBrowsers;
  debugPortRange = { first: ports.DEBUG_PORT_FIRST, last: ports.DEBUG_PORT_LAST };
  setUpHereImpl = a.setUpAccountHere;
  adoptProfileImpl = a.adoptProfileDir;
  boundHandlesImpl = () => dbAccounts.boundHandles(db.getPool());
  /* Which exit each account owns. Read-only here — the console shows the address, it does not
     hand out the credential, which stays sealed in the vault (src/db/proxies.ts). */
  proxiesApi = () => dbProxies.loadAccountProxies(db.getPool());
  /**
   * The relays themselves, which live in THIS process for as long as it runs.
   *
   * That placement is the design, not an accident of where the code went: Chrome is spawned
   * detached and outlives this console, so quitting redbot takes the exit with it and every page
   * in that browser then fails closed. See src/proxy/manager.ts for why that beats a daemon
   * holding live provider credentials with nobody watching.
   */
  relayApi = {
    ensure: (handle) => relay.ensureRelay(db.getPool(), handle),
    stop: (handle) => relay.stopRelay(handle),
    stopAll: () => relay.stopAllRelays(),
    states: () => relay.relayStates()
  };
  /**
   * The half a proxy cannot do: making the BROWSER agree with the address.
   *
   * Held here for the same reason the relays are — the timezone override and the WebRTC fence only
   * cover pages this process is attached to, so quitting redbot drops the exit and the alignment
   * together rather than leaving a browser that looks protected and is not.
   */
  alignApi = {
    refusal: align.alignmentRefusal,
    cover: align.alignBrowser,
    stop: (handle) => align.stopAlignment(handle),
    stopAll: () => align.stopAllAlignments(),
    states: () => align.alignmentStates()
  };
  /**
   * Adding and removing an exit — the write half, which until now had no console surface at all.
   *
   * `assertUsable` is the RELAY's own rule, not a second copy of it. A form that accepted a host
   * the relay will later refuse is a form that fails at launch instead of at typing, which is the
   * worst possible moment: the operator has by then paid for the address.
   */
  exitApi = {
    assertUsable: relayCore.assertUsableUpstream,
    forget: (handle) => dbProxies.deleteAccountProxy(db.getPool(), handle),
    forgetCredential: (handle) => proxyCred.forgetProxyCredential(handle)
  };
  /* The one call the Setup screen makes with a stored Webshare key: list this account's US exits.
     Read-only and vendor-optional — see src/proxy/webshare.ts for why it is not on any run path. */
  webshareApi = { fetchUsProxies: webshare.fetchUsProxies };
  /**
   * Which account this machine acts as (migration 0015).
   *
   * This is the control that makes the desktop app usable at all: `selectedAccount()` used to read
   * only REDBOT_ACCOUNT, and a window has no shell to set it in — so an install with two accounts
   * could never say which one it was, and every command refused.
   */
  selectAccountImpl = a.selectConsoleAccount;
  selectedHandleImpl = () => dbAccounts.selectedHandleForMachine(db.getPool());
  machineImpl = machine.machineId;
  /* Every figure that used to be `array.length` over a fully-loaded table. */
  summaryApi = {
    totals: () => sum.consoleTotals(db.getPool()),
    accounts: () => sum.accountTallies(db.getPool()),
    handles: () => sum.handlesInLogs(db.getPool()),
    subreddits: () => sum.threadsBySubreddit(db.getPool()),
    /* The same figure for the other kind of source. Absent on an older dist, hence the guard
       at the call site rather than here — a console must not fail to render because one
       count is missing. */
    queries: () => (sum.threadsByQuery ? sum.threadsByQuery(db.getPool()) : Promise.resolve({})),
    argus: () => sum.argusSummary(db.getPool()),
    /* Which mechanical rule caught each thread that never reached a model call (0014). */
    prefilter: () => pre.prefilterBreakdown(db.getPool())
  };
  /* Bound to the pool here so every call site asks the database for a page, and none of them
     can quietly go back to loading a table and slicing it. */
  pagesApi = {
    threads: (q) => pages.pageThreads(db.getPool(), q),
    /* Collected but never assessed — the threads the funnel counts and no screen showed. */
    dropped: (q) => pages.pageDroppedThreads(db.getPool(), q),
    outcomes: (q) => pages.pageOutcomes(db.getPool(), q),
    observations: (q) => pages.pageObservations(db.getPool(), q),
    draftIds: (q) => pages.pageDraftIds(db.getPool(), q),
    draftCounts: () => pages.draftCounts(db.getPool()),
    funnel: () => pages.threadFunnel(db.getPool()),
    checkpoints: () => pages.checkpointSummary(db.getPool()),
    clamp: pages.clampPage,
    DEFAULT_PAGE: pages.DEFAULT_PAGE
  };
  dbStatus = db.dbUnavailableReason;
  /* Separate from `dbStatus` because they answer different questions: "is there a file" and
     "is its schema the one this build expects". The Setup screen needs both — see setupStatus. */
  dbPing = db.ping;
  sourcesApi = src;
  vaultApi = cred;
  /**
   * The requirement set, from the SAME module `redbot doctor` reads.
   *
   * This console used to have its own four-condition idea of "ready" and never mentioned Chrome,
   * while doctor checked sixteen and failed on it — so the Setup screen could show green on a
   * machine that could not drive a browser. One list, two readers; see src/requirements.ts.
   */
  requirementsApi = (await import('../../dist/requirements.js'));
  /**
   * What has to be INSTALLED, as opposed to configured — see src/dependencies.ts for the line
   * between the two. Kept out of `/api/setup` on purpose: locating an executable on PATH spawns a
   * process, and `/api/setup` is read on every screen change.
   */
  dependenciesApi = (await import('../../dist/dependencies.js'));
  /* Chrome profile folders: allocation, creation and what is actually in one. The console
     must not have its own idea of "is this profile real" beside src/profiles.ts. */
  profilesApi = (await import('../../dist/profiles.js'));
  /**
   * The operator registry, from the SAME module the CLI and the requirement check read.
   *
   * This console used to compute "is that operator ready" itself, with `existsSync(configDir)` —
   * and so did `listOperators()`. Both were wrong in the same way and neither could tell you so.
   * One typed implementation, three readers.
   */
  configApi = (await import('../../dist/config.js'));
  updateApi = (await import('../../dist/update.js'));
  /* Dashboard sync: the same module the CLI uses, so the Setup screen and `redbot push` cannot
     disagree about where the endpoint is or which secret name holds a token. */
  pushApi = (await import('../../dist/push/index.js'));
  pushStateApi = (await import('../../dist/push/state.js'));
  pushSchedulerApi = (await import('../../dist/push/scheduler.js'));
  pushClientApi = (await import('../../dist/push/client.js'));
  pushAccountsApi = (await import('../../dist/push/accounts.js'));
} catch (e) {
  console.error(
    '\n  This console reads the database through the compiled build, which is missing or stale.\n' +
    '    npm run build\n' +
    `  (${e && e.message ? e.message : e})\n`
  );
  process.exit(1);
}

/* ------------------------------------------------------------------ *
 * reading — every accessor reports absence rather than substituting a default
 * ------------------------------------------------------------------ */
const readJson = (p, fallback) => {
  try { return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : fallback; }
  catch { return fallback; }
};
const readLines = (p) => {
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8').split('\n').filter((l) => l.trim())
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
};
const arr = (v, key) => (Array.isArray(v) ? v : (v && Array.isArray(v[key]) ? v[key] : []));
const meta = (rel) => {
  const p = join(DATA, rel);
  if (!existsSync(p)) return { file: 'data/' + rel, exists: false };
  const s = statSync(p);
  return { file: 'data/' + rel, exists: true, bytes: s.size, modified: s.mtime.toISOString() };
};

/* ------------------------------------------------------------------ *
 * state
 * ------------------------------------------------------------------ */
async function buildState(opts = {}) {
  /**
   * The domain, from Postgres. These were nine reads of data/*.json and data/*.jsonl —
   * files that `src/store.ts` stopped writing when the store moved to the database. The
   * console went on rendering them, so every screen showed an empty redbot no matter how
   * much work the engine had actually done.
   *
   * `unavailable` is carried through to the client rather than swallowed: a console showing
   * nothing because the database is down must say so, or it reads as "redbot did nothing".
   */
  /**
   * The page's drafts are chosen BEFORE the domain is read, because everything heavy hangs off
   * them — their threads, their assessments, their certifications. Resolving the ids first is
   * what turns four whole-table reads into three narrowed ones.
   *
   * Falls back to an unscoped read when the pager is unavailable, which keeps a console with no
   * database, or an older build, correct rather than empty.
   */
  let draftPage = null, draftTally = null, summary = null, argusRaw = null, subs = null, byQuery = null;
  if (pagesApi && summaryApi) {
    try {
      [draftPage, draftTally, summary, argusRaw, subs, byQuery] = await Promise.all([
        pagesApi.draftIds({ offset: opts.reviewOffset }),
        pagesApi.draftCounts(),
        summaryApi.totals(),
        summaryApi.argus(),
        summaryApi.subreddits(),
        summaryApi.queries().catch(() => null)
      ]);
    } catch (e) {
      /* Unscoped, then — every draft rather than a page. Correct, just not bounded, and the
         same rule as below: a fallback nobody can see is indistinguishable from working. */
      console.error('[state] draft paging failed, reading every draft:', e && e.message ? e.message : e);
    }
  }
  /* The two derived fields the screen wants but SQL should not be asked to name. */
  const argus = argusRaw && {
    ...argusRaw,
    everCertified: (argusRaw.byVerdict?.CERTIFIED ?? 0) > 0,
    draftsCheckedTwice: argusRaw.claimSpread.length
  };

  const dom = await domain(
    draftPage ? { draftIds: draftPage.rows, skipLogs: true, historyLimit: 200 } : {}
  );
  const drafts = dom.drafts;
  const threads = dom.threads;
  const assessments = dom.assessments;
  const gaps = dom.gaps;
  const certs = dom.certifications;
  const history = dom.history;
  const observations = dom.observations;
  const reviews = dom.reviews;
  const regret = dom.regret;

  const threadById = new Map(threads.map((t) => [t.id, t]));

  /**
   * The Threads screen's page and its figures, from the database rather than from array
   * lengths. Both fail SOFT: a console that cannot reach Postgres already reports that at the
   * top of every screen, and this must not be the thing that turns a degraded console into a
   * blank one.
   */
  let threadPage = { rows: [], total: 0, offset: 0, limit: 25 };
  /* Collected but never assessed. Same fallback shape: a degraded console shows an empty list
     rather than failing, and says so through the same catch below. */
  let droppedPage = { rows: [], total: 0, offset: 0, limit: 25 };
  let threadCounts = {
    threadsCollected: threads.length, assessed: assessments.length,
    contribute: assessments.filter((a) => a.verdict === 'contribute').length,
    skip: assessments.filter((a) => a.verdict === 'skip').length,
    gapsAnalysed: gaps.length, drafted: drafts.length
  };
  /* Null until the prefilter has run and recorded itself — which is a different thing from
     "nothing was dropped", and the screen says so rather than showing an empty breakdown. */
  let prefilterDrops = null;
  let observationPage = {
    rows: observations.map((o) => ({
      ts: o.ts, account: o.account, kind: o.kind, value: o.value, vector: o.vector,
      note: o.note, checkpoint: o.checkpoint ?? null, permalink: o.permalink ?? null
    })),
    total: observations.length, offset: 0, limit: 25
  };
  /* Derived from EVERY observation, not from the page — see checkpointSummary. Falls back to
     deriving from what is in hand, which is exact whenever the page is the whole table. */
  let checkpoints = [...new Set(observations.filter((o) => o.checkpoint).map((o) => o.checkpoint))]
    .map((key) => {
      const mine = observations.filter((o) => o.checkpoint === key);
      return { checkpoint: key, taken: mine.length, latestTs: mine[mine.length - 1]?.ts ?? null };
    });

  if (pagesApi && !dom.unavailable) {
    try {
      [threadPage, threadCounts, observationPage, checkpoints, prefilterDrops, droppedPage] = await Promise.all([
        pagesApi.threads({}), pagesApi.funnel(), pagesApi.observations({}), pagesApi.checkpoints(),
        summaryApi ? summaryApi.prefilter() : null,
        pagesApi.dropped({})
      ]);
    } catch (e) {
      /**
       * Falls back to the arrays in hand — but SAYS SO.
       *
       * This catch used to be silent, and it hid a real fault: one member of the batch was
       * undefined (a wiring edit that never landed), so calling it threw and took the other
       * four aggregates down with it. The console then served `3 collected` for a database
       * holding 116 — plausible enough to read as truth, with nothing anywhere saying a
       * fallback had happened. A degraded answer has to be a loud one.
       */
      console.error('[state] page/summary aggregates failed, falling back to loaded rows:',
                    e && e.message ? e.message : e);
    }
  }

  /* certifications grouped per draft, newest last */
  const certsByDraft = new Map();
  for (const c of certs) {
    if (!certsByDraft.has(c.draftId)) certsByDraft.set(c.draftId, []);
    certsByDraft.get(c.draftId).push(c);
  }

  /**
   * Certification stability.
   *
   * Phase 16 measured the same draft certified repeatedly on a byte-identical build:
   * claim counts of 12 and 16, different provenance, different rules fired, same verdict.
   * Where a draft has more than one certification, the spread is reported next to it —
   * a single certification is a sample, and a console that prints one number as "the"
   * answer teaches the operator to trust it more than the evidence allows.
   */
  const spread = (list) => {
    if (list.length < 2) return null;
    const claims = list.map((c) => (c.claims || []).length);
    const fatal = list.map((c) => (c.contradictions || []).filter((x) => x.fatal).length);
    const verdicts = [...new Set(list.map((c) => c.verdict))];
    return {
      runs: list.length,
      claimsMin: Math.min(...claims), claimsMax: Math.max(...claims), claims,
      fatalMin: Math.min(...fatal), fatalMax: Math.max(...fatal),
      verdicts, verdictStable: verdicts.length === 1
    };
  };

  /**
   * Which drafts this response carries.
   *
   * The ids come from SQL — newest first, one page — and only those are projected. Projecting a
   * draft is not cheap: it joins its certifications, its thread and its assessment, so doing it
   * for every draft to show twenty-five was the expensive half of this response.
   *
   * Falls back to every draft when the page cannot be fetched, which keeps a degraded console
   * correct rather than empty.
   */
  /* Resolved above, before the domain read. Only the fallbacks are computed here. */
  draftPage ??= { rows: drafts.map((d) => d.id), total: drafts.length, offset: 0, limit: 25 };
  draftTally ??= { total: drafts.length, pending: drafts.filter((d) => d.status === 'pending').length };
  const onPage = new Set(draftPage.rows);
  const review = drafts.filter((d) => onPage.has(d.id)).map((d) => {
    const list = certsByDraft.get(d.id) || [];
    const last = list[list.length - 1] || null;
    const t = threadById.get(d.threadId) || null;
    const a = assessments.find((x) => x.threadId === d.threadId) || null;
    return {
      id: d.id,
      status: d.status,
      /* what YOU did with it, separate from what redbot did: ignored / read / actioned */
      workflow: (readStatuses()[d.id] || { status: 'none' }),
      title: d.title,
      permalink: d.permalink,
      body: d.body,
      createdAt: d.createdAt,
      model: d.model,
      lintIssues: d.lintIssues || [],
      hasDisclosure: !!d.hasDisclosure,
      thread: t && {
        id: t.id, title: t.title, subreddit: t.subreddit, author: t.author,
        upvotes: t.upvotes, commentCount: t.commentCount, ageText: t.ageText,
        ageMinutes: t.ageMinutes, collectedAt: t.collectedAt,
        body: t.body, permalink: t.permalink,
        comments: (t.comments || []).slice(0, 8).map((c) => ({
          author: c.author, body: c.body, upvotes: c.upvotes, byOriginalPoster: c.byOriginalPoster
        }))
      },
      assessment: a && { verdict: a.verdict, score: a.score, thesis: a.thesis, reasons: a.reasons },
      certification: last && {
        verdict: last.verdict,
        certifiedAt: last.certifiedAt,
        model: last.model,
        claims: last.claims || [],
        contradictions: last.contradictions || [],
        epistemic: last.epistemic || [],
        invalidated: last.invalidated || [],
        resolution: last.resolution || null,
        reasons: last.reasons || [],
        fatal: (last.contradictions || []).filter((c) => c.fatal).length
      },
      certificationRuns: list.length,
      stability: spread(list),
      /* The command a person runs. This console cannot run it — see the header. */
      publishCommand: `REDBOT_OPERATOR=<you> node dist/cli.js reply ${d.id}`
    };
  });

  /* ---- accounts: only what the append-only logs actually name ---- */
  const profiles = readdirSync(DATA, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith('chrome-profile'))
    .map((e) => e.name);
  /* From a UNION in SQL rather than from two loaded logs — those are no longer read here. */
  const namedInLogs = summaryApi
    ? await summaryApi.handles().catch(() => [])
    : [...new Set([...observations.map((o) => o.account), ...history.map((h) => h.account)].filter(Boolean))];

  /* Per-account figures, grouped by the database: one query for all accounts rather than a
     scan per card. Empty when unavailable, and the fallbacks below fill in from what is held. */
  const tallies = summaryApi ? await summaryApi.accounts().catch(() => new Map()) : new Map();

  /**
   * Configured accounts, from accounts.json. Kept strictly apart from what has been measured:
   * a handle written in a config file is an intention, a karma reading is a fact. The screen
   * shows both and never lets the first stand in for the second.
   */
  // Configured accounts come from accounts (the system of record), falling back to
  // the seed file only when the database is empty or unreachable — dom.accountsFrom says
  // which, and the screen reports it rather than letting a stale file look authoritative.
  const configured = dom.accounts;
  rememberSoleAccount(configured);   // keeps the run-as fallback current
  // `_rules` has no table: it is prose a person writes beside their accounts, so it stays
  // in the seed file. Read defensively — the file legitimately may not exist at all.
  const acctFile = readJson(join(DATA, 'accounts.json'), null);
  const rules = (acctFile && acctFile._rules) || [];

  /* union: everything configured, plus anything the logs name that nobody configured */
  const handles = [...new Set([...configured.map((a) => a.handle), ...namedInLogs])];
  const accounts = handles.map((handle) => {
    const cfg = configured.find((c) => c.handle === handle) || null;
    /**
     * Counted by the database, per account, in one grouped query — see accountTallies. These
     * were `observations.filter(...)` and `history.filter(...)` over two fully-loaded logs,
     * once per card. The fallback path keeps a database-less console honest.
     */
    const tally = tallies.get(handle) || null;
    const mine = tally ? null : observations.filter((o) => o.account === handle);
    const karma = tally ? tally.karma : ([...(mine ?? [])].reverse().find((o) => o.kind === 'karma') || null);
    const published = tally
      ? tally.published
      : history.filter((h) => h.account === handle && h.kind === 'publish.ok').length;
    return {
      handle,
      configured: !!cfg,
      role: cfg ? cfg.role : null,
      speaks: cfg ? cfg.speaks : null,
      knows: cfg ? cfg.knows || [] : [],
      subreddits: cfg ? cfg.subreddits || [] : [],
      timezone: cfg ? cfg.timezone : null,
      quietHours: cfg ? cfg.quietHours : null,
      dailyCeiling: cfg ? cfg.dailyCeiling : null,
      profileDir: cfg ? cfg.profileDir : null,
      debugPort: cfg ? cfg.debugPort : null,
      note: cfg ? cfg.note : null,
      /* a profile folder that actually exists on disk, not merely named in the config */
      /* resolveProfileDir, not join: an adopted profile carries an ABSOLUTE path, and
         join(DATA, 'D:\\...') yields a path that exists nowhere — so this would report a
         signed-in profile as missing. See src/profiles.ts. */
      profileExists: cfg && cfg.profileDir && profilesApi
        ? existsSync(profilesApi.resolveProfileDir(DATA, cfg.profileDir)) : false,
      /**
       * THREE states, not two — see src/profiles.ts.
       *
       * redbot now creates the folder when it allocates the name, so "exists" stopped meaning what
       * it used to. An empty directory redbot made this second would answer `profileExists: true`
       * while holding no Reddit session at all, which is precisely the "looks ready and cannot
       * post" reading that src/push/accounts.ts warns about. `used` is the only value that means a
       * browser has ever written a profile here.
       */
      profileState: profilesApi && cfg && cfg.profileDir
        ? profilesApi.profileState(DATA, cfg.profileDir)
        : (cfg && cfg.profileDir ? 'missing' : 'missing'),
      karma: karma ? karma.value : null,
      karmaMeasuredAt: karma ? karma.ts : null,
      karmaVector: karma ? karma.vector : null,
      karmaNote: karma ? karma.note : null,
      observations: tally ? tally.observations : (mine ?? []).length,
      published,
      /* karma 1 is exactly the profile new-account filters catch — see ACCOUNT-WARMING.md */
      stage: karma && karma.value < 10 ? 'warming' : karma ? 'established' : 'unmeasured'
    };
  });
  const accountRules = rules;
  /* ports and folders already spoken for, so a new account is never handed a clashing one */
  const takenPorts = configured.map((c) => c.debugPort).filter(Boolean);
  const takenDirs = configured.map((c) => c.profileDir).filter(Boolean);

  /* The figure the whole Results screen hangs off, counted rather than filtered. */
  const published = summary ? summary.published : history.filter((h) => h.kind === 'publish.ok').length;

  /**
   * Where threads are looked for. From sources — the console turns whatever is switched
   * on into the commands to run. It cannot collect anything itself, and nothing here fires on
   * a schedule; a person runs each command.
   *
   * This panel used to be null whenever data/sources.json was absent, which on a fresh install
   * meant the whole "what do we collect" screen simply did not render — no list, and no way to
   * see that the answer was "nothing yet".
   */
  let srcView, srcError = null;
  try { srcView = await sourcesApi.loadSources(); }
  catch (e) { srcView = { sources: [], from: 'seed-file', unavailable: null }; srcError = String(e && e.message || e); }
  // `_limits` is prose with no table, so it stays in the seed file — read defensively, since
  // that file legitimately may not exist at all.
  const srcFile = readJson(join(DATA, 'sources.json'), null);

  /* named `collect`, not `sources` — `sources` is already the provenance list below */
  const collect = {
    from: srcView.from,
    unavailable: srcView.unavailable,
    error: srcError,
    maxPerRun: (srcFile && srcFile._limits && srcFile._limits.maxThreadsPerRun) || null,
    limitNote: (srcFile && srcFile._limits && srcFile._limits.note) || null,
    subreddits: srcView.sources.filter((s) => s.kind === 'subreddit')
      .map((s) => ({ name: s.value, why: s.why, enabled: s.enabled })),
    searches: srcView.sources.filter((s) => s.kind === 'search')
      .map((s) => ({ query: s.value, why: s.why, enabled: s.enabled })),
    /* how many threads on record came from each place, so a source that never pays off is visible */
    /**
     * Tallied case-INSENSITIVELY, because Reddit canonicalises the name: a source added as
     *  comes back on every thread as , and  as . The console
     * looked these up by exact key, so two of three sources read "0 on file" while holding 16
     * and 14 threads — it reported the collector as having done nothing, right next to the
     * threads it had collected.
     *
     * Both shapes are returned:  keeps Reddit's own casing (it is the real name of
     * the place), and  is the lower-cased index the lookup actually needs.
     */
    /**
     * Two shapes, on purpose.
     *
     * Reddit canonicalises a subreddit name: a source added as "wordpress" comes back on every
     * thread as "Wordpress", and "crm" as "CRM". The console looked the count up by exact key,
     * so two of three sources read "0 on file" while holding 16 and 14 threads — it reported
     * the collector as having done nothing, directly above the threads it had just collected.
     *
     * `collected` keeps Reddit's own casing, because that is the real name of the place.
     * `collectedByKey` is the lower-cased index the lookup actually needs.
     */
    /* GROUP BY subreddit — `threads` now holds only the page's threads, so counting them here
       would report a source as having collected nothing directly above its own threads, which
       is the exact defect the comment above describes, reintroduced by paging. */
    collected: subs ? subs.collected : threads.reduce((m, t) => {
      const k = t.subreddit || 'unknown';
      m[k] = (m[k] || 0) + 1;
      return m;
    }, {}),
    collectedByKey: subs ? subs.collectedByKey : threads.reduce((m, t) => {
      const k = (t.subreddit || 'unknown').toLowerCase();
      m[k] = (m[k] || 0) + 1;
      return m;
    }, {}),
    /**
     * The same tally for saved searches, so a search row can answer "did anything come of it".
     *
     * `null` when the database could not be asked, and that is not the same as `{}`: an empty
     * object says every search has collected nothing, which is a claim, while null says the
     * figure could not be read. The row renders nothing rather than a confident zero — the
     * console has already shipped one "0 on file" that was really "not looked up".
     */
    collectedByQuery: byQuery
  };

  return {
    generatedAt: new Date().toISOString(),
    /**
     * The running version, so the header can say which redbot this is.
     *
     * Read from package.json rather than carried in a constant, for the reason `currentVersion()`
     * in src/update.ts already gives: a hand-maintained version string is a version string that
     * lies after the first release nobody remembered to edit it for. Read once at module load,
     * not per request — it cannot change while the process lives.
     */
    version: APP_VERSION,
    build: APP_BUILD,
    /* The data root this console actually reads and writes — the thing a variant changes. */
    dataRoot: DATA,
    collect,

    pulse: {
      /* Every one of these was `array.length` over a fully-loaded log. They are the badges in
         the shell, so they describe the WHOLE record — a page-derived figure here would be
         wrong on every screen at once. */
      waitingOnYou: summary ? summary.pending : drafts.filter((d) => d.status === 'pending').length,
      profilesProvisioned: profiles.length,
      accountsInLogs: accounts.length,
      published,
      operatorDecisions: summary ? summary.reviews : reviews.length,
      regretReadings: summary ? summary.regret : regret.length,
      removals: summary ? summary.removals
                        : observations.filter((o) => o.kind === 'reply-marked-removed').length
    },

    review,
    /* The queue's real size, counted by the database. The header reports THIS, not the page —
       "3 waiting" when three hundred are is the one wrong number on that screen a person acts on. */
    reviewTotal: draftTally.total,
    reviewPending: draftTally.pending,
    reviewOffset: draftPage.offset,
    reviewLimit: draftPage.limit,

    /**
     * The fact-checker's own record, read from the log rather than described.
     *
     * The guide panel explains what the check does; these are what it has actually done. They
     * are computed here so the explanation can never drift from the evidence — a guide that
     * says "nothing has passed yet" while the log says otherwise would be worse than no guide.
     */
    /**
     * How the fact-checker has performed, over the WHOLE record — never over the page.
     *
     * This is the console's answer to "can Argus be trusted", and the evidence for that is
     * every certification ever run. Now that `certs` holds only the page's drafts, deriving it
     * here would answer that question from twenty-five rows. Counted in SQL instead; the
     * fallback below is exact whenever the certifications in hand ARE the whole table.
     */
    argus: argus ?? (() => {
      const byVerdict = { REJECT: 0, ESCALATE: 0, CERTIFIED: 0 };
      for (const c of certs) if (c.verdict in byVerdict) byVerdict[c.verdict]++;
      const ruleCounts = {};
      for (const c of certs) for (const r of c.reasons || []) ruleCounts[r.rule] = (ruleCounts[r.rule] || 0) + 1;
      const repeated = [...certsByDraft.values()].filter((l) => l.length > 1);
      return {
        runs: certs.length,
        draftsChecked: certsByDraft.size,
        byVerdict,
        everCertified: byVerdict.CERTIFIED > 0,
        topReasons: Object.entries(ruleCounts).sort((a, b) => b[1] - a[1]).slice(0, 5)
          .map(([rule, n]) => ({ rule, n })),
        draftsCheckedTwice: repeated.length,
        claimSpread: repeated.map((l) => l.map((c) => (c.claims || []).length))
      };
    })(),

    /**
     * The Threads screen. FIRST PAGE ONLY, and the figures counted by the database.
     *
     * This used to sort every assessment and `.map()` it with a `drafts.find()` inside — an
     * O(n·m) pass over two fully-loaded tables to render one screen, with every row shipped to
     * the browser whether or not it was ever scrolled to. At sixteen threads that is free; at
     * sixteen thousand it is the whole page-load. `items` is now one page and `total` says how
     * many there are, so the screen can page through the rest without ever holding them all.
     */
    discovery: {
      ...threadCounts,
      items: threadPage.rows,
      total: threadPage.total,
      offset: threadPage.offset,
      limit: threadPage.limit,
      /**
       * THE THREADS THAT WERE COLLECTED AND SHOWN NOWHERE.
       *
       * `items` comes from opportunity_assessments, so a thread the prefilter refused was counted
       * in the funnel and sent to no screen. Measured on this machine: 20 collected, 0 rows, and
       * the only account of what those twenty were living in a run log that scrolls away. The
       * console reported a number it would not let anybody look behind.
       */
      dropped: droppedPage.rows,
      droppedTotal: droppedPage.total,
      /* The position of THIS page, sent for the same reason `offset`/`limit` are sent for
         `items` above: the screen seeds its own pager from the page that already arrived, so
         it neither guesses the server's page size nor spends a second round trip learning it. */
      droppedOffset: droppedPage.offset,
      droppedLimit: droppedPage.limit,
      /**
       * WHY the threads that never reached a model call were dropped.
       *
       * `collected − assessed` is NOT all prefilter drops, and conflating them would be the
       * made-up figure this panel has always refused to show. It also contains threads the
       * filter KEPT and that simply have not been analysed yet — `redbot opportunity` takes 15
       * at a time. So the recorded drops are reported as themselves, and whatever is left over
       * is named as "not looked at yet" rather than attributed to a rule that never fired.
       */
      prefilter: prefilterDrops
    },

    accounts,
    profiles,
    accountRules,
    /* everything the "add an account" panel needs to hand over exact, non-clashing commands */
    newAccount: {
      dataDir: DATA,
      nextPort: (takenPorts.length ? Math.max(...takenPorts) : 9221) + 1,
      takenPorts,
      takenDirs,
      suggestedDir: `chrome-profile-${String.fromCharCode(98 + Math.max(0, takenDirs.length - 1))}`
    },

    outcomes: {
      published,
      /**
       * `checkpoint` and `permalink` are carried through deliberately.
       *
       * `src/health.ts` defines a reading as happening at one of four moments — immediate,
       * 1h, 24h, 7d — and `observations` stores which. This projection dropped both,
       * so the console could say a measurement existed but never WHEN in a comment's life it
       * was taken, and the Results screen had no way to tell "the 24h check has not run yet"
       * from "there is nothing to check". They are different facts.
       *
       * Null where the row has none: a karma probe is not tied to a checkpoint, and reporting
       * it as `immediate` would be inventing a reading nobody took.
       */
      /* FIRST PAGE ONLY. This grows with every karma probe and every checkpoint reading — a
         slow but genuinely unbounded table, the kind that looks harmless for months. */
      observations: observationPage.rows,
      observationsTotal: observationPage.total,
      observationsOffset: observationPage.offset,
      observationsLimit: observationPage.limit,
      /* Counted over the whole table, so "not run" means not run rather than not on this page. */
      checkpoints,
      reviews: summary ? summary.reviews : reviews.length,
      regret: summary ? summary.regret : regret.length,
      /* Everything Outcomes exists to show is downstream of a published reply. */
      blockedBy: published === 0 ? 'nothing has been published' : null
    },

    /* The last forty events. `history` is already bounded to that by the scope passed to the
       domain read, so this slice is a safety net rather than the thing doing the limiting. */
    activity: history.slice(-40).reverse().map((h) => ({ ts: h.ts, kind: h.kind, summary: h.summary })),

    /**
     * Where the numbers on this screen came from.
     *
     * This used to list ten data/ files. Nine of them are now tables, and after the store
     * moved they all reported `exists: false` — a provenance panel saying "no evidence on
     * disk" beside a screen full of rows, which is the exact inversion of what it is for.
     * It reports the database as one source with its row counts, plus the files that really
     * are still files.
     */
    sources: [
      {
        file: 'postgres: redbot',
        exists: !dom.unavailable,
        detail: dom.unavailable ?? `${threads.length} threads, ${drafts.length} drafts, ` +
          `${gaps.length} gap analyses, ${assessments.length} assessments, ${certs.length} certifications, ` +
          `${history.length} history, ${observations.length} observations, ${reviews.length} reviews, ` +
          `${regret.length} regret`
      },
      { file: `accounts (${dom.accountsFrom === 'database' ? 'accounts' : 'data/accounts.json seed'})`,
        exists: configured.length > 0, detail: `${configured.length} configured` },
      { file: `sources (${srcView.from === 'database' ? 'sources' : 'data/sources.json seed'})`,
        exists: srcView.sources.length > 0,
        detail: srcError ?? srcView.unavailable ??
          `${collect.subreddits.length} subreddit(s), ${collect.searches.length} search(es)` },
      meta('ui-status.json')
    ]
  };
}

/* ------------------------------------------------------------------ *
 * Actions
 *
 * The console runs redbot for you. What it will not do is publish without a person
 * deciding — but "a person deciding" is a typed confirmation, not a terminal. The original
 * rule (DEFECT-08) was that an approval must FAIL CLOSED; requiring a shell was one way to
 * get that and it turned out to be the expensive way. A click plus a typed word is a
 * decision, it is recorded, and it is attributable. That is the guarantee kept here.
 *
 * `reply` is not in this list. Publishing has its own endpoint with its own confirmation.
 * ------------------------------------------------------------------ */
/**
 * `needsBrowser` marks the actions that attach to Chrome over CDP, and therefore MUST know
 * which account they are running as. Verified against the engine rather than guessed:
 * read (src/commands/read.ts), search (src/commands/search.ts), probe-karma
 * (src/probe-karma.ts) and reply (src/commands/reply.ts) all reach `attach()`;
 * opportunity, draft and certify never do and run fine without an account.
 *
 * The flag exists because `config.browser.cdpEndpoint` does NOT fail closed when no account
 * is set — src/config.ts `resolveEndpoint()` falls through to a hardcoded 127.0.0.1:9222,
 * and on this machine that port is answered by Lenovo Vantage's Edge WebView2. Attaching
 * there is worse than refusing: it opens tabs in the wrong browser and reports the empty
 * result as though Reddit had served nothing.
 */
/**
 * `stoppable` says whether a person may interrupt this action part-way.
 *
 * It is true for everything that READS and ANALYSES: killing a collect half-way leaves fewer
 * threads collected, which is exactly what "stop" should mean. It is false for exactly one
 * action, and that exception is the whole reason this flag exists rather than a blanket kill —
 * see `__reply` below.
 */
/**
 * WHICH FEED A BUTTON READS. Both of these are passed explicitly rather than left to the CLI's
 * default, because the console is the only path a person actually presses and what it collects
 * should not move when a default moves.
 *
 * `--sort new`: a post becomes `hot` by ACCUMULATING votes, so `hot` hands over threads that are
 * already old, and the publish gate refuses anything past 72h. Measured on r/WordPress
 * 2026-08-11: `/hot` → 0 of 20 survived the prefilter, `--sort new` → 12 of 35 survived.
 * `--time week`: a search with no `t=` is Reddit's ALL TIME, which is where the seven- and
 * eight-year-old threads of DEFECT-11 came from. A week is the smallest window wider than the
 * 72h ceiling.
 *
 * Both are validated by the CLI, which refuses an unknown value instead of asking Reddit for a
 * feed that does not exist and reporting the empty page as a quiet subreddit.
 */
const FEED_SORT = 'new';
const SEARCH_WINDOW = 'week';

const ACTIONS = {
  'find-threads':   { args: (o) => ['read', String(o.subreddit || 'WordPress'), '--sort', FEED_SORT], label: 'look for new threads', needsBrowser: true, stoppable: true },
  'find-search':    { args: (o) => ['search', String(o.query || ''), '--time', SEARCH_WINDOW],         label: 'run a saved search',   needsBrowser: true, stoppable: true },
  /**
   * The second half of a search — and the reason a search source could not collect anything.
   *
   * `redbot search "<q>"` is a PREVIEW by construction: it reads the listing, opens no thread,
   * writes data/search-candidates.json and exits **0** saying "Nothing has been collected yet."
   * That two-step is deliberate and documented at the top of src/commands/search.ts — a bulk
   * commit is how threads seven and eight YEARS old got into the corpus (DEFECT-11), and the
   * corpus is the only production evidence redbot has.
   *
   * The console only ever ran the first half, so a search source was decorative, and said
   * nothing about it because exit 0 reads as success. Measured on this install 2026-08-12:
   * three `search.preview` rows in history, **zero** `search` commits, and zero threads with
   * `source='search'` — while the operator had added a search and pressed Collect three times.
   *
   * `picks` is passed straight through to the CLI's own parser ("1,4,7", "1-5" or "all")
   * rather than re-implemented here. The picker builds it from ticked rows, so what the
   * console commits and what the CLI would commit cannot drift apart.
   */
  'collect-search': { args: (o) => ['search', '--commit', String(o.picks || '')], label: 'collect the ones you picked', needsBrowser: true, stoppable: true },
  'score':          { args: () => ['opportunity'],                               label: 'score what came back', stoppable: true },
  'write':          { args: (o) => ['draft', ...(o.threadId ? [String(o.threadId)] : [])], label: 'write a reply', stoppable: true },
  'check':          { args: (o) => ['certify', ...(o.draftId ? [String(o.draftId)] : []), ...(o.override ? ['--override'] : [])], label: 'fact-check a reply', stoppable: true },
  'check-karma':    { args: () => ['probe-karma'],                               label: 'check karma',          needsBrowser: true, stoppable: true },
  /**
   * Publishing. Deliberately named with a leading underscore and NOT reachable from
   * /api/run — the only caller is publish(), which will not proceed without the typed
   * confirmation and which writes the single-use approval token first.
   *
   * NOT STOPPABLE, and this is the case the flag exists for. A reply is submitted to Reddit and
   * then CONFIRMED by re-reading its permalink — two steps, deliberately separate, because a
   * post that landed and was not recorded is the one failure this codebase spent a whole commit
   * on ("confirmation is a first-class stage"). Killing between them leaves a live comment on
   * Reddit that redbot does not know it made: it will not be measured, not checked for removal,
   * and may be written again. Waiting out a publish is the lesser harm, every time.
   */
  /**
   * Creating a post. Publish-class, so it is underscored and NOT in PUBLIC_ACTIONS — the only
   * caller is publishPost() below, which will not proceed without a typed SEND.
   *
   * `stoppable: false` for the same reason as __reply, and more so: a post is submitted and then
   * CONFIRMED by reading the page redbot lands on. Killing between those two leaves a live post
   * on somebody's subreddit that redbot does not know it made — and unlike a comment, a
   * duplicate post is something a moderator has to clean up.
   */
  '__post':         { args: (o) => ['post', String(o.subreddit || ''), '--title', String(o.title || ''),
                                    ...(o.body ? ['--body', String(o.body)] : []),
                                    /* The console already took a typed SEND; this hands `post` the
                                       token so it does not demand a SECOND confirmation from a pipe
                                       it cannot read. Without it every console "New post" dead-ended
                                       at the interactive prompt (found in UAT 2026-08-16). */
                                    ...(o.approvalId ? ['--approval-id', String(o.approvalId)] : [])],
                      label: 'create the post', needsBrowser: true, stoppable: false },
  '__reply':        { args: (o) => ['reply', String(o.draftId || '')],           label: 'send the reply',       needsBrowser: true, stoppable: false }
};
const PUBLIC_ACTIONS = Object.keys(ACTIONS).filter((k) => !k.startsWith('__'));

let running = null;   // one at a time — two runs against the same data files corrupt each other
/**
 * The live child, so it can be stopped from outside the promise that started it.
 *
 * Held as the ChildProcess OBJECT, never as a bare pid kept for later. A pid is a rendezvous
 * with whatever holds it NOW: Windows recycles them quickly, and a stale number will happily
 * name somebody else's process by the time you use it. Everything below re-reads
 * `runningChild.pid` at the moment of the kill and checks the child is still alive first.
 */
let runningChild = null;
/** Set when a person pressed Stop, so the close handler can say "stopped" and not "failed". */
let runningStopped = false;
/**
 * When the current run started, so refresh can say how long it has been going.
 *
 * Module-level rather than the local `started` inside runAction, because the question "has this
 * been running for eight seconds or eight minutes" is asked from OUTSIDE the promise — which is
 * exactly where a person stands when they suspect something is stuck.
 */
let runningSince = 0;
/**
 * WHICH account the running action is driving, or null when it drives no browser.
 *
 * Kept beside `running` because the one-at-a-time rule above was never the whole story: the
 * unattended loop is held in `autoProc` and consults neither, so the loop and a button could
 * drive the same Chrome at the same time. Deciding whether that is happening needs the
 * account, not just the action name.
 */
let runningAccount = null;

/**
 * The one account to drive when a request does not name one — or null when that is ambiguous.
 *
 * Refreshed whenever the console reads accounts (every /api/state and /api/pulse), so a newly
 * created account is usable without restarting the server. Null with zero accounts and null
 * with several: in both cases there is no defensible choice, and the child must fail closed
 * rather than drive somebody's browser by accident.
 */
let soleAccountHandle = null;

/**
 * Every configured handle, so an ambiguous run can name the choices instead of just refusing.
 * Kept next to `soleAccountHandle` because both are refreshed from the same read.
 */
let knownAccountHandles = [];

function rememberSoleAccount(accounts) {
  const list = (Array.isArray(accounts) ? accounts : []).filter((a) => a && a.handle);
  knownAccountHandles = list.map((a) => String(a.handle));
  soleAccountHandle = list.length === 1 ? String(list[0].handle) : null;
}

/* ------------------------------------------------------------------ *
 * The live run log.
 *
 * `/api/run` answers only when the child EXITS, and a collect pass takes minutes. Until then
 * the screen said "Looking through r/wordpress…" and nothing else — so a run that was working
 * and a run that had wedged looked identical, and the only way to tell them apart was to wait.
 * Every defect found in this console so far was diagnosed from CLI output the operator could
 * not see.
 *
 * The child's stdout/stderr is appended here line by line as it arrives, and served by
 * GET /api/run/log. Kept on the SERVER rather than pushed down a socket for two reasons:
 * reloading the page mid-run must not lose the log, and this console holds no other streaming
 * connection to keep alive. Polling a bounded array is the smaller mechanism.
 *
 * Read-only, like the rest of the GET surface: it exposes what a command printed, and nothing
 * about how to start one.
 * ------------------------------------------------------------------ */
const RUN_LOG_MAX = 2000;   // bounded: `auto` can print for days
/* Built with the constructor so the pattern text is unambiguous in every editor and escape layer. */
const NEWLINE = String.fromCharCode(10);
const ANSI = new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g');
const TRAILING_CR = new RegExp(String.fromCharCode(13) + '$');
let runLog = { id: 0, key: null, command: null, startedAt: null, lines: [], dropped: 0, done: true, code: null };
let runLogPartial = '';

/* ------------------------------------------------------------------ *
 * Where a finished run goes.
 *
 * The live buffer above is memory, so a restart lost it and starting a second action discarded
 * the first — which meant the output that diagnosed every defect found today was gone the
 * moment you clicked anything else.
 *
 * One file per run under data/run-logs/, JSONL: a header line, then one line per output line,
 * then a footer. Written AS THE RUN GOES rather than on exit, so a crashed or killed run still
 * leaves what it managed to print — the case you most want a log for.
 *
 * Files, not Postgres: this is debug output, not the operator's evidence, and it has to stay
 * readable when the database is the thing that broke.
 * ------------------------------------------------------------------ */
const RUN_LOG_DIR = join(DATA, 'run-logs');
const RUN_LOG_KEEP = 500;              // newest 500 runs; older ones pruned when a run starts
let runLogStream = null;

/** Sortable by name, so listing and pruning never have to stat every file. */
function runLogFileName(startedAt, id) {
  return startedAt.replace(/[:.]/g, '-') + '__' + String(id).padStart(6, '0') + '.jsonl';
}

function runLogWrite(obj) {
  if (!runLogStream) return;
  try { runLogStream.write(JSON.stringify(obj) + NEWLINE); } catch { /* disk full, read-only fs */ }
}

/**
 * Delete everything past the newest RUN_LOG_KEEP.
 *
 * Done when a run starts, not on a timer: that is exactly when the count can exceed the cap,
 * and it means no background work and no surprise pause in the middle of a run.
 */
function runLogPrune(target) {
  try {
    const files = readdirSync(RUN_LOG_DIR).filter((f) => f.endsWith('.jsonl')).sort();
    const excess = files.length - target;
    for (let i = 0; i < excess; i++) rmSync(join(RUN_LOG_DIR, files[i]), { force: true });
  } catch { /* no directory yet, or unreadable — nothing to prune */ }
}

/** Newest first. Headers only — a run's lines stay on disk until it is actually opened. */
function runLogList(limit = 100) {
  try {
    const files = readdirSync(RUN_LOG_DIR).filter((f) => f.endsWith('.jsonl')).sort().reverse();
    return files.slice(0, limit).map((f) => {
      try {
        const raw = readFileSync(join(RUN_LOG_DIR, f), 'utf8');
        const rows = raw.split(NEWLINE).filter((l) => l.trim());
        const h = JSON.parse(rows[0]);
        const foot = rows.length > 1 ? JSON.parse(rows[rows.length - 1]) : null;
        const done = !!(foot && foot.t === 'f');
        return {
          file: f, id: h.id, key: h.key, command: h.command, startedAt: h.startedAt,
          /* No footer means the process died mid-run. Reported, not hidden: a truncated log is
             itself the most useful thing to know about that run. */
          done, code: done ? foot.code : null, lines: done ? foot.lines : rows.length - 1
        };
      } catch {
        return { file: f, id: null, key: null, command: '(unreadable log)', startedAt: null,
                 done: false, code: null, lines: null };
      }
    });
  } catch { return []; }
}

/** One past run, in the same shape the live endpoint returns. */
function runLogRead(file) {
  if (!/^[0-9A-Za-z._-]+[.]jsonl$/.test(file)) return null;   // name shape only: no traversal
  let raw;
  try { raw = readFileSync(join(RUN_LOG_DIR, file), 'utf8'); } catch { return null; }
  const rows = raw.split(NEWLINE).filter((l) => l.trim());
  if (!rows.length) return null;
  let header;
  try { header = JSON.parse(rows[0]); } catch { return null; }
  const out = [];
  let foot = null;
  for (const r of rows.slice(1)) {
    try {
      const o = JSON.parse(r);
      if (o && o.t === 'l') out.push({ at: o.at, text: o.text });
      else if (o && o.t === 'f') foot = o;
    } catch { /* skip a torn line rather than fail the whole read */ }
  }
  return {
    runId: header.id, key: header.key, command: header.command, startedAt: header.startedAt,
    running: false, done: !!foot, code: foot ? foot.code : null, dropped: foot ? foot.dropped : 0,
    total: out.length, lines: out, file
  };
}

function runLogStart(key, command) {
  runLogPartial = '';
  try { if (runLogStream) runLogStream.end(); } catch { /* already closed */ }
  runLogStream = null;
  runLog = {
    id: runLog.id + 1, key, command,
    startedAt: new Date().toISOString(),
    lines: [], dropped: 0, done: false, code: null
  };

  /* Open this run's file and write its header at once, so even a run that dies in its first
     second leaves a record that it was attempted. */
  try {
    mkdirSync(RUN_LOG_DIR, { recursive: true });
    /* KEEP-1: this run is about to add its own file, and the cap is a promise about how
       many files exist — not how many existed a moment before the newest one appeared. */
    runLogPrune(RUN_LOG_KEEP - 1);
    runLog.file = runLogFileName(runLog.startedAt, runLog.id);
    runLogStream = createWriteStream(join(RUN_LOG_DIR, runLog.file), { flags: 'a' });
    runLogWrite({ t: 'h', id: runLog.id, key, command, startedAt: runLog.startedAt });
  } catch {
    runLogStream = null;   // a console that cannot write its log still runs commands
  }
}

/**
 * Split on newlines and stamp each line with milliseconds since the run began.
 *
 * A chunk boundary is not a line boundary, so a partial line is held back until its newline
 * arrives — otherwise the viewer renders half a sentence and then repeats it whole.
 */
function runLogAppend(chunk) {
  if (runLog.done) return;
  const at = Date.now() - Date.parse(runLog.startedAt);
  const parts = (runLogPartial + String(chunk)).split(NEWLINE);
  runLogPartial = parts.pop() ?? '';
  for (const raw of parts) {
    // The CLI writes for a terminal; this renders in HTML. Strip the colour codes.
    const text = raw.replace(ANSI, '').replace(TRAILING_CR, '');
    runLog.lines.push({ at, text });
    runLogWrite({ t: 'l', at, text });   // to disk as it happens, not on exit
  }
  if (runLog.lines.length > RUN_LOG_MAX) {
    const cut = runLog.lines.length - RUN_LOG_MAX;
    runLog.lines.splice(0, cut);
    runLog.dropped += cut;   // reported to the client, never silently forgotten
  }
}

function runLogFinish(code) {
  if (runLogPartial) runLogAppend(NEWLINE);   // flush a final line with no trailing newline
  runLogPartial = '';
  runLog.done = true;
  runLog.code = code;
  /* A footer appended rather than the header rewritten: append-only means a reader never
     sees a half-updated record, and a run killed before this point simply has none. */
  runLogWrite({ t: 'f', code, lines: runLog.lines.length, dropped: runLog.dropped });
  try { if (runLogStream) runLogStream.end(); } catch { /* already closed */ }
  runLogStream = null;
}

/**
 * Is that pid still a live process — asked of the OS, not of our own bookkeeping.
 *
 * Signal 0 performs the existence and permission checks and delivers nothing. EPERM means the
 * process EXISTS and belongs to somebody else, which is still alive; only ESRCH is gone. Reading
 * EPERM as "dead" would clear a lock over a running child and let a second run start against the
 * same data files, which is the one thing the lock exists to prevent.
 */
function pidAlive(pid) {
  if (!pid) return false;
  try { process.kill(pid, 0); return true; }
  catch (e) { return !!(e && e.code === 'EPERM'); }
}

/**
 * What is actually running, and release the lock when the answer is nothing.
 *
 * Called by refresh. Reports rather than acts, with one exception: a lock whose process has
 * gone is cleared, because that state is unrecoverable from the UI and blocks every button.
 *
 * The pending `/api/run` request of a cleared run is NOT resolved here — it belongs to the
 * promise inside runAction and only the child's own close handler can settle it. If that
 * handler never ran, that request was already never going to answer; the caller's fetch is
 * lost either way. What this changes is that the NEXT run can start.
 */
function reconcileRun() {
  if (!running) return { ok: true, running: false, cleared: false };

  const key = running;
  const spec = ACTIONS[key] || null;
  const label = spec ? spec.label : key;
  const child = runningChild;
  const exited = !child || child.exitCode !== null || child.signalCode !== null;

  if (!exited && pidAlive(child.pid)) {
    return {
      ok: true, running: true, cleared: false,
      key, label, account: runningAccount, pid: child.pid,
      ms: runningSince ? Date.now() - runningSince : null,
      /* Whether a person is ALLOWED to end it. Sending a reply is not stoppable, and offering a
         button the server would refuse is a button that lies. */
      stoppable: !!(spec && spec.stoppable),
      command: runLog.command || null
    };
  }

  running = null; runningAccount = null; runningChild = null; runningStopped = false; runningSince = 0;
  /* Only if the log is still open — a run that closed normally has already written its footer,
     and a second one would make the file describe two endings. */
  if (!runLog.done) { runLogAppend(`${NEWLINE}[the console found this run had already ended]${NEWLINE}`); runLogFinish(-1); }
  return { ok: true, running: false, cleared: true, key, label };
}

/**
 * Why a reply could not start right now, or null when nothing is in the way.
 *
 * The same three questions `runAction` asks, asked without side effects so `publish()` can ask
 * them BEFORE it writes an approval token. Kept as one function rather than two copies: a
 * pre-flight that drifts from the real gate is worse than no pre-flight, because it says yes
 * to something that is then refused.
 */
function whyReplyCannotStart(requestedAccount) {
  const spec = ACTIONS['__reply'];
  if (running) return `"${running}" is still running`;
  const account = requestedAccount ? String(requestedAccount) : soleAccountHandle;
  if (!account) {
    return `"${spec.label}" drives a Reddit browser, so it needs to know which account to run as. ` +
      (knownAccountHandles.length
        ? `Configured: ${knownAccountHandles.join(', ')}.`
        : 'No accounts are configured yet — add one on the Accounts screen.');
  }
  if (autoProc && autoProc.account === account) {
    return `The unattended loop is already running as ${account}. Stop it first — two processes on one Chrome read each other's pages.`;
  }
  return null;
}

function runAction(key, opts) {
  return new Promise((resolve) => {
    const spec = ACTIONS[key];
    if (!spec) return resolve({ ok: false, error: `unknown action: ${key}` });
    if (running) return resolve({ ok: false, error: `"${running}" is still running` });

    /**
     * Which account, decided BEFORE the run slot is claimed so a refusal cannot wedge it.
     *
     * An explicit account from the request wins; otherwise the single configured account.
     * With none resolvable this is genuinely ambiguous, and a browser-driving action must
     * refuse rather than let the child fall through to `resolveEndpoint()`'s 9222 default.
     */
    const account = (opts && opts.account) ? String(opts.account) : soleAccountHandle;
    if (spec.needsBrowser && !account) {
      const known = knownAccountHandles.length
        ? `Configured: ${knownAccountHandles.join(', ')}.`
        : 'No accounts are configured yet — add one on the Accounts screen.';
      return resolve({
        ok: false,
        error: `"${spec.label}" drives a Reddit browser, so it needs to know which account to run as. ${known}`
      });
    }

    /**
     * The loop and this button must not drive one Chrome between them.
     *
     * `running` guards one button against another; `autoProc` guards one loop against another;
     * neither consulted the other, so starting the unattended loop as an account and then
     * pressing Collect as that same account put TWO processes on that account's CDP endpoint,
     * both calling `context.newPage()` and both writing threads. The comment on `running`
     * already says why that is not allowed — "two runs against the same data files corrupt
     * each other" — the loop simply was not covered by it.
     *
     * Scoped to the SAME account on purpose. A loop running as A while you collect as B is two
     * browsers and no conflict, and the loop was deliberately held apart from `running` so it
     * could never block a person from pressing a button. This keeps that, and only refuses the
     * case that actually collides.
     */
    if (spec.needsBrowser && autoProc && autoProc.account === account) {
      return resolve({
        ok: false,
        status: 409,
        error: `The unattended loop is already running as ${account}. Stop it first — two processes on one Chrome read each other's pages.`
      });
    }

    const args = spec.args(opts || {}).filter((a) => a !== '');
    running = key;
    runningAccount = spec.needsBrowser ? account : null;
    const started = Date.now();
    runningSince = started;
    /**
     * Who runs it, and as whom.
     *
     * The operator (whose Claude credentials pay for the model calls) comes from the shell
     * this server was started in — never from the browser, which cannot be trusted to name
     * a billing identity. The ACCOUNT (whose Reddit browser is driven) does come from the
     * request, because that is a per-click choice, and config.ts validates the name against
     * accounts.json before anything runs.
     */
    const env = { ...process.env };
    /**
     * Which Reddit browser this drives. Resolved above, into `account`.
     *
     * This block used to END the story with "so nothing is set and the child fails closed".
     * It did not. `soleAccountHandle` is null with two or more accounts, so REDBOT_ACCOUNT
     * went unset, and src/config.ts `selectedAccount()` returns null (it does not throw) —
     * leaving `resolveEndpoint()` to fall through to its hardcoded 127.0.0.1:9222. Measured
     * on 2026-07-29: that port answered /json/version as "LenovoVantage/3.0.0.191", the very
     * browser the old comment named as the bug it had fixed. The guard was inert on any
     * machine with more than one account.
     *
     * The refusal is now explicit, above, and only browser-driving actions are subject to it —
     * opportunity, draft and certify never attach and keep working without an account.
     */
    if (account) env.REDBOT_ACCOUNT = account;
    /**
     * Bill the run to the operator the console picked, overriding whatever the server's shell
     * inherited. Only ever a name already in operators.json (the select endpoint validates it),
     * so the browser is choosing among pre-authorised local identities, not naming a new one.
     * If nothing is selected, the child's config.ts fails closed with "No Claude operator set".
     */
    if (selectedOperator) env.REDBOT_OPERATOR = selectedOperator;
    /* Which LLM path. Always set, because 'cli' must be able to OVERRIDE a REDBOT_LLM=api the
       server's own shell exported — a choice made on the Setup screen has to win over it. */
    env.REDBOT_LLM = selectedProvider;
    // H5: the CDP endpoint is NOT taken from the request. The selected account already resolves
    // its own debug port from accounts.json (config.ts); letting the browser body set REDBOT_CDP
    // would let a caller point redbot at a debugger they control and harvest every scraped
    // thread. config.ts additionally refuses any non-loopback REDBOT_CDP as defence in depth.

    runLogStart(key, `redbot ${args.join(' ')}`);
    const child = spawn(process.execPath, [join(ROOT, 'dist', 'cli.js'), ...args], {
      cwd: SPAWN_CWD, env, stdio: ['ignore', 'pipe', 'pipe']
    });
    runningChild = child;
    runningStopped = false;
    let out = '', err = '';
    // Buffered for the final response AND streamed to the live log — the response contract
    // is unchanged, the log is additive.
    child.stdout.on('data', (d) => { out += String(d); runLogAppend(d); });
    child.stderr.on('data', (d) => { err += String(d); runLogAppend(d); });
    const timer = setTimeout(() => { try { child.kill(); } catch {} }, 20 * 60 * 1000);
    child.on('close', (code) => {
      clearTimeout(timer); running = null; runningAccount = null; runningChild = null; runningSince = 0;
      runLogFinish(code);
      /* The moment the numbers changed. Fire-and-forget: the run's response must not wait on a
         network call, and a push that fails leaves its cursor alone and retries on the heartbeat. */
      try { pushScheduler?.trigger('run-end'); } catch { /* never let a push break a run */ }
      /* A run somebody stopped is not a run that failed. Reported separately so the screen can
         say "Stopped" rather than showing a red error for the thing it was asked to do. */
      const stopped = runningStopped;
      runningStopped = false;
      /* The child already said why. Carrying its own last flagged line up to the response is what
         stops the front end reaching for `|| 'scoring did not work'` — see run-outcome.mjs. */
      const error = runError({ code, stopped, out, err });
      /* NOTHING TO DO IS NOT A FAILURE. `ok: code === 0` alone made an empty corpus a failed run:
         opportunity exits NOTHING_TO_DO when there is nothing to score, the front end threw on
         `!ok`, and a collect that worked was reported red over a message that was only ever a
         statement of fact. The flag is what a caller branches on; the note is what it says. */
      const nothing = !stopped && code === NOTHING_TO_DO;
      const note = nothing ? runNote({ code, out, err }) : null;
      resolve({
        ok: code === 0 || nothing, code, stopped, ms: Date.now() - started,
        ...(nothing ? { nothing: true } : {}),
        ...(note ? { note } : {}),
        ...(error ? { error } : {}),
        output: (out + err).slice(-24000), command: `redbot ${args.join(' ')}`
      });
    });
    child.on('error', (e) => {
      clearTimeout(timer); running = null; runningAccount = null; runningChild = null; runningSince = 0;
      runningStopped = false;
      runLogAppend(`failed to start: ${e && e.message || e}` + NEWLINE);
      runLogFinish(-1);
      resolve({ ok: false, error: String(e && e.message || e) });
    });
  });
}

/* ------------------------------------------------------------------ *
 * Setting up an account, without a terminal.
 *
 * The person's only job is to type their own Reddit password into a real Chrome window.
 * Everything around that — picking a free port, making the folder, launching Chrome with
 * the right flags, writing the config — is clerical, and asking a non-technical operator to
 * paste PowerShell to do clerical work is how a tool ends up unused.
 *
 * What is NOT automated, deliberately: the sign-in itself. redbot never sees or stores a
 * password, and an account nobody signed into is not really yours.
 * ------------------------------------------------------------------ */
const accountsPath = join(DATA, 'accounts.json');
const operatorsPath = join(DATA, 'operators', 'operators.json');

/* ------------------------------------------------------------------ *
 * Operators — whose Claude login pays for a run.
 *
 * The console must NEVER invent a billing identity from a web request. So the picker offers
 * only names already written into operators.json by someone with filesystem access — the same
 * trust model as the account picker. Selecting one just chooses among pre-authorised local
 * identities; it cannot create one, and the credential PATHS never reach the browser.
 *
 * `selectedOperator` starts as whatever REDBOT_OPERATOR the server was launched with, so a
 * shell that already named an operator keeps working with no click.
 * ------------------------------------------------------------------ */
/**
 * The environment first, then whatever was picked on the Setup screen last time.
 *
 * Same precedence as `config.llm.operator`, and it has to be, or the picker would show one name
 * while the requirement check reported another. That disagreement is the defect this fixes: the
 * console remembered a choice in this variable, forwarded it to spawned children, and the gate —
 * reading `config.llm.operator` — never saw it, so the Setup screen said "no Claude operator is
 * selected" directly underneath a picker showing one.
 */
let selectedOperator = process.env.REDBOT_OPERATOR || configApi.storedOperatorSelection();

/**
 * Which LLM path a run takes: this machine's Claude login ('cli') or a stored API key ('api').
 *
 * Starts from REDBOT_LLM so a shell that already chose keeps working with no click — the same
 * rule as `selectedOperator`. Forwarded to every child rather than mutated into this process's
 * own environment: a running child cannot be re-pointed, and pretending otherwise would make
 * the screen disagree with the run.
 */
let selectedProvider = process.env.REDBOT_LLM === 'api' ? 'api' : 'cli';

/** Last answer from the update check, so the page asking on every load costs one request a day. */
/** Last dependency scan. Locating executables spawns processes; see the /api/dependencies route. */
let depsCache = { at: 0, value: null };

let updateCache = { at: 0, value: null };

/** Last dashboard reachability answer. Short-lived: it is a liveness reading, not a fact. */
let syncHealthCache = { at: 0, value: null };
const llmProvider = () => selectedProvider;

function readOperators() {
  let all;
  try {
    all = configApi.listOperators();
  } catch {
    // A corrupt registry is reported by the requirement check, in words; the picker just empties.
    return [];
  }
  return all.map((o) => ({
    name: o.name,
    // shared = not a dedicated data/operators/<name>/ folder → bills a login someone else owns
    shared: o.shared,
    // `ready` now means SIGNED IN, not "the folder exists" — see config.ts operatorSignedIn().
    ready: o.ready,
    note: o.note || '',
    /**
     * The sign-in command, ready to copy.
     *
     * This DOES carry `configDir`, reversing what this function used to say, so the reasoning is
     * worth stating rather than deleting. The old note was "a filesystem path never leaves the
     * machine" — but signing in is the one step redbot cannot do for anybody (it is an interactive
     * Claude session), so the console's only useful move is to hand over the exact command. Two
     * places already emitted this same string with the same path: `/api/operator/create` returns it
     * on registration, and `src/requirements.ts` puts it in the sign-in hint. Withholding it here
     * only meant an operator who dismissed that one message could never see it again.
     *
     * The path is under the operator's OWN per-user data directory, it is rendered to the same
     * person on the same machine, and it is not a credential — the login it initiates never passes
     * through redbot. `configDir` itself is still not sent as a bare field; only this command is.
     */
    signIn: {
      powershell: `$env:CLAUDE_CONFIG_DIR = "${o.configDir}"; claude`,
      bash: `CLAUDE_CONFIG_DIR="${o.configDir}" claude`
    }
  }));
}

/** Reddit-ish operator names, matching VALID in src/commands/operators.ts. */
const OPERATOR_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$/;

/**
 * Register an operator — the half of `redbot operators add` that a web page legitimately can do.
 *
 * Creating one is a directory and a line in a registry: no credential is involved, so there is
 * nothing here the console must be kept away from. The half it CANNOT do is the SIGN-IN — that
 * is an interactive `claude` session with `/login` typed into it by a person, and no web page
 * drives that. So this returns the exact command to paste, and `ready` stays false until that
 * folder actually has a login in it.
 *
 * Mirrors src/commands/operators.ts rather than shelling out to it: `operators add` writes
 * prose to stdout for a human, and the console needs the values.
 *
 * ON RETURNING configDir. `readOperators()` above deliberately withholds it, and that rule is
 * right for a list polled on every render. This is the considered exception: it is the path of
 * the operator you just created, returned once, to a loopback-only origin, and the sign-in
 * command is unusable without it. Nothing else here hands out a path.
 */
function createOperator(rawName) {
  const name = String(rawName || '');
  if (!OPERATOR_NAME_RE.test(name)) {
    return { ok: false, error: 'Letters, digits, dot, dash and underscore only — up to 32 characters, starting with a letter or digit.' };
  }

  const existing = readJson(operatorsPath, null);
  if (existing !== null && (typeof existing !== 'object' || Array.isArray(existing))) {
    return { ok: false, error: 'data/operators/operators.json is not readable JSON. Fix or remove it before adding an operator.' };
  }
  const all = existing || {};
  if (all[name]) {
    return { ok: false, error: `"${name}" already exists. Remove its entry by hand to re-create it.` };
  }

  const configDir = join(DATA, 'operators', name, 'claude');
  mkdirSync(configDir, { recursive: true });
  all[name] = {
    configDir,
    declaredBy: name,
    declaredAt: new Date().toISOString().slice(0, 10),
    note: 'Dedicated login folder created from the console. Sign in once before use.'
  };
  writeFileSync(operatorsPath, JSON.stringify(all, null, 2) + '\n', 'utf8');

  return {
    ok: true,
    name,
    signIn: {
      powershell: `$env:CLAUDE_CONFIG_DIR = "${configDir}"; claude`,
      bash: `CLAUDE_CONFIG_DIR="${configDir}" claude`
    }
  };
}

/**
 * Everything the Setup screen needs to say whether this install can actually run.
 *
 * Reports ABSENCE as absence, the same rule as the rest of this file: a vault that cannot be
 * opened, a database that is down and a key that was never stored are three different answers
 * and each gets its own sentence. Never reports a secret VALUE — `listSecrets()` returns the
 * name, the 4-char hint and the sealing key id, which identifies a credential without being one.
 */
async function setupStatus() {
  const dbReason = dbStatus ? dbStatus() : 'the compiled build is missing';
  const vaultReason = vaultApi ? vaultApi.vaultUnavailableReason() : 'the compiled build is missing';

  /**
   * Whether the schema is CURRENT, which is not what `dbReason` answers.
   *
   * `dbUnavailableReason()` is `existsSync(dbFile())` and nothing more, so this field used to go
   * green on a database whose migrations had failed — the exact state the 2.0.0 proxy release
   * shipped into, where `account_proxies` did not exist and every screen said the database was
   * fine. `ping()` now knows what pending means; this is where the Setup screen learns it.
   *
   * Kept OUT of the secrets gate below on purpose. Secrets live in `credentials` (migration 0011),
   * so a database that is merely behind can still open them — and the Setup screen is the screen a
   * person uses to fix things. Blanking it out would remove the tools at the moment they are needed.
   */
  let dbHealth = null;
  if (!dbReason && dbPing) {
    try { dbHealth = await dbPing(); } catch { dbHealth = null; }
  }

  let fingerprint = null;
  if (!vaultReason) {
    try { fingerprint = vaultApi.keyFingerprint(); } catch { fingerprint = null; }
  }

  /* Only attempted when both halves are up: listing needs the database, opening needs the key. */
  let secrets = [], secretsError = null;
  if (!dbReason && !vaultReason) {
    try {
      secrets = (await vaultApi.listSecrets()).map((s) => ({
        scope: s.scope, name: s.name, hint: s.hint, keyId: s.keyId,
        updatedAt: s.updatedAt, lastUsedAt: s.lastUsedAt
      }));
    } catch (e) {
      secretsError = e && e.message ? e.message : String(e);
    }
  }

  const operators = readOperators();
  const apiKeyName = vaultApi ? vaultApi.ANTHROPIC_API_KEY : 'anthropic_api_key';

  /**
   * The shared requirement set — the thing the first-boot gate turns on.
   *
   * Derived on every request, never cached and never remembered. These go stale constantly: a
   * browser gets closed, a port gets taken, a key gets rotated. A stored "setup complete" flag
   * would let the app open onto a broken install and say nothing, which is exactly what the old
   * `localStorage['redbot.seenGuide']` first-run signal did.
   *
   * Failure here must not take the whole Setup screen down — it is the screen a person uses to fix
   * things — so the error is reported as a field rather than thrown.
   */
  let requirements = [];
  let requirementsError = null;
  if (requirementsApi) {
    try {
      requirements = await requirementsApi.checkRequirements();
    } catch (e) {
      requirementsError = e && e.message ? e.message : String(e);
    }
  } else {
    requirementsError = 'the compiled build is missing';
  }

  return {
    requirements,
    requirementsError,
    /* Split here rather than in the browser so the CLI and the console agree on what "blocking"
       means. The UI decides what to DO about it; it does not decide what it IS. */
    blocking: requirements.filter((r) => r.tier === 'blocking' && !r.ok),
    advisory: requirements.filter((r) => r.tier === 'advisory' && !r.ok),
    database: {
      ok: !dbReason && (dbHealth ? dbHealth.ok : true),
      reason: dbReason || (dbHealth && !dbHealth.ok ? dbHealth.detail : null),
      /* Named rather than merely counted, so the screen can say WHICH migration is missing. */
      pendingMigrations: (dbHealth && dbHealth.pendingMigrations) || []
    },
    vault: { ok: !vaultReason, reason: vaultReason, keyId: fingerprint },
    secrets, secretsError, apiKeyName,
    /* Whether a key is on file at all — the one fact the "which provider" choice turns on. */
    apiKeyStored: secrets.some((s) => s.name === apiKeyName),
    /* Whether a Webshare key is stored — the one fact the OPTIONAL exit-autofill step turns on.
       A boolean, never the value: the key is used only server-side by /api/webshare/proxies. */
    webshareKeyStored: secrets.some((s) => s.name === (vaultApi ? vaultApi.WEBSHARE_API_KEY : 'webshare_api_key')),
    /* The environment's key wins over the vault (src/config.ts anthropicKey), so say when one
       is set — otherwise storing a vault key and seeing no change is baffling. */
    apiKeyFromEnv: Boolean(process.env.ANTHROPIC_API_KEY),
    provider: llmProvider(),
    providerFromEnv: process.env.REDBOT_LLM === 'api' ? 'api' : null,
    /**
     * Dashboard sync, reported the same way secrets always are here: whether a token EXISTS and
     * its last four characters, never the value. `installId` is not a secret — it is the
     * partition key the dashboard stores under, and an operator needs to read it out to have a
     * token minted for this install.
     */
    sync: await (async () => {
      if (!pushApi) return { available: false };
      try {
        const push = await pushApi.resolveToken();
        const share = await pushApi.resolveShareToken();
        return {
          available: true,
          url: pushApi.syncUrl(),
          urlFromEnv: Boolean(process.env.REDBOT_SYNC_URL),
          installId: pushApi.pushStatus().installId,
          pushToken: push.token ? { present: true, from: push.from, hint: push.token.slice(-4) } : { present: false, note: push.note ?? null },
          shareToken: share.token ? { present: true, from: share.from, hint: share.token.slice(-4) } : { present: false, note: share.note ?? null }
        };
      } catch (e) {
        return { available: false, error: e && e.message ? e.message : String(e) };
      }
    })(),
    operators,
    selectedOperator,
    /* Same rule as apiKeyFromEnv: the environment wins over the stored choice, so say when one
       is set — otherwise picking an operator and seeing nothing change is baffling. */
    operatorFromEnv: process.env.REDBOT_OPERATOR || null,
    operatorReady: operators.some((o) => o.name === selectedOperator && o.ready)
  };
}

function chromeBinary() {
  const candidates = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.CHROME_PATH
  ].filter(Boolean);
  return candidates.find((p) => existsSync(p)) || null;
}

/**
 * The everyday Chrome profiles that actually exist on this machine.
 *
 * Read from Chrome's own `Local State` → `profile.info_cache`, which is exactly the list
 * Chrome's profile switcher shows: folder name, display name, and the Google account signed
 * into it. Overridable by REDBOT_CHROME_USER_DATA so a test can point at a fixture instead of
 * whatever browser the machine running the suite happens to have.
 *
 * WHY `usableForAutomation` IS FALSE — this is the important part.
 *
 * redbot cannot drive one of these profiles, and the failure is silent, which is worse than
 * an error. MEASURED on 2026-07-29 against Chrome 150 on this machine: launching Chrome with
 * `--user-data-dir=<the real User Data folder> --profile-directory="Profile 1"
 * --remote-debugging-port=9337` DOES open a working CDP endpoint — /json/version answered 200
 * — but the browser behind it carried NONE of that profile's data: 0 cookies, against 11
 * cookies (reddit among them) on redbot's own profile probed the same way, in the same script.
 *
 * That is the Chrome 136 change: remote debugging is refused for the everyday data directory,
 * and what answers instead is an isolated, empty profile.
 * https://developer.chrome.com/blog/remote-debugging-port
 *
 * So an account pointed at one of these would attach perfectly and behave as though signed
 * out. The list is offered for RECOGNITION — "this Reddit login lives in that profile" — and
 * the screen says plainly that redbot still drives its own window.
 */
const CHROME_USER_DATA = process.env.REDBOT_CHROME_USER_DATA
  || (process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'User Data') : null);

function chromeProfiles() {
  const none = (reason) => ({ available: false, reason, profiles: [], usableForAutomation: false });
  if (!CHROME_USER_DATA) return none('This machine does not report a Chrome data folder.');

  const statePath = join(CHROME_USER_DATA, 'Local State');
  if (!existsSync(statePath)) return none('Chrome’s profile list is not where it usually lives, so its profiles cannot be read.');

  const state = readJson(statePath, null);
  const cache = state && state.profile && state.profile.info_cache;
  if (!cache || typeof cache !== 'object') return none('Chrome’s profile list could not be read.');

  const profiles = Object.entries(cache)
    .filter(([dir]) => typeof dir === 'string' && dir)
    .map(([dir, info]) => ({
      directory: dir,
      name: (info && typeof info.name === 'string' && info.name) || dir,
      /* Two profiles routinely share a display name; the account is what tells them apart, and
         Chrome's own switcher already shows it. */
      email: (info && typeof info.user_name === 'string' && info.user_name) || null,
      onDisk: existsSync(join(CHROME_USER_DATA, dir))
    }))
    // Default first, then Profile 1, 2, 3 — the order Chrome itself presents them in.
    .sort((a, b) => (a.directory === 'Default' ? -1 : b.directory === 'Default' ? 1
                     : a.directory.localeCompare(b.directory, 'en', { numeric: true })));

  return {
    available: true,
    reason: null,
    profiles,
    lastUsed: (state.profile && state.profile.last_used) || null,
    usableForAutomation: false,
    whyNotUsable: 'Chrome refuses remote debugging on your everyday profile, so redbot would attach to an empty one and read Reddit signed out. It signs in through its own window instead.'
  };
}

/**
 * Adding an account is the one mutation this console performs directly, and it now lands in
 * `accounts` — the system of record — with data/accounts.json written alongside as the
 * seed and the database-is-down fallback.
 *
 * The allocator (which free port, which profile folder) lives in dist/console-accounts.js so
 * this console and the operator console cannot each grow their own version of it and start
 * handing out the same port.
 */
async function createAccount(body) {
  return createAccountImpl(body);
}

/**
 * Opens that account's own Chrome. Detached — closing the console must not close it.
 *
 * `background` puts the window off-screen instead of in front of the person. See the spawn below
 * for why that is off-screen and never headless.
 */
async function launchChrome(handle, { background = false } = {}) {
  // Which port and folder this account owns is read from the system of record, so a browser
  // opened here is the same browser the CLI will later attach to. Reading the seed file
  // instead would open the wrong Chrome the moment the two disagreed.
  const { accounts } = await consoleAccounts();
  /* `let`, because a port held by another program is moved off below and the record changes. */
  let a = accounts.find((x) => x.handle === handle);
  if (!a) return { ok: false, error: `${handle} is not set up.` };

  const bin = chromeBinary();
  if (!bin) return { ok: false, error: 'Chrome could not be found in the usual place. Set CHROME_PATH and try again.' };

  /**
   * Never open a window on a port that is not this account's to take.
   *
   * Chrome given an occupied --remote-debugging-port does NOT fail: it starts, silently gives
   * up the port to whoever holds it, and the window looks perfectly normal. redbot then
   * attaches to the squatter. That is how a machine with Lenovo Vantage on 9222 produced a
   * signed-out reading for an account whose Chrome was signed in — so the check belongs here,
   * before a window is opened that would look like success.
   */
  const [live] = await portStatusImpl([a]);
  if (live && live.ours) {
    return { ok: true, handle, port: a.debugPort, profileDir: a.profileDir, alreadyRunning: true };
  }

  /**
   * A port somebody else is holding is MOVED OFF, not reported.
   *
   * This used to return `live.detail` and stop: "port 9222 is held by msedgewebview2.exe, pick
   * another one on the Accounts screen." Every word of that is true and none of it is the
   * operator's problem. A debug port is an implementation detail of how redbot talks to Chrome —
   * a person cannot be expected to know why 9222 matters, which number is safe, or that Lenovo
   * Vantage took it at boot. Handing them that decision is handing them a puzzle they have no
   * way to solve, in exchange for nothing: any free port works equally well.
   *
   * So the account is reallocated to the next port that actually binds, the record is updated,
   * and the browser opens. `changeAccountPort({auto:true})` is the SAME allocator the Accounts
   * screen's "pick one for me" button uses — this is that button, pressed automatically at the
   * only moment it was ever needed.
   *
   * WHAT THIS IS NOT: it is not attaching to the squatter. That is the defect the foreign check
   * was written for — Chrome handed an occupied --remote-debugging-port starts anyway, silently
   * yields the port, and redbot then reads whatever answers, which is how a signed-in account
   * once reported "not signed in". Moving to a free port is the opposite of that: it guarantees
   * the browser redbot opens is the browser redbot attaches to.
   *
   * It reports what it did rather than doing it silently — `movedFrom` is surfaced so a person
   * who is curious can see it, and so a port that moves every single launch is visible as a
   * pattern instead of as nothing at all.
   */
  let movedFrom = null;
  if (live && live.state === 'foreign') {
    const moved = await changePortImpl({ handle: a.handle, auto: true });
    if (!moved.ok) {
      /* No free port at all is a real fault and stays a refusal — but it says what was tried. */
      return { ok: false, error: `${live.detail} redbot tried to move ${a.handle} to a free port and could not: ${moved.error}` };
    }
    movedFrom = a.debugPort;
    a = moved.account ?? { ...a, debugPort: moved.port };
  }

  /* resolveProfileDir, not join — an adopted profile's path is absolute, and join would build a
     folder that exists nowhere, so Chrome would open a brand-new empty profile and report the
     account signed out. See src/profiles.ts. */
  const dir = profilesApi ? profilesApi.resolveProfileDir(DATA, a.profileDir) : join(DATA, a.profileDir);

  /**
   * THE EXIT. Which address this browser will appear from — decided here, before it opens.
   *
   * Three outcomes, and the middle one is the whole point of putting this before `spawn`:
   *
   *   not proxied  no exit configured, or it is switched off. Every account is in this state
   *                until somebody vets one, and it launches exactly as it always did. This is
   *                the ONLY branch that adds no flag.
   *   refused      an exit IS configured but could not be proven good right now — never vetted,
   *                no credential, unreachable, or answering from an address that is not the
   *                pinned one. Nothing is spawned. Reddit fixes an account to the address it
   *                first appears from and there is no undo, so a window that opens and quietly
   *                uses this computer's own connection is the one failure worth refusing a
   *                button over. `launchChrome` already refuses a foreign debug port on exactly
   *                this reasoning; this is the same rule applied to the network.
   *   proxied      `--proxy-server=http://127.0.0.1:<relayPort>`. The relay adds the provider
   *                credential on the way out — Chrome ignores credentials in that flag
   *                (crbug 40471183) and the extension workaround died with `--load-extension`
   *                in Chrome 137, which is why a local relay exists at all.
   *
   * MEASURED, and it is what makes the refusal defence-in-depth rather than the only guard:
   * with its proxy dead Chrome made ZERO connections — no silent fallback to the direct
   * address. The browser fails closed by itself. This refuses first so that a person gets a
   * sentence they can act on instead of a window where every page is
   * ERR_PROXY_CONNECTION_FAILED.
   */
  let exit = null;
  if (relayApi) {
    try {
      exit = await relayApi.ensure(a.handle);
    } catch (e) {
      /* The exit could not even be ASKED about — no database, or 0016 not applied. Unknown is
         not "no proxy": launching would be a guess about which address this account uses, and
         src/ports.ts sets the precedent that unproven is not owned. */
      return { ok: false, error: `redbot could not work out which address ${a.handle} should use, so it did not open a browser: ${String(e && e.message || e)}` };
    }
    if (exit && exit.proxied && !exit.ok) return { ok: false, error: exit.error };
  }
  const proxied = !!(exit && exit.proxied && exit.ok);

  /**
   * THE TIMEZONE MUST AGREE WITH THE ADDRESS — checked here, before a window exists.
   *
   * Deliberately not after the browser is up. Finding out then would leave two bad options: close
   * a window in the operator's face, or let a browser announcing Manila reach Reddit from a US
   * address. The second cannot be undone for that account, and the mismatch is one of the most
   * reliable proxy tells in use — the IP comes from routing and the timezone from the machine, so
   * changing only the IP manufactures a contradiction a single line of JavaScript reads.
   *
   * Only for proxied accounts. An unproxied one genuinely IS where its clock says it is, and
   * overriding anything there would create the very mismatch this refuses.
   */
  if (proxied && alignApi) {
    const no = alignApi.refusal(a.handle, a.timezone, exit.proxy.country, exit.proxy.region);
    if (no) return { ok: false, error: no };
  }

  /**
   * OFF-SCREEN, NOT HEADLESS — and the difference is the whole product.
   *
   * Boot opens a browser for every bound account, which meant two Chrome windows taking the
   * screen every launch. The obvious fix is headless and it is the one thing that cannot be done:
   * Reddit answers a headless browser with a BLOCK PAGE SERVED AS HTTP 200, so reads come back
   * empty and actions fail silently while looking fine. src/browser.ts refuses a headless UA for
   * that reason and doctor calls it a FAIL; TIER0-BLOCKER records both send attempts hitting it.
   *
   * So the browser stays fully headed — real renderer, real user-agent, real Reddit — and is
   * simply put where nobody has to look at it. `--window-position` is honoured at launch; the two
   * backgrounding flags are what stop Chrome throttling a window it believes is not visible,
   * which would otherwise make an off-screen page load slowly or not at all.
   *
   * Only the boot path asks for this. Pressing Open Chrome on the Accounts screen means a person
   * wants to see it — that is the signing-in path — so it opens where it always did.
   */
  /* Not off-screen any more — see minimizeBrowserWindow in src/browser.ts. A window parked at
     -32000 still gets a taskbar entry, and clicking it restores the window to a position on no
     monitor, which reads as broken. The two backgrounding flags stay: Chrome throttles a window it
     believes is not visible, and a minimised one qualifies. */
  const BACKGROUND = ['--disable-backgrounding-occluded-windows',
                      '--disable-renderer-backgrounding'];
  const LOGIN = 'https://www.reddit.com/login';
  try {
    /**
     * A PROXIED browser starts on `about:blank`, and that is the load-bearing difference.
     *
     * Chrome opening the login page itself produces a tab redbot never touched — and MEASURED, a
     * tab redbot did not create reports the machine's own timezone and has a live
     * `RTCPeerConnection`. That tab is where manual sign-in happens, which is the one moment the
     * account's identity is fixed and the one moment neither may be wrong. So the browser is
     * spawned empty, covered over CDP, and only then sent to Reddit.
     *
     * An unproxied browser keeps the login URL on the command line exactly as it always had.
     */
    const child = spawn(bin, [
      `--remote-debugging-port=${a.debugPort}`,
      `--user-data-dir=${dir}`,
      '--no-first-run', '--no-default-browser-check',
      ...(proxied ? [`--proxy-server=http://127.0.0.1:${exit.relayPort}`] : []),
      ...(background ? BACKGROUND : []),
      proxied ? 'about:blank' : LOGIN
    ], { detached: true, stdio: 'ignore' });
    child.unref();

    const said = { ok: true, handle, port: a.debugPort, profileDir: a.profileDir,
                   ...(background ? { background: true } : {}),
                   ...(movedFrom ? { movedFrom } : {}) };

    if (!proxied) {
      /**
       * ASKING FOR A PORT IS NOT GETTING ONE.
       *
       * This path used to return the instant `spawn` was called, reporting `port: a.debugPort`
       * because that is the number it passed on the command line. But this file already documents
       * the thing that makes that a lie: "Chrome given an occupied --remote-debugging-port does
       * NOT fail: it starts, silently gives up the port to whoever holds it, and the window looks
       * perfectly normal." So a launch could log `opened on 9223`, the record could say 9224, and
       * nothing was listening on either — which is what a machine reported on 2026-08-13, where
       * `statusForAccounts` then probed the recorded port, found it free, and answered "this
       * account's browser is not running" seventeen times while the browser was up.
       *
       * The proxied path below already waited for the port to answer before doing anything with
       * it. It waits here too now: same helper, same bound, so the report is of a port that
       * actually answered rather than one that was requested.
       */
      const answered = await waitForDebugPort(`http://127.0.0.1:${a.debugPort}`);
      if (!answered) {
        return {
          ok: false,
          error: `${a.handle}'s browser was opened but nothing answered on port ${a.debugPort} ` +
                 `within 30s. Chrome yields a debugging port it cannot take, so another program ` +
                 `probably holds it. The window is open; redbot cannot drive it.`,
          handle, port: a.debugPort, profileDir: a.profileDir, unverified: true
        };
      }
      return { ...said, verified: true };
    }

    /**
     * Cover it, then navigate. A failure here CLOSES the browser rather than leaving it.
     *
     * An uncovered window sitting on about:blank behind a US address is the worst of both states:
     * it looks like the feature worked, and the first thing a person does with it is sign in. We
     * spawned it, so we own closing it.
     */
    const endpoint = `http://127.0.0.1:${a.debugPort}`;
    const covered = await coverProxiedBrowser(endpoint, a, exit);
    if (!covered.ok) {
      await stopBrowserImpl(a).catch(() => {});
      return { ok: false, error: covered.error };
    }
    /* Said back so the caller can show WHICH address this window appears from and WHAT clock it
       is telling, rather than the operator having to trust that a flag went on. */
    return { ...said, relayPort: exit.relayPort, exitIp: exit.exitIp,
             timezone: a.timezone, pagesAligned: covered.pagesAligned };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

/**
 * Wait for the browser we just spawned to answer, then align it and send it to Reddit.
 *
 * The wait is not optional: Chrome takes a second or two to open its debugging port, and
 * attaching before it does fails in a way that reads as "the browser is broken" rather than "it
 * had not started yet". Bounded, because a Chrome that never answers must produce a sentence and
 * not a hang.
 */
/**
 * Wait until a debugging port actually ANSWERS, or say it never did.
 *
 * One place, because both launch paths need the same question answered and only one of them used
 * to ask it. Chrome takes a second or two to open the port, and it silently declines to take one
 * that is already held — so "did spawn return" and "is the browser drivable on this port" are
 * different facts, and only the second is worth reporting to an operator.
 *
 * Bounded on purpose: a Chrome that never answers must produce a sentence, not a hang.
 */
async function waitForDebugPort(endpoint, ms = 30_000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(1200) })).ok) return true;
    } catch { /* not up yet — the loop is the retry */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

async function coverProxiedBrowser(endpoint, account, exit) {
  const up = await waitForDebugPort(endpoint);
  if (!up) {
    return { ok: false, error:
      `${account.handle}'s browser did not open its debugging port on ${endpoint} within 30 `
      + 'seconds, so redbot could not align it and did not send it to Reddit.' };
  }
  if (!alignApi) {
    return { ok: false, error: 'the compiled build is missing its alignment module — run npm run build' };
  }
  try {
    const a = await alignApi.cover({
      endpoint,
      handle: account.handle,
      timezone: account.timezone,
      /**
       * English for the exit's country — for FORMATTING, which is all this actually buys.
       *
       * The previous note here said `--lang` is ignored "so this is the only route to it", meaning
       * navigator.language. That was wrong, and measuring it settled the question: on Chrome
       * 150.0.7871.187, `Emulation.setLocaleOverride` moves `Intl` and NOT the language a page
       * reads. Overriding to de-DE, fr-FR and en-GB each left `navigator.language` at en-US while
       * `Intl.NumberFormat().resolvedOptions().locale` followed the override every time.
       *
       * So one call was never enough. `align.ts` now sends BOTH: `setLocaleOverride` for what it
       * genuinely buys — dates, numbers and collation agreeing with the exit's region rather than
       * the operator's — and `setUserAgentOverride({ acceptLanguage })` for navigator.language,
       * navigator.languages and the Accept-Language header, which is the property D-5 is about.
       *
       * One value feeds both, so the two cannot drift apart into a browser formatting dates for
       * one country while announcing the language of another.
       */
      locale: exit.proxy.country ? `en-${exit.proxy.country}` : null,
      openUrl: 'https://www.reddit.com/login'
    });
    return { ok: true, pagesAligned: a.pagesAligned };
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }
}

/* ------------------------------------------------------------------ *
 * Adding an exit, from the console.
 *
 * WHY THIS SPAWNS THE CLI RATHER THAN CALLING THE GATE DIRECTLY.
 *
 * `redbot proxy vet <handle>` already IS the gate: it measures the address, and on an all-PASS it
 * writes the pin, the country, the network and the sealed credential. Reimplementing that here
 * would be a second gate, and the day the two disagreed the console would be the one storing an
 * address nothing had proven. So the console runs the same command a person would.
 *
 * WHY IT IS A BACKGROUND JOB AND NOT A REQUEST.
 *
 * The default check is EIGHT SAMPLES OVER SIX HOURS, because the one property a dedicated address
 * has and a rotating pool does not is that it stays put — and a single look cannot tell them
 * apart. No HTTP request survives that, so the job runs detached from the request that started it
 * and the console polls it, exactly as the unattended loop works.
 *
 * WHY THE PASSWORD GOES IN THE CHILD'S ENVIRONMENT.
 *
 * Not on its command line: a command line is readable by every other process on this machine
 * through the process table — which is how `src/ports.ts` identifies browsers, so it is not a
 * hypothetical. The CLI takes the credential from the environment for exactly this reason, and
 * this hands it over the same way. It is never written to disk, never echoed in a response, and
 * never reaches the run log.
 * ------------------------------------------------------------------ */
let exitVet = null;

/** Bounded, so a six-hour job cannot grow without limit. Same rule as the unattended loop. */
function exitVetKeep(line) {
  if (!exitVet) return;
  exitVet.lines.push(String(line).replace(/\[[0-9;]*m/g, ''));
  if (exitVet.lines.length > 400) exitVet.lines = exitVet.lines.slice(-400);
}

function exitVetStatus() {
  if (!exitVet) return { running: false, handle: null, startedAt: null, lines: [], finished: null };
  return {
    running: exitVet.finished === null,
    handle: exitVet.handle,
    startedAt: exitVet.startedAt,
    /* The CLI prints host:port and per-sample addresses — never the credential. */
    lines: exitVet.lines,
    finished: exitVet.finished
  };
}

async function exitVetStart(body) {
  if (!exitApi) return { ok: false, error: 'the compiled build is missing — run npm run build' };
  if (exitVet && exitVet.finished === null) {
    return { ok: false, error: `A check is already running for ${exitVet.handle}. Stop it first.` };
  }

  const handle = String(body.handle || '').trim();
  const { accounts: known } = await consoleAccounts();
  const account = known.find((x) => x.handle.toLowerCase() === handle.toLowerCase());
  if (!account) return { ok: false, error: `${handle || 'That account'} is not set up.` };

  const host = String(body.host || '').trim();
  const port = Number(body.port);
  const username = String(body.username || '');
  const password = String(body.password || '');

  /* The relay's own rule, so a form cannot accept what the relay will later refuse. */
  try {
    exitApi.assertUsable({ host, port, username, password });
  } catch (e) {
    return { ok: false, error: String(e && e.message || e) };
  }

  const country = String(body.country || 'US').trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(country)) {
    return { ok: false, error: 'A country is its two-letter code, like US.' };
  }
  const region = String(body.region || '').trim();

  const quick = body.quick === true;
  const samples = Math.max(1, Math.min(200, Number(body.samples) || 8));
  const hours = Math.max(0, Math.min(72, Number(body.hours) === undefined ? 6 : Number(body.hours)));

  const args = ['proxy', 'vet', account.handle, '--country', country];
  if (region) args.push('--region', region);
  if (quick) args.push('--quick');
  else args.push('--samples', String(samples), '--hours', String(hours));

  const child = spawn(process.execPath, [join(ROOT, 'dist', 'cli.js'), ...args], {
    cwd: SPAWN_CWD,
    env: {
      ...process.env,
      REDBOT_PROXY_HOST: host,
      REDBOT_PROXY_PORT: String(port),
      REDBOT_PROXY_USER: username,
      REDBOT_PROXY_PASS: password
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  exitVet = {
    child, handle: account.handle, startedAt: new Date().toISOString(),
    lines: [], finished: null,
    /* Echoed back so the screen can say WHICH address is being checked. Never the credential. */
    upstream: `${host}:${port}`
  };
  child.stdout.on('data', (d) => exitVetKeep(d));
  child.stderr.on('data', (d) => exitVetKeep(d));
  child.on('close', (code) => {
    exitVetKeep(`\n[check finished, exit ${code}]\n`);
    if (exitVet) exitVet.finished = { code, ok: code === 0, at: new Date().toISOString() };
  });
  child.on('error', (e) => {
    exitVetKeep(`\n[check could not start: ${e && e.message ? e.message : e}]\n`);
    if (exitVet) exitVet.finished = { code: -1, ok: false, at: new Date().toISOString() };
  });

  return { ok: true, handle: account.handle, upstream: exitVet.upstream, ...exitVetStatus() };
}

function exitVetStop() {
  if (!exitVet || exitVet.finished !== null) return { ok: false, error: 'No check is running.' };
  try { exitVet.child.kill(); } catch { /* already gone */ }
  exitVet.finished = { code: -1, ok: false, at: new Date().toISOString(), stopped: true };
  return { ok: true, ...exitVetStatus() };
}

/**
 * Remove an account's exit.
 *
 * Three things in one, and the ORDER matters: the relay comes down first, because leaving a
 * listener up after the row that justified it is gone would carry traffic on an exit the console
 * no longer shows. The observation ledger is deliberately kept — see `deleteAccountProxy`.
 */
async function exitRemove(body) {
  if (!exitApi) return { ok: false, error: 'the compiled build is missing — run npm run build' };
  const handle = String(body.handle || '').trim();
  const { accounts: known } = await consoleAccounts();
  const account = known.find((x) => x.handle.toLowerCase() === handle.toLowerCase());
  if (!account) return { ok: false, error: `${handle || 'That account'} is not set up.` };

  if (alignApi) await alignApi.stop(account.handle).catch(() => {});
  if (relayApi) await relayApi.stop(account.handle).catch(() => {});

  let removed = false;
  try { removed = await exitApi.forget(account.handle); }
  catch (e) { return { ok: false, error: `The exit could not be removed: ${String(e && e.message || e)}` }; }

  let credential = false;
  try { credential = await exitApi.forgetCredential(account.handle); }
  catch { /* the row is gone either way; a stuck credential is not a reason to report failure */ }

  return {
    ok: true, handle: account.handle, removed, credential,
    note: 'The record of what this account\'s exit actually was is kept — removing a setting does not rewrite history.'
  };
}

/* ------------------------------------------------------------------ *
 * The unattended loop.
 *
 * Held separately from `running` (the one-at-a-time action lock) because this is long-lived
 * by design and must not block a person from pressing a button. It is a child process, not a
 * timer in here — so if this console is closed or crashes, the loop is unaffected, and
 * killing the loop cannot take the console down with it.
 * ------------------------------------------------------------------ */
let autoProc = null;
let autoLog = [];

/**
 * Run a CLI verb and hand back what it said.
 *
 * Deliberately NOT `runAction`: that one takes the one-at-a-time lock, streams to the run log and
 * is keyed to the PUBLIC_ACTIONS allow-list, none of which fits a call the console makes on its
 * own behalf. This is the plain "shell out and read the output" case, used by reset so the
 * console and a terminal run identical code — including the snapshot the CLI takes first.
 */
function spawnCli(args, timeoutMs = 5 * 60 * 1000) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(ROOT, 'dist', 'cli.js'), ...args], {
      cwd: SPAWN_CWD, env: process.env, stdio: ['ignore', 'pipe', 'pipe']
    });
    let out = '', err = '';
    child.stdout.on('data', (d) => { out += String(d); });
    child.stderr.on('data', (d) => { err += String(d); });
    const timer = setTimeout(() => { try { child.kill(); } catch {} }, timeoutMs);
    child.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, error: String(e && e.message || e), output: out }); });
    child.on('close', (code) => {
      clearTimeout(timer);
      /* The CLI says why it refused on its own last line; repeating "it failed" over the top of
         that would replace the reason with a category. */
      resolve(code === 0
        ? { ok: true, output: out }
        : { ok: false, output: out, error: (err.trim() || out.trim().split('\n').pop() || `exit ${code}`) });
    });
  });
}

function autoStart({ account, everyMinutes }) {
  if (autoProc) return { ok: false, error: 'The unattended loop is already running.' };
  if (!account) return { ok: false, error: 'Choose which account it should run as.' };
  /* The mirror of the check in runAction: whichever starts second is the one that must refuse,
     or the guard only holds in one direction and the collision comes back by starting the
     loop last. Same scoping — only when it is the same account's Chrome. */
  if (running && ACTIONS[running] && ACTIONS[running].needsBrowser && runningAccount === String(account)) {
    return {
      ok: false,
      error: `"${ACTIONS[running].label}" is running as ${account} right now. Wait for it to finish — the loop would drive the same Chrome.`
    };
  }
  const every = Math.max(15, Number(everyMinutes) || 60);
  autoLog = [];
  const child = spawn(process.execPath, [join(ROOT, 'dist', 'cli.js'), 'auto', '--every', String(every)], {
    /* Same identity rules as a button-driven run: the loop bills the chosen operator and takes
       the chosen LLM path, or the Setup screen would silently not apply to the one thing that
       runs unattended for days. */
    cwd: SPAWN_CWD,
    env: {
      ...process.env,
      REDBOT_ACCOUNT: String(account),
      REDBOT_LLM: selectedProvider,
      ...(selectedOperator ? { REDBOT_OPERATOR: selectedOperator } : {})
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const keep = (d) => {
    autoLog.push(String(d).replace(/\[[0-9;]*m/g, ''));
    if (autoLog.length > 400) autoLog = autoLog.slice(-400);   // bounded: this runs for days
  };
  child.stdout.on('data', keep);
  child.stderr.on('data', keep);
  child.on('close', (code) => { keep(`\n[loop stopped, exit ${code}]\n`); autoProc = null; });
  child.on('error', (e) => { keep(`\n[loop failed to start: ${e.message}]\n`); autoProc = null; });
  autoProc = { child, account: String(account), every, startedAt: new Date().toISOString() };
  return { ok: true, ...autoStatus() };
}

function autoStop() {
  if (!autoProc) return { ok: false, error: 'The loop is not running.' };
  try { autoProc.child.kill(); } catch { /* already gone */ }
  autoProc = null;
  return { ok: true, ...autoStatus() };
}

function autoStatus() {
  return {
    running: !!autoProc,
    account: autoProc ? autoProc.account : null,
    everyMinutes: autoProc ? autoProc.every : null,
    startedAt: autoProc ? autoProc.startedAt : null,
    log: autoLog.join('').split('\n').filter(Boolean).slice(-40)
  };
}

/* ---- per-reply workflow state: ignore / read / actioned ---- */
const statusPath = join(DATA, 'ui-status.json');
const readStatuses = () => readJson(statusPath, {});
function setStatus(draftId, status, note) {
  const allowed = ['none', 'ignored', 'read', 'actioned'];
  if (!allowed.includes(status)) return { ok: false, error: `status must be one of ${allowed.join(', ')}` };
  const all = readStatuses();
  if (status === 'none') delete all[draftId];
  else all[draftId] = { status, note: note || '', at: new Date().toISOString() };
  writeFileSync(statusPath, JSON.stringify(all, null, 2), 'utf8');
  return { ok: true, statuses: all };
}

/* ---- publishing: the one action that reaches the outside world ---- */
/**
 * Creating a post, from the console.
 *
 * Mirrors publish() deliberately rather than sharing with it: the two guard DIFFERENT things. A
 * reply is bound to a draft that already passed the gates and Argus; a post is text a person just
 * typed, aimed at a subreddit, with no draft record behind it. Folding them together would mean
 * one set of checks pretending to cover both.
 *
 * WHAT IS ENFORCED HERE, and everything else is enforced by the CLI it spawns:
 *   - the exact word SEND, or it is a refusal. Never "starts with", never case-insensitive;
 *   - a subreddit that looks like a subreddit and a non-empty title, before anything is written;
 *   - the same pre-flight `whyReplyCannotStart` asks, so an approval token is not written for a
 *     run that cannot begin — the defect publish() already carries a comment about;
 *   - the decision is recorded separately from the capability, because a person approving is
 *     history even when the send then fails.
 */
async function publishPost(body) {
  const subreddit = String(body.subreddit || '').replace(/^\/?r\//i, '').trim();
  const title = String(body.title || '').trim();
  const text = String(body.body || '');

  if (!/^[A-Za-z0-9_]{2,21}$/.test(subreddit)) {
    return { ok: false, error: `"${body.subreddit ?? ''}" is not a subreddit name` };
  }
  if (!title) return { ok: false, error: 'a post needs a title' };

  /* fail closed: anything other than the exact word is a refusal, never an approval */
  if (body.confirm !== 'SEND') return { ok: false, error: 'not confirmed — type SEND exactly' };

  const blocked = whyReplyCannotStart(body.account);
  if (blocked) return { ok: false, error: blocked };

  const id = `post_${Date.now().toString(36)}`;
  appendFileSync(join(DATA, 'decisions.jsonl'),
    JSON.stringify({ ts: new Date().toISOString(), decision: 'approved', kind: 'post',
                     subreddit, title, reason: body.reason || '', via: 'console' }) + String.fromCharCode(10), 'utf8');

  const dir = join(DATA, 'approvals');
  mkdirSync(dir, { recursive: true });
  const tokenPath = join(dir, `${id}.json`);
  writeFileSync(tokenPath, JSON.stringify(
    { draftId: id, decision: 'approved', note: body.reason || '', at: new Date().toISOString() }, null, 2), 'utf8');

  return runAction('__post', { subreddit, title, body: text, account: body.account, approvalId: id })
    .then((r) => {
      /* The run never started, so the authorisation must not outlive the attempt. */
      if (!r.ok) { try { if (existsSync(tokenPath)) rmSync(tokenPath, { force: true }); } catch { /* best effort */ } }
      return r;
    });
}

async function publish(body) {
  const { confirm, reason } = body || {};
  const draftId = String((body && body.draftId) || '');
  if (!draftId) return { ok: false, error: 'no draft named' };
  /**
   * H4: draftId is interpolated into a file path below, so an unvalidated value like
   * "../accounts" would write data/accounts.json (breaking every browser command) and
   * "../../package" would hit package.json. Allow only a safe id shape — no slashes, no dots,
   * so no path traversal — and require it to name a draft that actually exists.
   */
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(draftId)) {
    return Promise.resolve({ ok: false, error: 'that is not a valid draft id' });
  }
  /**
   * The draft must exist. Checked against Postgres — this read used to be data/drafts.json,
   * which `src/store.ts` stopped writing when drafts moved to the database, so the existence
   * check was failing for every draft and refusing every publish with "no draft on record".
   */
  const { drafts } = await domain();
  if (!drafts.some((d) => d.id === draftId)) {
    return { ok: false, error: `no draft "${draftId}" on record` };
  }
  /* fail closed: anything other than the exact word is a refusal, never an approval */
  if (confirm !== 'SEND') return Promise.resolve({ ok: false, error: 'not confirmed — type SEND exactly' });

  /**
   * Can the send actually START? Asked BEFORE anything is written.
   *
   * The approval token below is a capability: `takeConsoleApproval` (src/ask.ts) will let a
   * `redbot reply` for this draft go through on it, once, for five minutes, with nobody typing
   * SEND again. This function used to write it and THEN call runAction — so every refusal
   * runAction can give (the slot is busy, the account is ambiguous, the loop holds that
   * Chrome) left a live send-authorisation on disk for a reply that was never sent.
   *
   * Checked first, and cleaned up after, because those are two different failures: this closes
   * the ones knowable in advance, and the cleanup below closes the race in between.
   */
  const blocked = whyReplyCannotStart(body.account);
  if (blocked) return Promise.resolve({ ok: false, error: blocked });

  /* The decision is recorded first, and separately. If the send then fails, the fact that a
     person approved it must still be on the record — that is history, not a capability. */
  appendFileSync(join(DATA, 'decisions.jsonl'),
    JSON.stringify({ ts: new Date().toISOString(), draftId, decision: 'approved', reason: reason || '', via: 'console' }) + '\n', 'utf8');

  /* One draft, five minutes, consumed on read — see takeConsoleApproval in src/ask.ts */
  const dir = join(DATA, 'approvals');
  mkdirSync(dir, { recursive: true });
  const tokenPath = join(dir, `${draftId}.json`);
  /**
   * `overrule` names the gates this operator has been shown and is publishing over.
   *
   * Since gates became advisory (src/gates.ts HARD_GATES), most of them are live-page facts that
   * only exist once `reply` has probed the thread — so the first SEND cannot have displayed them,
   * and `reply` refuses rather than publish over findings nobody saw. It writes them to the run
   * log; a second SEND repeats them here to say they have been read.
   *
   * Sanitised to an array of plain strings on the way in. This is a capability file: whatever
   * arrives in the request body decides what a later process will publish over, so it is not
   * passed through on trust. Absent or malformed means "nothing acknowledged", which refuses —
   * the failure direction that costs a second click rather than an unwanted comment.
   */
  const overrule = Array.isArray(body.overrule)
    ? body.overrule.filter((g) => typeof g === 'string' && g.length > 0 && g.length < 64).slice(0, 40)
    : [];
  writeFileSync(tokenPath,
    JSON.stringify({
      draftId, decision: 'approved', note: reason || '',
      at: new Date().toISOString(),
      ...(overrule.length ? { overrule } : {})
    }, null, 2), 'utf8');

  return runAction('__reply', { draftId, account: body.account })
    .then((r) => {
      /**
       * The run never started, so the authorisation must not outlive the attempt.
       *
       * `ok:false` here means the child was refused before it could consume the token — the
       * pre-flight above closes the predictable cases, but the slot can be taken in between.
       * Leaving it would arm an unattended send for five minutes on the strength of a SEND
       * that visibly failed. The DECISION record stays: a person did approve, and that is
       * true whatever happened next.
       */
      if (!r.ok) {
        try { if (existsSync(tokenPath)) rmSync(tokenPath, { force: true }); }
        catch { /* a token we cannot remove is reported, not hidden */ }
      }
      /**
       * Gates the child found only after the approval, passed back so the console can offer to
       * publish over them.
       *
       * `reply` refuses a console approval that has not acknowledged them and tells the person to
       * send again — which the console could not do, because it did not know what to acknowledge.
       * It re-sent the same body, hit the same refusal, and the send button appeared dead.
       *
       * Read from the child's own output rather than recomputed here: these are live-page facts
       * that only exist once the thread has been probed, and this process has not probed it. A
       * second opinion formed from a different set of facts is exactly the acknowledgement that
       * would be worthless.
       */
      const m = /^::gates (.+)$/m.exec(String(r.output || ''));
      const advisories = m
        ? m[1].split(',').map((g) => g.trim()).filter((g) => /^[A-Za-z0-9_-]{1,64}$/.test(g))
        : [];
      return { ...r, recorded: true, ...(advisories.length ? { advisories } : {}) };
    });
}

/* ------------------------------------------------------------------ *
 * Request guard — this console binds loopback, but "on localhost" is not the same as "safe".
 *
 * Any web page the operator has open can send requests to http://localhost:7902, and a
 * DNS-rebinding attack can make an attacker domain resolve to 127.0.0.1. Since the endpoints
 * here drive a signed-in Chrome, spend model credits, rewrite config and publish, that mattered
 * (evaluation H3). Two checks close it, both standard for a localhost service:
 *
 *   - Host must be loopback. A rebinding attack arrives with the attacker's domain in Host.
 *   - A mutating POST must be application/json AND (if it carries an Origin) a loopback Origin.
 *     A cross-site page can send a "simple" form/text POST with no preflight, but it cannot set
 *     content-type: application/json without a preflight the browser will then block, nor forge
 *     a loopback Origin. The console's own fetches already send application/json + same origin.
 * ------------------------------------------------------------------ */
function hostIsLocal(h) {
  if (!h) return false;
  const host = String(h).split(':')[0].toLowerCase().replace(/^\[|\]$/g, '');
  return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}
function originIsLocal(o) {
  if (!o) return true;                 // no Origin header (curl, same-origin GET) is allowed
  try {
    const host = new URL(o).hostname.toLowerCase().replace(/^\[|\]$/g, '');
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
  } catch { return false; }
}

/* ------------------------------------------------------------------ */
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const send = (code, body, type = 'application/json; charset=utf-8') => {
    res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
    res.end(body);
  };

  // Refuse anything whose Host is not loopback (anti DNS-rebinding), for every method.
  if (!hostIsLocal(req.headers.host)) {
    return send(403, JSON.stringify({ error: 'refused: this console only answers requests addressed to localhost' }));
  }

  if (req.method === 'POST') {
    // A mutating request must look like it came from the console, not a cross-site page.
    if (!String(req.headers['content-type'] || '').includes('application/json')) {
      return send(415, JSON.stringify({ error: 'refused: POST requires content-type application/json' }));
    }
    if (!originIsLocal(req.headers.origin)) {
      return send(403, JSON.stringify({ error: 'refused: cross-origin request' }));
    }

    let raw = '';
    req.on('data', (c) => { raw += c; if (raw.length > 1e6) req.destroy(); });
    req.on('end', async () => {
      let body = {};
      try { body = raw ? JSON.parse(raw) : {}; } catch { return send(400, JSON.stringify({ error: 'bad JSON' })); }

      if (url.pathname === '/api/run') {
        if (!PUBLIC_ACTIONS.includes(body.key)) {
          return send(400, JSON.stringify({ ok: false, error: `"${body.key}" cannot be run from here` }));
        }
        const r = await runAction(body.key, body);
        return send(r.ok ? 200 : 409, JSON.stringify(r));
      }

      /* ---------------- setup ---------------- */
      if (url.pathname === '/api/operator/create') {
        const r = createOperator(body.name);
        return send(r.ok ? 200 : 400, JSON.stringify(r));
      }

      if (url.pathname === '/api/llm/provider') {
        const want = String(body.provider || '');
        if (want !== 'cli' && want !== 'api') {
          return send(400, JSON.stringify({ ok: false, error: 'provider must be "cli" or "api"' }));
        }
        selectedProvider = want;
        return send(200, JSON.stringify({ ok: true, provider: selectedProvider }));
      }

      /**
       * Store the Anthropic API key.
       *
       * THE VALUE ARRIVES IN THE BODY AND IS NEVER SENT BACK. This is the web equivalent of
       * `redbot vault set` reading from stdin: src/commands/vault.ts refuses an argv value
       * because the shell history and the process list both keep it, and a query string is the
       * same mistake — it lands in access logs and browser history. A POST body does not.
       *
       * Nothing below echoes `value`, puts it in an error, or writes it to the run log. The
       * response carries the 4-character hint only, which is what `vault list` shows.
       */
      if (url.pathname === '/api/vault/key') {
        if (!vaultApi) return send(503, JSON.stringify({ ok: false, error: 'the compiled build is missing — run npm run build' }));
        const reason = vaultApi.vaultUnavailableReason();
        if (reason) return send(400, JSON.stringify({ ok: false, error: reason }));

        const value = typeof body.value === 'string' ? body.value.trim() : '';
        if (!value) return send(400, JSON.stringify({ ok: false, error: 'no key given' }));
        // A sanity ceiling, not a format rule: redbot does not get to decide what a key looks like.
        if (value.length > 4096) return send(400, JSON.stringify({ ok: false, error: 'that is too long to be an API key' }));

        try {
          const scope = body.scope ? String(body.scope) : undefined;
          await vaultApi.putSecret(vaultApi.ANTHROPIC_API_KEY, value, scope);
          return send(200, JSON.stringify({ ok: true, hint: value.slice(-4), scope: scope || 'global' }));
        } catch (e) {
          // The message names the problem, never the value — same rule as src/vault.ts.
          return send(400, JSON.stringify({ ok: false, error: e && e.message ? e.message : String(e) }));
        }
      }

      /**
       * Store the Webshare API key — the SAME never-echoed, POST-body-only rule as /api/vault/key,
       * for the same reason: a key in a query string lands in access logs and browser history.
       *
       * OPTIONAL. Nothing in redbot's run path reads this key (src/credentials.ts WEBSHARE_API_KEY);
       * it only lets /api/webshare/proxies list this account's US exits so the exit form can be
       * auto-filled. Global scope, like the sync tokens: it is a per-install convenience, not
       * per-operator identity. The response carries the 4-character hint and nothing else.
       */
      if (url.pathname === '/api/webshare/key') {
        if (!vaultApi) return send(503, JSON.stringify({ ok: false, error: 'the compiled build is missing — run npm run build' }));
        const reason = vaultApi.vaultUnavailableReason();
        if (reason) return send(400, JSON.stringify({ ok: false, error: reason }));

        const value = typeof body.value === 'string' ? body.value.trim() : '';
        if (!value) return send(400, JSON.stringify({ ok: false, error: 'no key given' }));
        if (value.length > 4096) return send(400, JSON.stringify({ ok: false, error: 'that is too long to be an API key' }));

        try {
          await vaultApi.putSecret(vaultApi.WEBSHARE_API_KEY, value);
          return send(200, JSON.stringify({ ok: true, hint: value.slice(-4) }));
        } catch (e) {
          return send(400, JSON.stringify({ ok: false, error: e && e.message ? e.message : String(e) }));
        }
      }

      if (url.pathname === '/api/webshare/key/remove') {
        if (!vaultApi) return send(503, JSON.stringify({ ok: false, error: 'the compiled build is missing' }));
        const reason = vaultApi.vaultUnavailableReason();
        if (reason) return send(400, JSON.stringify({ ok: false, error: reason }));
        try {
          const removed = await vaultApi.removeSecret(vaultApi.WEBSHARE_API_KEY);
          return send(200, JSON.stringify({ ok: true, removed }));
        } catch (e) {
          return send(400, JSON.stringify({ ok: false, error: e && e.message ? e.message : String(e) }));
        }
      }

      /**
       * Dashboard sync configuration.
       *
       * THE TOKENS GO TO THE VAULT, sealed, exactly like the Anthropic key — same POST-body rule,
       * same never-echoed response. The endpoint URL is not a secret and is persisted beside the
       * push watermarks, because a desktop app has no shell to export `REDBOT_SYNC_URL` in.
       *
       * WHAT IS DELIBERATELY NOT HERE: `REDBOT_ADMIN_TOKEN` and `REDBOT_SHARE_TOKEN_SECRET`.
       * Those are the SERVICE's secrets — the first mints and revokes tokens for every install,
       * the second signs them. Accepting either here would put a service-wide credential on every
       * operator's desktop, which is the failure src/config.ts opens by naming. redbot holds only
       * the two tokens issued TO it.
       */
      if (url.pathname === '/api/sync/url') {
        if (!pushApi) return send(503, JSON.stringify({ ok: false, error: 'the compiled build is missing' }));
        const raw = typeof body.url === 'string' ? body.url.trim() : '';
        if (raw && !/^https?:\/\//i.test(raw)) {
          return send(400, JSON.stringify({ ok: false, error: 'that is not an http(s) URL' }));
        }
        try {
          const { readPushState, writePushState } = pushStateApi;
          const state = readPushState();
          if (raw) writePushState({ ...state, syncUrl: raw });
          else { const { syncUrl, ...rest } = state; void syncUrl; writePushState(rest); }
          return send(200, JSON.stringify({ ok: true, url: raw || null }));
        } catch (e) {
          return send(400, JSON.stringify({ ok: false, error: e && e.message ? e.message : String(e) }));
        }
      }

      /**
       * Store a sync token. THE VALUE ARRIVES IN THE BODY AND IS NEVER SENT BACK — the same rule
       * as /api/vault/key, for the same reason: a query string lands in access logs and history.
       */
      if (url.pathname === '/api/sync/token') {
        if (!vaultApi || !pushApi) return send(503, JSON.stringify({ ok: false, error: 'the compiled build is missing' }));
        const reason = vaultApi.vaultUnavailableReason();
        if (reason) return send(400, JSON.stringify({ ok: false, error: reason }));

        const kind = body.kind === 'share' ? 'share' : body.kind === 'push' ? 'push' : null;
        if (!kind) return send(400, JSON.stringify({ ok: false, error: 'kind must be "push" or "share"' }));
        const name = kind === 'push' ? pushApi.SYNC_PUSH_TOKEN : pushApi.SYNC_SHARE_TOKEN;

        const value = typeof body.value === 'string' ? body.value.trim() : '';
        if (!value) return send(400, JSON.stringify({ ok: false, error: 'no token given' }));
        if (value.length > 4096) return send(400, JSON.stringify({ ok: false, error: 'that is too long to be a token' }));
        /* A pasted `NAME=value` line is the mistake this whole feature invites, and it cost a
           401 while wiring it up. Refuse it with the fix named rather than storing it. */
        if (/^[A-Z][A-Z0-9_]*=/.test(value)) {
          return send(400, JSON.stringify({
            ok: false,
            error: 'that looks like a NAME=value line. Paste only the part after the "=".'
          }));
        }
        try {
          await vaultApi.putSecret(name, value);
          return send(200, JSON.stringify({ ok: true, name, hint: value.slice(-4) }));
        } catch (e) {
          return send(400, JSON.stringify({ ok: false, error: e && e.message ? e.message : String(e) }));
        }
      }

      /**
       * Push now — the retry button.
       *
       * Goes through the SCHEDULER rather than calling `pushOnce` directly, so a manual retry
       * obeys the same one-at-a-time guard as the timer. Two pushes racing would re-send the same
       * events and let whichever finished last decide the cursor; a button a person can hammer is
       * exactly how that would happen.
       */
      if (url.pathname === '/api/sync/push') {
        if (!pushScheduler) return send(503, JSON.stringify({ ok: false, error: 'the scheduler is not running' }));
        if (pushScheduler.busy) {
          return send(200, JSON.stringify({ ok: true, skipped: 'a push is already in flight' }));
        }
        syncHealthCache = { at: 0, value: null };   // the next health read must be fresh
        const report = await pushScheduler.trigger('manual');
        if (!report) {
          return send(200, JSON.stringify({ ok: false, error: 'not configured — set an endpoint and a token' }));
        }
        const blocked = report.streams.filter((s) => s.stopped);
        return send(200, JSON.stringify({
          ok: !report.fatal && !blocked.length,
          sent: report.sent,
          ...(report.fatal ? { error: report.fatal } : {}),
          ...(blocked.length ? { blocked: blocked.map((s) => ({ stream: s.stream, why: s.stopped })) } : {})
        }));
      }

      /**
       * Pull the shared account list.
       *
       * TWO STEPS ON PURPOSE. `plan` fetches and compares, writing nothing; `apply` writes. This
       * is the one path where a remote machine's data reaches local accounts a person set up by
       * hand, so it shows what would change before it changes it.
       *
       * Uses the SHARE token, which is a different credential with different powers — an ingest
       * token is refused here by the service, which is the point of issuing two.
       */
      if (url.pathname === '/api/sync/accounts/plan' || url.pathname === '/api/sync/accounts/apply') {
        if (!pushApi || !pushAccountsApi) {
          return send(503, JSON.stringify({ ok: false, error: 'the compiled build is missing' }));
        }
        const baseUrl = pushApi.syncUrl();
        if (!baseUrl) return send(400, JSON.stringify({ ok: false, error: 'no endpoint set' }));
        const share = await pushApi.resolveShareToken();
        if (!share.token) {
          return send(400, JSON.stringify({
            ok: false,
            error: `no share token — ${share.note ?? 'none stored'}. Paste one above.`
          }));
        }

        const state = pushStateApi.readPushState();
        const client = new pushClientApi.PushClient({ baseUrl, token: share.token });
        /* No If-None-Match here: a person pressing "Pull accounts" is asking to look NOW, and a
           304 would answer with nothing to show them. The ETag is for the background path. */
        const r = await pushAccountsApi.pullAccounts(client, {});
        if (r.stopped) return send(200, JSON.stringify({ ok: false, error: r.stopped }));

        const actionable = r.plan.filter((p) => p.action === 'create' || p.action === 'update');
        if (url.pathname === '/api/sync/accounts/plan') {
          return send(200, JSON.stringify({
            ok: true, listVersion: r.listVersion ?? null,
            plan: r.plan, withdrawn: r.withdrawn, actionable: actionable.length
          }));
        }

        if (!actionable.length) {
          return send(200, JSON.stringify({ ok: true, applied: 0, note: 'nothing to apply' }));
        }

        /**
         * ONLY WHAT WAS CHOSEN, AND THE CHOICE IS CHECKED HERE.
         *
         * The screen offers one switch per account, but a list of handles arriving from a browser
         * is a request, not an instruction. The selection is intersected with the plan THIS
         * request just computed, so the set that can possibly be written is bounded by what the
         * shared list actually holds right now: a handle that is not in the list, or is in it and
         * unchanged, or was invented by the caller, matches nothing and is reported back as
         * skipped rather than acted on.
         *
         * Fail closed. `handles` absent or empty applies NOTHING — the old behaviour was to apply
         * every actionable account on an empty body, and that is the exact click this feature
         * exists to stop somebody making by accident.
         */
        const { chosen, skipped } = pushAccountsApi.selectPlan(r.plan, body.handles);
        if (!chosen.length && !skipped.length) {
          return send(200, JSON.stringify({
            ok: true, applied: 0, selected: 0, actionable: actionable.length,
            note: 'no accounts were selected — nothing was applied'
          }));
        }

        if (!chosen.length) {
          return send(200, JSON.stringify({
            ok: true, applied: 0, selected: 0, skipped, actionable: actionable.length,
            note: 'nothing that was selected is still in the shared list to apply'
          }));
        }

        const done = await pushAccountsApi.applyAccounts(r.incoming, chosen);

        /**
         * THE ETAG IS ONLY STORED WHEN THE WHOLE LIST WAS TAKEN.
         *
         * It is the background path's "I am caught up" marker, and a partial pull is the opposite
         * of caught up. Writing it after applying 2 of 7 would make the next scheduled fetch a
         * 304, and the five accounts that were deliberately left behind would never arrive — the
         * person would have to notice the absence themselves. Left unwritten, the next pull sees
         * them again, which is what someone who ticked two of seven expects.
         */
        const complete = chosen.length === actionable.length && !done.errors.length;
        if (r.etag && complete) pushStateApi.writePushState({ ...state, accountsEtag: r.etag });

        return send(200, JSON.stringify({
          ok: !done.errors.length, applied: done.applied,
          selected: chosen.length, actionable: actionable.length,
          remaining: actionable.length - chosen.length,
          ...(skipped.length ? { skipped } : {}),
          ...(done.errors.length ? { errors: done.errors } : {}),
          withdrawn: r.withdrawn
        }));
      }

      if (url.pathname === '/api/sync/token/remove') {
        if (!vaultApi || !pushApi) return send(503, JSON.stringify({ ok: false, error: 'the compiled build is missing' }));
        const kind = body.kind === 'share' ? 'share' : 'push';
        const name = kind === 'push' ? pushApi.SYNC_PUSH_TOKEN : pushApi.SYNC_SHARE_TOKEN;
        try {
          const removed = await vaultApi.removeSecret(name);
          return send(200, JSON.stringify({ ok: true, removed }));
        } catch (e) {
          return send(400, JSON.stringify({ ok: false, error: e && e.message ? e.message : String(e) }));
        }
      }

      if (url.pathname === '/api/vault/key/remove') {
        if (!vaultApi) return send(503, JSON.stringify({ ok: false, error: 'the compiled build is missing — run npm run build' }));
        try {
          const scope = body.scope ? String(body.scope) : undefined;
          const removed = await vaultApi.removeSecret(vaultApi.ANTHROPIC_API_KEY, scope);
          return send(200, JSON.stringify({ ok: true, removed }));
        } catch (e) {
          return send(400, JSON.stringify({ ok: false, error: e && e.message ? e.message : String(e) }));
        }
      }
      if (url.pathname === '/api/status') {
        const r = setStatus(body.draftId, body.status, body.note);
        return send(r.ok ? 200 : 400, JSON.stringify(r));
      }
      if (url.pathname === '/api/auto/start') {
        const r = autoStart(body);
        return send(r.ok ? 200 : 400, JSON.stringify(r));
      }
      if (url.pathname === '/api/auto/stop') {
        const r = autoStop();
        return send(r.ok ? 200 : 400, JSON.stringify(r));
      }
      if (url.pathname === '/api/operator/select') {
        const name = typeof body.name === 'string' ? body.name : null;
        /**
         * The choice is WRITTEN DOWN, not just remembered.
         *
         * It used to live only in `selectedOperator`, which meant two things went wrong at once:
         * it died with the process, and — worse — the requirement check reads
         * `config.llm.operator`, which never looked at this variable. So picking an operator
         * changed which login a run was billed to while the Setup screen went on insisting none
         * was selected. Persisting it is what makes those two agree.
         */
        // Empty/null clears the pick → runs fall back to the server's shell env, or fail closed.
        if (!name) {
          try { configApi.setStoredOperatorSelection(null); }
          catch (e) { return send(400, JSON.stringify({ ok: false, error: e && e.message ? e.message : String(e) })); }
          selectedOperator = process.env.REDBOT_OPERATOR || null;
          return send(200, JSON.stringify({ ok: true, selected: selectedOperator }));
        }
        // The browser can only choose among registered operators; it cannot create one.
        if (!readOperators().some((o) => o.name === name)) {
          return send(400, JSON.stringify({
            ok: false,
            error: `"${name}" is not a registered operator. Add one at a terminal: redbot operators add ${String(name).replace(/[^a-z0-9._-]/gi, '')}`
          }));
        }
        try { configApi.setStoredOperatorSelection(name); }
        catch (e) { return send(400, JSON.stringify({ ok: false, error: e && e.message ? e.message : String(e) })); }
        selectedOperator = name;
        /* Whether the environment is overriding the choice that was just saved — the one thing
           that would make the screen and the run disagree, so it is reported rather than hidden. */
        return send(200, JSON.stringify({
          ok: true,
          selected: selectedOperator,
          overriddenByEnv: Boolean(process.env.REDBOT_OPERATOR) && process.env.REDBOT_OPERATOR !== name
        }));
      }
      /**
       * Sources go to sources. Both of these used to refuse with "sources.json is
       * missing." on a fresh install — the file they demanded is the file this button exists
       * to create, the same bootstrap trap the account wizard had. Validation, the
       * absent-vs-corrupt distinction and the seed-file mirror all live in dist/sources.js so
       * the CLI and this console cannot disagree about what a valid source is.
       */
      if (url.pathname === '/api/sources/add') {
        const kind = body.kind === 'search' ? 'search' : 'subreddit';
        const r = await sourcesApi.addSource(kind, String(body.value || ''), String(body.why || ''));
        return send(r.ok ? 200 : 400, JSON.stringify(r));
      }
      /* Change one in place. Not remove-then-add: that route discards the operator's stated
         reason (addSource defaults `why`), and a rejected add after a successful remove leaves
         the source gone with nothing put back. Relevance is not checked here for the same reason
         it is not checked on add — what is worth watching is the operator's call. */
      if (url.pathname === '/api/sources/edit') {
        const kind = body.kind === 'search' ? 'search' : 'subreddit';
        const r = await sourcesApi.editSource(
          kind,
          String(body.value || ''),
          String(body.newValue ?? body.value ?? ''),
          body.why === undefined ? undefined : String(body.why)
        );
        return send(r.ok ? 200 : 400, JSON.stringify(r));
      }
      /**
       * The switch on a source row.
       *
       * It used to be a browser preference. `localStorage['redbot.src.<kind>.<id>']` decided what
       * a collect visited, while `sources.enabled` — which is what /api/state, the CLI, doctor
       * and the seed file all report — was consulted only as a default for a key not yet
       * written. One machine, two answers, and the quieter one drove the run.
       */
      if (url.pathname === '/api/sources/enable') {
        const kind = body.kind === 'search' ? 'search' : 'subreddit';
        const r = await sourcesApi.switchSource(kind, String(body.value || ''), body.enabled !== false);
        return send(r.ok ? 200 : 400, JSON.stringify(r));
      }
      /**
       * Take the switches a browser was holding into the record, once, on upgrade.
       *
       * Without this, moving the truth to the database silently switches ON every source the
       * operator had switched off — the collector would start visiting places they had stopped
       * watching, with no action from them. A key naming a source that no longer exists is
       * REPORTED, never re-created: those keys outlived their sources (they are keyed by name),
       * and re-creating one would resurrect a switch nobody set on a source somebody deleted.
       */
      if (url.pathname === '/api/sources/adopt-toggles') {
        const toggles = Array.isArray(body.toggles) ? body.toggles : [];
        const applied = [], ignored = [], refused = [];
        for (const t of toggles) {
          const kind = t?.kind === 'search' ? 'search' : 'subreddit';
          const value = String(t?.value || '');
          if (!value) continue;
          const r = await sourcesApi.switchSource(kind, value, t?.enabled !== false);
          if (r.ok) applied.push(r.value);
          else if (/Not on the list/.test(r.error || '')) ignored.push(value);
          else refused.push({ value, error: r.error });
        }
        return send(200, JSON.stringify({ ok: refused.length === 0, applied, ignored, refused }));
      }
      if (url.pathname === '/api/sources/remove') {
        const kind = body.kind === 'search' ? 'search' : 'subreddit';
        const r = await sourcesApi.removeSource(kind, String(body.value || ''));
        return send(r.ok ? 200 : 400, JSON.stringify(r));
      }
      if (url.pathname === '/api/account/create') {
        const r = await createAccount(body);
        return send(r.ok ? 200 : 400, JSON.stringify(r));
      }
      /**
       * Editing an existing account — the descriptive half of it.
       *
       * The handle, the profile folder and the debug port are NOT taken from this request; see
       * `updateConsoleAccount` for why repointing a signed-in account at another Chrome is a
       * silent failure rather than a loud one. Sending them is not an error, but the response
       * names them under `ignored` so a caller is never told it changed something it did not.
       */
      if (url.pathname === '/api/account/update') {
        const r = await updateAccountImpl(body);
        return send(r.ok ? 200 : 400, JSON.stringify(r));
      }
      /**
       * Removing an account — the record, never the signed-in browser folder.
       *
       * Answers 409 rather than 400 when it needs confirming: the request was well-formed and
       * the account exists, the state of the world is what stopped it. A client that treats
       * every non-200 as "bad input" would otherwise show a validation error for a question.
       */
      /**
       * RESET — the one control here that destroys work on purpose.
       *
       * Four things guard it, and each one is a separate refusal so the reason is never guessed:
       *
       *   1. It REFUSES while anything is running. A reset that deletes threads.json under a
       *      collect leaves the run writing to a file that no longer describes the install.
       *   2. `confirm` must be the exact word RESET. Fail closed: anything else is a refusal,
       *      never an approval — the same rule publishing uses for SEND.
       *   3. The signed-in Chrome folders are only touched when `signIns` is true, which the
       *      screen makes a separate tick with its own sentence. No scope implies them.
       *   4. It shells out to `dist/cli.js reset --yes`, so the console and the terminal run the
       *      SAME code and take the same snapshot first. A second implementation here is how the
       *      two would drift on the one operation nobody can inspect afterwards.
       */
      /**
       * Close an orphaned browser of ours — by PID, but never on the caller's word for it.
       *
       * The PID is re-proved against the process table at the moment of the kill: it must still
       * be holding a profile folder inside this install's data root, and still be claimed by no
       * account. A stale id from a screen somebody left open ten minutes ago is exactly how a
       * kill-by-number ends up terminating whatever inherited that PID.
       */
      if (url.pathname === '/api/browsers/close-orphan') {
        const pid = Number(body.pid);
        if (!Number.isInteger(pid) || pid <= 0) {
          return send(400, JSON.stringify({ ok: false, error: 'that is not a process id' }));
        }
        if (!inspectPortsImpl || !orphanBrowsersImpl || !debugPortRange) {
          return send(400, JSON.stringify({ ok: false, error: 'the compiled build is missing its ports module — run npm run build' }));
        }
        const { accounts: accts } = await consoleAccounts();
        const range = [];
        for (let p = debugPortRange.first; p <= debugPortRange.last; p++) range.push(p);
        const look = await inspectPortsImpl(range);
        const orphans = orphanBrowsersImpl(look.owners, DATA, accts.map((a) => a.profileDir).filter(Boolean));
        const target = orphans.find((o) => o.pid === pid);
        if (!target) {
          return send(409, JSON.stringify({
            ok: false,
            error: look.reason
              ? `redbot could not read the process table, so it will not close anything: ${look.reason}`
              : `process ${pid} is not an orphaned browser of ours right now. Nothing was closed.`
          }));
        }
        const killed = await new Promise((resolve) => {
          const k = spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
          k.on('error', () => resolve(false));
          k.on('close', (code) => resolve(code === 0));
        });
        return send(killed ? 200 : 400, JSON.stringify(killed
          ? { ok: true, pid, port: target.port, profileDir: target.profileDir }
          : { ok: false, error: `redbot could not close process ${pid}.` }));
      }

      if (url.pathname === '/api/reset') {
        const scope = body.scope === 'all' ? 'all' : 'work';
        if (running) {
          return send(409, JSON.stringify({
            ok: false,
            error: `"${ACTIONS[running]?.label ?? running}" is running. Let it finish before resetting — a reset under a run leaves both half-done.`
          }));
        }
        if (autoProc) {
          return send(409, JSON.stringify({
            ok: false, error: 'the unattended loop is running. Stop it before resetting.'
          }));
        }
        if (body.confirm !== 'RESET') {
          return send(400, JSON.stringify({ ok: false, error: 'not confirmed — type RESET exactly' }));
        }
        const args = ['reset', '--scope', scope, '--yes'];
        if (body.signIns === true) args.push('--sign-ins');
        const r = await spawnCli(args);
        return send(r.ok ? 200 : 400, JSON.stringify(r));
      }
      if (url.pathname === '/api/account/remove') {
        const r = await deleteAccountImpl(body);
        return send(r.ok ? 200 : r.needsConfirm ? 409 : 400, JSON.stringify(r));
      }
      /**
       * Moving an account to another port. A separate verb from /api/account/update, which
       * still refuses debugPort — see `changeAccountPort` for why changing it blind is the
       * dangerous case and changing it deliberately is not.
       */
      if (url.pathname === '/api/account/port') {
        const r = await changePortImpl(body);
        return send(r.ok ? 200 : 400, JSON.stringify(r));
      }
      /* Stops the browser on this account's port — and only if it can prove the process is
         that account's own. A kill-by-port would close whatever happened to be there. */
      if (url.pathname === '/api/account/stop') {
        const { accounts: all } = await consoleAccounts();
        const acct = all.find((x) => x.handle === String(body.handle || ''));
        if (!acct) return send(400, JSON.stringify({ ok: false, error: `${body.handle} is not set up.` }));
        const r = await stopBrowserImpl(acct);
        /**
         * The exit goes down with the browser it was carrying.
         *
         * Only after a SUCCESSFUL stop: a refusal means that Chrome is still running — quite
         * possibly on this relay — and closing the listener under it would take a working
         * session offline as a side effect of a button that reported it had done nothing.
         */
        if (r.ok && relayApi) await relayApi.stop(acct.handle).catch(() => {});
        /* The CDP connection goes with it. Held open it would keep a dead browser's alignment in
           the list, which is a claim about a window that no longer exists. */
        if (r.ok && alignApi) await alignApi.stop(acct.handle).catch(() => {});
        return send(r.ok ? 200 : 400, JSON.stringify(r));
      }
      /**
       * Give an account an exit — the write half of the proxy feature.
       *
       * Starts the SAME gate `redbot proxy vet <handle>` runs, as a background job, because the
       * default check is six hours long and no request survives that. The response says the job
       * started; `GET /api/account/exit` is how the screen follows it.
       *
       * NOTHING IS STORED BY THIS CALL. The address, the country and the credential are written
       * only by the gate, and only on an all-PASS. A form that saved first and checked afterwards
       * would leave an account pointed at an address nobody had proven — and the first sign-in
       * through it cannot be undone.
       */
      if (url.pathname === '/api/account/exit') {
        const r = await exitVetStart(body);
        return send(r.ok ? 200 : 400, JSON.stringify(r));
      }
      if (url.pathname === '/api/account/exit/stop') {
        const r = exitVetStop();
        return send(r.ok ? 200 : 400, JSON.stringify(r));
      }
      if (url.pathname === '/api/account/exit/remove') {
        const r = await exitRemove(body);
        return send(r.ok ? 200 : 400, JSON.stringify(r));
      }

      /* Gives a shared account a folder and a port on THIS machine. The step after it is still
         a human signing in — the session cannot travel, so nothing here pretends it can. */
      /**
       * Stop the action that is running now.
       *
       * Refuses rather than obeys in two cases, and both matter more than the button:
       *
       *   - nothing is running. The screen may simply be stale; killing "whatever is there"
       *     on that basis is how the wrong process dies.
       *   - the action is `__reply`. A publish is submit-then-confirm, and a kill between them
       *     leaves a live comment on Reddit that redbot has no record of. See ACTIONS.
       *
       * `/T` because the CLI child is a tree — it drives Playwright, which has helpers of its
       * own — and terminating only the parent leaves them holding the account's Chrome. The pid
       * is read from the LIVE handle at this instant and only if the child has not already
       * exited: a number captured earlier can name somebody else's process by now.
       */
      /**
       * REFRESH, BUT OF THE ENGINE RATHER THAN THE PICTURE.
       *
       * The console's refresh re-fetched state and repainted, and said "Refreshed" whatever it
       * found. That is the right answer to stale numbers and no answer at all to a stuck job:
       * this process holds a single `running` lock, and while it is set every action is refused
       * with "something else is still running". If the lock ever outlives its process, the app
       * is finished until it is restarted, and nothing on any screen says why.
       *
       * So refresh now ASKS. Three answers, and they are different facts:
       *   - nothing is running: the lock is clear and always was;
       *   - something is running: it is named, timed and its pid given, so a person can let it
       *     carry on or stop it — the "continue or exit" choice, made on evidence;
       *   - the lock outlived its process: cleared here, and REPORTED as cleared rather than
       *     silently tidied, because a console that quietly fixes itself teaches nobody what
       *     went wrong.
       *
       * Liveness is checked against the OS (`process.kill(pid, 0)`), not against this process's
       * own belief. Believing our own bookkeeping is what produced the stuck lock in the first
       * place, and a gauge that reads its own memory cannot report its own memory being wrong.
       *
       * It does NOT kill anything. Stopping stays an explicit act with its own endpoint and its
       * own refusal for the one action that must not be interrupted part-way.
       */
      if (url.pathname === '/api/run/reconcile') {
        return send(200, JSON.stringify(reconcileRun()));
      }

      if (url.pathname === '/api/run/stop') {
        const key = running;
        if (!key || !runningChild) {
          return send(400, JSON.stringify({ ok: false, error: 'Nothing is running.' }));
        }
        const spec = ACTIONS[key];
        if (!spec || !spec.stoppable) {
          return send(409, JSON.stringify({
            ok: false,
            error: 'A reply that is being sent cannot be stopped part-way — it would leave a '
                 + 'comment on Reddit that redbot has no record of. Let it finish.'
          }));
        }
        if (runningChild.exitCode !== null || runningChild.signalCode !== null) {
          return send(400, JSON.stringify({ ok: false, error: 'That run has already finished.' }));
        }
        const pid = runningChild.pid;
        runningStopped = true;
        runLogAppend(`\n[stopped by the operator]\n`);
        if (process.platform === 'win32') {
          spawn('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
        } else {
          try { runningChild.kill('SIGTERM'); } catch { /* already gone */ }
        }
        /* Answers immediately. The run's own promise resolves when the child actually closes,
           and the screen learns it stopped from that, not from this. */
        return send(200, JSON.stringify({ ok: true, stopped: key, label: spec.label, pid }));
      }
      if (url.pathname === '/api/account/setup-here') {
        const r = await setUpHereImpl(body);
        return send(r.ok ? 200 : 400, JSON.stringify(r));
      }

      /**
       * Choose which account this machine acts as.
       *
       * The one endpoint that turns a blocking requirement into something a person can clear from
       * inside the app. Before it existed, `selectedAccount()` read only REDBOT_ACCOUNT — and a
       * desktop window has no shell — so an install with two accounts refused every command with
       * no way to answer.
       *
       * Writes ONE row's flag and nothing else. It cannot create, rename or delete an account:
       * `setSelectedAccount` refuses a handle that is not already a record, and the database holds
       * the "at most one per machine" invariant through a partial unique index, so two clicks
       * racing cannot leave two selections.
       */
      if (url.pathname === '/api/account/select') {
        if (!selectAccountImpl) {
          return send(503, JSON.stringify({ ok: false, error: 'the compiled build is missing — run npm run build' }));
        }
        /* Validation and the {ok,error} shape belong to src/console-accounts.ts, beside the same
           HANDLE_RE that create/update/delete use. A second copy of the rule here would be a second
           rule, and they would disagree the first time one was tightened. */
        const r = await selectAccountImpl({ handle: body.handle });
        return send(r.ok ? 200 : 400, JSON.stringify(r));
      }
      if (url.pathname === '/api/account/open') {
        // `await` is load-bearing: launchChrome became async when it started reading the port
        // from accounts. Without it, `r` is a Promise — `r.ok` is undefined, so the
        // button got 400 and a body of `{}` while Chrome opened perfectly well behind it.
        /* `background` is a placement request, not a capability — the worst a caller can do with
           it is put a window where they cannot see it, and the same caller could close it. It is
           NOT the shape of REDBOT_CDP, which is refused from the request because a caller could
           point redbot at a debugger they control and harvest every scraped thread. */
        const r = await launchChrome(String(body.handle || ''), { background: body.background === true });
        return send(r.ok ? 200 : 400, JSON.stringify(r));
      }
      /**
       * Bring an off-screen browser back where it can be seen.
       *
       * The counterpart to `background`. A window at -32000,-32000 cannot be reached by clicking
       * or alt-tabbing, and launching Chrome again only messages the running instance — so this
       * is the only way back, and it is why the off-screen default is safe to ship.
       *
       * dist/browser.js is imported HERE rather than in the module's startup block because it
       * pulls in Playwright, and the console has no other reason to load it. A screen nobody has
       * opened should not cost that.
       */
      /**
       * Use a Chrome profile that is already signed in, instead of signing in again.
       *
       * The rules live in dist/console-accounts.js beside the ones create/change-port follow, so
       * the console cannot grow its own idea of what a valid profile is.
       */
      if (url.pathname === '/api/account/use-profile') {
        if (!adoptProfileImpl) {
          return send(503, JSON.stringify({ ok: false, error: 'the compiled build is missing — run npm run build' }));
        }
        const r = await adoptProfileImpl({ handle: body.handle, path: body.path });
        return send(r.ok ? 200 : 400, JSON.stringify(r));
      }
      if (url.pathname === '/api/account/show') {
        const { accounts: accts } = await consoleAccounts();
        const a = accts.find((x) => x.handle === String(body.handle || ''));
        if (!a) return send(400, JSON.stringify({ ok: false, error: `${body.handle} is not set up.` }));
        const [live] = await portStatusImpl([a]);
        if (!live || !live.ours) {
          return send(400, JSON.stringify({ ok: false, error: live ? live.detail : 'that browser is not running' }));
        }
        try {
          const { showBrowserWindow } = await import('../../dist/browser.js');
          const r = await showBrowserWindow(`http://127.0.0.1:${a.debugPort}`);
          return send(r.ok ? 200 : 400, JSON.stringify(r.ok ? { ok: true, handle: a.handle, port: a.debugPort } : { ok: false, error: r.reason }));
        } catch (e) {
          return send(400, JSON.stringify({ ok: false, error: String(e && e.message || e) }));
        }
      }
      if (url.pathname === '/api/publish-post') {
        const r = await publishPost(body);
        return send(r.ok ? 200 : 400, JSON.stringify(r));
      }
      if (url.pathname === '/api/publish') {
        const r = await publish(body);
        return send(r.ok ? 200 : 400, JSON.stringify(r));
      }
      return send(404, JSON.stringify({ error: 'not found' }));
    });
    return;
  }

  if (req.method !== 'GET') return send(405, JSON.stringify({ error: 'unsupported method' }));

  /**
   * Live health. Polled by the console so a disconnect is visible where the work happens,
   * rather than surfacing later as a command that mysteriously fails.
   *
   * Everything here is probed at request time. Nothing is remembered between calls, so this
   * cannot report a browser as reachable because it was reachable a minute ago.
   */
  /**
   * The live log. `since` is a line INDEX, not a timestamp: the client sends how many lines it
   * already has and gets only what is new, so a poll is a few hundred bytes rather than the
   * whole run. `runId` lets the client notice a new run started and reset its view instead of
   * appending one run's output onto another's.
   */
  /**
   * Past runs, newest first. Headers only — a run's lines are read from disk only when one is
   * actually opened, so listing 500 runs costs 500 first-lines rather than 500 whole files.
   */
  /**
   * The last preview's candidates, so the console can offer the pick step the CLI documents.
   *
   * Read from disk on every call, never cached: `search --commit` reads this same file, so a
   * remembered copy here could show a list that no longer matches what a commit would collect —
   * and the operator would be picking row 4 of one search and committing row 4 of another.
   *
   * An absent file is `present:false`, not an error. Nobody has previewed yet is a state, not
   * a fault, and the console renders it as "run the search first".
   */
  if (url.pathname === '/api/search/candidates') {
    const p = join(DATA, 'search-candidates.json');
    if (!existsSync(p)) return send(200, JSON.stringify({ ok: true, present: false, candidates: [] }));
    try {
      const f = JSON.parse(readFileSync(p, 'utf8'));
      return send(200, JSON.stringify({
        ok: true, present: true,
        query: f.query || '',
        previewedAt: f.previewedAt || null,
        candidates: Array.isArray(f.candidates) ? f.candidates : []
      }));
    } catch (e) {
      return send(200, JSON.stringify({
        ok: false, present: true, candidates: [],
        error: `search-candidates.json could not be read (${e.message}). Run the search again.`
      }));
    }
  }

  if (url.pathname === '/api/run/history') {
    const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit') ?? 100) || 100));
    return send(200, JSON.stringify({ keep: RUN_LOG_KEEP, runs: runLogList(limit) }));
  }

  if (url.pathname === '/api/run/log') {
    const since = Math.max(0, Number(url.searchParams.get('since') ?? 0) || 0);
    /**
     * ?file=<name> reads a PAST run from disk instead of the live buffer. Same response shape,
     * so the viewer renders history and a running command with one code path.
     */
    const wanted = url.searchParams.get('file');
    if (wanted) {
      const past = runLogRead(wanted);
      if (!past) return send(404, JSON.stringify({ error: 'no such run log' }));
      return send(200, JSON.stringify({ ...past, lines: past.lines.slice(since) }));
    }

    return send(200, JSON.stringify({
      runId: runLog.id,
      key: runLog.key,
      command: runLog.command,
      startedAt: runLog.startedAt,
      running: !runLog.done,
      done: runLog.done,
      code: runLog.code,
      dropped: runLog.dropped,
      total: runLog.lines.length,
      lines: runLog.lines.slice(since)
    }));
  }

  if (url.pathname === '/api/pulse') {
    (async () => {
      const { accounts: accts } = await consoleAccounts();
      rememberSoleAccount(accts);
      /**
       * `browserUp` used to be `fetch('/json/version').ok`, and that answered TRUE for a
       * browser that was not ours. On this machine 9222 is Lenovo Vantage's Edge WebView2 —
       * it speaks CDP fluently — so an account pointed there reported healthy while every
       * read came back signed out. Ownership now decides, and a squatter is a problem rather
       * than a pass. See src/ports.ts.
       */
      const statuses = await portStatusImpl(accts);

      /**
       * The exit travels WITH the status, so no surface can render a green "connected" without
       * also being able to say where that connection leaves from. `undefined` is deliberate and
       * load-bearing: it means the record could not be read, which `exitPosture` renders as
       * "unknown" rather than as "no proxy". Reporting no-proxy for an unreadable record would
       * tell the operator they are on their own address, which might be false.
       */
      let proxyRows;
      try { proxyRows = proxiesApi ? await proxiesApi() : undefined; } catch { proxyRows = undefined; }
      const relayStates = relayApi ? (relayApi.states() || []) : [];
      const byHandle = (rows, h) =>
        (rows || []).find((r) => r && String(r.handle).toLowerCase() === String(h).toLowerCase());

      return statuses.map((s) => ({
        handle: s.handle, port: s.port,
        browserUp: s.ours,
        state: s.state,
        detail: s.detail,
        profileOnDisk: s.profileOnDisk,
        exit: exitPosture(
          proxyRows === undefined ? undefined : (byHandle(proxyRows, s.handle) || null),
          byHandle(relayStates, s.handle) || null,
          { browserUp: s.ours }
        )
      }));
    })().then((browsers) => {
      /* Derived in ONE tested place, and that place knows about the empty fleet. While this loop
         lived inline here, zero accounts meant zero iterations meant zero problems meant
         `healthy: true` — and the console painted "all connected" in green directly above its own
         banner listing the two things still missing. See tools/product/fleet-posture.mjs. */
      const problems = fleetProblems(browsers);
      if (!existsSync(join(ROOT, 'dist', 'cli.js'))) problems.push('redbot is not built — run npm run build');
      send(200, JSON.stringify({
        at: new Date().toISOString(), running, browsers, problems,
        auto: autoStatus(),
        healthy: problems.length === 0
      }));
    }).catch((e) => send(500, JSON.stringify({ error: String(e && e.message || e) })));
    return;
  }

  /**
   * What is on each account's port, right now.
   *
   * Its own endpoint rather than a field on /api/state: this asks the operating system who owns
   * a socket, which is the one read here that cannot be answered from the database, and the
   * accounts screen wants it on a faster cadence than a full state rebuild.
   *
   * `suggestion` rides along so the "change port" form can offer a number that is actually free
   * instead of making a person guess and be refused.
   */
  /**
   * One page of one list, straight from the database.
   *
   * Its own endpoint rather than a bigger `/api/state`: paging is the one read here that
   * happens because a person clicked Next, and rebuilding every screen's figures to answer it
   * would make the cheap action the expensive one.
   *
   * The list name is matched against a fixed map, never interpolated. It arrives from a query
   * string, and the functions behind it build SQL.
   */
  if (url.pathname === '/api/page') {
    const want = String(url.searchParams.get('list') || '');
    const lists = {
      threads: pagesApi?.threads,
      /**
       * `dropped` is its OWN list, paged independently of `threads`.
       *
       * Both live on the Threads screen and they answer different questions — what redbot chose
       * to look at, and what it refused before spending anything. Sharing one position would
       * mean paging into the refusals moved the list above them, which is why they page apart.
       * `pageDroppedThreads` has always cut a real LIMIT/OFFSET page; only this map withheld it,
       * so the screen showed the newest 25 and offered no way to reach the 26th.
       */
      dropped: pagesApi?.dropped,
      outcomes: pagesApi?.outcomes,
      observations: pagesApi?.observations
    };
    const fn = Object.prototype.hasOwnProperty.call(lists, want) ? lists[want] : null;
    if (!fn) {
      return send(400, JSON.stringify({ error: `unknown list "${want}"`, lists: Object.keys(lists) }));
    }
    fn({ offset: url.searchParams.get('offset'), limit: url.searchParams.get('limit') })
      .then((page) => send(200, JSON.stringify({ list: want, ...page })))
      .catch((e) => send(500, JSON.stringify({ error: String(e && e.message || e) })));
    return;
  }

  /**
   * Browsers that are OURS but belong to no account — and can therefore be reclaimed.
   *
   * THE STATE THIS ANSWERS. Ownership used to be resolved only THROUGH an account row, so a
   * Chrome that outlived its account was invisible to every screen and every stop button. On the
   * machine that reported this, one sat on 9222 — the first port the allocator hands out — and
   * nothing short of a reboot could take it back:
   *
   *     browsers  Big_Variation_8580 NOT closed — Big_Variation_8580 is not set up.
   *
   * The proof of ownership is the FOLDER, not the row: that browser was told to open a directory
   * inside this install's data root. `orphanBrowsers` decides; this route only reports.
   */
  if (url.pathname === '/api/browsers/orphans') {
    if (!inspectPortsImpl || !orphanBrowsersImpl || !debugPortRange) {
      return send(200, JSON.stringify({ ok: false, error: 'the compiled build is missing its ports module — run npm run build', orphans: [] }));
    }
    (async () => {
      const { accounts: accts } = await consoleAccounts();
      const range = [];
      for (let p = debugPortRange.first; p <= debugPortRange.last; p++) range.push(p);
      const look = await inspectPortsImpl(range);
      const orphans = orphanBrowsersImpl(look.owners, DATA, accts.map((a) => a.profileDir).filter(Boolean));
      /* `reason` travels: an empty list because the machine would not answer is a different fact
         from an empty list because there are none, and a screen that showed both the same way
         would tell somebody their ports are clean when nothing was ever looked at. */
      send(200, JSON.stringify({ ok: true, orphans, lookupProblem: look.reason ?? null }));
    })().catch((e) => send(200, JSON.stringify({ ok: false, error: String(e && e.message || e), orphans: [] })));
    return;
  }

  if (url.pathname === '/api/ports') {
    (async () => {
      const { accounts: accts } = await consoleAccounts();
      const ports = await portStatusImpl(accts);
      let suggestion = null;
      try { suggestion = await suggestPortImpl(); } catch { /* every port in range is spoken for */ }
      /**
       * Which of these have a browser on THIS machine.
       *
       * An account shared through the database from another computer arrives with a
       * description and nothing else. Its port may even look plausible — the legacy column
       * still answers when no binding exists — but no folder here holds its session, so
       * "Start browser" would open a signed-out window. The card has to be able to say that.
       */
      let boundHere = null;
      try { boundHere = [...await boundHandlesImpl()]; } catch { /* unknown, not empty */ }
      /**
       * Which exit each account leaves from.
       *
       * NULL vs [] matters here exactly as it does for `boundHere`: null means the question
       * could not be asked (no database, migration 0016 not applied), and the card must then say
       * nothing rather than claim "no proxy" — which would read as "this account exits from your
       * home address" and might be wrong. An empty array genuinely means none are configured.
       *
       * The credential is never in this payload. The address is not a secret — it is the thing
       * the operator is paying for and needs to see — but the username and password stay sealed.
       */
      let proxies = null;
      try { proxies = await proxiesApi(); } catch { /* unknown, not none */ }
      /**
       * Which of those exits are actually CARRYING traffic right now.
       *
       * `proxies` is the record — what was vetted, and when. This is the live fact, and the two
       * are not the same claim: a pinned address with no relay running means the browser would
       * exit from this computer's own connection, and a card that showed only the record would
       * say "exit 198.51.100.20" about a window that is doing nothing of the kind.
       *
       * Read from the relay objects in this process, so it cannot be stale. Never null-vs-empty
       * ambiguous either: no relays running is genuinely an empty list.
       */
      const relays = relayApi ? relayApi.states() : null;
      /* Which browsers this process is still COVERING — the timezone override and the WebRTC
         fence only hold while redbot is attached, so an empty list beside a live relay is a real
         state and not a rendering detail. `pagesAligned` is what makes a hook that never fired
         visible rather than silent. */
      const alignments = alignApi ? alignApi.states() : null;
      /**
       * The per-account posture, computed HERE so the Accounts card and the header chip cannot
       * disagree about the same account. Keyed by lower-cased handle, the canonical account key.
       *
       * `proxies === null` means the record could not be read — that is passed through as
       * `undefined` so `exitPosture` returns `unknown` rather than the flat lie of "no proxy".
       */
      const postures = {};
      for (const p of (ports || [])) {
        const h = String(p.handle || '');
        if (!h) continue;
        const key = h.toLowerCase();
        const rec = proxies === null || proxies === undefined
          ? undefined
          : ((proxies || []).find((x) => x && String(x.handle).toLowerCase() === key) || null);
        const rel = (relays || []).find((x) => x && String(x.handle).toLowerCase() === key) || null;
        postures[key] = exitPosture(rec, rel, { browserUp: p.state === 'running' || p.ours === true });
      }

      return { at: new Date().toISOString(), machine: machineImpl(), ports, suggestion, boundHere,
               proxies, relays, alignments, postures };
    })()
      .then((payload) => send(200, JSON.stringify(payload)))
      .catch((e) => send(500, JSON.stringify({ error: String(e && e.message || e) })));
    return;
  }

  /* How the exit check is going. Polled while it runs — six hours of samples, so the screen
     needs something to show other than a spinner. Never carries the credential. */
  if (url.pathname === '/api/account/exit') {
    return send(200, JSON.stringify(exitVetStatus()));
  }

  /**
   * What a reset WOULD take. Read-only: this runs the same CLI verb without `--yes`, which is
   * the mode that prints the plan and removes nothing, so the screen cannot show one plan while
   * the button carries out another.
   */
  if (url.pathname === '/api/reset/plan') {
    const scope = url.searchParams.get('scope') === 'all' ? 'all' : 'work';
    const args = ['reset', '--scope', scope];
    if (url.searchParams.get('signIns') === '1') args.push('--sign-ins');
    /* This half of the handler is not async — the plan is answered from the promise rather than
       awaited, which is why nothing below runs for this path. */
    spawnCli(args, 60_000).then((r) => {
      send(200, JSON.stringify({ ok: r.ok, scope, plan: r.output ?? '', error: r.error ?? null }));
    });
    return;
  }

  if (url.pathname === '/api/actions') {
    return send(200, JSON.stringify({
      running,
      actions: PUBLIC_ACTIONS.map((key) => ({ key, label: ACTIONS[key].label }))
    }));
  }

  /* Who can run, and who is currently selected to pay. No credential paths cross this line. */
  /**
   * Is there a newer redbot? See src/update.ts for what this does and deliberately does not do.
   *
   * CACHED, because the page asks on every load and GitHub allows 60 unauthenticated requests an
   * hour per address. Six hours is far below that even if somebody restarts the app all morning,
   * and an update that is six hours stale is not a problem an update NOTICE has. `?force=1`
   * exists for the "check now" button, and is the only path that can spend a request on demand.
   *
   * A failure is cached too, briefly. Without that, an offline machine re-attempts a DNS lookup
   * on every screen change and the console feels slow for a feature nobody asked to run.
   */
  /**
   * Is the dashboard reachable, and what happened last time we pushed?
   *
   * Separate from `/api/setup` because that is read on every screen change and this makes a
   * NETWORK call — folding it in would put a round trip in front of every navigation. Cached for
   * thirty seconds so a person clicking "Check now" twice does not double the traffic, with
   * `?force=1` for the button itself.
   */
  if (url.pathname === '/api/sync/health') {
    if (!pushApi) return send(200, JSON.stringify({ ok: false, reason: 'the compiled build is missing' }));
    const force = url.searchParams.get('force') === '1';
    if (!force && syncHealthCache.value && Date.now() - syncHealthCache.at < 30_000) {
      return send(200, JSON.stringify({ ...syncHealthCache.value, cached: true }));
    }
    (async () => {
      const { baseUrl } = pushApi.pushConfig();
      if (!baseUrl) {
        const v = { ok: false, configured: false, reason: 'no endpoint set' };
        syncHealthCache = { at: Date.now(), value: v };
        return send(200, JSON.stringify({ ...v, cached: false }));
      }
      const { token } = await pushApi.resolveToken();
      const started = Date.now();
      const health = await new pushClientApi.PushClient({ baseUrl, token: token ?? '' }).health();
      const state = pushStateApi.readPushState();
      const lastSent = Object.entries(state.lastSentAt ?? {})
        .sort((a, b) => String(b[1]).localeCompare(String(a[1])))[0] ?? null;
      const v = {
        ok: health.ok,
        configured: Boolean(baseUrl && token),
        hasToken: Boolean(token),
        url: baseUrl,
        detail: health.detail,
        ms: Date.now() - started,
        checkedAt: new Date().toISOString(),
        lastPushAt: lastSent ? lastSent[1] : null,
        lastPushStream: lastSent ? lastSent[0] : null,
        streamsAcknowledged: Object.keys(state.cursors ?? {}).length,
        busy: Boolean(pushScheduler?.busy)
      };
      syncHealthCache = { at: Date.now(), value: v };
      send(200, JSON.stringify({ ...v, cached: false }));
    })().catch((e) => send(200, JSON.stringify({ ok: false, reason: e && e.message ? e.message : String(e) })));
    return;
  }

  /**
   * Is the software redbot depends on actually installed?
   *
   * SEPARATE FROM /api/setup, and cached, because locating an executable spawns `where` — cheap
   * once, wasteful on every screen change, and `/api/setup` is read on all of them. Two minutes is
   * long enough that opening Setup repeatedly costs nothing and short enough that installing Chrome
   * in another window shows up without restarting the app. `?force=1` is the "Check again" button.
   *
   * Answers 200 with `ok:false` rather than an error status: a dependency check that fails to run
   * must not be indistinguishable from a dependency that is missing.
   */
  if (url.pathname === '/api/dependencies') {
    const force = url.searchParams.get('force') === '1';
    if (!force && depsCache.value && Date.now() - depsCache.at < 120_000) {
      return send(200, JSON.stringify({ ...depsCache.value, cached: true }));
    }
    if (!dependenciesApi) {
      return send(200, JSON.stringify({ ok: false, dependencies: [], reason: 'the compiled build is missing' }));
    }
    /* Promise chaining, not await: this callback is synchronous — only the POST body branch is
       async. The same reason /api/update gives, and the same SyntaxError if it is forgotten. */
    Promise.resolve()
      .then(() => dependenciesApi.checkDependencies({
        /* The Claude CLI is only required on the CLI path, so the check has to know which is set. */
        provider: configApi && configApi.config ? configApi.config.llm.provider : 'cli'
      }))
      .then((dependencies) => {
        const v = {
          ok: true,
          dependencies,
          missing: dependenciesApi.missingDependencies(dependencies).map((d) => d.id),
          checkedAt: new Date().toISOString()
        };
        depsCache = { at: Date.now(), value: v };
        send(200, JSON.stringify({ ...v, cached: false }));
      })
      .catch((e) => {
        const v = { ok: false, dependencies: [], reason: e && e.message ? e.message : String(e) };
        depsCache = { at: Date.now(), value: v };
        send(200, JSON.stringify({ ...v, cached: false }));
      });
    return;
  }

  if (url.pathname === '/api/update') {
    const force = url.searchParams.get('force') === '1';
    const ttl = updateCache.value && updateCache.value.ok ? 6 * 3600_000 : 10 * 60_000;
    if (!force && updateCache.value && Date.now() - updateCache.at < ttl) {
      return send(200, JSON.stringify({ ...updateCache.value, cached: true }));
    }
    if (!updateApi) {
      return send(200, JSON.stringify({ ok: false, current: '0.0.0', reason: 'the compiled build is missing' }));
    }
    /**
     * Promise chaining rather than `await`, because THIS callback is synchronous — only the POST
     * body branch below is async. Written with `await` first and caught immediately by running it:
     * `SyntaxError: Unexpected reserved word`, the server child died on import, and the window
     * closed before it opened. Making the shared callback async to suit one new route would put
     * every other route behind a promise for no reason.
     */
    updateApi.checkForUpdate()
      .then((r) => {
        updateCache = { at: Date.now(), value: r };
        send(200, JSON.stringify({ ...r, cached: false }));
      })
      .catch((e) => {
        /* checkForUpdate is written not to throw; this is the belt to those braces. An update
           check must never be the reason a screen fails to render. */
        const r = { ok: false, current: '0.0.0', reason: e && e.message ? e.message : String(e) };
        updateCache = { at: Date.now(), value: r };
        send(200, JSON.stringify({ ...r, cached: false }));
      });
    return;
  }

  if (url.pathname === '/api/operators') {
    const operators = readOperators();
    const sel = operators.find((o) => o.name === selectedOperator) || null;
    return send(200, JSON.stringify({
      operators,
      selected: selectedOperator,
      selectedRegistered: !!sel,
      selectedShared: sel ? sel.shared : null,
      selectedReady: sel ? sel.ready : null
    }));
  }

  /**
   * Everything the Setup screen reads. Async, so it is answered off the same path /api/state
   * uses rather than the synchronous static branch below.
   */
  /* The machine's real Chrome profiles, for recognising which one a Reddit login lives in. */
  if (url.pathname === '/api/chrome/profiles') {
    return send(200, JSON.stringify(chromeProfiles()));
  }

  if (url.pathname === '/api/setup') {
    setupStatus()
      .then((s) => send(200, JSON.stringify(s)))
      .catch((e) => send(500, JSON.stringify({ error: e && e.message ? e.message : String(e) })));
    return;
  }

  /**
   * This account's US Webshare proxies, for filling the exit form.
   *
   * Reads the stored key from the vault and asks Webshare with it — the KEY never comes in on the
   * request and never goes back out in the response. What DOES go back is the proxy list, proxy
   * credentials included, because auto-filling the exit form is the whole feature and the exit form
   * takes those credentials anyway; this response only reaches the localhost console. Each proxy
   * carries a suggested `timezone` (src/proxy/align.ts usZoneForCity) so the exit's city can be
   * copied straight onto the account's timezone.
   *
   * OPTIONAL end to end: a 400 with `noKey` means simply "store a key first", not that anything is
   * broken. The GET handler is not async, so this owns its own promise like /api/state does.
   */
  if (url.pathname === '/api/webshare/proxies') {
    if (!vaultApi || !webshareApi) {
      return send(503, JSON.stringify({ ok: false, error: 'the compiled build is missing — run npm run build' }));
    }
    const reason = vaultApi.vaultUnavailableReason();
    if (reason) return send(400, JSON.stringify({ ok: false, error: reason }));
    (async () => {
      const key = await vaultApi.getSecret(vaultApi.WEBSHARE_API_KEY);
      if (!key) return send(400, JSON.stringify({ ok: false, error: 'no Webshare key stored', noKey: true }));
      const proxies = await webshareApi.fetchUsProxies(key);
      return send(200, JSON.stringify({ ok: true, count: proxies.length, proxies }));
    })().catch((e) => send(400, JSON.stringify({ ok: false, error: e && e.message ? e.message : String(e) })));
    return;
  }

  if (url.pathname === '/api/state') {
    // The GET handler is not async (it serves static files synchronously), so the one route
    // that now awaits a database read owns its own promise rather than making every route pay.
    /* Which page of the review queue to assemble. Review cards are built HERE — each carries
       its certification, its thread and its assessment — so paging that list is a parameter of
       this response rather than a separate endpoint with nothing lighter to return. */
    buildState({ reviewOffset: url.searchParams.get('reviewOffset') })
      .then((state) => send(200, JSON.stringify(state)))
      .catch((e) => send(500, JSON.stringify({ error: String(e && e.message || e) })));
    return;
  }

  if (url.pathname === '/' || url.pathname === '/index.html') {
    const f = join(HERE, 'index.html');
    if (!existsSync(f)) return send(404, 'index.html missing', 'text/plain');
    return send(200, readFileSync(f), TYPES['.html']);
  }

  send(404, JSON.stringify({ error: 'not found' }));
});

/**
 * The banner used to say "read-only — no command surface exists in this server" and that
 * publishing needed a terminal. Both were false here — see the header — and this was the more
 * misleading of the two copies, because an operator reads it every launch and may size their
 * caution to it. It now states the actual surface and the actual boundary.
 */
server.listen(PORT, '127.0.0.1', () => {
  process.stdout.write(
    `redbot product console\n` +
    `  http://localhost:${PORT}\n` +
    `  Runs ${PUBLIC_ACTIONS.length} allow-listed actions and can publish a draft on a typed SEND.\n` +
    `  Bound to 127.0.0.1 and refuses cross-origin requests — there is no other guard.\n` +
    `  Ctrl+C to stop.\n`
  );

  /**
   * Start pushing on this install's own schedule.
   *
   * Silent when unconfigured — no endpoint or no token means `trigger()` returns null and nothing
   * is logged, because an operator who has not set up a dashboard should see no evidence that one
   * exists. Configuration is re-read on every trigger, so pasting a token on the Setup screen
   * starts it working on the next tick without a restart.
   */
  if (pushSchedulerApi) {
    try {
      pushScheduler = pushSchedulerApi.createScheduler({
        log: (line) => process.stdout.write(`  ${line}\n`)
      });
      pushScheduler.start();
      /* On start, so the dashboard learns this install is alive without waiting a full interval. */
      pushScheduler.trigger('start');
    } catch (e) {
      process.stdout.write(`  push scheduler unavailable: ${e && e.message ? e.message : e}\n`);
    }
  }
});

/**
 * A last push on the way out, so the dashboard's final view is not mid-session.
 *
 * Bounded: a shutdown must not hang on a network call, so this waits at most three seconds and
 * then exits regardless. The cursor is untouched by an abandoned push, so the events go next time.
 */
let shuttingDown = false;
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    if (shuttingDown) process.exit(0);
    shuttingDown = true;
    const done = () => process.exit(0);
    const bail = setTimeout(done, 3000);
    bail.unref?.();
    /* The relays go down with this process, and saying so is part of the design: a Chrome
       spawned detached outlives the console, so its pages start failing closed the moment the
       exit disappears. That is the chosen failure — see src/proxy/manager.ts — and it only holds
       if the listeners really do stop, which `close()` has to force because an upgraded CONNECT
       socket is invisible to the http server's own connection tracking. */
    Promise.resolve(alignApi?.stopAll())
      .catch(() => {})
      .then(() => relayApi?.stopAll())
      .catch(() => {})
      .then(() => pushScheduler?.trigger('quit'))
      .then(() => pushScheduler?.stop())
      .catch(() => {})
      .finally(() => { clearTimeout(bail); done(); });
  });
}

/**
 * The state the UI suite renders against.
 *
 * WHY A FIXTURE AND NOT THE DATABASE. The screen with the most to lose in a redesign is
 * Review — the verdict lens, the claims, the reply, the gates and the send flow. Against live
 * data that screen is EMPTY: `/api/state` reports 0 drafts and 0 certifications, so a suite
 * pointed at Postgres would assert nothing about the very thing most likely to break. This
 * fixture reaches states real data has never produced: all three verdicts, a draft checked
 * twice with a claim-count spread, and a draft the operator ignored.
 *
 * Shapes are copied from `buildState()` in server.mjs, field for field. If that function grows
 * a key this file does not have, the UI cannot be relying on it — which is the point.
 *
 * Timestamps are computed from a `now` handed in, so `ago()` renders the same words on every
 * run and the screenshots stay comparable.
 */

const iso = (now, minutesAgo) => new Date(now - minutesAgo * 60_000).toISOString();

/** A certification reason, in the shape the lens groups and truncates. */
const reason = (rule, claimId, detail) => ({ rule, claimId, detail });

export function makeState(now = Date.now(), over = {}) {
  const state = {
    generatedAt: new Date(now).toISOString(),

    collect: {
      from: 'database',
      unavailable: null,
      error: null,
      maxPerRun: 15,
      limitNote: 'Fifteen is the ceiling per place, per run.',
      subreddits: [
        { name: 'wordpress', why: 'Where the questions are.', enabled: true },
        { name: 'woocommerce', why: 'Checkout and payment faults.', enabled: true },
        { name: 'crm', why: 'Added from the console.', enabled: false }
      ],
      searches: [
        { query: 'mysql server has gone away wordpress', why: 'A fault with one cause.', enabled: true }
      ],
      /* Reddit's own casing on the left, the lower-cased lookup index on the right — the pair
         that pinned the "0 on file" defect. Both are asserted by the Threads test. */
      collected: { Wordpress: 16, WooCommerce: 9, CRM: 14, unknown: 3 },
      collectedByKey: { wordpress: 16, woocommerce: 9, crm: 14, unknown: 3 }
    },

    pulse: {
      waitingOnYou: 3,
      profilesProvisioned: 2,
      accountsInLogs: 2,
      published: 0,
      operatorDecisions: 7,
      regretReadings: 0,
      removals: 0
    },

    review: [
      {
        id: 'draft-reject-1',
        status: 'pending',
        workflow: { status: 'none' },
        title: 'Site dies on import — "MySQL server has gone away"',
        permalink: 'https://www.reddit.com/r/Wordpress/comments/aaa/import_dies/',
        body: 'That error is almost always the server closing the connection because a single '
            + 'packet exceeded max_allowed_packet, not a timeout. max_allowed_packet defaults to '
            + '64M. Since your host will not give you my.cnf, split the dump so no single '
            + 'statement is oversized.',
        createdAt: iso(now, 240),
        model: 'claude-opus-5',
        lintIssues: [],
        hasDisclosure: false,
        thread: {
          id: 'thread-aaa', title: 'Site dies on import — "MySQL server has gone away"',
          subreddit: 'Wordpress', author: 'stuck_on_staging',
          upvotes: 12, commentCount: 11, ageText: '4 hr ago', ageMinutes: 240,
          collectedAt: iso(now, 235),
          body: 'Every time I import our staging database the process dies about 40 seconds in '
              + 'with "MySQL server has gone away". Same dump file imports fine on my laptop.',
          permalink: 'https://www.reddit.com/r/Wordpress/comments/aaa/import_dies/',
          comments: [
            { author: 'helpful_dev', body: 'Sounds like a timeout, bump wait_timeout.', upvotes: 3, byOriginalPoster: false },
            { author: 'stuck_on_staging', body: 'Host will not let me touch my.cnf at all.', upvotes: 1, byOriginalPoster: true }
          ]
        },
        assessment: {
          verdict: 'contribute', score: 82,
          thesis: {
            whyThread: 'A specific, reproducible fault. Nothing in the thread names the packet limit yet.',
            whatNew: 'The 40-second mark rules out a timeout, which is what everyone has assumed.',
            whyNotSilent: '3 claims are on the thread and none of them close this gap.'
          },
          reasons: ['headroom 100; best fillable gap is "wrong-claim"']
        },
        certification: {
          verdict: 'REJECT',
          certifiedAt: iso(now, 12),
          model: 'claude-opus-5',
          claims: [
            { id: 'c1', text: 'max_allowed_packet defaults to 64M' },
            { id: 'c2', text: 'The error indicates the server closed the connection' },
            { id: 'c3', text: 'Splitting the dump avoids the oversized statement' },
            { id: 'c4', text: 'The 40-second mark is not a timeout' },
            { id: 'c5', text: 'Managed hosts commonly withhold my.cnf' },
            { id: 'c6', text: 'Imports can be split without data loss' }
          ],
          contradictions: [{ claimId: 'c1', fatal: true, detail: 'Refuted by primary documentation.' }],
          epistemic: [], invalidated: [{ claimId: 'c3' }], resolution: null,
          reasons: [
            reason('fatal-contradiction', 'c1',
              'The default is 16M on the 5.7 line the asker\'s host reports, and 64M only from '
              + '8.0.3 onward. dev.mysql.com documents both, and the claim is load-bearing for '
              + 'the advice that follows it.'),
            reason('invalidated-dependency', 'c3',
              'The recommendation rests on the refuted packet default. With the real limit the '
              + 'split size named here is wrong.'),
            reason('overconfident-language', 'c4',
              'Stated as fact where the evidence is an inference from one timing observation.'),
            reason('no-provenance', 'c5', 'Nothing backs this beyond common practice.'),
            reason('unrefuted-falsifiable-claim', 'c6', 'Nobody attacked it, so it marked its own homework.')
          ],
          fatal: 1
        },
        certificationRuns: 2,
        /* A draft checked twice with a different claim count each time — the stability panel. */
        stability: {
          runs: 2, claimsMin: 6, claimsMax: 9, claims: [6, 9],
          fatalMin: 1, fatalMax: 1, verdicts: ['REJECT'], verdictStable: true
        },
        publishCommand: 'REDBOT_OPERATOR=<you> node dist/cli.js reply draft-reject-1'
      },
      {
        id: 'draft-escalate-2',
        status: 'pending',
        workflow: { status: 'read' },
        title: 'Checkout intermittently 502s under load',
        permalink: 'https://www.reddit.com/r/woocommerce/comments/bbb/checkout_502/',
        body: 'A 502 under load with no pattern in the access log usually means PHP-FPM ran out '
            + 'of children. Check pm.max_children against your memory ceiling.',
        createdAt: iso(now, 660),
        model: 'claude-opus-5',
        lintIssues: ['reads like a template in the second sentence'],
        hasDisclosure: false,
        thread: {
          id: 'thread-bbb', title: 'Checkout intermittently 502s under load',
          subreddit: 'woocommerce', author: 'shop_owner_44',
          upvotes: 5, commentCount: 4, ageText: '11 hr ago', ageMinutes: 660,
          collectedAt: iso(now, 650),
          body: 'Checkout throws a 502 maybe one time in twenty, only when we are busy.',
          permalink: 'https://www.reddit.com/r/woocommerce/comments/bbb/checkout_502/',
          comments: [
            { author: 'plugin_guy', body: 'Probably a plugin conflict, disable them one by one.', upvotes: 2, byOriginalPoster: false }
          ]
        },
        assessment: {
          verdict: 'contribute', score: 74,
          thesis: {
            whyThread: 'Two answers, both guessing at plugins. Nobody asked for the log.',
            whatNew: 'Names the one measurement that separates the causes.',
            whyNotSilent: 'No claim on the thread closes this.'
          },
          reasons: ['headroom 88; best fillable gap is "missing-diagnostic"']
        },
        certification: {
          verdict: 'ESCALATE',
          certifiedAt: iso(now, 30),
          model: 'claude-opus-5',
          claims: [{ id: 'd1' }, { id: 'd2' }, { id: 'd3' }, { id: 'd4' }],
          contradictions: [], epistemic: [{ claimId: 'd2' }], invalidated: [], resolution: null,
          reasons: [
            reason('falsifiable-claim-weak-evidence', 'd1',
              'No corpus has standing over PHP-FPM sizing, so the claim cannot be settled here.'),
            reason('low-confidence-as-fact', 'd2', 'A guess written in the voice of a fact.')
          ],
          fatal: 0
        },
        certificationRuns: 1,
        stability: null,
        publishCommand: 'REDBOT_OPERATOR=<you> node dist/cli.js reply draft-escalate-2'
      },
      {
        id: 'draft-certified-3',
        status: 'pending',
        workflow: { status: 'none' },
        title: 'Why does wp_options keep growing?',
        permalink: 'https://www.reddit.com/r/Wordpress/comments/ccc/wp_options/',
        body: 'Almost always transients that never expire because the site has no cron running. '
            + 'Look at how many rows have an _transient_timeout_ prefix.',
        createdAt: iso(now, 1440),
        model: 'claude-opus-5',
        lintIssues: [],
        hasDisclosure: false,
        thread: {
          id: 'thread-ccc', title: 'Why does wp_options keep growing?',
          subreddit: 'Wordpress', author: 'db_curious',
          upvotes: 30, commentCount: 8, ageText: '1 d ago', ageMinutes: 1440,
          collectedAt: iso(now, 1400),
          body: 'wp_options is 400MB. Is that normal?',
          permalink: 'https://www.reddit.com/r/Wordpress/comments/ccc/wp_options/',
          comments: []
        },
        assessment: null,
        certification: {
          verdict: 'CERTIFIED',
          certifiedAt: iso(now, 90),
          model: 'claude-opus-5',
          claims: [{ id: 'e1' }, { id: 'e2' }, { id: 'e3' }, { id: 'e4' }, { id: 'e5' }, { id: 'e6' }],
          contradictions: [], epistemic: [], invalidated: [], resolution: null,
          reasons: [],
          fatal: 0
        },
        certificationRuns: 1,
        stability: null,
        publishCommand: 'REDBOT_OPERATOR=<you> node dist/cli.js reply draft-certified-3'
      },
      {
        /* Ignored: must be HIDDEN by default and revealed by the toggle. */
        id: 'draft-ignored-4',
        status: 'pending',
        workflow: { status: 'ignored' },
        title: 'Which page builder should I use in 2026?',
        permalink: 'https://www.reddit.com/r/Wordpress/comments/ddd/builder/',
        body: 'Preference question — nothing here can be checked against documentation.',
        createdAt: iso(now, 2880),
        model: 'claude-opus-5',
        lintIssues: [],
        hasDisclosure: false,
        thread: null,
        assessment: null,
        certification: null,
        certificationRuns: 0,
        stability: null,
        publishCommand: 'REDBOT_OPERATOR=<you> node dist/cli.js reply draft-ignored-4'
      }
    ],

    argus: {
      runs: 4, draftsChecked: 3,
      byVerdict: { REJECT: 2, ESCALATE: 1, CERTIFIED: 1 },
      everCertified: true,
      topReasons: [
        { rule: 'fatal-contradiction', n: 2 },
        { rule: 'no-provenance', n: 2 },
        { rule: 'overconfident-language', n: 1 }
      ],
      draftsCheckedTwice: 1,
      claimSpread: [[6, 9]]
    },

    discovery: {
      threadsCollected: 48,
      assessed: 16,
      contribute: 9,
      skip: 7,
      gapsAnalysed: 16,
      drafted: 3,
      items: [
        {
          threadId: 'thread-aaa', title: 'Site dies on import — "MySQL server has gone away"',
          permalink: 'https://www.reddit.com/r/Wordpress/comments/aaa/import_dies/',
          verdict: 'contribute', score: 82,
          thesis: { whatNew: 'The 40-second mark rules out a timeout.' },
          reasons: ['headroom 100'],
          subreddit: 'Wordpress', comments: 11, ageText: '4 hr ago',
          draftId: 'draft-reject-1', draftStatus: 'pending'
        },
        {
          threadId: 'thread-bbb', title: 'Checkout intermittently 502s under load',
          permalink: 'https://www.reddit.com/r/woocommerce/comments/bbb/checkout_502/',
          verdict: 'contribute', score: 74,
          thesis: { whatNew: 'Names the one measurement that separates the causes.' },
          reasons: ['headroom 88'],
          subreddit: 'woocommerce', comments: 4, ageText: '11 hr ago',
          draftId: 'draft-escalate-2', draftStatus: 'pending'
        },
        {
          threadId: 'thread-ddd', title: 'Which page builder should I use in 2026?',
          permalink: 'https://www.reddit.com/r/Wordpress/comments/ddd/builder/',
          verdict: 'skip', score: 11,
          thesis: { whatNew: '' },
          reasons: ['preference, not a fault — nothing here can be checked against documentation'],
          subreddit: 'Wordpress', comments: 31, ageText: '2 d ago',
          draftId: null, draftStatus: null
        },
        {
          threadId: 'thread-eee', title: 'Fixed it! Posting in case it helps someone',
          permalink: 'https://www.reddit.com/r/Wordpress/comments/eee/fixed/',
          verdict: 'skip', score: 0,
          thesis: { whatNew: '' },
          reasons: ['certification stops before claim extraction on a resolved thread'],
          subreddit: 'Wordpress', comments: 8, ageText: '3 d ago',
          draftId: null, draftStatus: null
        }
      ]
    },

    accounts: [
      {
        handle: 'docs-architect', configured: true,
        role: 'docs engineer',
        speaks: 'WordPress internals, MySQL and managed hosting',
        knows: ['wordpress', 'mysql'], subreddits: ['WordPress', 'Wordpress_Help'],
        timezone: 'Europe/London', quietHours: [23, 7], dailyCeiling: 4,
        profileDir: 'chrome-profile-a', debugPort: 9222, note: null,
        profileExists: true,
        karma: 212, karmaMeasuredAt: iso(now, 2880), karmaVector: 'comment',
        karmaNote: 'measured by probe-karma from the profile page',
        observations: 6, published: 0, stage: 'established'
      },
      {
        handle: 'sgen-support', configured: true,
        role: 'support engineer',
        speaks: 'WooCommerce, checkout and payment gateways',
        knows: ['woocommerce'], subreddits: ['woocommerce'],
        timezone: 'Europe/London', quietHours: [22, 7], dailyCeiling: 2,
        profileDir: 'chrome-profile-b', debugPort: 9223, note: null,
        profileExists: false,
        karma: 1, karmaMeasuredAt: iso(now, 60), karmaVector: 'comment',
        karmaNote: 'measured by probe-karma from the profile page',
        observations: 3, published: 0, stage: 'warming'
      }
    ],

    profiles: ['chrome-profile-a', 'chrome-profile-b'],

    accountRules: [
      'Never both accounts in the same thread.',
      'No links and no product names while warming up.'
    ],

    newAccount: {
      /* Display-only in the wizard; kept relative so this fixture is machine-independent. */
      dataDir: 'data',
      nextPort: 9224,
      takenPorts: [9222, 9223],
      takenDirs: ['chrome-profile-a', 'chrome-profile-b'],
      suggestedDir: 'chrome-profile-c'
    },

    outcomes: {
      published: 0,
      observations: [
        { ts: iso(now, 60), account: 'sgen-support', kind: 'karma', value: 1, vector: 'comment',
          note: 'measured by probe-karma from the profile page' },
        { ts: iso(now, 2880), account: 'docs-architect', kind: 'karma', value: 212, vector: 'comment',
          note: 'measured by probe-karma from the profile page' }
      ],
      reviews: 7,
      regret: 0,
      blockedBy: 'nothing has been published'
    },

    activity: [
      { ts: iso(now, 12), kind: 'certify', summary: 'draft-reject-1 → REJECT (1 fatal)' },
      { ts: iso(now, 30), kind: 'certify', summary: 'draft-escalate-2 → ESCALATE' },
      { ts: iso(now, 240), kind: 'draft', summary: 'wrote a reply for thread-aaa' }
    ],

    sources: [
      { file: 'postgres: redbot', exists: true,
        detail: '48 threads, 4 drafts, 16 gap analyses, 16 assessments, 4 certifications, '
              + '3 history, 2 observations, 7 reviews, 0 regret' },
      { file: 'accounts (redbot.accounts)', exists: true, detail: '2 configured' },
      { file: 'sources (redbot.sources)', exists: true, detail: '3 subreddit(s), 1 search(es)' },
      { file: 'data/ui-status.json', exists: true, bytes: 93, modified: iso(now, 5000) }
    ]
  };

  return { ...state, ...over };
}

/**
 * What `/api/setup` answers on a HALF-configured install: machine ready, an operator registered
 * but not signed in, the API path chosen with no key stored. Deliberately not the happy path —
 * the Setup screen exists to name what is missing, and a fixture where nothing is missing
 * cannot exercise that at all.
 *
 * `secrets` carries a hint and never a value, mirroring the server: if a value ever appears in
 * this payload, the test that reads it should fail.
 */
export const SETUP = {
  database: { ok: true, reason: null },
  vault: { ok: true, reason: null, keyId: 'abc123def456' },
  secrets: [],
  secretsError: null,
  apiKeyName: 'anthropic_api_key',
  apiKeyStored: false,
  apiKeyFromEnv: false,
  provider: 'api',
  providerFromEnv: null,
  operators: [
    { name: 'dan', shared: false, ready: true, note: '' },
    { name: 'not-signed-in', shared: false, ready: false, note: '' }
  ],
  selectedOperator: 'dan',
  operatorReady: true
};

/**
 * The machine's everyday Chrome profiles, as `/api/chrome/profiles` reports them.
 *
 * Two profiles deliberately share a display name — that is the real case that makes the email
 * necessary rather than decorative, and a fixture where every name is unique would never
 * exercise it. `usableForAutomation` is false for the reason the server documents: Chrome
 * refuses remote debugging on the everyday data folder.
 */
/**
 * What is on each account's debugging port, as `/api/ports` reports it.
 *
 * Two accounts, two DIFFERENT answers on purpose: one browser running normally, and one port
 * held by something that is not ours. The second is the case the screen exists for — a port
 * that answers the debugging protocol but belongs to another program reads as a healthy
 * browser to anything that only checks reachability, and redbot would drive it. On the
 * development machine that was Lenovo Vantage's Edge WebView on 9222; the vendor path here is
 * generic so the fixture describes the SHAPE rather than one person's laptop.
 */
const FOREIGN_DIR = 'C:\\Program Files\\SomeVendor\\WebView\\EBWebView';

export const PORTS = {
  at: '2026-07-28T12:00:00.000Z',
  suggestion: 9225,
  ports: [
    {
      handle: 'docs-architect', port: 9222, state: 'running', ours: true, pid: 4242,
      process: 'chrome.exe', browser: 'Chrome/140.0.0.0', profileOnDisk: true,
      detail: "Chrome/140.0.0.0 is running on 9222 with this account's own sign-in folder."
    },
    {
      handle: 'sgen-support', port: 9223, state: 'foreign', ours: false, pid: 11640,
      process: 'msedgewebview2.exe', profileOnDisk: false, userDataDir: FOREIGN_DIR,
      detail: `Port 9223 is held by msedgewebview2.exe (pid 11640) using ${FOREIGN_DIR}`
            + " — not this account's browser. Driving it would read Reddit signed out."
    }
  ]
};

export const CHROME_PROFILES = {
  available: true,
  reason: null,
  lastUsed: 'Default',
  usableForAutomation: false,
  whyNotUsable: 'Chrome refuses remote debugging on your everyday profile, so redbot would attach to an empty one and read Reddit signed out. It signs in through its own window instead.',
  profiles: [
    { directory: 'Default', name: 'work', email: 'someone@example.com', onDisk: true },
    { directory: 'Profile 1', name: 'work', email: 'other@example.com', onDisk: true },
    { directory: 'Profile 2', name: 'personal', email: null, onDisk: true }
  ]
};

export const OPERATORS = {
  operators: [
    { name: 'dan', shared: false, ready: true, note: '' },
    { name: 'shared-box', shared: true, ready: true, note: 'bills this machine' }
  ],
  selected: 'dan',
  selectedRegistered: true,
  selectedShared: false,
  selectedReady: true
};

export function makePulse(now = Date.now(), over = {}) {
  return {
    at: new Date(now).toISOString(),
    running: null,
    browsers: [
      { handle: 'docs-architect', port: 9222, browserUp: true, detail: 'Chrome/141', profileOnDisk: true },
      { handle: 'sgen-support', port: 9223, browserUp: false, detail: 'no debugging port answered', profileOnDisk: false }
    ],
    problems: ['sgen-support: its browser folder is missing'],
    auto: { running: false, account: null, everyMinutes: null, startedAt: null, log: [] },
    healthy: false,
    ...over
  };
}

export const RUN_LOG_IDLE = {
  runId: 7, key: 'check-karma', command: 'redbot probe-karma',
  startedAt: new Date(0).toISOString(),
  running: false, done: true, code: 0, dropped: 0,
  total: 3,
  lines: [
    { at: 120, text: 'attaching to chrome-profile-a on 9222' },
    { at: 900, text: 'karma 212' },
    { at: 950, text: 'recorded one observation' }
  ]
};

export const RUN_HISTORY = {
  keep: 500,
  runs: [
    { file: '2026-07-28T09-00-00-000Z__000007.jsonl', id: 7, key: 'check-karma',
      command: 'redbot probe-karma', startedAt: '2026-07-28T09:00:00.000Z',
      done: true, code: 0, lines: 3 },
    { file: '2026-07-28T08-00-00-000Z__000006.jsonl', id: 6, key: 'find-threads',
      command: 'redbot read wordpress', startedAt: '2026-07-28T08:00:00.000Z',
      done: false, code: null, lines: 44 }
  ]
};

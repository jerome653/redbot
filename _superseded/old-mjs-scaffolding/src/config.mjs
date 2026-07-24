/**
 * Configuration loader.
 *
 * Precedence: env var > config.json > default.
 *
 * HARD RULE, inherited from the Appilot teardown: no credential is ever written to
 * a file in this repo or compiled into any artifact. Keys and account tokens come from
 * the environment only. `config.json` holds behaviour, never secrets.
 */
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const DEFAULTS = {
  /* which source adapter feeds the scout */
  source: 'fixture',                    // 'fixture' | 'reddit'

  /* which publisher sends approved replies */
  publisher: 'manual',                  // 'manual' (export for a human) | 'reddit' (auto-post)

  /* what we are listening to */
  subreddits: ['wordpress'],
  lookbackHours: 24,
  maxPostsPerScan: 40,

  /* engagement scoring weights — see src/score.mjs */
  scoring: {
    upvoteWeight: 1.0,
    commentWeight: 2.5,                 // a comment signals more thread life than an upvote
    velocityHalfLifeHours: 6,           // recency decay
    tierBreaks: { tier1: 70, tier2: 40 } // >=70 T1, 40-69 T2, <40 T3
  },

  /* tier -> minutes to wait after approval before the reply goes out */
  tierDelayMinutes: { 1: 5, 2: 30, 3: 60 },

  /* models. Qualification is high-volume and cheap; drafting is low-volume and hard. */
  models: {
    qualify: 'claude-haiku-4-5-20251001',
    draft: 'claude-sonnet-5',
    maxRetries: 3
  },

  /* the only identity claim the drafter is allowed to make */
  disclosure: {
    org: 'SGEN',
    /* Appended verbatim by the drafter when the reply mentions SGEN at all.
       FTC 16 CFR 255 — undisclosed material connection is the actual legal exposure. */
    line: 'Disclosure: I work on SGEN.'
  },

  /* Accounts that replies are posted from. Credentials are NEVER here — this holds only
     the label and the ENV VAR NAMES to read the refresh token from.
       { "id": "u_sgen_dev", "handle": "sgen_dev", "tokenEnv": "REDDIT_TOKEN_SGEN_DEV" } */
  accounts: [],

  /* Per-account posting limits. These exist because unlimited posting is how an account
     dies, not because of any policy nicety. Enforced in src/ledger.mjs. */
  rateLimits: {
    perAccountPerHour: 2,
    perAccountPerDay: 8,
    perSubredditPerAccountPerDay: 4,
    minMinutesBetweenPosts: 25,
    quietHoursLocal: [1, 7]             // no posts between 01:00 and 07:00 account-local
  },

  /* auto-post safety rails */
  autoPost: {
    enabled: false,                     // flip to true, or --auto on the CLI
    requireApproval: true,              // false = post without a human ever seeing it
    dryRun: true                        // true = log the call, do not send it
  },

  /* thresholds */
  minScoreToDraft: 25,                  // below this we record but do not spend a draft call

  /* server */
  port: 7880,
  host: '127.0.0.1'
};

function deepMerge(base, over) {
  if (!over || typeof over !== 'object' || Array.isArray(over)) return over ?? base;
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(over)) {
    out[k] = k in out && typeof out[k] === 'object' && !Array.isArray(out[k])
      ? deepMerge(out[k], v)
      : v;
  }
  return out;
}

export function loadConfig(overrides = {}) {
  let file = {};
  const path = join(ROOT, 'config.json');
  if (existsSync(path)) {
    try {
      file = JSON.parse(readFileSync(path, 'utf8'));
    } catch (e) {
      throw new Error(`config.json is not valid JSON: ${e.message}`);
    }
  }
  const cfg = deepMerge(deepMerge(DEFAULTS, file), overrides);

  if (process.env.SCOUT_SOURCE) cfg.source = process.env.SCOUT_SOURCE;
  if (process.env.SCOUT_PUBLISHER) cfg.publisher = process.env.SCOUT_PUBLISHER;
  if (process.env.SCOUT_PORT) cfg.port = Number(process.env.SCOUT_PORT);
  if (process.env.SCOUT_SUBREDDITS) {
    cfg.subreddits = process.env.SCOUT_SUBREDDITS.split(',').map((s) => s.trim()).filter(Boolean);
  }

  /* secrets: env only, never persisted. Account tokens are resolved by name so that
     adding an account is a config edit and a new env var, never a file containing a token. */
  cfg.secrets = {
    anthropicKey: process.env.ANTHROPIC_API_KEY || null,
    redditClientId: process.env.REDDIT_CLIENT_ID || null,
    redditClientSecret: process.env.REDDIT_CLIENT_SECRET || null,
    redditUserAgent: process.env.REDDIT_USER_AGENT || `sgen-reddit-scout/0.1 (by /u/${cfg.accounts[0]?.handle ?? 'unknown'})`
  };

  cfg.accounts = (cfg.accounts || []).map((a) => ({
    ...a,
    refreshToken: a.tokenEnv ? (process.env[a.tokenEnv] || null) : null
  }));

  return cfg;
}

/** Accounts that actually have a usable token right now. */
export function liveAccounts(cfg) {
  return cfg.accounts.filter((a) => a.refreshToken);
}

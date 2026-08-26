#!/usr/bin/env node
/**
 * redbot — assists a human engaging on Reddit through a real browser session.
 *
 * One account. One browser profile. Local files. Nothing is posted without a human
 * approving it first, and nothing is posted at all unless every gate in src/gates.ts passes.
 */
import { login } from './commands/login.js';
import { operators } from './commands/operators.js';
import { vault } from './commands/vault.js';
import { proxy } from './commands/proxy.js';
import { accounts } from './commands/accounts.js';
import { reset } from './commands/reset.js';
import { sources } from './commands/sources.js';
import { probeKarma } from './probe-karma.js';
import { primeAccounts, selectedAccount } from './config.js';
import { read } from './commands/read.js';
import { search } from './commands/search.js';
import { subreddits } from './commands/subreddits.js';
import { post } from './commands/post.js';
import { draft } from './commands/draft.js';
import { reply } from './commands/reply.js';
import { history } from './commands/history.js';
import { session } from './commands/session.js';
import { observe } from './commands/observe.js';
import { opportunity } from './commands/opportunity.js';
import { doctor } from './commands/doctor.js';
import { push, pull } from './commands/push.js';
import { tokens } from './commands/tokens.js';
import { backupCmd } from './commands/backup.js';
import { regret } from './commands/regret.js';
import { certifyCmd } from './commands/certify.js';
import { auto } from './commands/auto.js';
import { warmup } from './commands/warmup.js';
import { jobList, jobAdd, jobCancel, work } from './commands/job.js';
import {
  healthCmd, metricsCmd, policyCmd, selectCmd, reviewCmd, reportCmd, insightsCmd
} from './commands/status.js';
import { say } from './log.js';
import { provision, describeProvision } from './provision.js';
import { beginRunLog, endRunLog } from './run-log.js';
import { pathToFileURL } from 'node:url';

const USAGE = `
redbot — Reddit engagement assistant

  Reading
    redbot login                 confirm the browser session
    redbot operators [add <name>]
                                 who can run redbot, and whose Claude login pays
    redbot accounts [list|use <handle>|import|export]
                                 who redbot may post as (the database is the record)
    redbot sources [add|rm|on|off|import|export]
                                 where redbot looks for threads (the database is the record)
    redbot vault [list|check]    what secrets are stored, encrypted, in the database
    redbot vault set <name>      store one — piped in, never typed as an argument
    redbot vault rm <name>       remove one
    redbot proxy vet             check an exit address before an account signs in through it
                                 (proxy read from REDBOT_PROXY_HOST/PORT/USER/PASS)
    redbot session [--kind short|medium] [--sub <name>]
                                 one human-shaped browsing session (reads only)
    redbot read <subreddit> [--sort new|hot|top|rising]
                                 collect threads from a subreddit (default: new — a reply on a
                                 thread past 72h is refused, and hot is mostly older than that)
    redbot search "<query>" [--time hour|day|week|month|year|all]
                                 search Reddit and PREVIEW the results — collects nothing
                                 (default: week; with no window Reddit searches ALL TIME)
    redbot search --commit <n,n|all>
                                 collect only the ones you picked from that preview
    redbot subreddits "<topic>"  find COMMUNITIES to read, and PREVIEW them — adds nothing
    redbot subreddits --commit <n,n|all>
                                 add only the ones you picked as sources
    redbot reset [--scope work|all] [--sign-ins] [--yes]
                                 put this install back to a known state — prints the plan and
                                 removes NOTHING without --yes. work = the corpus and what was
                                 derived from it; all = the logs, accounts and sources too. The
                                 signed-in Chrome folders are kept unless --sign-ins is given.

  Deciding
    redbot opportunity [--all] [--force] [--limit N] [--only <id>]
                                 what each discussion is missing, then contribute-or-skip
    redbot select [--all]        rank assessed threads against the pilot criteria
    redbot draft [threadId]      draft against a gap; the model may decline
    redbot warmup [--dry]        draft ONE short warming comment for a new account —
                                 picks a young thread, holds the 2-4/day pace, refuses
                                 links and product names. Saves a draft; sends nothing.

  Unattended — everything except the decision
    redbot auto [--once] [--every <minutes>]
                                 collect -> score -> draft -> fact-check, on a loop.
                                 Respects quiet hours and the daily ceiling. NEVER publishes.

  The queue — every action becomes a job, per account
    redbot job list [--account <handle>] [--state <state>]
                                 what is queued, scheduled, waiting or done
    redbot job add <kind> [--account <handle>] [--at <iso>] [--after <jobId>]
                                 queue one action. A publish kind stops at
                                 "waiting" — the machine will not send it.
    redbot job cancel <id> [--account <handle>]
                                 binding: a cancelled job is never revived
    redbot work [--account <handle>] [--every <minutes>|--loop]
                                 run that account's queue — one pass, or on a
                                 loop. NEVER publishes.

  Certifying — truth before prose
    redbot certify [draftId] [--override]
                                 Argus: claims, evidence, contradictions
                                 -> CERTIFIED | ESCALATE | REJECT

  Publishing — needs a real terminal
    redbot post <subreddit> --title "<t>" [--body "<b>"]
                                 create a post — your words, gates, typed SEND
    redbot reply [draftId] [--quick]
                                 gates, human approval, then publish

  After
    redbot observe [draftId] [--checkpoint immediate|1h|24h|7d]
                                 what happened to a published reply
    redbot regret [draftId]      the two questions only a person can answer —
                                 "would you post this yourself?" and, 24h on,
                                 "would you still put your name on it?"

  Diagnosis
    redbot probe-karma           measure the signed-in account's karma, and record it
    redbot provision             what this install creates for itself, and where
    redbot doctor                is the INSTALL sound? build, auth, data, secrets, staleness
    redbot insights              where the pipeline is losing candidates, and which stage to fix
    redbot health [account]      is the ACCOUNT sound? karma, removals, cooldowns
    redbot metrics [--json]      reliability metrics from the activity log
    redbot review                operator decisions, by reason
    redbot report                regenerate every report in reports/
    redbot policy                every operational limit and where it came from
    redbot history [n]           the local activity log
    redbot backup [--list|--verify]
                                 snapshot data/ outside the working tree (evidence only)

Flow:  session/read -> opportunity -> select -> draft -> certify -> reply -> observe

Environment:
  REDBOT_OPERATOR              which operator's Claude credentials to use
  ANTHROPIC_API_KEY            required when REDBOT_LLM=api
  REDBOT_SEED                  replay a session's timings
`;

/**
 * The only flags that take a value in the `--flag value` (space-separated) form. Every other
 * `--flag` is boolean.
 *
 * This set is load-bearing: without it the parser cannot tell `--quick d_target` (a boolean
 * flag followed by a positional) from `--kind medium` (a value flag and its value), so it
 * treated the token after ANY flag as consumed and silently dropped the positional. For
 * `reply --quick d_target` that meant `d_target` vanished and `reply` published the latest
 * pending draft instead of the one named — a human approving specific text, sent to the wrong
 * comment. See the evaluation's H8.
 */
export const VALUE_FLAGS = new Set([
  'kind', 'sub', 'checkpoint', 'limit', 'every', 'commit',
  // job/queue flags. `account` matters most: omitting it here would make
  // `redbot job list --account docs-architect` read "docs-architect" as a positional filter
  // and then act on whatever REDBOT_ACCOUNT happened to be — the wrong queue, silently.
  // `time` is `redbot search "<q>" --time week`. Omitted here it would leak back into
  // `positional` and become the QUERY — the same parser bug this set exists to fix.
  'account', 'state', 'at', 'after', 'attempts', 'note', 'sort', 'time',
  'permalink', 'direction', 'target', 'query', 'subreddit', 'title', 'body',
  // `--approval-id` carries the console's single-use SEND token to `post`. Omitted here it would
  // leak into `positional` and, worse, be read by `post` as the SUBREDDIT — the D-10 class.
  'approval-id',
  'draft', 'thread', 'comment',
  // `redbot sources add --search "<query>" --why "<reason>"`. Both take a value in space form,
  // so both must be here or their values leak back into `positional` — the same parser bug
  // this set was created to fix.
  'search', 'why',
  /**
   * Found by the 2026-08-14 audit, all four the same D-10 shape.
   *
   * `redbot push --batch 50` left "50" as the first positional, which `push` reads as its
   * SUBCOMMAND — so the flag's value silently became the verb. `redbot tokens --label x`,
   * `--share-from` and `--admin-token-file` do the same to `tokens`. The forward direction is
   * now derived from the source by a test, so the next one cannot be forgotten instead of
   * remembered.
   */
  'batch', 'label', 'share-from', 'admin-token-file',
  // `redbot vault set <name> --scope <operator>`. This one currently works either way, because
  // `vault` reads its positionals before the flag — but that is an accident of argument order,
  // not a property of the parser, and the next command to take --scope would not be so lucky.
  'scope',
  /**
   * `redbot opportunity --only <id>`, and every flag `proxy vet` documents.
   *
   * MEASURED 2026-08-11, and this one reaches a WRITE. `redbot proxy vet --country US` printed
   * "The check passed but US could not be bound to it: \"US\" is not a configured account" —
   * because `flagValue()` reads the token after `--country` regardless of this set, so the value
   * applied, while `positional` only drops a token whose predecessor is IN this set. `US` therefore
   * stayed positional and became the ACCOUNT HANDLE. A handle is what makes `proxy vet` BIND, so
   * that command's stated guarantee — "with no handle it only reports, nothing is written" — was
   * defeated by its own documented flags. `--samples 8 --hours 6` would make `8` the handle.
   *
   * It failed safe only because no account happens to be named "US". That is luck, not a design.
   */
  'only', 'country', 'region', 'samples', 'hours'
]);

export interface ParsedArgs {
  flags: Set<string>;
  positional: string[];
  flagValue: (name: string) => string | undefined;
}

/** Pure argument parser, exported so the value-flag boundary is unit-testable. */
export function parseCliArgs(rest: string[]): ParsedArgs {
  const flags = new Set(rest.filter((a) => a.startsWith('--')));
  const args = rest.filter((a) => !a.startsWith('--'));

  /** `--kind medium` and `--kind=medium` both work. */
  const flagValue = (name: string): string | undefined => {
    const joined = [...flags].find((f) => f.startsWith(`--${name}=`));
    if (joined) return joined.slice(name.length + 3);
    const i = rest.indexOf(`--${name}`);
    const next = i >= 0 ? rest[i + 1] : undefined;
    return next && !next.startsWith('--') ? next : undefined;
  };

  // A token is a flag's VALUE (and therefore not a positional) only when its predecessor is a
  // value-taking flag written in space form (`--kind medium`). A boolean flag (`--quick`) and
  // an inline value (`--kind=medium`) both consume nothing, so the next token stays positional.
  const positional = args.filter((a) => {
    const i = rest.indexOf(a);
    if (i <= 0) return true;
    const prev = rest[i - 1];
    const consumes = !!prev && prev.startsWith('--') && !prev.includes('=') && VALUE_FLAGS.has(prev.slice(2));
    return !consumes;
  });

  return { flags, positional, flagValue };
}

async function main(): Promise<number> {
  const [cmd, ...rest] = process.argv.slice(2);
  const { flags, positional, flagValue } = parseCliArgs(rest);

  /**
   * Build whatever this install is missing, BEFORE anything reads it.
   *
   * It has to be here rather than only in the Electron shell: `npm run redbot doctor` from a
   * terminal must keep working, and it is the command a person reaches for precisely when the
   * install is broken. Running it first means `primeAccounts()` below queries a database that
   * exists and is migrated, rather than failing and silently falling back to the seed file.
   *
   * Idempotent, and quiet on a healthy install — see src/provision.ts. Failures are collected
   * into the report rather than thrown: a provisioning problem must not stop `doctor` from
   * running and telling you about it.
   */
  const provisioned = await provision();
  if (cmd !== 'provision') {
    for (const note of provisioned.notes) say.warn(note);
  }

  /**
   * `accounts` is the system of record, but the readers of it are synchronous —
   * `config.browser` resolves which Chrome this run drives. Load them once, here, before any
   * command can ask. Fails soft: an unreachable database leaves data/accounts.json answering,
   * so `doctor` and the browser commands still work when the database is the thing that broke.
   */
  await primeAccounts();

  /**
   * An account nobody configured stops the run, here, before any command starts.
   *
   * This used to happen as a SIDE EFFECT: `config.browser` resolved at module load, and
   * resolving it called `selectedAccount()`, which throws on an unknown handle. Accounts now
   * come from Postgres and cannot be loaded before this module is evaluated, so that
   * resolution had to become lazy — and the refusal quietly went with it. A work pass as an
   * unknown account then ran to completion against whatever browser the ambient profile
   * points at and reported "Nothing eligible this pass" with exit 0, which is the worst
   * possible answer: it looks like success and it acted as the wrong person.
   *
   * So the check is explicit now rather than emergent. It runs for every command, before
   * dispatch, and fails closed.
   */
  selectedAccount();

  switch (cmd) {
    case 'login':   return login();
    case 'operators': return operators(positional[0], positional[1]);
    /**
     * The value is never a positional argument — see src/commands/vault.ts. `--scope` names an
     * operator so two people on one machine can hold different keys under the same name.
     */
    case 'vault':   return vault(positional[0], positional[1], flagValue('scope'));
    /**
     * `redbot proxy vet` — check an exit address BEFORE an account signs in through it.
     *
     * The proxy credential comes from the environment rather than from a flag, so there is no
     * `--pass` to read here: a password in a command line lands in shell history and in the
     * process list. See src/commands/proxy.ts.
     */
    case 'proxy':   return proxy(positional[0], {
      handle: positional[1],
      samples: flagValue('samples'),
      hours: flagValue('hours'),
      country: flagValue('country'),
      region: flagValue('region'),
      quick: flags.has('--quick')
    });
    /**
     * The product console's "Check it worked" button spawns `dist/cli.js probe-karma`.
     * Without this case it answered "Unknown command" and step 3 of the wizard was dead.
     */
    case 'probe-karma': return probeKarma();
    case 'accounts': return accounts(positional[0], positional[1]);
    /**
     * Destructive, so it prints the plan and stops unless `--yes` is given. `--sign-ins` is a
     * separate word from the scope because the Chrome folders are the only copy of each Reddit
     * session and no scope should be able to take them by implication.
     */
    case 'reset':   return reset({
      scope: flagValue('scope'), signIns: flags.has('--sign-ins'),
      yes: flags.has('--yes'), skipBackup: flags.has('--skip-backup')
    });
    /** `--search "<q>"` adds a saved search; a bare value is a subreddit. */
    case 'sources': return sources(positional[0], positional[1], { search: flagValue('search'), why: flagValue('why') });
    /* Sends only what the dashboard has not acknowledged. `push dry-run` builds and validates
       without transmitting, which is the safe first run on an install that has never pushed. */
    case 'push':    return push(positional[0], {
      only: flagValue('only'), batch: flagValue('batch'), force: flags.has('--force')
    });
    /* The receiving half of account sync. Uses the SHARE token, and changes nothing without
       --apply, because it writes to accounts a person set up by hand. */
    case 'pull':    return pull(positional[0], { apply: flags.has('--apply') });
    /* Mints this install's dashboard tokens. The admin token is read from a FILE and never
       stored — it belongs to the service, not to any install. */
    case 'tokens':  return tokens(positional[0], {
      adminTokenFile: flagValue('admin-token-file'),
      shareFrom: flagValue('share-from'),
      label: flagValue('label')
    });
    case 'read':    return read(positional[0], undefined, flagValue('sort'));
    case 'search':  return search(positional[0], undefined, flagValue('commit'), flagValue('time'));
    /* Communities, not threads — `search` finds posts. Same preview/commit contract. */
    case 'subreddits': return subreddits(positional[0], flagValue('commit'));
    /* The second write path. Title and body come from the person — see commands/post.ts. */
    case 'post':    return post(positional[0], { title: flagValue('title'), body: flagValue('body'), approvalId: flagValue('approval-id') });
    case 'draft':   return draft(positional[0]);
    case 'reply':   return reply(positional[0], { quick: flags.has('--quick') });
    case 'history': return history(positional[0]);

    case 'session': {
      const kind = flagValue('kind');
      const sub = flagValue('sub');
      return session({ ...(kind ? { kind } : {}), ...(sub ? { sub } : {}) });
    }
    case 'observe': {
      const checkpoint = flagValue('checkpoint');
      return observe(positional[0], checkpoint ? { checkpoint } : undefined);
    }

    case 'opportunity': {
      const limit = flagValue('limit');
      const only = flagValue('only');
      return opportunity({
        force: flags.has('--force'),
        /* `--all` turns the mechanical prefilter OFF for this run. It is separate from `--force`,
           which means "re-assess threads already assessed" — two different things whose names
           read alike. Neither touches the publish gates. */
        all: flags.has('--all'),
        ...(only ? { only: [only] } : {}),
        ...(limit && /^\d+$/.test(limit) ? { limit: Number(limit) } : {})
      });
    }

    case 'certify':  return certifyCmd(positional[0], { override: flags.has('--override') });

    /**
     * The queue. `job` is the noun surface the workstation drives; `work` is the engine.
     * Kept as one CLI so there is a single implementation of queue rules, whether the
     * operator is clicking in the console or typing here.
     */
    case 'job': {
      const sub = positional[0];
      const account = flagValue('account');
      if (sub === 'list' || sub === undefined) return jobList(account, flagValue('state'));
      if (sub === 'cancel') {
        if (!positional[1]) { say.fail('Which job? `redbot job cancel <id>`'); return 1; }
        return jobCancel(positional[1], account);
      }
      if (sub === 'add') {
        const kind = positional[1];
        if (!kind) { say.fail('Which kind? `redbot job add <kind> [--flags]`'); return 1; }
        // Flag names are mapped to the argument names the runners read, so the CLI surface
        // stays readable (`--thread abc`) without the runners inventing their own vocabulary.
        const map: Array<[string, string]> = [
          ['permalink', 'permalink'], ['direction', 'direction'], ['target', 'target'],
          ['query', 'query'], ['commit', 'commit'], ['subreddit', 'subreddit'],
          ['title', 'title'], ['body', 'body'], ['draft', 'draftId'], ['thread', 'threadId'],
          ['comment', 'commentId'], ['at', 'runAt'], ['after', 'after'],
          ['attempts', 'maxAttempts'], ['every', 'everyMinutes'], ['note', 'note'],
          ['sub', 'subreddit']
        ];
        const jobArgs: Record<string, string> = {};
        for (const [flag, key] of map) {
          const v = flagValue(flag);
          if (v !== undefined) jobArgs[key] = v;
        }
        if (flags.has('--unsave')) jobArgs.saved = 'false';
        if (flags.has('--unfollow')) jobArgs.following = 'false';
        return jobAdd(kind, jobArgs, account);
      }
      say.fail(`Unknown: redbot job ${sub}. Use list, add or cancel.`);
      return 1;
    }

    case 'work': {
      const every = Number(flagValue('every'));
      return work({
        ...(flagValue('account') ? { account: flagValue('account')! } : {}),
        ...(Number.isFinite(every) && every > 0 ? { everyMinutes: every } : {}),
        once: !flags.has('--loop') && !(Number.isFinite(every) && every > 0)
      });
    }
    case 'auto': {
      const every = Number(flagValue('every'));
      return auto({
        once: flags.has('--once'),
        ...(Number.isFinite(every) && every > 0 ? { everyMinutes: every } : {})
      });
    }
    case 'warmup':   return warmup({ dry: flags.has('--dry') });
    case 'regret':   return regret(positional[0]);
    /**
     * Show what provisioning found, without doing anything else.
     *
     * The work already happened above — every command provisions. This exists so the result is
     * INSPECTABLE: "did the installer set this machine up correctly" is a real question, and the
     * honest answer is a list of paths and states rather than the absence of an error.
     */
    case 'provision': {
      say.head('redbot provision');
      for (const line of describeProvision(provisioned)) say.step(line);
      const bad = provisioned.schema && !provisioned.schema.ok;
      if (bad) { say.fail('the schema is not usable — see above'); return 1; }
      say.ok('the install has everything redbot creates for itself');
      return 0;
    }

    case 'doctor':   return doctor();
    case 'backup':   return backupCmd({ list: flags.has('--list'), verify: flags.has('--verify') });
    case 'insights': return insightsCmd();
    case 'health':  return healthCmd(positional[0]);
    case 'metrics': return metricsCmd(flags.has('--json'));
    case 'review':  return reviewCmd();
    case 'report':  return reportCmd();
    case 'policy':  return policyCmd();
    case 'select':  return selectCmd(flags.has('--all'));

    case undefined:
    case 'help':
    case '--help':
    case '-h':
      console.log(USAGE);
      return 0;
    default:
      say.fail(`Unknown command: ${cmd}`);
      console.log(USAGE);
      return 1;
  }
}

/**
 * Run only when invoked as the program, never when imported (a unit test importing
 * `parseCliArgs` must not trigger `main()` and its `process.exit`).
 */
const invokedDirectly =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  /* A terminal run leaves the same record a console run does — see src/run-log.ts. It is opened
     before main() so the run's first line is captured, and closed on both exits so a failed run
     is as readable as a successful one. */
  beginRunLog(process.argv.slice(2));
  main()
    .then((code) => { endRunLog(code); process.exit(code); })
    .catch((e) => {
      say.fail(e instanceof Error ? e.message : String(e));
      endRunLog(1);
      process.exit(1);
    });
}

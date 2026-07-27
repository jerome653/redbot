#!/usr/bin/env node
/**
 * redbot — assists a human engaging on Reddit through a real browser session.
 *
 * One account. One browser profile. Local files. Nothing is posted without a human
 * approving it first, and nothing is posted at all unless every gate in src/gates.ts passes.
 */
import { login } from './commands/login.js';
import { operators } from './commands/operators.js';
import { read } from './commands/read.js';
import { search } from './commands/search.js';
import { draft } from './commands/draft.js';
import { reply } from './commands/reply.js';
import { history } from './commands/history.js';
import { session } from './commands/session.js';
import { observe } from './commands/observe.js';
import { opportunity } from './commands/opportunity.js';
import { doctor } from './commands/doctor.js';
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
import { pathToFileURL } from 'node:url';

const USAGE = `
redbot — Reddit engagement assistant

  Reading
    redbot login                 confirm the browser session
    redbot operators [add <name>]
                                 who can run redbot, and whose Claude login pays
    redbot session [--kind short|medium] [--sub <name>]
                                 one human-shaped browsing session (reads only)
    redbot read <subreddit>      collect threads from a subreddit
    redbot search "<query>"      search Reddit and PREVIEW the results — collects nothing
    redbot search --commit <n,n|all>
                                 collect only the ones you picked from that preview

  Deciding
    redbot opportunity [--force] [--limit N]
                                 what each discussion is missing, then contribute-or-skip
    redbot select [--all]        rank assessed threads against the pilot criteria
    redbot draft [threadId]      draft against a gap; the model may decline

  Unattended — everything except the decision
    redbot auto [--once] [--every <minutes>]
                                 collect -> score -> draft -> fact-check, on a loop.
                                 Respects quiet hours and the daily ceiling. NEVER publishes.

  Certifying — truth before prose
    redbot certify [draftId] [--override]
                                 Argus: claims, evidence, contradictions
                                 -> CERTIFIED | ESCALATE | REJECT

  Publishing — needs a real terminal
    redbot reply [draftId] [--quick]
                                 gates, human approval, then publish

  After
    redbot observe [draftId] [--checkpoint immediate|1h|24h|7d]
                                 what happened to a published reply
    redbot regret [draftId]      the two questions only a person can answer —
                                 "would you post this yourself?" and, 24h on,
                                 "would you still put your name on it?"

  Diagnosis
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
  'account', 'state', 'at', 'after', 'attempts', 'note', 'sort',
  'permalink', 'direction', 'target', 'query', 'subreddit', 'title', 'body',
  'draft', 'thread', 'comment'
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

  switch (cmd) {
    case 'login':   return login();
    case 'operators': return operators(positional[0], positional[1]);
    case 'read':    return read(positional[0], undefined, flagValue('sort'));
    case 'search':  return search(positional[0], undefined, flagValue('commit'));
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
      return opportunity({
        force: flags.has('--force'),
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
  main()
    .then((code) => process.exit(code))
    .catch((e) => {
      say.fail(e instanceof Error ? e.message : String(e));
      process.exit(1);
    });
}

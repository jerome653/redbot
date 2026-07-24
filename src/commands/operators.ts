/**
 * `redbot operators`              — who can run redbot, and whose Claude login pays
 * `redbot operators add <name>`   — set up a dedicated login folder for a new operator
 *
 * **Why this exists.** Every model call redbot makes is billed to a Claude login, and until
 * now there was exactly one way to choose which: the shell environment the process started in.
 * The console inherits that, so whoever launched the server paid for everything, invisibly.
 * The recorded exception in `operators.json` — operator `jerome` pointing at the machine-wide
 * `~/.claude` — was the honest, announced version of that, but it is still one shared wallet.
 *
 * A per-operator folder (`data/operators/<name>/claude`) gives each person their own login,
 * so a run can be billed to the person who triggered it. redbot never handles the password:
 * `operators add` prepares the folder and prints the two commands you run yourself, exactly as
 * `redbot login` never sees your Reddit password.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA, operatorsPath, listOperators, config } from '../config.js';
import type { OperatorRecord } from '../config.js';
import { say, record } from '../log.js';

/** letters, digits, dot, dash, underscore — same shape config.ts validates REDBOT_OPERATOR against */
const VALID = /^[a-z0-9][a-z0-9._-]{0,31}$/i;

function list(): number {
  say.head('redbot operators');
  const ops = listOperators();

  if (!ops.length) {
    say.warn('No operators registered.');
    say.step('Add one:  redbot operators add <name>');
    say.step('Until then every run needs REDBOT_OPERATOR set, or it refuses (fails closed).');
    return 0;
  }

  const active = config.llm.operator;
  for (const o of ops) {
    const mark = o.name === active ? '→' : ' ';
    const creds = o.shared
      ? 'shares this machine\'s login — bills whoever owns it'
      : o.ready
        ? 'own login, ready'
        : 'own folder, NOT signed in yet';
    say.step(`${mark} ${o.name.padEnd(16)} ${creds}`);
    if (o.note) say.step(`    ${o.note}`);
  }

  say.step('');
  say.step(active
    ? `Active this shell: ${active} (REDBOT_OPERATOR). The console can pick any of the above.`
    : 'REDBOT_OPERATOR is not set in this shell. Set it, or pick an operator in the console.');
  return 0;
}

function add(name: string | undefined): number {
  say.head('redbot operators add');

  if (!name) { say.fail('Usage: redbot operators add <name>'); return 1; }
  if (!VALID.test(name)) {
    say.fail(`Invalid name "${name}" — letters, digits, dot, dash, underscore only.`);
    return 1;
  }

  let all: Record<string, OperatorRecord> = {};
  if (existsSync(operatorsPath)) {
    try {
      all = JSON.parse(readFileSync(operatorsPath, 'utf8')) as Record<string, OperatorRecord>;
    } catch {
      say.fail('data/operators/operators.json is not readable JSON. Fix or delete it first.');
      return 1;
    }
  }

  if (all[name]) {
    say.warn(`Operator "${name}" already exists → ${all[name]!.configDir}`);
    say.step('Nothing changed. Remove the entry by hand to re-create it.');
    return 0;
  }

  const configDir = join(DATA, 'operators', name, 'claude');
  mkdirSync(configDir, { recursive: true });

  all[name] = {
    configDir,
    declaredBy: name,
    // A CLI process may read the clock; only workflow scripts may not. This is dist/cli.js.
    declaredAt: new Date().toISOString().slice(0, 10),
    note: `Dedicated login folder created by \`redbot operators add\`. Sign in once (below) before use.`
  };
  mkdirSync(join(DATA, 'operators'), { recursive: true });
  writeFileSync(operatorsPath, JSON.stringify(all, null, 2) + '\n', 'utf8');

  say.ok(`Registered "${name}".`);
  say.step('Now sign in once, as that operator — redbot never sees your Claude password:');
  say.step('');
  say.step(`  PowerShell:  $env:CLAUDE_CONFIG_DIR = "${configDir}"; claude   # then /login inside it`);
  say.step(`  bash:        CLAUDE_CONFIG_DIR="${configDir}" claude          # then /login inside it`);
  say.step('');
  say.step(`Then run as this operator:  $env:REDBOT_OPERATOR = "${name}"   (or pick "${name}" in the console)`);
  record('operator.add', `registered operator ${name}`, { name });
  return 0;
}

export async function operators(sub: string | undefined, name: string | undefined): Promise<number> {
  switch (sub) {
    case undefined:
    case 'list': return list();
    case 'add':  return add(name);
    default:
      say.fail(`Unknown: redbot operators ${sub}. Use \`operators\` or \`operators add <name>\`.`);
      return 1;
  }
}

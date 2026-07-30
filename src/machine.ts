/**
 * Which computer this is.
 *
 * Needed because `accounts` is shared between machines but a Chrome profile folder and a
 * debugging port are not: the folder holds a session DPAPI-bound to one Windows user on one
 * machine, and a port that is free here may be held by something else there. Bindings are
 * therefore keyed by machine (db/migrations/0013_account_machines.up.sql), and this answers the
 * key.
 *
 * WHY A FILE AND NOT `os.hostname()` DIRECTLY. The hostname is the obvious answer and it is the
 * default — it is readable, which matters when a person is looking at a table of bindings and
 * has to know which laptop a row belongs to. But renaming a computer would silently orphan
 * every binding it owns: the accounts would still be in the database, still hold their ports,
 * and this machine would no longer recognise any of them. So the first answer is written to
 * `data/machine-id` and that file is what is read afterwards. The name stays stable across a
 * rename, and it stays readable because it started as the hostname.
 *
 * `data/` is gitignored in full, so this never travels with the repo — which is the point. Two
 * clones on two machines must not agree about which machine they are.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { DATA } from './config.js';

/** Same shape the database CHECK enforces, so a value from here can never fail to insert. */
const MACHINE_RE = /^[A-Za-z0-9_.-]{1,64}$/;

export const machineIdPath = (): string => join(DATA, 'machine-id');

/**
 * Make any hostname usable as an identifier.
 *
 * Real hostnames carry characters the column refuses — a Windows machine can be `DESK TOP`,
 * a mac is routinely `Dan's MacBook Pro.local`. Substituting rather than rejecting keeps the
 * readable part; the fallback covers a name with nothing usable left in it.
 */
export function sanitiseMachineName(raw: string): string {
  const cleaned = raw.trim().replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
  return MACHINE_RE.test(cleaned) ? cleaned : 'unknown-machine';
}

let cached: string | null = null;

/**
 * This machine's id, created on first use and stable thereafter.
 *
 * `REDBOT_MACHINE` overrides everything and is not written to disk — it is how a test gets to
 * be a second machine without there being one, and how somebody can correct a name that was
 * pinned wrong.
 */
export function machineId(): string {
  const forced = process.env.REDBOT_MACHINE;
  if (forced) return sanitiseMachineName(forced);
  if (cached) return cached;

  const file = machineIdPath();
  if (existsSync(file)) {
    try {
      const saved = sanitiseMachineName(readFileSync(file, 'utf8'));
      // An empty or unusable file is treated as absent rather than as an error: this must never
      // be the thing that stops a command from running.
      if (saved !== 'unknown-machine' || readFileSync(file, 'utf8').trim()) {
        cached = saved;
        return cached;
      }
    } catch { /* unreadable — fall through and write a fresh one */ }
  }

  const id = sanitiseMachineName(hostname() || 'unknown-machine');
  try {
    mkdirSync(DATA, { recursive: true });
    writeFileSync(file, id, 'utf8');
  } catch {
    /* A read-only data dir must not stop redbot; the hostname still answers for this process. */
  }
  cached = id;
  return id;
}

/** Drop the cache so the next read re-resolves. For tests, and after the file is rewritten. */
export function forgetMachineId(): void {
  cached = null;
}

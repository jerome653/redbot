/**
 * A run started from a terminal leaves a record, the same one the console leaves.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS MODULE EXISTS.
 *
 * `data/run-logs/` was written by exactly one program: the desktop console
 * (tools/product/server.mjs). Anything typed at a prompt ran, printed, and vanished. The two
 * ledgers therefore disagreed by construction, and the disagreement was not theoretical — the
 * execution log compiled on 2026-08-26 from Clark's machine found five runs on 08-18 (05:58:57
 * through 06:27:02, including two `opportunity` scores) that the database records and no run log
 * mentions. A report compiled over run-logs undercounts, and "45 executions in the window" is a
 * floor rather than a count.
 *
 * The format is the console's, byte for byte, because the console's reader is the consumer:
 * a header line, one line per line of output, a footer with the exit code. Written as the run
 * goes, so a run that is killed still leaves what it managed to print.
 *
 * WHAT THIS MODULE MUST NEVER DO is fail a run. It is the same rule the history logger learned
 * on 2026-08-19: writing down what happened cannot be allowed to undo what happened. Every
 * operation here is wrapped, and a log that cannot be written is simply not written.
 * ---------------------------------------------------------------------------
 */
import { closeSync, mkdirSync, openSync, readdirSync, rmSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import { DATA } from './config.js';

const RUN_LOG_DIR = join(DATA, 'run-logs');

/** The console's cap, and the same promise: the newest 500 runs exist, older ones do not. */
const RUN_LOG_KEEP = 500;

/**
 * The console spawns `dist/cli.js` and writes the run log itself. Without this the same run
 * would appear twice, once from each writer — so the console sets it and this module stands down.
 */
export const CONSOLE_MARKER = 'REDBOT_RUN_LOG';

interface Live {
  /**
   * A file DESCRIPTOR and synchronous writes, where the console uses a stream.
   *
   * The console is a long-lived server and its stream flushes on its own. The CLI ends with
   * `process.exit(code)`, which does not wait for a stream's pending writes — measured
   * 2026-08-26: the run-logs directory was created and every file in it was empty. A run log
   * that only survives when the process happens to linger is not a record.
   */
  fd: number;
  startedAt: number;
  lines: number;
  partial: string;
  restore: Array<() => void>;
}

let live: Live | null = null;

/** Sortable by name, exactly as tools/product/server.mjs writes it. */
function fileName(startedAt: string, id: number): string {
  return startedAt.replace(/[:.]/g, '-') + '__' + String(id).padStart(6, '0') + '.jsonl';
}

function write(obj: Record<string, unknown>): void {
  if (!live) return;
  try { writeSync(live.fd, JSON.stringify(obj) + '\n'); } catch { /* disk full, read-only fs */ }
}

/** Delete everything past the newest `target`, at the one moment the count can exceed the cap. */
function prune(target: number): void {
  try {
    const files = readdirSync(RUN_LOG_DIR).filter((f) => f.endsWith('.jsonl')).sort();
    for (let i = 0; i < files.length - target; i++) rmSync(join(RUN_LOG_DIR, files[i]!), { force: true });
  } catch { /* no directory yet, or unreadable — nothing to prune */ }
}

/**
 * Tee a stream into the log without changing what reaches the terminal.
 *
 * A chunk boundary is not a line boundary, so a partial line is held until its newline arrives —
 * the console's reader renders these, and half a sentence followed by the whole one reads as a
 * bug in the command that printed it.
 */
function tee(s: NodeJS.WriteStream): () => void {
  const original = s.write.bind(s);
  const patched = ((chunk: string | Uint8Array, ...rest: unknown[]) => {
    try {
      if (live) {
        const at = Date.now() - live.startedAt;
        const parts = (live.partial + String(chunk)).split('\n');
        live.partial = parts.pop() ?? '';
        for (const text of parts) { live.lines++; write({ t: 'l', at, text: text.replace(/\r$/, '') }); }
      }
    } catch { /* never let logging break output */ }
    return (original as (...a: unknown[]) => boolean)(chunk, ...rest);
  }) as typeof s.write;
  s.write = patched;
  return () => { s.write = original; };
}

/**
 * Open this run's file and write its header at once, so a run that dies in its first second
 * still leaves a record that it was attempted.
 *
 * `argv` is the command as typed. The id is the pid: the console counts its own runs from 1, and
 * the two writers must not fight over a number that only ever gets displayed. Uniqueness comes
 * from the millisecond in the filename, as it does for the console.
 */
export function beginRunLog(argv: readonly string[]): void {
  if (process.env[CONSOLE_MARKER]) return;   // the console is already logging this run
  try {
    const startedAt = new Date().toISOString();
    mkdirSync(RUN_LOG_DIR, { recursive: true });
    /* KEEP-1: this run is about to add its own file, and the cap is a promise about how many
       files exist — not how many existed a moment before the newest one appeared. */
    prune(RUN_LOG_KEEP - 1);
    const fd = openSync(join(RUN_LOG_DIR, fileName(startedAt, process.pid)), 'a');
    live = { fd, startedAt: Date.parse(startedAt), lines: 0, partial: '', restore: [] };
    write({
      t: 'h', id: process.pid,
      key: argv[0] ?? 'help',
      command: `redbot ${argv.join(' ')}`.trim(),
      startedAt,
      /* Not read by the console's reader, which ignores unknown keys — it is here so a person
         reading the file can tell a terminal run from a console one. */
      via: 'cli'
    });
    live.restore.push(tee(process.stdout), tee(process.stderr));
  } catch {
    live = null;   // a terminal that cannot write its log still runs commands
  }
}

/** Footer, with the exit code the caller is about to exit with. Safe to call twice. */
export function endRunLog(code: number): void {
  if (!live) return;
  const current = live;
  try {
    for (const undo of current.restore) undo();
    if (current.partial) { current.lines++; write({ t: 'l', at: Date.now() - current.startedAt, text: current.partial }); }
    write({ t: 'f', code, lines: current.lines, dropped: 0 });
    closeSync(current.fd);
  } catch { /* the run is over; a broken log must not change its outcome */ }
  live = null;
}

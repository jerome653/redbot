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
 * Bytes one run-log FILE may reach before the run rolls onto a continuation file.
 *
 * ---------------------------------------------------------------------------
 * WHY A SIZE CAP WAS MISSING AND WHY IT MATTERS HERE SPECIFICALLY.
 *
 * `prune(RUN_LOG_KEEP - 1)` caps the NUMBER of files, and it runs once — in `beginRunLog`, at
 * process start. For the commands this was designed around that is the whole story: a run prints
 * a few hundred lines and exits. `redbot auto` is not one of those: it is a single process that
 * loops forever, so it opens one file and appends to it for as long as the install runs, and a cap
 * on how many files exist says nothing about that one.
 *
 * MEASURED by tools/ops/simulate.mjs SIM 4, on this disk's own logs. The longest real
 * `redbot auto --every 120` run: 2,585,199 bytes and 23,759 lines in ONE file over 161.5 hours.
 * That is 16 KB/hour — 11.5 MB and ~106,000 lines a month, 140 MB and ~1.3M lines a year, all of
 * it in a single file that `tools/product/server.mjs` reads with `readFileSync` to render it.
 *
 * 8 MB is ~21 days of `auto` at the measured rate and small enough to open, parse and send. The
 * total on disk is unchanged — the same bytes land in ~18 files a year instead of one — and that
 * is the point: the bytes were never the problem, a single unopenable file was.
 */
const RUN_LOG_MAX_BYTES = Number(process.env.REDBOT_RUN_LOG_MAX_BYTES ?? 8_000_000);

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
  /** The run's own ISO start, kept so a continuation file can be named from it. */
  startedIso: string;
  /** Bytes written to the CURRENT file. Counted here rather than stat()ed on every line. */
  bytes: number;
  /** Which file of this run is open: 0 is the original, 1+ are continuations. */
  part: number;
}

let live: Live | null = null;

/**
 * Sortable by name, exactly as tools/product/server.mjs writes it.
 *
 * `part` appends `_p<NNN>` for a continuation file (see `roll`). Part 0 keeps the original name
 * unchanged, so every file this module has ever written still matches
 * `tools/product/server.mjs`'s `runLogList` and its `[0-9A-Za-z._-]+[.]jsonl` name guard.
 *
 * THE SEPARATOR IS `_`, AND IT HAD TO BE. The first version used `-p1`, and `-` is 0x2D while `.`
 * is 0x2E — so `…__012345-p1.jsonl` sorts BEFORE `…__012345.jsonl`, putting every continuation
 * ahead of the run it continues. Caught by src/test/run-log-rotation.test.ts, which read
 * `files[0]` expecting the original and got part 1. It is not a cosmetic ordering problem:
 * `prune` deletes `files[i]` from the front of the sorted list, so the oldest-first promise would
 * have deleted a run's continuations while keeping its first 8 MB. `_` is 0x5F, after `.`, so the
 * original leads and the parts follow in order.
 *
 * Zero-padded to three digits for the same reason the id is padded: `_p10` must not sort between
 * `_p1` and `_p2`. At the measured 16 KB/hour against an 8 MB cap, three digits is ~45 years.
 */
function fileName(startedAt: string, id: number, part = 0): string {
  return startedAt.replace(/[:.]/g, '-') + '__' + String(id).padStart(6, '0')
    + (part > 0 ? `_p${String(part).padStart(3, '0')}` : '') + '.jsonl';
}

function write(obj: Record<string, unknown>): void {
  if (!live) return;
  try {
    const line = JSON.stringify(obj) + '\n';
    writeSync(live.fd, line);
    live.bytes += Buffer.byteLength(line);
    if (live.bytes >= RUN_LOG_MAX_BYTES) roll();
  } catch { /* disk full, read-only fs */ }
}

/**
 * Close the current file and continue the same run in a new one.
 *
 * A FOOTER AND A HEADER, so neither file lies about itself. The closing file gets `t: 'f'` with
 * `rolled: true` — a reader that sees a footer must not conclude the run ended — and the new one
 * opens with a normal header carrying the same run id and start time, plus `part`. The viewer
 * renders either file on its own, and the directory listing keeps them adjacent because the name
 * is prefixed with the run's start.
 *
 * Never throws and never leaves `live` half-open: if the new file cannot be opened, logging stops
 * for the rest of the run and the run itself carries on. That is this module's standing rule —
 * writing down what happened cannot be allowed to undo what happened.
 */
function roll(): void {
  if (!live) return;
  const prev = live;
  try { writeSync(prev.fd, JSON.stringify({ t: 'f', rolled: true, lines: prev.lines, part: prev.part }) + '\n'); }
  catch { /* the roll is still worth doing */ }
  try { closeSync(prev.fd); } catch { /* already gone */ }
  const part = prev.part + 1;
  try {
    const fd = openSync(join(RUN_LOG_DIR, fileName(prev.startedIso, process.pid, part)), 'a');
    live = { ...prev, fd, bytes: 0, part };
    write({
      t: 'h', id: process.pid, key: 'auto-continued',
      command: `(continued, part ${part})`, startedAt: prev.startedIso, via: 'cli', part
    });
  } catch {
    /* No continuation file: stop logging rather than write into a closed descriptor. */
    live = null;
  }
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
    live = {
      fd, startedAt: Date.parse(startedAt), lines: 0, partial: '', restore: [],
      startedIso: startedAt, bytes: 0, part: 0
    };
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

/**
 * Footer for a run that dies on an uncaught exception or an unhandled rejection.
 *
 * ---------------------------------------------------------------------------
 * WHY. Node prints a fatal exception straight to file descriptor 2, NOT through
 * `process.stderr.write`, so `tee` never sees it, and the `.then`/`.catch` in src/cli.ts that
 * write the footer never run. Measured on cardinal: 2026-10-26T19-47-11 (`redbot reply`) and
 * 2026-10-29T20-02-23 (`redbot read r/CMS`) both end on a sub-command header with no footer and no
 * error text, and the second one's `rotation.tick` row reads `code: 1`. The cause of both is gone.
 *
 * Written through `process.stderr.write` so the stack lands in the run log AND on the terminal,
 * then the footer, then the exit — the same code Node would have exited with.
 * ---------------------------------------------------------------------------
 */
export function captureCrashes(exit: (code: number) => void = (c) => process.exit(c)): void {
  process.on('uncaughtException', (err, origin) => {
    try {
      const text = err instanceof Error ? (err.stack ?? `${err.name}: ${err.message}`) : String(err);
      process.stderr.write(`\n  ✗  crashed (${origin}): ${text}\n`);
    } catch { /* the footer and the exit still happen */ }
    endRunLog(1);
    exit(1);
  });
}

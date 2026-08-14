/**
 * The console's port, kept the same across restarts — because it is the app's ORIGIN.
 *
 * ---------------------------------------------------------------------------
 * WHY A RANDOM PORT WAS A DATA-LOSS BUG, NOT A DETAIL.
 *
 * The window loads `http://127.0.0.1:<port>/`, and everything the console remembers about how
 * this operator works is kept in that page's `localStorage`:
 *
 *     which account collects · WHICH ACCOUNT SENDS · the zoom level ·
 *     whether the walkthrough has been seen · which update was dismissed
 *
 * `localStorage` is scoped to the ORIGIN, and the origin contains the port. Binding :0 asks the
 * OS for any free port, so every launch got a different one — a different origin, a different
 * empty store, and the previous launch's settings stranded in a bucket nothing would read again.
 * Every restart therefore: forgot which account sends, re-opened the walkthrough, reset the zoom
 * and re-offered an update that had been dismissed. index.html said the flag "lives in the
 * renderer's localStorage, which is per-install"; it was per-BOOT, and no test could see it
 * because a test only ever runs one boot.
 *
 * It also made the 3.3.0 source-switch adoption a near no-op: it can only read keys written under
 * the origin it is running in, and the switches it was meant to adopt had been written under an
 * origin that no longer exists. (Harmless — since 3.3.0 the record is authoritative and those
 * buckets are inert — but it is why nothing was adopted on the machine that had the state.)
 *
 * So: remember the port and ask for it again. If something else has taken it, fall back to a
 * fresh one rather than refusing to start — a console that will not open is worse than a console
 * that forgot the zoom level — and SAY so, because that boot is the one where settings look lost.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:net';

export const PORT_FILE = 'console-port.json';

/** Is this exact port bindable on loopback right now? */
export function portIsFree(port) {
  return new Promise((resolve) => {
    const s = createServer();
    s.once('error', () => resolve(false));
    s.listen(port, '127.0.0.1', () => s.close(() => resolve(true)));
  });
}

/** A port the OS says is free. Bind :0, read it back, release it. */
export function anyFreePort() {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

/** The port this install used last time, or null when there is nothing usable on file. */
export function rememberedPort(dir, read = readFileSync) {
  try {
    const raw = JSON.parse(read(join(dir, PORT_FILE), 'utf8'));
    const port = Number(raw?.port);
    /* Ports 1-1023 need privileges and 0 means "any" — neither is something we wrote. */
    return Number.isInteger(port) && port >= 1024 && port <= 65535 ? port : null;
  } catch {
    return null;
  }
}

export function rememberPort(dir, port, write = writeFileSync) {
  try {
    write(join(dir, PORT_FILE), JSON.stringify({ port }, null, 2), 'utf8');
    return true;
  } catch {
    /* A port we cannot write down is a port we will not reuse — that costs settings, not a boot. */
    return false;
  }
}

/**
 * The port to start on: the remembered one when it is still free, otherwise a fresh one.
 *
 * @returns {Promise<{port: number, reused: boolean, note: string|null}>}
 *   `note` is a sentence for the boot log when the origin changed, and null when it did not —
 *   the one boot where an operator's settings appear to have vanished is the boot that should
 *   explain itself.
 */
export async function consolePort(dir, deps = {}) {
  const free = deps.portIsFree ?? portIsFree;
  const any = deps.anyFreePort ?? anyFreePort;
  const remembered = deps.rememberedPort ?? rememberedPort;
  const remember = deps.rememberPort ?? rememberPort;

  const last = remembered(dir);
  if (last !== null && await free(last)) return { port: last, reused: true, note: null };

  const port = await any();
  remember(dir, port);
  return {
    port,
    reused: false,
    note: last === null
      ? null
      : `port ${last} was taken, so this boot uses ${port} — settings kept by the console ` +
        '(which account sends, zoom, walkthrough) start fresh for this session'
  };
}

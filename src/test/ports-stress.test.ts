/**
 * The Windows-username defect, held shut across the whole space of paths a person can have.
 *
 * `ports-ownership.test.ts` pins the three shapes the fix names, one example each. This is the
 * other half: the same question asked over a generated space, plus the parser as it stood BEFORE
 * the fix kept here as a CONTROL — a differential test says "this input class was wrong and is
 * now right", which a fresh assertion cannot, and it fails loudly if anyone reintroduces the old
 * alternation.
 *
 * The failure being pinned is not cosmetic. Ownership is decided by comparing `--user-data-dir`,
 * so a truncated parse made redbot read its OWN Chrome as someone else's, correctly refuse to
 * close it on that false evidence, and leak one orphaned browser onto a debug port per restart
 * until the whole 9222–9299 range was gone. Reported 2026-08-13 from a machine whose Windows
 * user is `Clark Pesa`; invisible on every single-word username, which is every dev machine.
 *
 * No browser is launched here — the process table is modelled, so this is safe to run anywhere.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  userDataDirFrom, sameDir, orphanBrowsers, DEBUG_PORT_FIRST, DEBUG_PORT_LAST, type PortOwner
} from '../ports.js';

/** The parser as it stood before the fix. Kept to prove the input class, not to be used. */
const legacyParse = (cl: string | null): string | null => {
  if (!cl) return null;
  const m = /--user-data-dir="([^"]*)"|--user-data-dir=(\S+)/.exec(cl);
  return m ? (m[1] ?? m[2] ?? null) : null;
};

const USERS = [
  'Clark Pesa', 'Clark', 'JerOme.DESKTOP-EA0N9F1', 'Mary  Jane', 'josé garcía', "O'Brien",
  'user (admin)', 'a b c d e', 'Пётр', '山田 太郎', 'x'.repeat(120), 'name.with.dots', 'has=equals'
];
const LEAVES = ['chrome-profile-a', 'chrome profile b', 'profile.c', 'p'];
const ROOTS = [
  (u: string) => `C:\\Users\\${u}\\AppData\\Roaming\\redbot\\data`,
  () => `D:\\AI\\Clients\\SGEN\\Projects\\redbot\\data`,
  (u: string) => `C:/Users/${u}/AppData/Roaming/redbot/data`,
  (u: string) => `\\\\fileserver\\share\\${u}\\redbot\\data`
];

/** Windows quotes the WHOLE argument; a value-quoted and a bare form both occur too. */
const SHAPES = [
  { name: 'whole argument quoted', build: (d: string) => `"--user-data-dir=${d}"` },
  { name: 'value quoted', build: (d: string) => `--user-data-dir="${d}"` },
  { name: 'bare', build: (d: string) => `--user-data-dir=${d}` }
];
/** A real command line is never the flag on its own. */
const NEIGHBOURS = [
  (a: string) => a,
  (a: string) => `"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" ${a} --remote-debugging-port=9222`,
  (a: string) => `chrome.exe --no-first-run ${a} --disable-features=Foo,Bar --lang=en-US`,
  (a: string) => `chrome.exe --remote-debugging-port=9226 ${a} --user-agent="Mozilla/5.0 (Windows NT 10.0)"`
];

const PATHS: string[] = [];
for (const u of USERS) for (const r of ROOTS) for (const leaf of LEAVES) PATHS.push(`${r(u)}\\${leaf}`);

/** A bare unquoted flag cannot carry a space — Windows quotes it. Never generate that pair. */
const shapeFor = (dir: string, i: number) => SHAPES[/\s/.test(dir) ? i % 2 : i % SHAPES.length]!;

test('a user-data-dir survives every path a Windows user can have, in every shape', () => {
  let checked = 0, withSpaces = 0, legacyWrong = 0;
  for (const p of PATHS) {
    for (const shape of SHAPES) {
      if (shape.name === 'bare' && /\s/.test(p)) continue;
      for (const wrap of NEIGHBOURS) {
        const cl = wrap(shape.build(p));
        assert.equal(userDataDirFrom(cl), p, `${shape.name} lost the path: ${cl}`);
        checked++;
        if (/\s/.test(p)) { withSpaces++; if (legacyParse(cl) !== p) legacyWrong++; }
      }
    }
  }
  assert.ok(checked > 1000, `the generated space collapsed to ${checked} cases`);
  // The control. If this stops failing, the old alternation is back and the defect with it.
  assert.equal(legacyWrong, withSpaces / 2,
    'the pre-fix parser must still be wrong on exactly the whole-argument-quoted half');
});

test('a command line with no user-data-dir yields no claim, rather than a guess', () => {
  for (const cl of [null, '', 'chrome.exe --no-first-run', '--user-data-dirs=C:\\x']) {
    assert.equal(userDataDirFrom(cl), null, `invented an answer for ${JSON.stringify(cl)}`);
  }
});

const ROOT = 'C:\\Users\\Clark Pesa\\AppData\\Roaming\\redbot\\data';
const owner = (port: number, dir: string): PortOwner => {
  const cl = shapeFor(dir, port).build(dir);
  return { port, pid: 1000 + port, process: 'chrome', commandLine: cl, userDataDir: userDataDirFrom(cl) };
};

test('at four hundred browsers, ownership still splits ours from theirs exactly', () => {
  const mine: string[] = [], foreign: string[] = [];
  for (let i = 0; i < 200; i++) mine.push(`${ROOT}\\chrome-profile-${i}`);
  for (let i = 0; i < 200; i++) foreign.push(`C:\\Users\\Clark Pesa\\AppData\\Local\\Google\\Chrome\\User Data\\p${i}`);

  const claimed = mine.slice(0, 100);
  const owners = new Map<number, PortOwner>();
  let port = DEBUG_PORT_FIRST;
  for (const d of [...mine, ...foreign]) { owners.set(port, owner(port, d)); port++; }

  const orphans = orphanBrowsers(owners, ROOT, claimed);
  const dirs = new Set(orphans.map((o) => o.profileDir));
  assert.equal(orphans.length, 100, 'exactly the unclaimed profiles under the root are reclaimable');
  assert.ok(claimed.every((d) => !dirs.has(d)), 'a live account must never be reclaimed');
  assert.ok(foreign.every((d) => !dirs.has(d)), "someone else's Chrome must never be reclaimed");

  // The root is not a profile, and a sibling that merely shares its prefix is not underneath it.
  const tricky = new Map<number, PortOwner>([
    [9999, owner(9999, ROOT)],
    [9998, owner(9998, `${ROOT}-backup\\p`)]
  ]);
  assert.equal(orphanBrowsers(tricky, ROOT, []).length, 0);

  for (const d of mine.slice(0, 50)) {
    const a = userDataDirFrom(SHAPES[0]!.build(d));
    const b = userDataDirFrom(SHAPES[1]!.build(d.replace(/\\/g, '/').toUpperCase()));
    assert.ok(sameDir(a, b), `the same folder read as two different ones: ${d}`);
  }
});

/**
 * The consequence, replayed. This is what Clark actually experienced, and the number it produces
 * — one orphan per restart until the range is exhausted — is why the parse mattered at all.
 */
test('five hundred restarts hold one debug port, where the old parser burned all seventy-eight', () => {
  const run = (parse: (cl: string | null) => string | null, restarts: number) => {
    const held = new Map<number, string>();
    const mineDir = `${ROOT}\\chrome-profile-e`;
    let exhausted: number | null = null;
    for (let r = 0; r < restarts; r++) {
      let reused = false;
      for (const dir of held.values()) {
        if (parse(SHAPES[0]!.build(dir))?.toLowerCase() === mineDir.toLowerCase()) { reused = true; break; }
      }
      if (reused) continue;
      let port = DEBUG_PORT_FIRST;
      while (held.has(port) && port <= DEBUG_PORT_LAST) port++;
      if (port > DEBUG_PORT_LAST) { exhausted = r; break; }
      held.set(port, mineDir);
    }
    return { ports: held.size, exhausted };
  };

  const fixed = run(userDataDirFrom, 500);
  assert.deepEqual(fixed, { ports: 1, exhausted: null },
    'redbot must recognise its own browser and reuse its port, however the username is spelled');

  const legacy = run(legacyParse, 500);
  assert.equal(legacy.ports, DEBUG_PORT_LAST - DEBUG_PORT_FIRST + 1);
  assert.equal(legacy.exhausted, DEBUG_PORT_LAST - DEBUG_PORT_FIRST + 1,
    'the control must still exhaust the range, or it has stopped controlling for anything');
});

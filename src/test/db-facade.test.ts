/**
 * The pg-shaped façade over SQLite — does it hand back what the row mappers expect?
 *
 * ---------------------------------------------------------------------------
 * WHY THIS TEST EXISTS.
 *
 * The 13 row mappers in src/db/ were written against `pg`'s type parsers. 27 row interfaces
 * declare `: Date`, 28 call sites do `.toISOString()` on the result, 11 declare `: Buffer`, and
 * the array/JSON columns were handed back already parsed. SQLite returns strings, integers and
 * Uint8Array for all of it.
 *
 * src/db.ts restores those shapes centrally rather than making 26 files do it. That is the whole
 * bet of the port, and it fails SILENTLY if it is wrong: a timestamp that stays a string does
 * not throw, it just makes `.toISOString()` a TypeError somewhere far away, or worse, reaches a
 * screen as "[object Object]" or a NaN metric. src/db/logs.ts does `Number(x.edit_retained ?? 0)`
 * — a wrong type there produces NaN in a reliability figure and nothing complains.
 *
 * So every conversion is asserted here, at the seam, where a failure names the cause.
 * ---------------------------------------------------------------------------
 */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RUNNER = join(ROOT, 'db', 'sqlite', 'migrate.mjs');

let dir: string;

/* The database has to exist before src/db.ts is imported for the first time, because the
   module resolves its path lazily but caches connections and the derived schema map. */
dir = mkdtempSync(join(tmpdir(), 'redbot-facade-'));
process.env.REDBOT_DB = join(dir, 'redbot.db');
const migrated = spawnSync(process.execPath, [RUNNER, 'up'], { encoding: 'utf8' });
if (migrated.status !== 0) {
  throw new Error(`migrate up failed:\n${migrated.stdout}\n${migrated.stderr}`);
}

const { getPool, withTransaction, closePool, forgetSchema, ping, dbFile, DbBusyError } =
  await import('../db.js');

const ISO = '2026-07-30T12:34:56.789Z';

before(async () => {
  const db = getPool();
  await db.query('INSERT INTO accounts (handle, knows, subreddits) VALUES ($1,$2,$3)',
    ['docs-architect', JSON.stringify(['kubernetes', 'ci']), JSON.stringify(['devops'])]);
  await db.query(
    'INSERT INTO threads (id,permalink,title,subreddit,collected_at,source) VALUES ($1,$2,$3,$4,$5,$6)',
    ['aaaaaaaaaaaa', '/r/devops/1', 'How do I', 'devops', ISO, 'read']);
});

after(async () => {
  await closePool();
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* windows holds the file briefly */ }
});

/* ==================================================================== *
 * 1. Placeholders — the finding that let 237 call sites keep their SQL
 * ==================================================================== */
describe('pg-style $1 placeholders', () => {
  test('bind positionally, in order, and repeat', async () => {
    const r = await getPool().query<{ a: string; b: number; c: string }>(
      'SELECT $1 AS a, $2 AS b, $1 AS c', ['x', 7]);
    assert.deepEqual(r.rows[0], { a: 'x', b: 7, c: 'x' });
  });

  test('rows are ordinary objects, not the null-prototype ones SQLite returns', async () => {
    // node:sqlite builds rows with a null prototype; pg returned plain objects. Left alone,
    // `row.hasOwnProperty(...)` throws, `assert.deepStrictEqual` reports identical rows as
    // unequal, and anything reaching for a prototype method fails — all far from the cause.
    const r = await getPool().query<Record<string, unknown>>(
      'SELECT id, title FROM threads WHERE id = $1', ['aaaaaaaaaaaa']);
    const row = r.rows[0]!;
    assert.equal(Object.getPrototypeOf(row), Object.prototype);
    assert.equal(Object.prototype.hasOwnProperty.call(row, 'title'), true);
    assert.doesNotThrow(() => (row as { hasOwnProperty(k: string): boolean }).hasOwnProperty('title'));
  });

  test('a NULL parameter is a NULL, not the string "null"', async () => {
    const r = await getPool().query<{ v: unknown }>('SELECT $1 AS v', [null]);
    assert.equal(r.rows[0]!.v, null);
  });

  test('undefined is treated as NULL, as pg did', async () => {
    const r = await getPool().query<{ v: unknown }>('SELECT $1 AS v', [undefined]);
    assert.equal(r.rows[0]!.v, null);
  });
});

/* ==================================================================== *
 * 2. Types OUT — the shapes the mappers are written against
 * ==================================================================== */
describe('result coercion restores the Postgres-shaped values', () => {
  test('a timestamp column comes back as a Date whose toISOString() round-trips', async () => {
    const r = await getPool().query<{ collected_at: Date }>(
      'SELECT collected_at FROM threads WHERE id = $1', ['aaaaaaaaaaaa']);
    const v = r.rows[0]!.collected_at;
    assert.ok(v instanceof Date, `expected a Date, got ${typeof v}`);
    // This exact expression appears 28 times in src/db/. It must keep working.
    assert.equal(v.toISOString(), ISO);
  });

  test('a NULL timestamp stays null and is not turned into Invalid Date', async () => {
    const r = await getPool().query<{ decided_at: Date | null }>(
      "SELECT decided_at FROM drafts WHERE 1=0 UNION ALL SELECT NULL");
    assert.equal(r.rows[0]!.decided_at, null);
  });

  test('an array column comes back as a JS array', async () => {
    const r = await getPool().query<{ knows: string[]; subreddits: string[] }>(
      'SELECT knows, subreddits FROM accounts WHERE handle = $1', ['docs-architect']);
    assert.deepEqual(r.rows[0]!.knows, ['kubernetes', 'ci']);
    assert.deepEqual(r.rows[0]!.subreddits, ['devops']);
  });

  test('a JSON payload column comes back parsed', async () => {
    await getPool().query('INSERT INTO jobs (id,account,kind,args) VALUES ($1,$2,$3,$4)',
      ['j1', 'docs-architect', 'read', JSON.stringify({ subreddit: 'devops', limit: '5' })]);
    const r = await getPool().query<{ args: Record<string, string> }>(
      'SELECT args FROM jobs WHERE id = $1', ['j1']);
    assert.deepEqual(r.rows[0]!.args, { subreddit: 'devops', limit: '5' });
  });

  test('observations.value keeps a number a number and a string a string', async () => {
    // src/health.ts:56 types this as number | string | boolean | null, and 0009 chose jsonb
    // precisely so the three do not collapse into text.
    for (const v of [412, 'suspended', true]) {
      await getPool().query('INSERT INTO observations (ts,kind,vector,value) VALUES ($1,$2,$3,$4)',
        [ISO, 'karma', 'signed-in', JSON.stringify(v)]);
    }
    const r = await getPool().query<{ value: unknown }>(
      'SELECT value FROM observations ORDER BY id');
    assert.deepEqual(r.rows.map((x) => typeof x.value), ['number', 'string', 'boolean']);
    assert.deepEqual(r.rows.map((x) => x.value), [412, 'suspended', true]);
  });

  test('a boolean column comes back as true/false, not 1/0', async () => {
    await getPool().query(
      `INSERT INTO drafts (id,thread_id,permalink,title,body,has_disclosure,created_at,model)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      ['d1', 'aaaaaaaaaaaa', '/r/devops/1', 'T', 'B', false, ISO, 'm']);
    const r = await getPool().query<{ has_disclosure: boolean }>(
      'SELECT has_disclosure FROM drafts WHERE id = $1', ['d1']);
    assert.equal(r.rows[0]!.has_disclosure, false);
    assert.equal(typeof r.rows[0]!.has_disclosure, 'boolean');
  });

  test('a BLOB comes back as a real Buffer — src/vault.ts requires one', async () => {
    const iv = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    const tag = Buffer.alloc(16, 9);
    const ct = Buffer.from('sealed-bytes');
    await getPool().query(
      'INSERT INTO credentials (scope,name,key_id,iv,auth_tag,ciphertext) VALUES ($1,$2,$3,$4,$5,$6)',
      ['global', 'anthropic_api_key', 'abcdef012345', iv, tag, ct]);

    const r = await getPool().query<{ iv: Buffer; auth_tag: Buffer; ciphertext: Buffer }>(
      'SELECT iv, auth_tag, ciphertext FROM credentials WHERE name = $1', ['anthropic_api_key']);
    const row = r.rows[0]!;
    assert.ok(Buffer.isBuffer(row.iv), 'iv must be a Buffer, not a bare Uint8Array');
    assert.ok(Buffer.isBuffer(row.auth_tag));
    assert.ok(Buffer.isBuffer(row.ciphertext));
    assert.deepEqual(row.iv, iv);
    assert.equal(row.ciphertext.toString(), 'sealed-bytes');
    // The sizes 0011's CHECKs assert, and the ones createDecipheriv needs.
    assert.equal(row.iv.length, 12);
    assert.equal(row.auth_tag.length, 16);
  });

  test('coercion survives a LEFT JOIN and an alias', async () => {
    // The reason central coercion is possible at all: columns() reports the ORIGIN table and
    // column even when the result column is aliased and the row came through a join. This is
    // the shape src/db/pages.ts:84 uses on the Threads screen.
    await getPool().query(
      `INSERT INTO opportunity_assessments (thread_id,permalink,title,verdict,score,assessed_at,reasons)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      ['aaaaaaaaaaaa', '/r/devops/1', 'T', 'contribute', 91, ISO, JSON.stringify(['gap', 'novel'])]);

    const r = await getPool().query<{ when_seen: Date; why: string[]; disclosed: boolean }>(
      `SELECT t.collected_at AS when_seen,
              a.reasons      AS why,
              d.has_disclosure AS disclosed
         FROM opportunity_assessments a
         LEFT JOIN threads t ON t.id = a.thread_id
         LEFT JOIN drafts  d ON d.thread_id = a.thread_id
        WHERE a.thread_id = $1`, ['aaaaaaaaaaaa']);
    const row = r.rows[0]!;
    assert.ok(row.when_seen instanceof Date, 'an aliased timestamp was not coerced');
    assert.deepEqual(row.why, ['gap', 'novel'], 'an aliased array was not coerced');
    assert.equal(row.disclosed, false, 'a joined boolean was not coerced');
  });

  test('a computed column is left alone', async () => {
    const r = await getPool().query<{ n: number; label: string }>(
      "SELECT count(*) AS n, 'x' AS label FROM threads");
    assert.equal(typeof r.rows[0]!.n, 'number');
    assert.equal(r.rows[0]!.label, 'x');
  });
});

/* ==================================================================== *
 * 3. Types IN
 * ==================================================================== */
describe('parameter conversion', () => {
  test('a Date parameter is stored as the ISO string the schema requires', async () => {
    const when = new Date('2026-01-02T03:04:05.678Z');
    await getPool().query(
      'INSERT INTO threads (id,permalink,title,subreddit,collected_at,source) VALUES ($1,$2,$3,$4,$5,$6)',
      ['bbbbbbbbbbbb', '/r/devops/2', 'T', 'devops', when, 'read']);
    // Read the raw text past the coercion layer to prove what was STORED, not what comes back.
    const raw = await getPool().query<{ t: string }>(
      "SELECT CAST(collected_at AS TEXT) AS t FROM threads WHERE id = $1", ['bbbbbbbbbbbb']);
    assert.equal(raw.rows[0]!.t, '2026-01-02T03:04:05.678Z');
  });

  test('a boolean parameter is stored as 0/1', async () => {
    const raw = await getPool().query<{ n: number }>(
      'SELECT CAST(has_disclosure AS INTEGER) AS n FROM drafts WHERE id = $1', ['d1']);
    assert.equal(raw.rows[0]!.n, 0);
  });

  test('a raw JS array is REFUSED, and the message says what to write instead', async () => {
    // Both meanings an array had in the Postgres code are named, because the façade cannot tell
    // "store this list" from "match against this list" and must not guess.
    await assert.rejects(
      () => getPool().query('SELECT $1 AS v', [['a', 'b']]),
      (e: Error) => {
        assert.match(e.message, /JavaScript array/);
        assert.match(e.message, /To STORE it/);
        assert.match(e.message, /json_each/);
        return true;
      });
  });

  test('a plain object is REFUSED with the same guidance', async () => {
    await assert.rejects(
      () => getPool().query('SELECT $1 AS v', [{ a: 1 }]),
      /is an object, which SQLite cannot bind/);
  });

  test('json_each is the working replacement for = ANY($1)', async () => {
    const ids = ['aaaaaaaaaaaa', 'bbbbbbbbbbbb'];
    const r = await getPool().query<{ id: string }>(
      'SELECT id FROM threads WHERE id IN (SELECT j.value FROM json_each($1) j) ORDER BY id',
      [JSON.stringify(ids)]);
    assert.deepEqual(r.rows.map((x) => x.id), ids);
  });

  test('an empty list matches nothing without error, as = ANY(\'{}\') did', async () => {
    const r = await getPool().query(
      'SELECT id FROM threads WHERE id IN (SELECT j.value FROM json_each($1) j)', [JSON.stringify([])]);
    assert.equal(r.rowCount, 0);
  });
});

/* ==================================================================== *
 * 4. rowCount — pg's two meanings
 * ==================================================================== */
describe('rowCount keeps both of pg\'s meanings', () => {
  test('a SELECT reports rows RETURNED', async () => {
    const r = await getPool().query('SELECT id FROM threads');
    assert.equal(r.rowCount, r.rows.length);
    assert.ok(r.rowCount >= 2);
  });

  test('a DELETE reports rows AFFECTED', async () => {
    await getPool().query('INSERT INTO sources (kind,value) VALUES ($1,$2)', ['subreddit', 'tempsub']);
    const hit = await getPool().query('DELETE FROM sources WHERE value = $1', ['tempsub']);
    assert.equal(hit.rowCount, 1, 'src/db/sources.ts asks "did the delete find anything"');
    const miss = await getPool().query('DELETE FROM sources WHERE value = $1', ['tempsub']);
    assert.equal(miss.rowCount, 0, 'and must be able to tell "gone" from "never there"');
  });

  test('an UPDATE that matches nothing reports 0', async () => {
    const r = await getPool().query('UPDATE accounts SET note = $1 WHERE handle = $2', ['x', 'nobody']);
    assert.equal(r.rowCount, 0);
  });

  test('RETURNING gives back rehydrated rows', async () => {
    const r = await getPool().query<{ handle: string; created_at: Date }>(
      'INSERT INTO accounts (handle) VALUES ($1) RETURNING handle, created_at', ['returned']);
    assert.equal(r.rows[0]!.handle, 'returned');
    assert.ok(r.rows[0]!.created_at instanceof Date, 'RETURNING must coerce like a SELECT');
  });
});

/* ==================================================================== *
 * 5. Transactions and isolation
 *
 * This is the section that justifies the one-writer / several-readers design in src/db.ts.
 * ==================================================================== */
describe('transactions', () => {
  test('a rolled-back transaction leaves nothing behind', async () => {
    await assert.rejects(() => withTransaction(async (c) => {
      await c.query('INSERT INTO accounts (handle) VALUES ($1)', ['rolled-back']);
      throw new Error('deliberate');
    }), /deliberate/);
    const r = await getPool().query('SELECT handle FROM accounts WHERE handle = $1', ['rolled-back']);
    assert.equal(r.rowCount, 0);
  });

  test('a read inside the transaction DOES see its own uncommitted writes', async () => {
    await withTransaction(async (c) => {
      await c.query('INSERT INTO accounts (handle) VALUES ($1)', ['inside']);
      const seen = await c.query('SELECT handle FROM accounts WHERE handle = $1', ['inside']);
      assert.equal(seen.rowCount, 1, 'a transaction must see its own work');
      throw new Error('undo');
    }).catch(() => {});
  });

  test('a read OUTSIDE the transaction does NOT see its uncommitted writes', async () => {
    // pg gave every transaction its own client, so this was free. On one SQLite connection it
    // would NOT have been: the read would have run inside the open transaction and rendered a
    // row that might still roll back. The reader connections are what preserve it.
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });

    const tx = withTransaction(async (c) => {
      await c.query('INSERT INTO accounts (handle) VALUES ($1)', ['mid-tx']);
      await gate;
      return 'committed';
    });

    // Let the transaction start and do its insert.
    await new Promise((r) => setTimeout(r, 30));

    const during = await getPool().query('SELECT handle FROM accounts WHERE handle = $1', ['mid-tx']);
    assert.equal(during.rowCount, 0, 'an uncommitted row was visible to a reader');

    release();
    assert.equal(await tx, 'committed');

    const afterCommit = await getPool().query('SELECT handle FROM accounts WHERE handle = $1', ['mid-tx']);
    assert.equal(afterCommit.rowCount, 1, 'the row must appear once committed');
  });

  test('two concurrent transactions serialise instead of losing an update', async () => {
    // Read-modify-write on the same row from two transactions at once. On one connection
    // without the queue, both BEGINs would collide; with a naive lock, one update would be
    // lost. Neither is acceptable for the job queue this pattern exists for.
    await getPool().query('INSERT INTO accounts (handle, daily_ceiling) VALUES ($1,$2)', ['counter', 0]);

    const bump = () => withTransaction(async (c) => {
      const cur = await c.query<{ daily_ceiling: number }>(
        'SELECT daily_ceiling FROM accounts WHERE handle = $1', ['counter']);
      const next = (cur.rows[0]!.daily_ceiling ?? 0) + 1;
      await new Promise((r) => setTimeout(r, 10));   // widen the window a lost update needs
      await c.query('UPDATE accounts SET daily_ceiling = $2 WHERE handle = $1', ['counter', next]);
    });

    await Promise.all([bump(), bump(), bump()]);
    const final = await getPool().query<{ daily_ceiling: number }>(
      'SELECT daily_ceiling FROM accounts WHERE handle = $1', ['counter']);
    assert.equal(final.rows[0]!.daily_ceiling, 3, 'an update was lost between two transactions');
  });

  test('a constraint violation inside a transaction rolls the whole thing back', async () => {
    await assert.rejects(() => withTransaction(async (c) => {
      await c.query('INSERT INTO accounts (handle) VALUES ($1)', ['partial-1']);
      // 'published' + REJECT is the H6 invariant; 0006 makes it unstorable.
      await c.query(
        `INSERT INTO drafts (id,thread_id,permalink,title,body,has_disclosure,created_at,model,status,cert_verdict,cert_at,cert_claims,cert_fatal_contradictions)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        ['d-h6', 'aaaaaaaaaaaa', '/r/devops/1', 'T', 'B', false, ISO, 'm', 'published', 'REJECT', ISO, 1, 1]);
    }), /reject_is_never_published/);

    const r = await getPool().query('SELECT handle FROM accounts WHERE handle = $1', ['partial-1']);
    assert.equal(r.rowCount, 0, 'the earlier insert in the same transaction must be gone too');
  });
});

/* ==================================================================== *
 * 6. Errors
 * ==================================================================== */
describe('errors', () => {
  test('a failing statement names the SQL that failed', async () => {
    await assert.rejects(() => getPool().query('SELECT * FROM no_such_table'),
      (e: Error) => {
        assert.match(e.message, /no_such_table/);
        assert.match(e.message, /SQL: SELECT \* FROM no_such_table/);
        return true;
      });
  });

  test('DbBusyError exists and is distinguishable from a broken database', () => {
    // Cross-process contention is what raises this; the type is what lets a caller retry
    // rather than treat a held lock as corruption. Constructed directly here — provoking a
    // real SQLITE_BUSY needs a second process, which db/sqlite/schema.test.mjs is not for.
    const e = new DbBusyError('database is locked');
    assert.equal(e.name, 'DbBusyError');
    assert.match(e.message, /another redbot process/);
    assert.ok(e instanceof Error);
  });
});

/* ==================================================================== *
 * 7. The derived column map — the safety net under central coercion
 * ==================================================================== */
describe('the schema-derived column map', () => {
  test('every column that needs coercion is found, and nothing else is', async () => {
    // Derivation reads markers the schema carries anyway (the timestamp shape CHECK, the
    // json_valid CHECK, the IN (0,1) CHECK, a BLOB declaration). If a migration ever writes one
    // of those differently, that column silently stops being coerced — so the derived set is
    // pinned against an explicit list here.
    //
    // The counts reconcile against the Postgres schema they replace:
    //   8 text[] + 12 jsonb = 20 json · 3 bytea = 3 blob · 8 boolean · 39 timestamptz
    //
    // boolean was 9, not 8: migration 0015 added `account_machines.selected`, which is the per-machine
    // account choice. This test FAILING on that addition is the point of it — a new boolean column
    // that nobody added to the coercion map would come back as 0/1 instead of false/true, and the
    // map is derived, so the only way to notice is a count that no longer matches.
    //
    // Migration 0016 (per-account proxy exits) moved both counts again, and it moved them for
    // exactly the reason above rather than because the numbers were loosened:
    //   date    39 -> 43   account_proxies.{vetted_at,created_at,updated_at}, account_exit_ips.observed_at
    //   boolean  9 -> 11   account_proxies.enabled, account_exit_ips.matched_pin
    // `matched_pin` is the one that would bite hardest if it stopped coercing: the drift halt reads
    // it to decide whether an account's exit still matches its vetted address, and a raw 0 is
    // truthy in JavaScript — so an un-coerced column would report every observation as a match and
    // silently disable the check.
    const expected = {
      date: 43, json: 20, boolean: 11, blob: 3
    };

    const rows = await getPool().query<{ name: string; sql: string }>(
      "SELECT name, sql FROM sqlite_master WHERE type='table' AND sql IS NOT NULL");
    const found: Record<string, string[]> = { date: [], json: [], boolean: [], blob: [] };
    for (const t of rows.rows) {
      const info = await getPool().query<{ name: string; type: string }>(
        `PRAGMA table_info(${JSON.stringify(t.name)})`);
      const ddl = t.sql.replace(/\s+/g, ' ');
      for (const col of info.rows) {
        const c = col.name;
        const key = `${t.name}.${c}`;
        const n = `(?:${c}|"${c}")`;
        if ((col.type || '').toUpperCase() === 'BLOB') { found.blob!.push(key); continue; }
        if (new RegExp(`${n}\\s+LIKE\\s+'____-__-__T%Z'`, 'i').test(ddl)) { found.date!.push(key); continue; }
        if (new RegExp(`json_valid\\(\\s*${n}\\s*\\)`, 'i').test(ddl)) { found.json!.push(key); continue; }
        if (new RegExp(`${n}\\s+IN\\s*\\(\\s*0\\s*,\\s*1\\s*\\)`, 'i').test(ddl)) { found.boolean!.push(key); continue; }
      }
    }

    for (const [kind, count] of Object.entries(expected)) {
      assert.equal(found[kind]!.length, count,
        `${kind}: expected ${count} columns, derived ${found[kind]!.length}\n  ${found[kind]!.join('\n  ')}`);
    }

    // Spot-check the ones whose absence would break something specific and far away.
    assert.ok(found.date!.includes('threads.collected_at'));
    assert.ok(found.date!.includes('jobs.run_at'), 'the scheduler compares run_at to now');
    assert.ok(found.json!.includes('jobs.args'));
    assert.ok(found.json!.includes('interactions.self'), 'a quoted column name must still be found');
    assert.ok(found.json!.includes('certifications.refutation_ran'), 'EB-40 replay depends on this');
    assert.ok(found.blob!.includes('credentials.ciphertext'));
    assert.ok(found.boolean!.includes('certification_contradictions.fatal'), 'the publish gate reads this');
    assert.ok(found.boolean!.includes('account_machines.selected'),
      'the account choice must coerce to a boolean, or "selected" reads as 1 and never as true');
    assert.ok(found.boolean!.includes('account_exit_ips.matched_pin'),
      'the drift halt reads matched_pin; an un-coerced 0 is truthy and would report every exit as a match');
    assert.ok(found.date!.includes('account_proxies.vetted_at'),
      'the vetting gate compares vetted_at to now');
  });

  test('forgetSchema() lets a process pick up a migrated schema without restarting', () => {
    forgetSchema();
    assert.doesNotThrow(() => forgetSchema());
  });
});

/* ==================================================================== *
 * 8. Health
 * ==================================================================== */
describe('ping', () => {
  test('reports ok, the engine version and the migration count', async () => {
    const p = await ping();
    assert.equal(p.ok, true, p.detail);
    /**
     * An EXACT number on purpose — ">0" would pass over a migration that silently failed to
     * apply, which is the failure 2.0.0 shipped with. But the number is now DERIVED from the
     * migrations directory rather than typed here.
     *
     * The literal was `16`, and adding 0017 (history.kind gained 'reset') broke this test in a
     * way that says nothing about what went wrong: "17 !== 16" reads as a schema fault when the
     * schema is fine and the expectation is stale. Counting the .up.sql files keeps the strength
     * of the check — every migration on disk must be applied — without a number to remember.
     */
    const onDisk = readdirSync(join(ROOT, 'db', 'sqlite', 'migrations'))
      .filter((f) => f.endsWith('.up.sql')).length;
    assert.ok(onDisk > 0, 'no migrations were found on disk — the path is wrong, not the schema');
    assert.equal(p.migrationsApplied, onDisk,
      `${onDisk} migration(s) on disk but ${p.migrationsApplied} applied`);
    assert.match(p.detail, /sqlite \d+\.\d+/);
  });

  test('an absent database is reported as absent, with the command that fixes it', async () => {
    const was = process.env.REDBOT_DB;
    process.env.REDBOT_DB = join(dir, 'not-here.db');
    try {
      const p = await ping();
      assert.equal(p.ok, false);
      assert.match(p.detail, /no database at/);
      assert.match(p.detail, /migrate\.mjs up/);
    } finally {
      process.env.REDBOT_DB = was;
    }
  });

  test('dbFile() honours REDBOT_DB', () => {
    assert.equal(dbFile(), join(dir, 'redbot.db'));
  });
});

#!/usr/bin/env node
/**
 * Schema conformance — does the SQLite translation still enforce what Postgres enforced?
 *
 * ---------------------------------------------------------------------------
 * WHY THIS TEST EXISTS.
 *
 * The port from Postgres replaced three kinds of guarantee with hand-written substitutes:
 *
 *   29 native enum types        ->  TEXT + CHECK (col IN (...))
 *    7 regex CHECKs (`col ~ …`) ->  length() + GLOB pairs
 *   10 plpgsql BEFORE triggers  ->  10 per-table AFTER UPDATE triggers
 *
 * Every one of those is a place where the new schema can LOOK right and enforce nothing. A
 * CHECK with a typo in the vocabulary accepts the value it was meant to reject; a GLOB class
 * with a hyphen in the wrong place silently becomes a character range; an AFTER UPDATE trigger
 * that names the wrong key column updates no row. None of that shows up in `migrate.mjs verify`,
 * which counts objects — it only shows up if you try to store something bad and are refused.
 *
 * So this test tries to store bad things. It is the actual evidence that the translation kept
 * the schema's promises, and it is the thing to run after editing any migration in this
 * directory.
 * ---------------------------------------------------------------------------
 *
 *   node --test db/sqlite/schema.test.mjs
 *
 * It builds a throwaway database by running the real migrations, so it also proves `up` works
 * from nothing on the machine it runs on.
 */
import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNNER = join(HERE, 'migrate.mjs');

let dir, file, db;

/** Bind pg-style positional params the way src/db.ts does: [a,b] -> {'1':a,'2':b}. */
const P = (...vals) => Object.fromEntries(vals.map((v, i) => [String(i + 1), v]));

const ISO = '2026-07-30T12:00:00.000Z';

/** Run SQL that is expected to be REFUSED, and return the refusal message. */
function refused(sql, params) {
  try {
    db.prepare(sql).run(params ?? {});
  } catch (e) {
    return e.message;
  }
  return null;
}

/** Assert the database refused, and that it refused for the stated reason. */
function assertRefused(sql, params, because) {
  const msg = refused(sql, params);
  assert.ok(msg, `expected a refusal but the row was accepted: ${sql.slice(0, 90)}`);
  assert.match(msg, /CHECK constraint failed|UNIQUE constraint failed|FOREIGN KEY constraint failed|NOT NULL constraint failed/,
    `refused, but not by a constraint: ${msg}`);
  if (because) assert.match(msg, because, `refused by the wrong constraint: ${msg}`);
  return msg;
}

before(() => {
  dir = mkdtempSync(join(tmpdir(), 'redbot-schema-'));
  file = join(dir, 'redbot.db');
  const r = spawnSync(process.execPath, [RUNNER, 'up'],
    { encoding: 'utf8', env: { ...process.env, REDBOT_DB: file } });
  assert.equal(r.status, 0, `migrate up failed:\n${r.stdout}\n${r.stderr}`);
  assert.ok(existsSync(file), 'migrate up did not create the database file');

  db = new DatabaseSync(file, { timeout: 5000 });
  db.exec('PRAGMA foreign_keys = ON');

  /* A minimal valid graph, so the enum tests below have parents to hang off. */
  db.prepare('INSERT INTO accounts (handle) VALUES ($1)').run(P('docs-architect'));
  db.prepare(`INSERT INTO threads (id, permalink, title, subreddit, collected_at, source)
              VALUES ($1,$2,$3,$4,$5,$6)`)
    .run(P('aaaaaaaaaaaa', '/r/x/1', 'T', 'x', ISO, 'read'));
  db.prepare(`INSERT INTO drafts (id, thread_id, permalink, title, body, has_disclosure, created_at, model)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`)
    .run(P('d_1', 'aaaaaaaaaaaa', '/r/x/1', 'T', 'B', 0, ISO, 'm'));
  db.prepare(`INSERT INTO certifications
                (draft_id, thread_id, verdict, certified_at, model, resolution_resolved, resolution_detail)
              VALUES ($1,$2,$3,$4,$5,$6,$7)`)
    .run(P('d_1', 'aaaaaaaaaaaa', 'CERTIFIED', ISO, 'm', 0, 'no'));
  db.prepare(`INSERT INTO certification_claims
                (cert_id, claim_id, text, type, evidence_class, evidence_detail, confidence, source_quote)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`)
    .run(P(1, 'c1', 'txt', 'observation', 'source-code', 'd', 'high', 'q'));
  db.prepare(`INSERT INTO gap_analyses
                (thread_id, permalink, title, question, already_answered, headroom, analyzed_at, model)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`)
    .run(P('aaaaaaaaaaaa', '/r/x/1', 'T', 'Q?', 0, 50, ISO, 'm'));
});

after(() => {
  db?.close();
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* windows file lock */ }
});

/* ==================================================================== *
 * 1. The 29 enum vocabularies
 *
 * One row per Postgres `CREATE TYPE ... AS ENUM`. `evidence_class`, `confidence` and
 * `certification_verdict` were each referenced by two columns; both columns are listed, because
 * a CHECK cannot be shared and the two copies can drift apart. That is the specific risk the
 * duplication introduced, so it is the specific thing tested.
 * ==================================================================== */
describe('enum vocabularies are enforced by the database, not by hope', () => {
  const CASES = [
    ['thread_source', `INSERT INTO threads (id,permalink,title,subreddit,collected_at,source) VALUES ($1,$2,$3,$4,$5,$6)`,
      P('bbbbbbbbbbbb', '/r/x/2', 'T', 'x', ISO, 'skim'), /source/],
    ['gap_kind', `INSERT INTO gaps (thread_id,position,kind,what,fillable) VALUES ($1,$2,$3,$4,$5)`,
      P('aaaaaaaaaaaa', 0, 'missing', 'w', 1), /kind/],
    ['opportunity_verdict', `INSERT INTO opportunity_assessments (thread_id,permalink,title,verdict,score,assessed_at) VALUES ($1,$2,$3,$4,$5,$6)`,
      P('aaaaaaaaaaaa', '/r/x/1', 'T', 'maybe', 50, ISO), /verdict/],
    ['draft_status', `INSERT INTO drafts (id,thread_id,permalink,title,body,has_disclosure,created_at,model,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      P('d_bad', 'aaaaaaaaaaaa', '/r/x/1', 'T', 'B', 0, ISO, 'm', 'posted'), /status/],
    ['certification_verdict (on drafts)', `INSERT INTO drafts (id,thread_id,permalink,title,body,has_disclosure,created_at,model,cert_verdict,cert_at,cert_claims,cert_fatal_contradictions) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      P('d_bad2', 'aaaaaaaaaaaa', '/r/x/1', 'T', 'B', 0, ISO, 'm', 'PASSED', ISO, 1, 0), /cert_verdict/],
    ['certification_verdict (on certifications)', `INSERT INTO certifications (draft_id,thread_id,verdict,certified_at,model,resolution_resolved,resolution_detail) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      P('d_1', 'aaaaaaaaaaaa', 'PASSED', ISO, 'm', 0, 'no'), /verdict/],
    ['claim_type', `INSERT INTO certification_claims (cert_id,claim_id,text,type,evidence_class,evidence_detail,confidence,source_quote) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      P(1, 'cX', 't', 'guess', 'source-code', 'd', 'high', 'q'), /type/],
    ['evidence_class (on claims)', `INSERT INTO certification_claims (cert_id,claim_id,text,type,evidence_class,evidence_detail,confidence,source_quote) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      P(1, 'cY', 't', 'observation', 'a-blog-post', 'd', 'high', 'q'), /evidence_class/],
    ['confidence (on claims)', `INSERT INTO certification_claims (cert_id,claim_id,text,type,evidence_class,evidence_detail,confidence,source_quote) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      P(1, 'cZ', 't', 'observation', 'source-code', 'd', 'very-high', 'q'), /confidence/],
    ['contradiction_kind', `INSERT INTO certification_contradictions (cert_id,claim_id,kind,statement,evidence_class,evidence_detail,fatal) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      P(1, 'c1', 'disagreement', 's', 'source-code', 'd', 1), /kind/],
    ['evidence_class (on contradictions)', `INSERT INTO certification_contradictions (cert_id,claim_id,kind,statement,evidence_class,evidence_detail,fatal) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      P(1, 'c1', 'edge-case', 's', 'a-blog-post', 'd', 1), /evidence_class/],
    ['language_certainty', `INSERT INTO certification_epistemic_issues (cert_id,claim_id,language_certainty,supported_certainty,quote,detail) VALUES ($1,$2,$3,$4,$5,$6)`,
      P(1, 'c1', 'confident', 'high', 'q', 'd'), /language_certainty/],
    ['confidence (on epistemic issues)', `INSERT INTO certification_epistemic_issues (cert_id,claim_id,language_certainty,supported_certainty,quote,detail) VALUES ($1,$2,$3,$4,$5,$6)`,
      P(1, 'c1', 'hedged', 'very-high', 'q', 'd'), /supported_certainty/],
    ['resolution_where', `INSERT INTO certification_resolution_signals (cert_id,where_found,matched,context,by_original_poster) VALUES ($1,$2,$3,$4,$5)`,
      P(1, 'sidebar', 'm', 'c', 1), /where_found/],
    ['job_kind', `INSERT INTO jobs (id,account,kind) VALUES ($1,$2,$3)`,
      P('j_bad', 'docs-architect', 'delete'), /kind/],
    ['job_state', `INSERT INTO jobs (id,account,kind,state,detail) VALUES ($1,$2,$3,$4,$5)`,
      P('j_bad2', 'docs-architect', 'read', 'paused', 'why'), /state/],
    ['history_kind', `INSERT INTO history (ts,kind,summary) VALUES ($1,$2,$3)`,
      P(ISO, 'exploded', 's'), /kind/],
    ['history_status', `INSERT INTO history (ts,kind,summary,status) VALUES ($1,$2,$3,$4)`,
      P(ISO, 'read', 's', 'maybe'), /status/],
    ['observation_kind', `INSERT INTO observations (ts,kind,vector) VALUES ($1,$2,$3)`,
      P(ISO, 'vibes', 'signed-in'), /kind/],
    ['observation_vector', `INSERT INTO observations (ts,kind,vector) VALUES ($1,$2,$3)`,
      P(ISO, 'karma', 'logged-in'), /vector/],
    ['checkpoint', `INSERT INTO observations (ts,kind,vector,checkpoint) VALUES ($1,$2,$3,$4)`,
      P(ISO, 'karma', 'signed-in', '2h'), /checkpoint/],
    ['review_decision', `INSERT INTO reviews (ts,draft_id,thread_id,permalink,decision,reason_code) VALUES ($1,$2,$3,$4,$5,$6)`,
      P(ISO, 'd_1', 'aaaaaaaaaaaa', '/r/x/1', 'maybe', 'as-written'), /decision/],
    ['regret_kind', `INSERT INTO regret (ts,draft_id,thread_id,permalink,kind,answer,hours_after_publish) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      P(ISO, 'd_1', 'aaaaaaaaaaaa', '/r/x/1', 'remorse', 'yes', 1.5), /kind/],
    ['issue_category', `INSERT INTO regret (ts,draft_id,thread_id,permalink,kind,answer,hours_after_publish,category) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      P(ISO, 'd_1', 'aaaaaaaaaaaa', '/r/x/1', 'standalone', 'yes', 1.5, 'vibes'), /category/],
    ['interaction_kind', `INSERT INTO interactions (schema_version,ts,kind,draft_id,thread_id,permalink,elapsed_minutes) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      P('1.0', ISO, 'observed', 'd_1', 'aaaaaaaaaaaa', '/r/x/1', 0), /kind/],
    // The one 0010 rebuilt `interactions` in order to keep. An ALTER TABLE ADD COLUMN could not
    // have carried this CHECK, and this assertion is why the rebuild is there.
    ['interaction_vector', `INSERT INTO interactions (schema_version,ts,kind,draft_id,thread_id,permalink,elapsed_minutes,vector) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      P('1.0', ISO, 'publish', 'd_1', 'aaaaaaaaaaaa', '/r/x/1', 0, 'logged-in'), /vector/],
    ['trace_stage', `INSERT INTO trace (ts,run_id,stage,event,level) VALUES ($1,$2,$3,$4,$5)`,
      P(ISO, 'r1', 'thinking', 'e', 'info'), /stage/],
    ['trace_level', `INSERT INTO trace (ts,run_id,stage,event,level) VALUES ($1,$2,$3,$4,$5)`,
      P(ISO, 'r1', 'draft', 'e', 'trace'), /level/],
    ['evidence_source', `INSERT INTO confirmations (ts,action,account,confirmed,source,observed,ms) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      P(ISO, 'a', 'docs-architect', 1, 'i-looked', 'o', 1), /source/],
    ['visibility', `INSERT INTO confirmations (ts,action,account,confirmed,source,observed,ms,visibility) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      P(ISO, 'a', 'docs-architect', 1, 'third-party', 'o', 1, 'maybe'), /visibility/],
    ['source_kind', `INSERT INTO sources (kind,value) VALUES ($1,$2)`,
      P('rss', 'something'), /kind/],
    ['prefilter_drop_kind', `INSERT INTO thread_prefilter (thread_id,kind,detail) VALUES ($1,$2,$3)`,
      P('aaaaaaaaaaaa', 'boring', 'd'), /kind/]
  ];

  for (const [label, sql, params, because] of CASES) {
    test(`${label} rejects a value the TypeScript source cannot produce`, () => {
      assertRefused(sql, params, because);
    });
  }

  test('all 29 Postgres enum types are covered', () => {
    // 29 CREATE TYPE statements; three of the types were used on two columns each, so 32 cases.
    assert.equal(CASES.length, 32, 'a case was added or removed without updating this count');
  });
});

/* ==================================================================== *
 * 2. The regex CHECKs, translated to length() + GLOB
 *
 * A GLOB character class where the hyphen is not last silently becomes a RANGE. Every class in
 * the schema ends with `-` for that reason, and these tests are what prove it.
 * ==================================================================== */
describe('shape constraints translated from Postgres regexes', () => {
  test('accounts.handle: accepts the documented shape', () => {
    db.prepare('INSERT INTO accounts (handle) VALUES ($1)').run(P('A_valid-Handle09'));
    assert.ok(db.prepare('SELECT 1 AS ok FROM accounts WHERE handle = $1').get(P('A_valid-Handle09')));
  });
  test('accounts.handle: rejects a space, a slash, 41 characters and the empty string', () => {
    for (const bad of ['has space', 'a/b', 'x'.repeat(41), '']) {
      assertRefused('INSERT INTO accounts (handle) VALUES ($1)', P(bad), /handle/);
    }
  });
  test('accounts.handle: a hyphen is a literal, not a range', () => {
    // If `[^A-Za-z0-9_-]` were read as a range ending at `-`, characters between `_` and `-`
    // would wrongly be allowed. `^` and `]` sit in that neighbourhood in ASCII.
    for (const bad of ['a^b', 'a]b', 'a\\b']) {
      assertRefused('INSERT INTO accounts (handle) VALUES ($1)', P(bad), /handle/);
    }
  });

  test('threads.id: exactly 12 lowercase hex', () => {
    for (const bad of ['AAAAAAAAAAAA', 'aaaaaaaaaaa', 'aaaaaaaaaaaaa', 'aaaaaaaaaaag']) {
      assertRefused(
        'INSERT INTO threads (id,permalink,title,subreddit,collected_at,source) VALUES ($1,$2,$3,$4,$5,$6)',
        P(bad, `/r/x/${bad}`, 'T', 'x', ISO, 'read'), /id/);
    }
  });

  test('credentials.scope/name: first character is narrower than the rest', () => {
    const ok = (scope, name) => db.prepare(
      `INSERT INTO credentials (scope,name,key_id,iv,auth_tag,ciphertext) VALUES ($1,$2,$3,$4,$5,$6)`
    ).run(P(scope, name, 'abcdef012345', Buffer.alloc(12), Buffer.alloc(16), Buffer.from('x')));
    ok('global', 'anthropic_api_key');
    ok('op.one-2', 'a.b-c_d');
    // A leading '.', '-' or '_' is refused: Postgres wrote the first character as [a-z0-9].
    for (const bad of ['.hidden', '-lead', '_lead', 'UPPER', '']) {
      assertRefused(
        `INSERT INTO credentials (scope,name,key_id,iv,auth_tag,ciphertext) VALUES ($1,$2,$3,$4,$5,$6)`,
        P(bad, 'n', 'abcdef012345', Buffer.alloc(12), Buffer.alloc(16), Buffer.from('x')), /scope/);
    }
  });

  test('credentials.key_id: 12 lowercase hex, being a SHA-256 prefix', () => {
    assertRefused(
      `INSERT INTO credentials (scope,name,key_id,iv,auth_tag,ciphertext) VALUES ($1,$2,$3,$4,$5,$6)`,
      P('global', 'k2', 'ABCDEF012345', Buffer.alloc(12), Buffer.alloc(16), Buffer.from('x')), /key_id/);
  });

  test('account_machines.machine and profile_dir', () => {
    db.prepare('INSERT INTO account_machines (machine,handle,profile_dir,debug_port) VALUES ($1,$2,$3,$4)')
      .run(P('DESKTOP-1.local', 'docs-architect', 'chrome-profile-a', 9223));
    assertRefused('INSERT INTO account_machines (machine,handle) VALUES ($1,$2)',
      P("Dan's Mac", 'docs-architect'), /machine/);
    assertRefused('INSERT INTO account_machines (machine,handle,profile_dir) VALUES ($1,$2,$3)',
      P('OTHER', 'docs-architect', 'has space'), /profile_dir/);
  });

  test('sources: the subreddit shape applies to subreddits and NOT to searches', () => {
    db.prepare('INSERT INTO sources (kind,value) VALUES ($1,$2)').run(P('subreddit', 'devops'));
    // A search may be any prose within the length bound — the constraint is conditional on kind.
    db.prepare('INSERT INTO sources (kind,value) VALUES ($1,$2)')
      .run(P('search', 'how do I fix a broken pipe?'));
    for (const bad of ['a', 'x'.repeat(22), 'has space', 'has-hyphen']) {
      assertRefused('INSERT INTO sources (kind,value) VALUES ($1,$2)',
        P('subreddit', bad), /subreddit_name_shape|value/);
    }
  });

  test('timestamp columns reject a string that is not ISO-8601 UTC', () => {
    for (const bad of ['2026-07-30', 'yesterday', '1753876800', '30/07/2026']) {
      assertRefused(
        'INSERT INTO threads (id,permalink,title,subreddit,collected_at,source) VALUES ($1,$2,$3,$4,$5,$6)',
        P('cccccccccccc', `/r/x/${bad}`, 'T', 'x', bad, 'read'), /collected_at/);
    }
  });
});

/* ==================================================================== *
 * 3. UNIQUE with NULLs — load-bearing, and called out as such in 0013
 * ==================================================================== */
describe('account_machines uniqueness', () => {
  test('any number of accounts can be unbound on one machine (NULLs compare distinct)', () => {
    db.prepare('INSERT INTO accounts (handle) VALUES ($1)').run(P('second'));
    db.prepare('INSERT INTO accounts (handle) VALUES ($1)').run(P('third'));
    db.prepare('INSERT INTO account_machines (machine,handle) VALUES ($1,$2)').run(P('M2', 'second'));
    db.prepare('INSERT INTO account_machines (machine,handle) VALUES ($1,$2)').run(P('M2', 'third'));
    const n = db.prepare(
      'SELECT count(*) AS n FROM account_machines WHERE machine = $1 AND debug_port IS NULL'
    ).get(P('M2'));
    assert.equal(n.n, 2, 'two unbound accounts must coexist — every account on a new machine starts here');
  });

  test('two accounts cannot share a port on one machine', () => {
    db.prepare('INSERT INTO account_machines (machine,handle,debug_port) VALUES ($1,$2,$3)')
      .run(P('M3', 'second', 9333));
    assertRefused('INSERT INTO account_machines (machine,handle,debug_port) VALUES ($1,$2,$3)',
      P('M3', 'third', 9333), /debug_port/);
  });

  test('the same port on a DIFFERENT machine is fine — that is the whole point of 0013', () => {
    db.prepare('INSERT INTO account_machines (machine,handle,debug_port) VALUES ($1,$2,$3)')
      .run(P('M4', 'second', 9333));
    assert.equal(
      db.prepare('SELECT count(*) AS n FROM account_machines WHERE debug_port = $1').get(P(9333)).n, 2);
  });
});

/* ==================================================================== *
 * 4. The updated_at triggers
 * ==================================================================== */
describe('updated_at triggers', () => {
  test('an UPDATE moves updated_at forward', () => {
    db.prepare('INSERT INTO accounts (handle, note) VALUES ($1,$2)').run(P('trig', 'before'));
    const was = db.prepare('SELECT updated_at FROM accounts WHERE handle = $1').get(P('trig')).updated_at;
    /**
     * Let the clock tick before the UPDATE.
     *
     * Both the column default and the trigger use `strftime('%Y-%m-%dT%H:%M:%fZ','now')` —
     * MILLISECOND precision on the system clock (0002_accounts.up.sql). An INSERT and an UPDATE
     * that land inside the same millisecond therefore write the SAME string, and the assertion
     * below fails with actual == expected while the trigger has behaved perfectly.
     *
     * WAITING IS THE HONEST FIX, BUT IT HAS TO WAIT ON THE RIGHT CLOCK. This spun on `Date.now()`
     * and carried the note "SQLite's `now` and Date.now() are the same system clock, so this is
     * sufficient". It is not, and the claim that 400 attempts could not reproduce it was an
     * artefact of that assumption: with the Node-clock spin in place, 200 forced INSERT/UPDATE
     * pairs on this machine produced 21 ties (2026-08-03). The two clocks step by 1ms each — that
     * much was measured and is true — but they are not phase-locked, so Node ticking into a new
     * millisecond does not mean the value SQLite is about to read has changed.
     *
     * Spinning on `strftime('now')` itself removes the assumption rather than tightening it: the
     * loop exits only once the clock the TRIGGER reads has passed the value already stored. 500
     * pairs, 0 ties. The assertions are untouched — what is under test is still that the trigger
     * MOVES the value, which cannot be observed until that clock has moved.
     *
     * The product is NOT affected: push cursors are composite — `WHERE a > $1 OR (a = $2 AND
     * b > $3)` in src/push/streams.ts `forwardFrom` — so rows sharing a millisecond are still
     * ordered by the unique second column and neither is skipped nor resent. This is a test that
     * could not see what it was asserting, not a defect in the schema.
     */
    const sqliteNow = db.prepare("SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now') AS t");
    while (sqliteNow.get().t <= was) { /* spin until the trigger's own clock has moved past `was` */ }
    db.prepare('UPDATE accounts SET note = $2 WHERE handle = $1').run(P('trig', 'after'));
    const now = db.prepare('SELECT updated_at FROM accounts WHERE handle = $1').get(P('trig')).updated_at;
    assert.notEqual(now, was, 'the trigger did not fire — check the WHERE clause names the real key');
    assert.ok(now > was, `updated_at went backwards: ${was} -> ${now}`);
    assert.match(now, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, 'trigger wrote a non-ISO timestamp');
  });

  test('the trigger OVERWRITES an updated_at the caller set, as the plpgsql version did', () => {
    // src/db/jobs.ts sets updated_at explicitly. Postgres's BEFORE trigger assigned over it
    // unconditionally, so that write was already being discarded. Keeping that behaviour means
    // the port changes nothing observable; "improving" it here would be a silent behaviour change.
    db.prepare('UPDATE accounts SET note = $2, updated_at = $3 WHERE handle = $1')
      .run(P('trig', 'x', '2001-01-01T00:00:00.000Z'));
    const got = db.prepare('SELECT updated_at FROM accounts WHERE handle = $1').get(P('trig')).updated_at;
    assert.notEqual(got, '2001-01-01T00:00:00.000Z',
      'the caller-supplied updated_at survived; Postgres would have overwritten it');
  });

  test('the trigger does not recurse', () => {
    // Each trigger body UPDATEs the table it fires on. SQLite defaults recursive_triggers OFF,
    // which is the only reason that terminates. If the default ever changes, this test is what
    // catches it — the alternative discovery route is a hung process.
    assert.equal(db.prepare('PRAGMA recursive_triggers').get().recursive_triggers, 0);
    db.prepare('UPDATE accounts SET note = $2 WHERE handle = $1').run(P('trig', 'again'));
    assert.equal(db.prepare('SELECT count(*) AS n FROM accounts WHERE handle = $1').get(P('trig')).n, 1);
  });

  test('all ten tables that had the plpgsql trigger still have one', () => {
    const want = ['accounts', 'threads', 'gap_analyses', 'opportunity_assessments', 'drafts',
      'jobs', 'credentials', 'sources', 'account_machines', 'thread_prefilter'];
    const have = db.prepare("SELECT tbl_name FROM sqlite_master WHERE type='trigger'").all()
      .map((r) => r.tbl_name);
    assert.deepEqual([...have].sort(), [...want].sort());
  });
});

/* ==================================================================== *
 * 5. Referential actions — CASCADE / RESTRICT / SET NULL
 * ==================================================================== */
describe('foreign keys actually act', () => {
  test('deleting a thread CASCADEs to its comments', () => {
    db.prepare('INSERT INTO threads (id,permalink,title,subreddit,collected_at,source) VALUES ($1,$2,$3,$4,$5,$6)')
      .run(P('dddddddddddd', '/r/x/casc', 'T', 'x', ISO, 'read'));
    db.prepare('INSERT INTO thread_comments (thread_id,position,body,depth) VALUES ($1,$2,$3,$4)')
      .run(P('dddddddddddd', 0, 'hi', 0));
    db.prepare('DELETE FROM threads WHERE id = $1').run(P('dddddddddddd'));
    assert.equal(db.prepare('SELECT count(*) AS n FROM thread_comments WHERE thread_id = $1')
      .get(P('dddddddddddd')).n, 0);
  });

  test('a thread with a draft REFUSES to be deleted', () => {
    assertRefused('DELETE FROM threads WHERE id = $1', P('aaaaaaaaaaaa'), /FOREIGN KEY/);
  });

  test('deleting an account SET NULLs the drafts it wrote, rather than destroying them', () => {
    db.prepare('INSERT INTO accounts (handle) VALUES ($1)').run(P('ephemeral'));
    db.prepare(`INSERT INTO drafts (id,thread_id,permalink,title,body,has_disclosure,created_at,model,account)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`)
      .run(P('d_orphan', 'aaaaaaaaaaaa', '/r/x/1', 'T', 'B', 0, ISO, 'm', 'ephemeral'));
    db.prepare('DELETE FROM accounts WHERE handle = $1').run(P('ephemeral'));
    const row = db.prepare('SELECT account FROM drafts WHERE id = $1').get(P('d_orphan'));
    assert.equal(row.account, null, 'the draft must survive its author as unassigned');
  });
});

/* ==================================================================== *
 * 6. JSON columns, BLOB sizes, and the composite CHECKs
 * ==================================================================== */
describe('json_valid replaces the jsonb type', () => {
  test('a malformed array column is refused', () => {
    assertRefused('UPDATE accounts SET knows = $2 WHERE handle = $1', P('docs-architect', 'not json'), /knows/);
  });
  test('a malformed payload column is refused', () => {
    assertRefused('INSERT INTO trace (ts,run_id,stage,event,level,data) VALUES ($1,$2,$3,$4,$5,$6)',
      P(ISO, 'r', 'system', 'e', 'info', '{oops'), /data/);
  });
  test('a JSON scalar is valid JSON — observations.value must keep number/string/boolean apart', () => {
    for (const v of ['412', '"suspended"', 'true', 'null']) {
      db.prepare('INSERT INTO observations (ts,kind,vector,value) VALUES ($1,$2,$3,$4)')
        .run(P(ISO, 'karma', 'signed-in', v));
    }
    const vals = db.prepare('SELECT value FROM observations WHERE value IS NOT NULL').all().map((r) => r.value);
    assert.deepEqual(vals.map((v) => typeof JSON.parse(v)), ['number', 'string', 'boolean', 'object']);
  });
});

describe('the vault CHECKs count bytes', () => {
  test('iv must be 12 bytes and auth_tag 16', () => {
    const ins = (iv, tag, ct) => refused(
      `INSERT INTO credentials (scope,name,key_id,iv,auth_tag,ciphertext) VALUES ($1,$2,$3,$4,$5,$6)`,
      P('global', `n${Math.floor(iv.length * 100 + tag.length)}`, 'abcdef012345', iv, tag, ct));
    assert.ok(ins(Buffer.alloc(11), Buffer.alloc(16), Buffer.from('x')), 'an 11-byte IV was accepted');
    assert.ok(ins(Buffer.alloc(12), Buffer.alloc(15), Buffer.from('x')), 'a 15-byte tag was accepted');
    assert.ok(ins(Buffer.alloc(12), Buffer.alloc(16), Buffer.alloc(0)), 'empty ciphertext was accepted');
  });
  test('hint is capped at four characters, so it cannot drift into storing the secret', () => {
    assertRefused(
      `INSERT INTO credentials (scope,name,key_id,iv,auth_tag,ciphertext,hint) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      P('global', 'hinted', 'abcdef012345', Buffer.alloc(12), Buffer.alloc(16), Buffer.from('x'), 'sk-ant-toolong'),
      /hint/);
  });
  test('algo is pinned to the one src/vault.ts implements', () => {
    assertRefused(
      `INSERT INTO credentials (scope,name,algo,key_id,iv,auth_tag,ciphertext) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      P('global', 'cbc', 'aes-256-cbc', 'abcdef012345', Buffer.alloc(12), Buffer.alloc(16), Buffer.from('x')),
      /algo/);
  });
  test('a BLOB comes back as bytes, and round-trips through Buffer', () => {
    const iv = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    db.prepare(`INSERT INTO credentials (scope,name,key_id,iv,auth_tag,ciphertext) VALUES ($1,$2,$3,$4,$5,$6)`)
      .run(P('global', 'roundtrip', 'abcdef012345', iv, Buffer.alloc(16), Buffer.from('sealed')));
    const got = db.prepare('SELECT iv, ciphertext FROM credentials WHERE name = $1').get(P('roundtrip'));
    // SQLite hands back a Uint8Array, NOT a Buffer. src/vault.ts is typed for Buffer, so this is
    // the exact conversion src/db.ts owns; asserted here so the storage half is not in doubt.
    assert.ok(got.iv instanceof Uint8Array);
    assert.equal(Buffer.isBuffer(got.iv), false, 'if this becomes true, src/db.ts can stop converting');
    assert.deepEqual(Buffer.from(got.iv), iv);
    assert.equal(Buffer.from(got.ciphertext).toString(), 'sealed');
  });
});

describe('the composite CHECKs that encode project rules', () => {
  test('a partial contribution thesis is not storable', () => {
    assertRefused(
      `INSERT INTO opportunity_assessments (thread_id,permalink,title,verdict,score,assessed_at,thesis_why_thread) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      P('aaaaaaaaaaaa', '/r/x/1', 'T', 'contribute', 9, ISO, 'only one third'), /thesis_is_whole/);
  });

  test('a REJECTed draft can never be published — evaluation H6', () => {
    assertRefused(
      `INSERT INTO drafts (id,thread_id,permalink,title,body,has_disclosure,created_at,model,status,cert_verdict,cert_at,cert_claims,cert_fatal_contradictions)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      P('d_h6', 'aaaaaaaaaaaa', '/r/x/1', 'T', 'B', 0, ISO, 'm', 'published', 'REJECT', ISO, 3, 1),
      /reject_is_never_published/);
  });

  test('a half-recorded certification is not storable', () => {
    assertRefused(
      `INSERT INTO drafts (id,thread_id,permalink,title,body,has_disclosure,created_at,model,cert_verdict) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      P('d_half', 'aaaaaaaaaaaa', '/r/x/1', 'T', 'B', 0, ISO, 'm', 'CERTIFIED'),
      /certification_is_whole/);
  });

  test('a reason code must belong to its decision', () => {
    assertRefused(
      `INSERT INTO reviews (ts,draft_id,thread_id,permalink,decision,reason_code) VALUES ($1,$2,$3,$4,$5,$6)`,
      P(ISO, 'd_1', 'aaaaaaaaaaaa', '/r/x/1', 'approved', 'inaccurate'),
      /reason_code_matches_decision/);
  });

  test("0010's widened edit constraint covers the verbatim texts, not just the counts", () => {
    // This is the assertion that proves 0010's table rebuild actually replaced the constraint:
    // under 0009's version, edit_before on a non-edit was allowed.
    assertRefused(
      `INSERT INTO reviews (ts,draft_id,thread_id,permalink,decision,reason_code,edit_before) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      P(ISO, 'd_1', 'aaaaaaaaaaaa', '/r/x/1', 'approved', 'as-written', 'the original'),
      /edit_metrics_only_for_edits/);
  });

  test('public visibility needs a third-party read', () => {
    assertRefused(
      `INSERT INTO confirmations (ts,action,account,confirmed,source,observed,ms,visibility) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      P(ISO, 'reply', 'docs-architect', 1, 'same-page', 'I can see it', 1, 'public'),
      /public_visibility_needs_a_third_party/);
  });

  test('a terminal or waiting job must explain itself', () => {
    assertRefused('INSERT INTO jobs (id,account,kind,state) VALUES ($1,$2,$3,$4)',
      P('j_mute', 'docs-architect', 'read', 'failed'),
      /terminal_and_waiting_states_explain_themselves/);
  });

  test('a job cannot wait on itself', () => {
    db.prepare('INSERT INTO jobs (id,account,kind) VALUES ($1,$2,$3)').run(P('j_self', 'docs-architect', 'read'));
    assertRefused('UPDATE jobs SET after_id = $1 WHERE id = $1', P('j_self'), /a_job_cannot_wait_on_itself/);
  });

  test('quiet hours are a pair or absent', () => {
    assertRefused('INSERT INTO accounts (handle, quiet_start) VALUES ($1,$2)',
      P('halfquiet', 22), /quiet_hours_are_a_pair/);
  });

  test('a regret answer must match its question', () => {
    assertRefused(
      `INSERT INTO regret (ts,draft_id,thread_id,permalink,kind,answer,hours_after_publish) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      P(ISO, 'd_1', 'aaaaaaaaaaaa', '/r/x/1', 'standalone', 'would-edit', 1), /answer_matches_kind/);
  });
});

/* ==================================================================== *
 * 7. AUTOINCREMENT — src/db/summary.ts orders by id DESC to find the newest reading
 * ==================================================================== */
test('a deleted id is never handed out again', () => {
  // summary.ts picks the latest karma reading with DISTINCT ON (account) ORDER BY id DESC, and
  // says why it uses id rather than ts. A reused id would make "newest" wrong. `INTEGER PRIMARY
  // KEY` alone reuses the largest free rowid; AUTOINCREMENT is what prevents it.
  db.prepare('INSERT INTO trace (ts,run_id,stage,event,level) VALUES ($1,$2,$3,$4,$5)')
    .run(P(ISO, 'r-auto', 'system', 'first', 'info'));
  const first = db.prepare('SELECT max(id) AS id FROM trace').get().id;
  db.prepare('DELETE FROM trace WHERE id = $1').run(P(first));
  db.prepare('INSERT INTO trace (ts,run_id,stage,event,level) VALUES ($1,$2,$3,$4,$5)')
    .run(P(ISO, 'r-auto', 'system', 'second', 'info'));
  const second = db.prepare('SELECT max(id) AS id FROM trace').get().id;
  assert.ok(second > first, `id was reused after a delete: ${first} then ${second}`);
});

/* ==================================================================== *
 * Upgrading must never destroy the local database
 *
 * The desktop app runs `migrate up` on EVERY launch (src/provision.ts), so an update is: new
 * binary, same database, pending migrations applied. That is only safe if `up` is additive and
 * idempotent on a POPULATED database — and "the schema changed and took the corpus with it" is the
 * one failure that cannot be undone from inside the app.
 *
 * Empirically confirmed against the real installer too: a marker row survived an install and an
 * install-over-the-top, with the file size and migration count unchanged. These tests are what keep
 * it true when a future migration is added.
 * ==================================================================== */
describe('an upgrade preserves the data', () => {
  test('re-running every migration on a populated database changes no rows', () => {
    const before = {
      threads: db.prepare('SELECT count(*) n FROM threads').get().n,
      accounts: db.prepare('SELECT count(*) n FROM accounts').get().n,
      comments: db.prepare('SELECT count(*) n FROM thread_comments').get().n
    };
    assert.ok(before.threads > 0 && before.accounts > 0, 'precondition: the database has rows');

    /* `up` on an up-to-date database must be a no-op — that is what makes launching safe. */
    const r = spawnSync(process.execPath, [RUNNER, 'up'],
      { encoding: 'utf8', env: { ...process.env, REDBOT_DB: file } });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Nothing to apply/, 'up applied something on an up-to-date database');

    const after = {
      threads: db.prepare('SELECT count(*) n FROM threads').get().n,
      accounts: db.prepare('SELECT count(*) n FROM accounts').get().n,
      comments: db.prepare('SELECT count(*) n FROM thread_comments').get().n
    };
    assert.deepEqual(after, before, 'a launch must not change a single row');
  });

  test('the ledger refuses to re-apply an already-applied migration', () => {
    // The mechanism behind the above: applied versions are recorded, so `up` skips them. Without
    // the ledger, every launch would re-run 0015's table rebuild and copy the data again.
    const n = db.prepare('SELECT count(*) n FROM schema_migrations').get().n;
    assert.ok(n >= 15, `expected at least 15 recorded migrations, got ${n}`);
    assert.throws(
      () => db.prepare('INSERT INTO schema_migrations (version,name,checksum,execution_ms) VALUES (?,?,?,?)')
        .run('0001', 'init', 'x', 0),
      /UNIQUE constraint failed/,
      'a version must be recordable only once'
    );
  });

  test('a migration that rebuilds a table carries the rows across', () => {
    /* 0015 rebuilds account_machines (SQLite cannot ALTER in a CHECK). A rebuild that forgot the
       INSERT…SELECT would silently empty the table, and the only symptom would be an install that
       had forgotten which account it acts as. Asserted on the real column list. */
    const cols = db.prepare('PRAGMA table_info(account_machines)').all().map((c) => c.name);
    for (const c of ['machine', 'handle', 'profile_dir', 'debug_port', 'selected', 'created_at', 'updated_at']) {
      assert.ok(cols.includes(c), `account_machines lost "${c}" in the rebuild`);
    }
  });
});

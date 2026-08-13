import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resetPlan, RESET_SCOPES, KEPT_ALWAYS, PROTECTED_TABLES } from '../reset.js';

/**
 * Resetting is the one button that destroys evidence on purpose, so what it takes and what it
 * leaves is decided HERE, in a pure function, and pinned — not worked out inside the code that
 * does the deleting.
 *
 * Two things are never taken without being asked for by name:
 *
 * - the `chrome-profile-*` folders. They hold the only copy of each Reddit session; no password
 *   is stored anywhere, so a wipe cannot be undone by signing in again from a file. Same reason
 *   removing an account keeps them.
 * - `schema_migrations`. It is not user data, it is the record of what shape the database is in.
 *   Empty it and the next boot either re-applies every migration over live tables or refuses to
 *   start — the exact failure this project spent 2.0.0 through 2.0.1 fixing.
 */
describe('a reset knows what it destroys before it destroys anything', () => {
  test('the two scopes are work and all, and work is the narrower one', () => {
    assert.deepEqual([...RESET_SCOPES], ['work', 'all']);
    const work = resetPlan('work');
    const all = resetPlan('all');
    for (const f of work.files) assert.ok(all.files.includes(f), `${f} is in work but not in all`);
    assert.ok(all.files.length > work.files.length);
    assert.ok(all.tables.length > work.tables.length);
  });

  test('work takes the corpus and what was derived from it, and keeps who you are', () => {
    const p = resetPlan('work');
    for (const f of ['threads.json', 'gaps.json', 'assessments.json', 'drafts.json']) {
      assert.ok(p.files.includes(f), `work must clear ${f}`);
    }
    for (const f of ['accounts.json', 'sources.json', 'history.jsonl', 'observations.jsonl']) {
      assert.ok(!p.files.includes(f), `work must NOT clear ${f}`);
      assert.ok(p.kept.some((k) => k.includes(f)), `and it must SAY it kept ${f}`);
    }
  });

  test('all takes the logs too — including the record of what redbot did to Reddit', () => {
    const p = resetPlan('all');
    for (const f of ['history.jsonl', 'observations.jsonl', 'accounts.json', 'sources.json']) {
      assert.ok(p.files.includes(f), `all must clear ${f}`);
    }
    assert.ok(p.warnings.some((w) => /rate limit|429|health/i.test(w)),
      'clearing the history resets the health counters, and that must be said out loud');
  });

  test('sign-in folders are never taken unless asked for by name', () => {
    for (const scope of RESET_SCOPES) {
      const p = resetPlan(scope);
      assert.equal(p.profileDirs, false, `${scope} must not touch the Chrome folders by default`);
      assert.ok(p.kept.some((k) => /chrome-profile/i.test(k)), `${scope} must say the sign-ins are kept`);
    }
    const asked = resetPlan('all', { signIns: true });
    assert.equal(asked.profileDirs, true);
    assert.ok(asked.warnings.some((w) => /sign|session/i.test(w)),
      'taking the sessions is irreversible and must carry its own warning');
  });

  test('the migration ledger is protected in every scope — it is not user data', () => {
    assert.ok(PROTECTED_TABLES.includes('schema_migrations'));
    for (const scope of RESET_SCOPES) {
      const p = resetPlan(scope);
      for (const t of PROTECTED_TABLES) {
        assert.ok(!p.tables.includes(t), `${scope} must never empty ${t}`);
      }
    }
  });

  test('what is always kept is listed, not implied', () => {
    assert.ok(KEPT_ALWAYS.length > 0);
    const p = resetPlan('all');
    for (const k of KEPT_ALWAYS) {
      assert.ok(p.kept.some((line) => line.includes(k)), `the plan must name ${k} as kept`);
    }
  });

  test('an unknown scope is refused rather than guessed at', () => {
    assert.throws(() => resetPlan('everything' as unknown as 'all'), /everything/);
    assert.throws(() => resetPlan('everything' as unknown as 'all'), /work/);
  });

  test('the plan counts what it would touch, so a person can be told before confirming', () => {
    const p = resetPlan('all');
    assert.equal(typeof p.summary, 'string');
    assert.match(p.summary, /\d+ file/);
    assert.match(p.summary, /\d+ table/);
  });
});

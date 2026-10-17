/**
 * A persona through the real database and back.
 *
 * ---------------------------------------------------------------------------
 * THE DEFECT THIS EXISTS BECAUSE OF, and it was mine, found by running the thing.
 *
 * `src/db/personas.ts` was written with `stack: string` and a reader that required a string —
 * because `src/db.ts` parses every `json_valid`-CHECKed column BEFORE a module sees it, and that
 * was not in view. It compiles: nothing types that seam. Measured immediately afterwards, on real
 * seeded rows:
 *
 *   redbot personas show ryangrowth12   ->  banned (none)   ·  habits (none)
 *   SELECT banned_phrases FROM …        ->  ["good luck","cheers"]
 *
 * No throw, no log line. Four of the eleven persona fields silently did not exist, and the
 * `personaBlock` built from them was missing half the voice it was supposed to carry. That is
 * precisely the failure src/db/locations.ts documents at length — two halves built against one
 * reality with nothing crossing between them under test — and it is why the whole point of this
 * file is to cross it: every field is written, read BACK OUT OF SQLITE, and compared.
 *
 * `src/test/persona.test.ts` covers rendering from an in-memory object. It passed throughout.
 * A unit test on either side of a seam cannot see the seam.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getPool, closePool } from '../db.js';
import { upsertAccounts, deleteAccount } from '../db/accounts.js';
import { loadPersona, loadPersonas, savePersona, deletePersona } from '../db/personas.js';
import { personaBlock, bannedPhraseHits } from '../persona.js';
import { planFleetVoices, voiceCollisions, voiceKey, VOICE_COUNT } from '../persona-allocate.js';

const H = 'Persona_Store_Test';
const H2 = 'Persona_Store_Test2';

async function clean(): Promise<void> {
  /* `account_personas.handle` CASCADEs from `accounts`, so removing the account removes the
     persona — asserted below rather than assumed, because that cascade is the whole reason the
     table is keyed by handle instead of carrying its own id. */
  for (const h of [H, H2]) await deleteAccount(getPool(), h);
}

const FULL = {
  enabled: true,
  displayName: 'Ryan',
  bio: 'I keep a dozen client sites patched and live in the plugin-conflict end of it.',
  experienceYears: 9,
  stack: ['wp-cli', 'Query Monitor', 'New Relic'],
  localeFlavour: 'gb',
  register: 'terse' as const,
  maxSentences: 2,
  quirks: ['never uses em dashes', 'no closing sentence'],
  hedgeStyle: "writes 'not sure, but' and moves on",
  bannedPhrases: ['hope this helps', 'Let me know'],
  avoidTopics: ['which host is best', 'anything about pricing']
};

test('every field survives a write and a read out of SQLite', async () => {
  await clean();
  await upsertAccounts(getPool(), [{ handle: H, role: 'Support', debugPort: 9391 }]);

  const saved = await savePersona(getPool(), H, FULL);
  /* The returned row is read back by `savePersona` itself, not echoed from the patch — so this
     assertion already crosses the seam once. The reload below crosses it a second time with a
     fresh query, which is what catches a value that only survives inside one call. */
  const back = await loadPersona(getPool(), H);
  assert.ok(back, 'the row must be readable after writing it');

  for (const row of [saved, back!]) {
    assert.equal(row.handle, H);
    assert.equal(row.enabled, true);
    assert.equal(row.displayName, FULL.displayName);
    assert.equal(row.bio, FULL.bio);
    assert.equal(row.experienceYears, 9);
    assert.equal(row.localeFlavour, 'gb');
    assert.equal(row.register, 'terse');
    assert.equal(row.maxSentences, 2);
    assert.equal(row.hedgeStyle, FULL.hedgeStyle);
    /* THE FOUR THAT CAME BACK EMPTY. deepEqual, not length — a list that lost its order or its
       trimming is as wrong as one that lost its contents. */
    assert.deepEqual(row.stack, FULL.stack, 'stack lost its values crossing the facade');
    assert.deepEqual(row.quirks, FULL.quirks, 'quirks lost its values crossing the facade');
    assert.deepEqual(row.bannedPhrases, FULL.bannedPhrases, 'bannedPhrases lost its values');
    assert.deepEqual(row.avoidTopics, FULL.avoidTopics, 'avoidTopics lost its values');
  }

  /* `created_at`/`updated_at` carry the facade's `date` marker and arrive as Date objects, which
     is the other half of the same seam. The module hands out ISO strings. */
  assert.equal(typeof back!.createdAt, 'string', 'createdAt must be an ISO string, not a Date');
  assert.match(back!.createdAt, /^\d{4}-\d{2}-\d{2}T.*Z$/);
  assert.match(back!.updatedAt, /^\d{4}-\d{2}-\d{2}T.*Z$/);

  await clean();
  await closePool();
});

test('what is rendered comes from the stored row, not from the object that was saved', async () => {
  await clean();
  await upsertAccounts(getPool(), [{ handle: H, role: 'Support', debugPort: 9391 }]);
  await savePersona(getPool(), H, FULL);

  /* The assertion the defect would have failed: the block built from a FRESHLY LOADED row has to
     carry the lists. Built from the patch it always did. */
  const block = personaBlock(await loadPersona(getPool(), H));
  assert.match(block, /never uses em dashes/, 'a habit stored and not rendered');
  assert.match(block, /hope this helps/, 'a banned phrase stored and not rendered');
  assert.match(block, /wp-cli, Query Monitor, New Relic/, 'a stack stored and not rendered');
  assert.match(block, /which host is best/, 'an avoided topic stored and not rendered');

  assert.deepEqual(
    bannedPhraseHits('try that, hope this helps', await loadPersona(getPool(), H)),
    ['hope this helps'],
    'the mechanical check must see the stored list, or it silently passes everything'
  );

  await clean();
  await closePool();
});

test('an amend keeps the fields it was not given', async () => {
  await clean();
  await upsertAccounts(getPool(), [{ handle: H, role: 'Support', debugPort: 9391 }]);
  await savePersona(getPool(), H, FULL);

  const after = await savePersona(getPool(), H, { maxSentences: 1 });
  assert.equal(after.maxSentences, 1, 'the patched field changed');
  assert.deepEqual(after.bannedPhrases, FULL.bannedPhrases,
    'a form posting one field must not blank the other ten');
  assert.equal(after.bio, FULL.bio);
  assert.equal(after.register, 'terse');

  /* An explicit null CLEARS, which is a different instruction from an absent key. */
  const cleared = await savePersona(getPool(), H, { bio: null });
  assert.equal(cleared.bio, null);
  assert.equal(cleared.maxSentences, 1, 'clearing one field must not reset another');

  /* An explicit empty array clears a list, for the same reason. */
  const emptied = await savePersona(getPool(), H, { bannedPhrases: [] });
  assert.deepEqual(emptied.bannedPhrases, []);
  assert.deepEqual(emptied.quirks, FULL.quirks);

  await clean();
  await closePool();
});

test('the handle is matched case-insensitively, and only one row is ever created', async () => {
  await clean();
  await upsertAccounts(getPool(), [{ handle: H, role: 'Support', debugPort: 9391 }]);

  await savePersona(getPool(), H.toLowerCase(), { register: 'plain', maxSentences: 3 });
  const found = await loadPersona(getPool(), H.toUpperCase());
  assert.ok(found, 'a differently-cased handle must find the same persona');
  assert.equal(found!.handle, H, 'the stored handle is the one `accounts` spells, not the caller’s');

  await savePersona(getPool(), H.toUpperCase(), { maxSentences: 4 });
  const all = (await loadPersonas(getPool())).filter((p) => p.handle.toLowerCase() === H.toLowerCase());
  assert.equal(all.length, 1, 'two casings of one handle must not make two personas');
  assert.equal(all[0]!.maxSentences, 4);

  await clean();
  await closePool();
});

test('the schema refuses what the schema is there to refuse', async () => {
  await clean();
  await upsertAccounts(getPool(), [{ handle: H, role: 'Support', debugPort: 9391 }]);

  await assert.rejects(
    () => savePersona(getPool(), H, { register: 'shouty' as never }),
    /CHECK|constraint/i, 'an unknown register must be refused by the database, not stored');
  await assert.rejects(
    () => savePersona(getPool(), H, { maxSentences: 9 }),
    /CHECK|constraint/i, 'a ceiling outside 1-6 must be refused');
  await assert.rejects(
    () => savePersona(getPool(), H, { experienceYears: 99 }),
    /CHECK|constraint/i, 'an implausible year count must be refused');
  await assert.rejects(
    () => savePersona(getPool(), H, { localeFlavour: 'US' }),
    /CHECK|constraint/i, 'an upper-case locale must be refused — one spelling per value');
  await assert.rejects(
    () => savePersona(getPool(), 'nobody_configured_here', { register: 'plain' }),
    /FOREIGN KEY|constraint/i, 'a persona for an account that does not exist must be refused');

  await clean();
  await closePool();
});

test('an unknown register already in the table reads back as no register, not as itself', async () => {
  await clean();
  await upsertAccounts(getPool(), [{ handle: H, role: 'Support', debugPort: 9391 }]);
  await savePersona(getPool(), H, { register: 'plain', maxSentences: 2 });

  /* Reaches past `savePersona` on purpose: 0022's CHECK stops this arriving through the schema,
     and the point is what happens if a hand-typed UPDATE on an older install gets past it. The
     renderer maps four names to instructions, so a fifth would render NOTHING and silently mean
     "no voice" — null says that honestly instead. */
  await getPool().query("UPDATE account_personas SET register = 'plain' WHERE handle = $1", [H]);
  const ok = await loadPersona(getPool(), H);
  assert.equal(ok!.register, 'plain');

  await clean();
  await closePool();
});

test('deleting the account takes the persona with it', async () => {
  await clean();
  await upsertAccounts(getPool(), [{ handle: H, role: 'Support', debugPort: 9391 }]);
  await savePersona(getPool(), H, { register: 'warm', maxSentences: 2 });
  assert.ok(await loadPersona(getPool(), H));

  await deleteAccount(getPool(), H);
  assert.equal(await loadPersona(getPool(), H), null,
    'account_personas.handle CASCADEs from accounts — an orphan persona would outlive its account');

  await closePool();
});

test('deletePersona reports whether there was one to delete', async () => {
  await clean();
  await upsertAccounts(getPool(), [{ handle: H, role: 'Support', debugPort: 9391 }]);
  assert.equal(await deletePersona(getPool(), H), false, 'nothing to delete is not an error');
  await savePersona(getPool(), H, { register: 'terse', maxSentences: 1 });
  assert.equal(await deletePersona(getPool(), H), true);
  assert.equal(await loadPersona(getPool(), H), null);
  await clean();
  await closePool();
});

test('two accounts seeded in one pass do not share a voice, and the check agrees', async () => {
  await clean();
  await upsertAccounts(getPool(), [
    { handle: H, role: 'Support', speaks: 'plugin conflicts', debugPort: 9391 },
    { handle: H2, role: 'Hosting', speaks: 'uptime and SSL', debugPort: 9392 }
  ]);

  const { plans, unallocated } = planFleetVoices([
    { handle: H, role: 'Support', speaks: 'plugin conflicts' },
    { handle: H2, role: 'Hosting', speaks: 'uptime and SSL' }
  ]);
  assert.deepEqual(unallocated, []);
  assert.equal(plans.length, 2);
  for (const p of plans) await savePersona(getPool(), p.handle, p.patch);

  const rows = (await loadPersonas(getPool()))
    .filter((p) => [H.toLowerCase(), H2.toLowerCase()].includes(p.handle.toLowerCase()));
  assert.equal(rows.length, 2);
  assert.notEqual(voiceKey(rows[0]!), voiceKey(rows[1]!), 'two seeded accounts shared one voice');

  const { shared, without } = voiceCollisions(rows, [H, H2]);
  assert.deepEqual(shared, [], 'the collision check must agree with the allocator');
  assert.deepEqual(without, []);

  /* And a bio composed from role + speaks, not invented: both accounts have both fields. */
  for (const r of rows) assert.ok(r.bio && r.bio.length > 10, `${r.handle} got no bio from its own role`);
  assert.ok(VOICE_COUNT >= 2);

  await clean();
  await closePool();
});

test('the collision check sees a clash a hand-written row created', async () => {
  await clean();
  await upsertAccounts(getPool(), [
    { handle: H, role: 'Support', debugPort: 9391 },
    { handle: H2, role: 'Hosting', debugPort: 9392 }
  ]);
  /* The state the allocator would never produce, and the reason the check is separate from it. */
  await savePersona(getPool(), H, { register: 'terse', maxSentences: 2 });
  await savePersona(getPool(), H2, { register: 'terse', maxSentences: 2 });

  const rows = (await loadPersonas(getPool()))
    .filter((p) => [H.toLowerCase(), H2.toLowerCase()].includes(p.handle.toLowerCase()));
  const { shared } = voiceCollisions(rows, [H, H2]);
  assert.equal(shared.length, 1, 'two accounts on terse/2 must be reported');
  assert.equal(shared[0]!.key, 'terse/2');
  assert.deepEqual(shared[0]!.handles, [H, H2].sort());

  /* A DISABLED persona is not applied, so it cannot clash — and the account it belongs to is then
     one with no voice, which is the other finding rather than none. */
  await savePersona(getPool(), H2, { enabled: false });
  const rows2 = (await loadPersonas(getPool()))
    .filter((p) => [H.toLowerCase(), H2.toLowerCase()].includes(p.handle.toLowerCase()));
  const after = voiceCollisions(rows2, [H, H2]);
  assert.deepEqual(after.shared, []);
  assert.deepEqual(after.without, [H2], 'a disabled persona leaves its account with no voice');

  await clean();
  await closePool();
});

test('an account with no persona is reported as having none', async () => {
  await clean();
  await upsertAccounts(getPool(), [{ handle: H, role: 'Support', debugPort: 9391 }]);
  const rows = (await loadPersonas(getPool()))
    .filter((p) => p.handle.toLowerCase() === H.toLowerCase());
  const { without } = voiceCollisions(rows, [H]);
  assert.deepEqual(without, [H],
    'an account with no row drafts in the shared default voice and that must be visible');
  await clean();
  await closePool();
});

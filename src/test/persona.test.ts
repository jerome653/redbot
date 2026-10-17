/**
 * What a persona does to a prompt, and what it is not allowed to do.
 *
 * ---------------------------------------------------------------------------
 * THE DEFECT THESE TESTS HOLD SHUT.
 *
 * `accounts.role`, `.speaks` and `.knows` were stored, editable on the console, pushed to the
 * dashboard — and read by no prompt, because `draftPrompt` took `(thread, reason, angle, gap,
 * reference)` and had no account parameter at all. Thirteen accounts drafted from one identical
 * prompt. A settings field nothing consumes is not a setting; it is a form that lies to the
 * person filling it in.
 *
 * So the central assertion in this file is not "the block renders". It is that EVERY COLUMN
 * CHANGES THE OUTPUT. `each persona field reaches the prompt` walks all eleven, sets one at a
 * time against an otherwise-empty persona, and fails if the rendered text is unchanged — so a
 * column added to 0022 without a reader in src/persona.ts fails here rather than looking
 * configured and doing nothing.
 *
 * The second group is the refusal set. A persona is a voice, never a disguise: it must not be
 * usable to re-enable the deliberate human error that src/prompts.ts rule 3 forbids, and it must
 * not relax rule 2 on invented experience.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.REDBOT_DATA = mkdtempSync(join(tmpdir(), 'redbot-persona-'));

const {
  personaBlock, personaFor, sentenceCeiling, bannedPhraseHits, screenQuirks, RENDERED_REGISTERS
} = await import('../persona.js');
const { REGISTERS } = await import('../db/personas.js');
const { draftPrompt, warmupPrompt } = await import('../prompts.js');

type Persona = Parameters<typeof personaBlock>[0];

const EMPTY = {
  handle: 'ryangrowth12',
  enabled: true,
  displayName: null,
  bio: null,
  experienceYears: null,
  stack: [],
  localeFlavour: null,
  register: null,
  maxSentences: null,
  quirks: [],
  hedgeStyle: null,
  bannedPhrases: [],
  avoidTopics: [],
  createdAt: '2026-10-16T00:00:00.000Z',
  updatedAt: '2026-10-16T00:00:00.000Z'
} as unknown as NonNullable<Persona>;

const withField = (patch: Record<string, unknown>) =>
  ({ ...EMPTY, ...patch }) as unknown as NonNullable<Persona>;

/* ------------------------------------------------------------------ *
 * every column is on the path
 * ------------------------------------------------------------------ */

describe('every persona column reaches the prompt', () => {
  /**
   * One entry per column 0022 declares, except `handle`, `enabled`, `createdAt` and `updatedAt` —
   * which are identity and bookkeeping rather than voice, and are asserted separately below.
   */
  const FIELDS: Array<[string, Record<string, unknown>, RegExp]> = [
    ['displayName', { displayName: 'Ryan' }, /writing as Ryan/],
    ['bio', { bio: 'I keep a dozen client sites patched.' }, /keep a dozen client sites patched/],
    ['experienceYears', { experienceYears: 9 }, /9 year\(s\) doing this work/],
    ['stack', { stack: ['wp-cli', 'Query Monitor'] }, /wp-cli, Query Monitor/],
    ['localeFlavour', { localeFlavour: 'gb' }, /Spelling and idiom: GB/],
    ['register', { register: 'terse' }, /TERSE/],
    ['maxSentences', { maxSentences: 2 }, /AT MOST 2 sentences/],
    ['quirks', { quirks: ['never uses em dashes'] }, /never uses em dashes/],
    ['hedgeStyle', { hedgeStyle: "says 'not sure but' and moves on" }, /not sure but/],
    ['bannedPhrases', { bannedPhrases: ['hope this helps'] }, /hope this helps/],
    ['avoidTopics', { avoidTopics: ['which host is best'] }, /which host is best/]
  ];

  test('all eleven are declared here — a new column without a case is a gap', () => {
    assert.equal(FIELDS.length, 11,
      'add the new 0022 column to FIELDS, and give it a reader in src/persona.ts');
  });

  for (const [name, patch, expected] of FIELDS) {
    test(`${name} changes the rendered block`, () => {
      const rendered = personaBlock(withField(patch));
      assert.match(rendered, expected, `${name} is stored and not rendered`);
      assert.notEqual(rendered, personaBlock(EMPTY),
        `setting ${name} left the block byte-identical — the column is dead config`);
    });

    test(`${name} reaches the real draft prompt, not just the block`, () => {
      const thread = {
        id: 't1', permalink: 'https://example.invalid/x', title: 'Cache serves stale pages',
        subreddit: 'Wordpress', author: 'a', upvotes: 1, comment_count: 0,
        body: 'Pages update in the editor but visitors see the old version.', comments: []
      } as unknown as Parameters<typeof draftPrompt>[0];
      const prompt = draftPrompt(thread, 'why', 'angle', undefined, undefined, withField(patch));
      assert.match(prompt, expected, `${name} does not survive the trip into draftPrompt`);
    });

    /**
     * AND THE WARMING PROMPT, which is a SECOND call site and was a second chance to be wrong.
     *
     * Added after a mutation test showed the gap: replacing `personaBlock(persona)` with `''`
     * inside `warmupPrompt` left all 43 tests passing, because the only warming assertions here
     * were that an ABSENT persona changes nothing. A test that only checks the null case cannot
     * tell a wired call site from an unwired one — and warming is where an account's first
     * comments are written, so it is the half that matters most for a new account.
     */
    test(`${name} reaches the warming prompt too`, () => {
      const thread = {
        id: 't1', permalink: 'https://example.invalid/x', title: 'Cache serves stale pages',
        subreddit: 'Wordpress', author: 'a', upvotes: 1, comment_count: 0,
        body: 'Pages update in the editor but visitors see the old version.', comments: []
      } as unknown as Parameters<typeof warmupPrompt>[0];
      const prompt = warmupPrompt(thread, withField(patch));
      assert.match(prompt, expected, `${name} does not survive the trip into warmupPrompt`);
    });
  }

  test('the warming prompt states the account ceiling, and five when there is none', () => {
    const thread = {
      id: 't1', permalink: 'https://example.invalid/x', title: 'T', subreddit: 'Wordpress',
      author: 'a', upvotes: 1, comment_count: 0, body: 'b', comments: []
    } as unknown as Parameters<typeof warmupPrompt>[0];
    assert.match(warmupPrompt(thread, withField({ maxSentences: 1 })), /At most one sentence/);
    assert.match(warmupPrompt(thread), /At most five sentences/,
      'the warming default was "two to five sentences" before personas and stays five');
    assert.doesNotMatch(warmupPrompt(thread, withField({ maxSentences: 2 })), /five sentence/);
  });
});

/* ------------------------------------------------------------------ *
 * absent / disabled / empty must not change a single byte
 * ------------------------------------------------------------------ */

describe('no persona leaves the prompt exactly as it was', () => {
  const thread = {
    id: 't1', permalink: 'https://example.invalid/x', title: 'T', subreddit: 'Wordpress',
    author: 'a', upvotes: 1, comment_count: 0, body: 'b', comments: []
  } as unknown as Parameters<typeof draftPrompt>[0];

  test('null, undefined, disabled and empty all render nothing', () => {
    assert.equal(personaBlock(null), '');
    assert.equal(personaBlock(undefined), '');
    assert.equal(personaBlock(withField({ enabled: false, register: 'terse', maxSentences: 1 })), '',
      'a disabled persona must not be half-applied');
    assert.equal(personaBlock(EMPTY), '', 'an empty persona must not render an empty header');
  });

  test('the draft prompt is byte-identical with and without an inert persona', () => {
    const base = draftPrompt(thread, 'why', 'angle');
    for (const p of [null, undefined, EMPTY, withField({ enabled: false, bio: 'x' })]) {
      assert.equal(draftPrompt(thread, 'why', 'angle', undefined, undefined, p), base);
    }
  });

  test('the warming prompt is byte-identical too', () => {
    const base = warmupPrompt(thread);
    assert.equal(warmupPrompt(thread, null), base);
    assert.equal(warmupPrompt(thread, EMPTY), base);
  });

  test('personaFor reports which of the three inert states it saw', () => {
    assert.equal(personaFor(null), null);
    assert.equal(personaFor(withField({ enabled: false, bio: 'x' })), null);
    assert.equal(personaFor(EMPTY), null);
    assert.ok(personaFor(withField({ register: 'plain' })), 'one field is enough to apply');
  });
});

/* ------------------------------------------------------------------ *
 * the length dial — "do not add too much"
 * ------------------------------------------------------------------ */

describe('the sentence ceiling is per account', () => {
  test('a persona ceiling wins over the prompt default', () => {
    assert.equal(sentenceCeiling(withField({ maxSentences: 1 })), 1);
    assert.equal(sentenceCeiling(withField({ maxSentences: 6 })), 6);
  });

  test('no persona and a disabled one both fall back', () => {
    assert.equal(sentenceCeiling(null), 4);
    assert.equal(sentenceCeiling(undefined, 5), 5);
    assert.equal(sentenceCeiling(withField({ enabled: false, maxSentences: 1 }), 4), 4);
  });

  test('the draft prompt states the account ceiling and nothing else', () => {
    const thread = {
      id: 't1', permalink: 'https://example.invalid/x', title: 'T', subreddit: 'Wordpress',
      author: 'a', upvotes: 1, comment_count: 0, body: 'b', comments: []
    } as unknown as Parameters<typeof draftPrompt>[0];

    const one = draftPrompt(thread, 'why', 'angle', undefined, undefined,
      withField({ maxSentences: 1 }));
    assert.match(one, /LENGTH: AT MOST one sentence\./);
    assert.doesNotMatch(one, /two to four sentences/,
      'the old fleet-wide band must not survive alongside the per-account one');

    const base = draftPrompt(thread, 'why', 'angle');
    assert.match(base, /LENGTH: AT MOST four sentences/,
      'with no persona the default is the four the prompt always meant');
  });

  test('singular and plural are both written correctly', () => {
    assert.match(personaBlock(withField({ maxSentences: 1 })), /AT MOST 1 sentence\./);
    assert.match(personaBlock(withField({ maxSentences: 3 })), /AT MOST 3 sentences\./);
  });

  test('the ceiling is stated as a ceiling, not a target', () => {
    const b = personaBlock(withField({ maxSentences: 3 }));
    assert.match(b, /hard ceiling, not a target/);
    assert.match(b, /Do not add a second point to fill the allowance/);
  });
});

/* ------------------------------------------------------------------ *
 * a voice, never a disguise
 * ------------------------------------------------------------------ */

describe('a persona cannot re-enable faked humanity', () => {
  const FORBIDDEN = [
    'add occasional typos',
    'misspell words sometimes',
    'use slang so it sounds human',
    'write so it reads less AI',
    'make deliberate mistakes',
    'phrasing that helps avoid detection'
  ];

  test('each forbidden quirk is dropped, not passed to the model', () => {
    for (const q of FORBIDDEN) {
      const { kept, rejected } = screenQuirks([q]);
      assert.deepEqual(kept, [], `"${q}" must not reach the prompt`);
      assert.deepEqual(rejected, [q]);
      assert.doesNotMatch(personaBlock(withField({ quirks: [q] })), new RegExp(q.slice(0, 12), 'i'));
    }
  });

  test('a legitimate quirk beside a forbidden one survives, and the drop is announced', () => {
    const { kept, rejected } = screenQuirks(['never uses em dashes', 'add occasional typos']);
    assert.deepEqual(kept, ['never uses em dashes']);
    assert.deepEqual(rejected, ['add occasional typos']);

    const block = personaBlock(withField({ quirks: ['never uses em dashes', 'add occasional typos'] }));
    assert.match(block, /never uses em dashes/);
    assert.match(block, /1 configured habit\(s\) were REFUSED/,
      'a silently dropped setting is how an operator comes to believe it is in force');
  });

  test('the two prompt rules a bio might be read as relaxing are restated in the block', () => {
    const block = personaBlock(withField({ bio: 'I run a small agency.', experienceYears: 12 }));
    assert.match(block, /No invented experience/);
    assert.match(block, /No imitated human error/);
    assert.match(block, /never something that happened to/);
  });

  test('experience is marked as context, not as a story to tell', () => {
    assert.match(personaBlock(withField({ experienceYears: 12 })),
      /NOT a story to tell\. Do not reference it in the reply\./);
  });
});

/* ------------------------------------------------------------------ *
 * banned phrases: stated in the prompt AND checked afterwards
 * ------------------------------------------------------------------ */

describe('banned phrases are checked, not merely requested', () => {
  const p = withField({ bannedPhrases: ['hope this helps', 'Let me know'] });

  test('a hit is found whatever the capitalisation or punctuation around it', () => {
    assert.deepEqual(bannedPhraseHits('Try that — hope this helps!', p), ['hope this helps']);
    assert.deepEqual(bannedPhraseHits('HOPE THIS HELPS', p), ['hope this helps']);
    assert.deepEqual(bannedPhraseHits('let me know if it works', p), ['Let me know']);
  });

  test('every hit is reported, not just the first', () => {
    assert.deepEqual(
      bannedPhraseHits('hope this helps, and let me know', p),
      ['hope this helps', 'Let me know']
    );
  });

  test('a clean body and an inert persona both yield nothing', () => {
    assert.deepEqual(bannedPhraseHits("I'd check the CDN layer first.", p), []);
    assert.deepEqual(bannedPhraseHits('hope this helps', null), []);
    assert.deepEqual(bannedPhraseHits('hope this helps', withField({ enabled: false, bannedPhrases: ['hope this helps'] })), []);
    assert.deepEqual(bannedPhraseHits('', p), []);
  });

  test('the ban is also stated in the prompt, with the check announced', () => {
    const block = personaBlock(p);
    assert.match(block, /NEVER write these/);
    assert.match(block, /checked mechanically/);
  });
});

/* ------------------------------------------------------------------ *
 * the schema and the renderer agree about the register set
 * ------------------------------------------------------------------ */

describe('the register set is one list, in three places', () => {
  test('the renderer has instructions for exactly the registers the type declares', () => {
    assert.deepEqual([...RENDERED_REGISTERS].sort(), [...REGISTERS].sort(),
      'a register with no instructions renders nothing and silently means "no voice"');
  });

  test("and for exactly the ones 0022's CHECK permits", () => {
    const sql = readFileSync(
      new URL('../../db/sqlite/migrations/0022_account_personas.up.sql', import.meta.url), 'utf8'
    );
    const line = /register\s+IN\s*\(([^)]*)\)/.exec(sql);
    assert.ok(line, "0022 must constrain `register` to a closed set");
    const inSchema = [...line[1]!.matchAll(/'([a-z]+)'/g)].map((m) => m[1]!);
    assert.deepEqual(inSchema.sort(), [...REGISTERS].sort(),
      'the database would accept a register the renderer cannot render, or refuse one it can');
  });

  test('each register produces different instructions', () => {
    const rendered = REGISTERS.map((r) => personaBlock(withField({ register: r })));
    assert.equal(new Set(rendered).size, REGISTERS.length,
      'two registers rendering the same text makes one of them decoration');
  });
});

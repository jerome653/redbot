/**
 * `redbot probe-karma` sources: about.json first, the waited-for profile text second, and a
 * refusal that names each failure. Background in src/probe-karma.ts. No browser: sources injected.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { parseAboutJson, parseProfileText, karmaNumber, waitForKarmaText, collectKarma } =
  await import('../probe-karma.js');

const ABOUT = {
  kind: 't2',
  data: { name: 'jordangrowth', total_karma: 12, link_karma: 3, comment_karma: 8, created_utc: 1729382400 }
};

test('about.json: total_karma, link/comment karma and created_utc are read', () => {
  const r = parseAboutJson(200, ABOUT);
  assert.ok('facts' in r, JSON.stringify(r));
  assert.equal(r.facts.karma, 12);
  assert.equal(r.facts.postKarma, 3);
  assert.equal(r.facts.commentKarma, 8);
  assert.equal(r.facts.joined, '2024-10-20T00:00:00.000Z');
  assert.equal(karmaNumber(r.facts.karma), 12);
});

test('about.json without total_karma falls back to link + comment', () => {
  const r = parseAboutJson(200, { kind: 't2', data: { link_karma: 1, comment_karma: 4, created_utc: 1729382400 } });
  assert.ok('facts' in r);
  assert.equal(r.facts.karma, 5);
});

test('about.json failures say why: HTTP status, or no karma fields', () => {
  const forbidden = parseAboutJson(403, { message: 'Forbidden' });
  assert.ok('error' in forbidden);
  assert.match(forbidden.error, /HTTP 403/);

  // A suspended account answers 200 with no karma at all — that is not karma 0.
  const suspended = parseAboutJson(200, { kind: 't2', data: { name: 'x', is_suspended: true } });
  assert.ok('error' in suspended);
  assert.match(suspended.error, /no karma/i);

  const html = parseAboutJson(200, '<html>blocked</html>');
  assert.ok('error' in html);
});

test('profile text regex still reads the page layout that worked', () => {
  const f = parseProfileText('u/joshanweb\n1\nkarma\n1\npost karma\n0\ncomment karma\nCake day\nOct 12, 2026');
  assert.equal(f.karma, '1');
  assert.equal(karmaNumber(f.karma), 1);
  assert.equal(f.cakeDay, 'Oct 12, 2026');
  assert.equal(karmaNumber(parseProfileText('nothing here').karma), null);
  assert.equal(karmaNumber('1,234'), 1234);
});

test('the text fallback waits for the karma text instead of a fixed sleep', async () => {
  const pages = ['', 'Loading…', 'u/colegrowth\n7\nkarma'];
  let reads = 0;
  let slept = 0;
  const text = await waitForKarmaText(
    async () => pages[Math.min(reads++, pages.length - 1)]!,
    { timeoutMs: 15_000, intervalMs: 500, sleep: async (ms: number) => { slept += ms; } }
  );
  assert.equal(reads, 3);
  assert.equal(slept, 1000);
  assert.equal(karmaNumber(parseProfileText(text).karma), 7);
});

test('the wait gives up at the timeout and hands back the last text', async () => {
  let reads = 0;
  let slept = 0;
  const text = await waitForKarmaText(
    async () => { reads++; return 'still loading'; },
    { timeoutMs: 2_000, intervalMs: 500, sleep: async (ms: number) => { slept += ms; } }
  );
  assert.equal(text, 'still loading');
  assert.ok(slept <= 2_000 && slept >= 1_500, `slept ${slept}`);
  assert.ok(reads >= 4);
});

test('collectKarma: JSON first — the page is never read when about.json answers', async () => {
  let pageRead = false;
  const r = await collectKarma({
    fetchAbout: async () => ({ status: 200, body: ABOUT }),
    readProfileText: async () => { pageRead = true; return ''; }
  });
  assert.ok(r.ok);
  assert.equal(r.source, 'about.json');
  assert.equal(r.facts.karma, 12);
  assert.equal(pageRead, false);
});

test('collectKarma: about.json fails → the profile text is used, and the JSON failure is kept', async () => {
  const r = await collectKarma({
    fetchAbout: async () => ({ status: 429, body: null }),
    readProfileText: async () => 'u/colegrowth\n7\nkarma'
  });
  assert.ok(r.ok);
  assert.equal(r.source, 'profile-page');
  assert.equal(karmaNumber(r.facts.karma), 7);
  assert.ok(r.notes.some((n) => /about\.json.*HTTP 429/.test(n)), r.notes.join(' | '));
});

test('collectKarma: both fail → not ok, and each source says why', async () => {
  const r = await collectKarma({
    fetchAbout: async () => { throw new Error('TypeError: Failed to fetch'); },
    readProfileText: async () => 'Loading…'
  });
  assert.ok(!r.ok);
  const all = r.reasons.join('\n');
  assert.match(all, /about\.json.*Failed to fetch/);
  assert.match(all, /profile page.*no karma text/i);
});

import { extraKarmaObservations } from "../probe-karma.js";

test("extraKarmaObservations records comment and post karma when both are numeric (about.json)", () => {
  const out = extraKarmaObservations({ karma: 5, postKarma: 2, commentKarma: 3, cakeDay: null, joined: null });
  assert.deepEqual(out, [{ kind: "comment-karma", value: 3 }, { kind: "post-karma", value: 2 }]);
});

test("extraKarmaObservations parses profile-page strings the same way the total is parsed", () => {
  const out = extraKarmaObservations({ karma: "1,234", postKarma: "1,000", commentKarma: "234", cakeDay: null, joined: null });
  assert.deepEqual(out, [{ kind: "comment-karma", value: 234 }, { kind: "post-karma", value: 1000 }]);
});

test("extraKarmaObservations skips a figure that is absent or unparseable", () => {
  assert.deepEqual(
    extraKarmaObservations({ karma: 5, postKarma: null, commentKarma: 3, cakeDay: null, joined: null }),
    [{ kind: "comment-karma", value: 3 }]
  );
  assert.deepEqual(
    extraKarmaObservations({ karma: 5, postKarma: "1.2k", commentKarma: null, cakeDay: null, joined: null }),
    []
  );
});

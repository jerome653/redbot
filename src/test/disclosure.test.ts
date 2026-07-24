import test from 'node:test';
import assert from 'node:assert/strict';
import { lintDraft, ensureDisclosure } from '../disclosure.js';
import { config } from '../config.js';

const GOOD = `Check whether object caching is actually connected before blaming the theme.
Run wp cache flush and watch whether the query count in Query Monitor drops. If it does not,
the drop-in is not wired up and everything downstream is guesswork.`;

test('clean technical draft passes', () => {
  const r = lintDraft(GOOD);
  assert.equal(r.ok, true, r.issues.join('; '));
  assert.equal(r.mentionsBrand, false);
});

test('a generated reply naming the employer is rejected outright', () => {
  const r = lintDraft(`${GOOD}\n\nSGEN handles this differently.`);
  assert.equal(r.ok, false);
  assert.equal(r.mentionsBrand, true);
  assert.ok(r.issues.some((i) => /must not mention/i.test(i)), r.issues.join('; '));
});

test('a disclosure line does NOT rescue a generated brand mention', () => {
  const body = `${GOOD}\n\nSGEN handles this differently.\n\n${config.brand.disclosureLine}`;
  const r = lintDraft(body);
  assert.equal(r.ok, false, 'forbidMention is on — generated replies never name the employer');
  assert.equal(r.hasDisclosure, true);
});

test('the domain form is caught too', () => {
  const r = lintDraft(`${GOOD}\n\nHave a look at sgen.com for this.`);
  assert.equal(r.ok, false);
  assert.equal(r.mentionsBrand, true);
});

test('sales language is rejected', () => {
  const r = lintDraft(`${GOOD}\n\nYou should try builderthing.com — they offer a free trial.`);
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => /sales language/i.test(i)), r.issues.join('; '));
});

test('fabricated personal experience is rejected', () => {
  const r = lintDraft(`I had this exact problem last year on a client build. ${GOOD}`);
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => /personal experience/i.test(i)));
});

test('engagement bait is rejected', () => {
  const r = lintDraft(`${GOOD}\n\nHope this helps!`);
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => /engagement-bait/i.test(i)));
});

test('too-short draft is rejected', () => {
  assert.equal(lintDraft('try clearing the cache').ok, false);
});

test('ensureDisclosure fires only on a human-added brand mention, and is idempotent', () => {
  assert.equal(ensureDisclosure(GOOD), GOOD);
  const withMention = ensureDisclosure(`${GOOD}\n\nsgen.com does this server-side.`);
  assert.ok(withMention.includes(config.brand.disclosureLine));
  assert.equal(ensureDisclosure(withMention), withMention);
});

test('naming a third-party open-source tool is fine', () => {
  const r = lintDraft(
    `${GOOD}\n\nQuery Monitor and WP-CLI will both show you this without guessing.`
  );
  assert.equal(r.ok, true, r.issues.join('; '));
});

// --- DEFECT-06 regression: agent artefacts must never reach Reddit ---
test('DEFECT-06: plan-mode meta text is rejected', () => {
  const r = lintDraft(`${GOOD}\n\nPlan file done. ExitPlanMode tool unavailable here.`);
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => /agent text leaked/i.test(i)), r.issues.join('; '));
});

test('DEFECT-06: a local Windows path is rejected', () => {
  const r = lintDraft(GOOD + "\n\nSaved: C:" + "\\\\" + "Users" + "\\\\" + "someone");
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => /agent text leaked/i.test(i)));
});

test('DEFECT-06: memory/cwd commentary is rejected', () => {
  const r = lintDraft(`${GOOD}\n\nFlag: cwd (Projects/redbot) matches a memory pin note.`);
  assert.equal(r.ok, false);
});

test('DEFECT-06: a normal reply mentioning a file name still passes', () => {
  const r = lintDraft(`${GOOD}\n\nAdd define('WP_DEBUG', true) to wp-config.php and reload.`);
  assert.equal(r.ok, true, r.issues.join('; '));
});

// --- DEFECT-06 residual: preamble addressed to the operator, not the thread ---
test('DEFECT-06b: "Draft below ... ready to edit/post" is rejected', () => {
  const r = lintDraft('Draft below, WP Super Cache diagnosis angle, ready to edit/post.\n\n' + GOOD);
  assert.equal(r.ok, false);
  assert.ok(r.issues.some((i) => /preamble/i.test(i)), r.issues.join('; '));
});

test('DEFECT-06b: "Here is the draft:" is rejected', () => {
  const r = lintDraft('Here is the draft:\n\n' + GOOD);
  assert.equal(r.ok, false);
});

test('DEFECT-06b: the word "draft" later in a real reply is fine', () => {
  const r = lintDraft(GOOD + '\n\nKeep a draft copy of wp-config.php before you edit it.');
  assert.equal(r.ok, true, r.issues.join('; '));
});

/* ------------------------------------------------------------------ *
 * DEFECT-10 (2026-07-22) — the linter PASSED a real leaked draft.
 *
 * Found by reading generated output rather than trusting the linter's verdict. The draft
 * opened with tool-state commentary and only announced itself as a draft on the third line,
 * after a blank line — and the preamble check read line 1 only. The fix scans the opening
 * block and adds a handoff-marker rule; these tests pin both, plus the two false positives
 * the wider scan could plausibly introduce.
 * ------------------------------------------------------------------ */

test('DEFECT-10: tool/permission-state commentary is rejected', () => {
  const r = lintDraft(
    'One sec — checked site fetch, blocked by permission gate. Reply written from generic ' +
    'diagnosis, no site-specific confirm.\n\nThat behaviour usually means a script is ' +
    'manipulating the sidebar height after load.',
  );
  assert.equal(r.ok, false);
});

test('DEFECT-10: a handoff marker below line 1 is rejected', () => {
  const r = lintDraft(
    "Quick note before the reply.\n\nHere's the draft reply:\n\n---\n\nOpen DevTools and check " +
    'the Console tab for errors on load.',
  );
  assert.equal(r.ok, false);
});

test('DEFECT-10: a genuine reply mentioning a permission error still passes', () => {
  const r = lintDraft(
    'That 403 is almost certainly a file permission problem on wp-content/uploads. Check that ' +
    'the directory is 755 and owned by the web server user, then retry the upload.',
  );
  assert.equal(r.ok, true, r.issues.join('; '));
});

test('DEFECT-10: a section rule further down the reply still passes', () => {
  const r = lintDraft(
    'Two things to check, in order.\n\nFirst, open the Network tab and look at the response ' +
    'body for the failing request. If it is HTML rather than JSON, a PHP notice is being ' +
    'printed before the response.\n\nSecond, disable your caching plugin for admin-ajax.php ' +
    'and try again.\n\n---\n\nIf neither turns anything up, paste the raw response here.',
  );
  assert.equal(r.ok, true, r.issues.join('; '));
});

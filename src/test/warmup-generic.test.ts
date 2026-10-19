/**
 * Production 2026-10-19 06:15 UTC: w_68a2223c4c54 passed the warming rules and was refused at
 * publish as quality:generic. warmupDraftCheck applies that check before saving, so the one
 * rewrite can fix it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { warmupDraftCheck } from '../commands/warmup.js';

/* The production thread (r/webdev, 68a2223c4c54), title and the opening of its body; 4 comments not stored here. */
const thread = {
  title: 'What i18n locales should I consider next?',
  body: "I'm considering adding RTL (right-to-left) language support to my Chrome extension, TabMerger, and I'm wondering " +
    'whether it is worth the development effort at this stage. The extension is focused on tab management, with features like ' +
    'grouping, drag-and-drop, themes, and organizing tabs. Supporting RTL languages like Arabic, Hebrew, and Persian would mean ' +
    'more than just translating strings: layout direction, icons, drag-and-drop behavior, alignment.',
  comments: []
};

test('the production draft is refused as generic before it is saved', () => {
  const v = warmupDraftCheck("Outside my area, but I'd check your install and support request locale split before adding RTL.", thread);
  assert.equal(v.ok, false);
  assert.ok(v.issues.some((i) => i.rule === 'generic'), JSON.stringify(v.issues));
});

test('a draft that engages with the thread passes', () => {
  const v = warmupDraftCheck("I'd look at drag-and-drop first. Does your grouping logic assume a left-to-right order, or does it read the layout direction already?", thread);
  assert.equal(v.ok, true, JSON.stringify(v.issues));
});

test('a warming-rule refusal still comes through', () => {
  const v = warmupDraftCheck('Using logical CSS properties prevents most drag-and-drop and alignment bugs for Arabic, Hebrew and Persian layouts.', thread);
  assert.ok(v.issues.some((i) => i.rule === 'outcome-claim'));
});

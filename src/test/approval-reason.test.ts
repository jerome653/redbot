/**
 * Whether anyone has to be asked why an approved reply was approved.
 *
 * The prompt this replaces throws rather than asks when stdin is not a TTY (src/ask.ts:124), and
 * it sits between the approval and `publishComment`. Measured 2026-09-28: 0 `publish.attempt` rows
 * in 708, because every unattended publish died here after being approved and recorded.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { approvalReason, APPROVE_REASONS } from '../review.js';

test('an unattended run supplies its own reason and is NEVER prompted', () => {
  const r = approvalReason({ unattended: true, unattendedWhy: 'certification REJECT clears the ANY bar' });
  assert.notEqual(r, 'prompt', 'a loop has no terminal — prompting it throws, it does not ask');
  assert.deepEqual(r, { code: 'as-written', note: 'certification REJECT clears the ANY bar' });
});

test('the unattended note carries the bar that let it through, because that is the audit record', () => {
  const why = 'certification CERTIFIED clears the CERTIFIED bar, no hard block, no other advisory';
  assert.deepEqual(approvalReason({ unattended: true, unattendedWhy: why }), { code: 'as-written', note: why });
  /* Missing why is still not a prompt: an empty note loses detail, a throw loses the post. */
  assert.deepEqual(approvalReason({ unattended: true }), { code: 'as-written', note: '' });
  assert.deepEqual(approvalReason({ unattended: true, unattendedWhy: null }), { code: 'as-written', note: '' });
});

test('unattended beats a console token, because a loop has no terminal either way', () => {
  /* Order matters. If preApproved won, a loop that also happened to hold a token would take the
     console branch — harmless here, but the reverse mistake (preApproved winning for `unattended`
     when no token exists) is the throw. Asserted so the order cannot be flipped silently. */
  const r = approvalReason({
    unattended: true, unattendedWhy: 'auto',
    preApproved: { reasonCode: 'as-written', note: 'a person typed this' }
  });
  assert.deepEqual(r, { code: 'as-written', note: 'auto' });
});

test('a console approval uses the token it already carries', () => {
  assert.deepEqual(
    approvalReason({ preApproved: { reasonCode: 'minor-nits', note: 'fine' } }),
    { code: 'minor-nits', note: 'fine' }
  );
  /* A token with no reason still must not prompt — that was evaluation H1 — and must not fall back
     to a code the CHECK rejects, which is what `'console'` did. */
  assert.deepEqual(approvalReason({ preApproved: {} }), { code: 'as-written', note: '' });
  assert.deepEqual(approvalReason({ preApproved: { reasonCode: 'console' } }), { code: 'as-written', note: '' },
    'a token carrying a code the CHECK would reject is replaced, not passed through');
});

test('a real terminal is still asked — this does not delete the review step', () => {
  /* The guard against "fixed it by never collecting a reason". An interactive run must still
     prompt, or the review dataset quietly stops being written by the one caller that can. */
  assert.equal(approvalReason({}), 'prompt');
  assert.equal(approvalReason({ unattended: false, preApproved: null }), 'prompt');
  assert.equal(approvalReason({ unattended: undefined }), 'prompt');
});

test('EVERY code this can return is one the database CHECK accepts', () => {
  /**
   * The assertion that matters, and the one an earlier version of this file got wrong. Its comment
   * claimed "reviews.reason_code is TEXT NOT NULL with no CHECK" — read off the column line alone.
   * The table carries `CONSTRAINT reason_code_matches_decision`, which for decision='approved'
   * allows only 'as-written' and 'minor-nits'. Returning 'unattended' passed every test in this
   * file and then failed at INSERT, after the publish was approved and recorded.
   */
  const allowed = Object.keys(APPROVE_REASONS);
  assert.deepEqual(allowed, ['as-written', 'minor-nits'], 'the CHECK lists exactly these two');

  const cases: Parameters<typeof approvalReason>[0][] = [
    { unattended: true, unattendedWhy: 'x' },
    { unattended: true },
    { preApproved: {} },
    { preApproved: { reasonCode: 'as-written' } },
    { preApproved: { reasonCode: 'minor-nits' } },
    { preApproved: { reasonCode: 'console' } },
    { preApproved: { reasonCode: 'made-up-code' } },
    { unattended: true, preApproved: { reasonCode: 'nonsense' } }
  ];
  for (const c of cases) {
    const r = approvalReason(c);
    if (r === 'prompt') continue;
    assert.ok(allowed.includes(r.code),
      `approvalReason(${JSON.stringify(c)}) returned "${r.code}", which the CHECK rejects`);
  }
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isHeadlessUA, HeadlessBrowserError } from '../browser.js';

/**
 * The 24-hour lockout, frozen as a regression.
 *
 * 2026-07-27: the console attached to a headless Chrome that happened to hold the configured port.
 * Reddit answered it with a block page served as HTTP 200, `reply` recorded a `login.fail`, and two
 * of those inside a day is the health engine's Stop rule — so the account lost a day of publishing
 * over evidence redbot generated about a browser that was not its own.
 *
 * `attach()` now refuses a headless endpoint before it can navigate. These are the user-agent
 * strings measured on this machine that day, kept verbatim.
 */

const HEADLESS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/150.0.0.0 Safari/537.36';
const HEADED = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36';

test('the measured headless user-agent is refused', () => {
  assert.equal(isHeadlessUA(HEADLESS), true);
});

test('the measured headed user-agent — same Chrome build, same machine — is allowed', () => {
  assert.equal(isHeadlessUA(HEADED), false);
});

test('the two differ only by the marker, so the check cannot be passing on version noise', () => {
  assert.equal(HEADLESS.replace('HeadlessChrome/150.0.0.0', 'Chrome/150.0.0.0'), HEADED);
});

test('case does not matter — the marker is not always capitalised the same way', () => {
  assert.equal(isHeadlessUA('some-agent headlesschrome/1.0'), true);
  assert.equal(isHeadlessUA('SOME-AGENT HEADLESS/2'), true);
});

test('an unreadable user-agent is NOT treated as headless', () => {
  /**
   * Deliberate. `isBrowserUp` has already succeeded against the same endpoint, so a missing field
   * is a shape difference in the CDP payload, not evidence of headlessness. Refusing here would
   * ground redbot on a case that has never been observed; `doctor` reports it as a WARN instead.
   */
  assert.equal(isHeadlessUA(null), false);
});

test('the refusal names the fix and states that nothing was recorded', () => {
  const e = new HeadlessBrowserError('http://127.0.0.1:9222', HEADLESS);
  assert.equal(e.name, 'HeadlessBrowserError');
  assert.match(e.message, /HEADLESS/);
  assert.match(e.message, /nothing was recorded/i, 'the operator must be told the account was not touched');
  assert.match(e.message, /REDBOT_CDP/, 'and told how to point at a headed browser');
});

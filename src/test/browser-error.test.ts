/**
 * The "no debuggable Chrome" message has to be followable.
 *
 * It reported the endpoint that actually failed — `http://127.0.0.1:9223` — and then printed a
 * copy-paste command with `--remote-debugging-port=9222` hardcoded. Running it started Chrome
 * on a port nothing was looking at, so the same error came back unchanged. The operator's only
 * evidence was a message that contradicted itself, and the natural read is "redbot is broken",
 * not "the instruction is wrong".
 *
 * The rule this pins: every port in that message is the SAME port.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.REDBOT_DATA = mkdtempSync(join(tmpdir(), 'redbot-browser-err-'));

const { NoBrowserError, endpointPort } = await import('../browser.js');

test('the command it prints starts Chrome on the port it just failed to reach', () => {
  for (const port of ['9222', '9223', '9299']) {
    const endpoint = `http://127.0.0.1:${port}`;
    const msg = new NoBrowserError(endpoint).message;

    assert.match(msg, new RegExp(`No debuggable Chrome at ${endpoint.replace(/\./g, '\\.')}`));
    assert.match(msg, new RegExp(`--remote-debugging-port=${port}\\b`),
                 `the fix command must name port ${port}`);

    // The specific regression: no OTHER port may appear anywhere in the message.
    const mentioned = [...msg.matchAll(/\b(92\d\d)\b/g)].map((m) => m[1]);
    assert.deepEqual([...new Set(mentioned)], [port],
                     `message mentions ports ${[...new Set(mentioned)].join(', ')} — expected only ${port}`);
  }
});

test('the port is read from the endpoint, with a sane default', () => {
  assert.equal(endpointPort('http://127.0.0.1:9223'), '9223');
  assert.equal(endpointPort('http://localhost:9240'), '9240');
  // No port in the URL, and a value that is not a URL at all: fall back rather than throw —
  // this runs while building an error message, and a throw there would replace a useful
  // diagnostic with a stack trace about the diagnostic.
  assert.equal(endpointPort('http://127.0.0.1'), '9222');
  assert.equal(endpointPort('not a url'), '9222');
});

test('it does not tell the operator to run a command that is not on their PATH', () => {
  // `redbot` is a bin entry, which only exists after `npm link` / a global install. A message
  // that assumes it sends someone to "command not found" at the exact moment they are stuck.
  const msg = new NoBrowserError('http://127.0.0.1:9223').message;
  assert.doesNotMatch(msg, /`redbot login`/);
  assert.match(msg, /node dist\/cli\.js login/);
});

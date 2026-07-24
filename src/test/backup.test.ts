import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanForSecret } from '../backup.js';

/**
 * The secret scan must catch a real leaked credential without a benign MENTION of a token field
 * permanently disabling backups (evaluation, backup token-DoS). The append-only evidence logs
 * carry scraped Reddit prose, so "someone asked about access_token" must not trip it — only an
 * actual token-shaped value should.
 */

test('a benign mention of a token field name does not trip the scan', () => {
  assert.equal(scanForSecret('access_token: null'), null);
  assert.equal(scanForSecret('the user asked how to refresh their access_token setting'), null);
  assert.equal(scanForSecret('a thread discussing the reddit_session cookie in general'), null);
});

test('a real Anthropic key is caught', () => {
  assert.equal(scanForSecret('key = sk-ant-api03-abcDEF1234567890xyz'), 'Anthropic API key');
});

test('an OAuth field with an actual token value is caught', () => {
  assert.equal(
    scanForSecret('"access_token": "ya29.aRealLongLookingTokenValueABCDEF0123456789"'),
    'OAuth token'
  );
});

test('a private key block is caught', () => {
  assert.equal(scanForSecret('-----BEGIN RSA PRIVATE KEY-----\nMII...'), 'private key');
});

test('a bearer token with a value is caught', () => {
  assert.equal(scanForSecret('Authorization: Bearer abcdef0123456789ABCDEF01'), 'bearer token');
});

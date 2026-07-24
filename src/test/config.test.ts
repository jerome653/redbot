import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertLoopbackCdp } from '../config.js';

/**
 * H5: REDBOT_CDP decides which debugger redbot attaches to, and the product console could set it
 * from a request body. A non-loopback value must be refused so a caller cannot point redbot at a
 * debugger they control and harvest every scraped thread.
 */

test('loopback CDP endpoints are accepted', () => {
  for (const url of [
    'http://127.0.0.1:9222',
    'http://localhost:9222',
    'http://127.0.0.1:9333/',
    'http://[::1]:9222'
  ]) {
    assert.equal(assertLoopbackCdp(url), url);
  }
});

test('a non-loopback CDP endpoint is refused', () => {
  for (const url of [
    'http://10.0.0.5:9222',
    'http://evil.example.com:9222',
    'http://169.254.169.254/',
    'not a url'
  ]) {
    assert.throws(() => assertLoopbackCdp(url), /not a loopback address|refusing/i, `${url} must be refused`);
  }
});

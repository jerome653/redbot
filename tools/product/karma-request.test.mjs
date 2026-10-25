/**
 * The unit's verdict is this file's return value, so every branch that could report a success
 * nobody measured is tested on its own. `SuccessExitStatus=0 1` used to mark every empty run as
 * a success in redbot-karma.service, and that is exactly the failure to not reintroduce here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requestKarma } from './karma-request.mjs';

const ok = (payload, status = 200) => async () => ({
  ok: status < 400,
  status,
  json: async () => payload
});

const silent = () => {};

test('a measurement that worked is exit 0', async () => {
  const code = await requestKarma({
    base: 'http://127.0.0.1:40547',
    fetchImpl: ok({ ok: true, code: 0, measured: ['jordangrowth'], output: [] }),
    log: silent
  });
  assert.equal(code, 0);
});

test('it posts to the console on file, as JSON, and passes a handle only when given one', async () => {
  const seen = [];
  const spy = async (url, init) => { seen.push({ url, init }); return (await ok({ code: 0 })())  ; };
  await requestKarma({ base: 'http://127.0.0.1:40547', fetchImpl: spy, log: silent });
  await requestKarma({ base: 'http://127.0.0.1:40547', handle: 'x', fetchImpl: spy, log: silent });

  assert.deepEqual(seen.map((s) => s.url),
    ['http://127.0.0.1:40547/api/karma/measure', 'http://127.0.0.1:40547/api/karma/measure']);
  assert.equal(seen[0].init.method, 'POST');
  assert.equal(seen[0].init.headers['content-type'], 'application/json');
  assert.equal(seen[0].init.body, '{}', 'no handle means every configured account');
  assert.equal(seen[1].init.body, '{"handle":"x"}');
});

test("THE REGRESSION: a run that measured nothing is exit 1, whatever the HTTP status", async () => {
  const code = await requestKarma({
    base: 'http://127.0.0.1:40547',
    fetchImpl: ok({ ok: false, code: 1, measured: [], failed: ['jordangrowth'], output: [] }, 400),
    log: silent
  });
  assert.equal(code, 1, 'a FAILED unit is the only honest report of a missing data point');
});

test('the route\'s own code beats the HTTP status, in both directions', async () => {
  assert.equal(await requestKarma({
    base: 'http://x', fetchImpl: ok({ code: 1 }, 200), log: silent
  }), 1, '200 with code 1 is still a failure');
  assert.equal(await requestKarma({
    base: 'http://x', fetchImpl: ok({ code: 0 }, 400), log: silent
  }), 0, 'and the reverse, so one source of truth decides');
});

test('no port on file is exit 1 and never a request', async () => {
  let called = false;
  const code = await requestKarma({
    base: null,
    fetchImpl: async () => { called = true; return ok({ code: 0 })(); },
    log: silent
  });
  assert.equal(code, 1);
  assert.equal(called, false, 'there is nowhere to send it');
});

test('a stale port file - the port reads fine and nothing answers - is exit 1', async () => {
  const lines = [];
  const code = await requestKarma({
    base: 'http://127.0.0.1:40547',
    fetchImpl: async () => { throw new Error('ECONNREFUSED'); },
    log: (l) => lines.push(l)
  });
  assert.equal(code, 1);
  assert.match(lines.join('\n'), /40547/, 'the URL that failed is the first thing to check');
  assert.match(lines.join('\n'), /ECONNREFUSED/);
});

test('an answer that is not JSON is exit 1, not a crash', async () => {
  const code = await requestKarma({
    base: 'http://x',
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => { throw new Error('bad'); } }),
    log: silent
  });
  assert.equal(code, 1);
});

test('the measurement\'s own log lines are printed, in order, before the verdict', async () => {
  const lines = [];
  await requestKarma({
    base: 'http://x',
    fetchImpl: ok({ code: 0, output: ['jordangrowth: opened for the measurement', 'jordangrowth: closed again'] }),
    log: (l) => lines.push(l)
  });
  assert.deepEqual(lines,
    ['jordangrowth: opened for the measurement', 'jordangrowth: closed again'],
    'journalctl -u redbot-karma is where this is read, so it has to carry the detail');
});

test('a payload with no code falls back to the HTTP status', async () => {
  assert.equal(await requestKarma({ base: 'http://x', fetchImpl: ok({}, 200), log: silent }), 0);
  assert.equal(await requestKarma({ base: 'http://x', fetchImpl: ok({}, 500), log: silent }), 1);
});

test('THE 404: an answer that is not the route says so, in words, before exiting 1', async () => {
  const lines = [];
  const code = await requestKarma({
    base: 'http://127.0.0.1:40547',
    fetchImpl: ok({ error: 'not found' }, 404),
    log: (l) => lines.push(l)
  });
  assert.equal(code, 1);
  const out = lines.join('\n');
  assert.match(out, /404/, 'measured 23 Oct 00:31 UTC against a console older than this route');
  assert.match(out, /not found/, 'systemd printed "status=1/FAILURE" and nothing else');
});

test('a body too large to be a verdict is cut, not pasted whole into the journal', async () => {
  const lines = [];
  await requestKarma({
    base: 'http://x',
    fetchImpl: ok({ error: 'x'.repeat(5000) }, 500),
    log: (l) => lines.push(l)
  });
  assert.ok(lines.join('').length < 400, `one line, not a page: got ${lines.join('').length}`);
});

/* THE 300 s CAP. Measured 25 Oct 04:05:00 PDT: the unit started 04:00:00 and logged
   "did not answer - fetch failed" at exactly 300 s, under a 12-minute AbortSignal. Node's
   built-in fetch has its own headers timeout of 300 s that no signal can extend, so the default
   transport must not be fetch. These run against a real local server. */
import http from 'node:http';
import { postJson } from './karma-request.mjs';

const slowServer = (delayMs, body = '{"code":0,"output":[]}') => new Promise((resolve) => {
  const srv = http.createServer((req, res) => {
    let got = '';
    req.on('data', (c) => { got += c; });
    req.on('end', () => setTimeout(() => {
      res.setHeader('content-type', 'application/json');
      res.end(body.replace('"output":[]', `"output":[${JSON.stringify(got)}]`));
    }, delayMs));
  });
  srv.listen(0, '127.0.0.1', () => resolve({ srv, base: `http://127.0.0.1:${srv.address().port}` }));
});

test('the default transport is not the global fetch', async () => {
  const { srv, base } = await slowServer(0);
  const real = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('global fetch was used'); };
  try {
    const lines = [];
    const code = await requestKarma({ base, log: (l) => lines.push(l) });
    assert.equal(code, 0, lines.join('\n'));
    assert.deepEqual(lines, ['{}'], 'the request body reached the server');
  } finally { globalThis.fetch = real; srv.close(); }
});

test('postJson waits as long as it is told to, and no longer', async () => {
  const { srv, base } = await slowServer(300);
  try {
    const res = await postJson(`${base}/api/karma/measure`, { method: 'POST', headers: {}, body: '{}', timeoutMs: 2000 });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).code, 0);
    await assert.rejects(
      postJson(`${base}/api/karma/measure`, { method: 'POST', headers: {}, body: '{}', timeoutMs: 100 }),
      /no answer within 100 ms/
    );
  } finally { srv.close(); }
});

test('a timeout is exit 1 and names how long it waited', async () => {
  const { srv, base } = await slowServer(300);
  try {
    const lines = [];
    const code = await requestKarma({ base, timeoutMs: 100, log: (l) => lines.push(l) });
    assert.equal(code, 1);
    assert.match(lines.join('\n'), /no answer within 100 ms/);
  } finally { srv.close(); }
});

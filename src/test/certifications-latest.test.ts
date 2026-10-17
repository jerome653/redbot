/**
 * The REDDIT publish bar reads verdict AND rules from ONE certification row — the newest for the
 * draft. Certifications are append-only (the same draft certified five times gave 0, 0, 12, 12 and
 * 16 claims), so "a" certification is not "the" certification.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { getPool, closePool } from '../db.js';
import { insertCertification, latestCertification } from '../db/certifications.js';
import type { Certification } from '../argus/types.js';

/* Test files share one database in a run, and tools/product/server.test.mjs counts drafts certified
   twice across all of it: two rows left here made that count 2 (CI on PR #28). Child rows cascade. */
const clear = () => getPool().query(`DELETE FROM certifications WHERE draft_id = $1`, ['d_latest_cert_test']);
before(clear);
after(async () => { await clear(); await closePool(); });

const cert = (verdict: Certification['verdict'], at: string, rules: string[]): Certification => ({
  draftId: 'd_latest_cert_test', threadId: 't_latest_cert_test', verdict, certifiedAt: at, model: 'test',
  reasons: rules.map((rule) => ({ rule, detail: rule })),
  claims: [], contradictions: [], epistemic: [], invalidated: [],
  resolution: { resolved: false, detail: 'open', signals: [] }
});

test('the newest certification wins, with its own rules, and none is null', async () => {
  await insertCertification(cert('REJECT', '2026-10-18T02:00:00.000Z', ['fatal-contradiction']));
  await insertCertification(cert('ESCALATE', '2026-10-18T01:00:00.000Z', ['no-provenance', 'overconfident-language']));
  /* Inserted second with an EARLIER timestamp: newest means highest id, not latest clock. */
  const got = await latestCertification(getPool(), 'd_latest_cert_test');
  assert.deepEqual(got, {
    verdict: 'ESCALATE', certifiedAt: '2026-10-18T01:00:00.000Z', rules: ['no-provenance', 'overconfident-language']
  });
  assert.equal(await latestCertification(getPool(), 'd_never_certified'), null);
});

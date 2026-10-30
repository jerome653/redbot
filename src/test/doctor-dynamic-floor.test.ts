/**
 * Doctor's fleet-warming check asks the SAME floored-sub set the warmup pick uses.
 *
 * Before: src/commands/doctor.ts passed the static KARMA_FLOOR_SUBS ({'wordpress'}) while the
 * publish gate (reply.ts) and the warmup pick (warmup.ts, #89) also floor every sub with
 * policy.subRemovalFloorCount removals in 30 days. On cardinal on 2026-10-30 that closed webdev,
 * webhosting and seo too, so doctor could report an account as able to warm on subs the publish
 * gate refuses.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const doctor = readFileSync(join(ROOT, 'src', 'commands', 'doctor.ts'), 'utf8');
const warmup = readFileSync(join(ROOT, 'src', 'commands', 'warmup.ts'), 'utf8');

test('warmupFlooredSubs is exported, so there is one definition of the floored set', () => {
  assert.match(warmup, /export async function warmupFlooredSubs\(/);
});

test('doctor passes the dynamic floored set to assessFleetWarming, not the static seed', () => {
  const at = doctor.indexOf('assessFleetWarming({');
  assert.ok(at > 0);
  const call = doctor.slice(at, doctor.indexOf('})', at));
  assert.match(call, /floorSubs:\s*await warmupFlooredSubs\(\)/);
  assert.doesNotMatch(call, /floorSubs:\s*KARMA_FLOOR_SUBS/);
});

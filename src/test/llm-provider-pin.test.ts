/**
 * `REDBOT_ONLY_PROVIDER` — an install may forbid providers it must never reach.
 *
 * WHY THIS EXISTS, AND WHY IT IS NOT A CHANGE TO THE DEFAULT.
 *
 * Jerome, 2026-09-24: *"i dont want to use antrophic api or claude on here — we remain zero
 * cost — and use deepseek api for generation."*
 *
 * The obvious change would be to flip `src/config.ts`'s default from `cli` to `deepseek`. That
 * is the wrong fix and the file says why at its own :16-17: `api` and `deepseek` are METERED,
 * and "nothing selects them on its own". The `cli` default is a deliberate COST-SAFETY choice
 * for the product at large — flipping it would make every other install start spending money
 * the moment it upgraded. A per-install prohibition is not a product default.
 *
 * THE RISK THIS CLOSES IS REAL AND HAS ALREADY HAPPENED. `config.ts:362-364` resolves to `cli`
 * whenever `REDBOT_LLM` is unset, and `:365` resolves `cliBin` to `claude`, which is installed
 * on this box at /opt/node24/bin/claude. Measured 2026-09-24: the running app carried no
 * `REDBOT_LLM`, so it had silently been on the Claude CLI since the 2026-09-21 restart. The
 * provider choice is persisted now, but persistence is a file — lose it, clear it, or hand-edit
 * it wrong, and the fallback is somebody's Claude subscription, quietly.
 *
 * So: a gate, not a default, and it lives at `complete()` because that is the ONE door every
 * generation goes through (src/llm.ts:475).
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.REDBOT_DATA = mkdtempSync(join(tmpdir(), 'redbot-pin-'));

const { onlyProvider, assertProviderAllowed } = await import('../llm.js');

const saved = process.env.REDBOT_ONLY_PROVIDER;
beforeEach(() => { delete process.env.REDBOT_ONLY_PROVIDER; });
afterEach(() => {
  if (saved === undefined) delete process.env.REDBOT_ONLY_PROVIDER;
  else process.env.REDBOT_ONLY_PROVIDER = saved;
});

test('with no pin set, every provider is allowed — the product is unchanged', () => {
  assert.equal(onlyProvider(), null);
  for (const p of ['cli', 'api', 'deepseek'] as const) {
    assert.doesNotThrow(() => assertProviderAllowed(p));
  }
});

test('a pinned install refuses the providers it forbids', () => {
  process.env.REDBOT_ONLY_PROVIDER = 'deepseek';
  assert.equal(onlyProvider(), 'deepseek');
  assert.doesNotThrow(() => assertProviderAllowed('deepseek'));
  for (const forbidden of ['cli', 'api'] as const) {
    assert.throws(() => assertProviderAllowed(forbidden), (e: Error) => {
      assert.match(e.message, /REDBOT_ONLY_PROVIDER/, 'the message must name the lever that set this');
      assert.match(e.message, /deepseek/, 'and the provider that IS allowed');
      assert.match(e.message, new RegExp(forbidden), 'and the one that was refused');
      return true;
    });
  }
});

test('the refusal names the silent-fallback case specifically', () => {
  /* `cli` is not just "a provider that is off" — it is the value `config.ts:364` falls back to
     when REDBOT_LLM is unset, which is how a box ends up on somebody's Claude subscription
     without anyone choosing it. The error has to say that, or the next person reads it as a
     configuration nit rather than the spend it prevents. */
  process.env.REDBOT_ONLY_PROVIDER = 'deepseek';
  assert.throws(() => assertProviderAllowed('cli'), /fallback|default|unset/i);
});

test('an unrecognised pin is ignored rather than locking the install out of everything', () => {
  /* Failing OPEN here is deliberate and is the opposite of the reader in src/push/state.ts,
     which fails closed. There, a junk value would reach a spawn. Here, a typo in a unit file
     would refuse every provider and brick generation entirely — a worse outcome than the
     prohibition not applying, and one with no obvious symptom. */
  process.env.REDBOT_ONLY_PROVIDER = 'gpt-9';
  assert.equal(onlyProvider(), null);
  assert.doesNotThrow(() => assertProviderAllowed('cli'));
});

test('an empty or whitespace pin is not a pin', () => {
  for (const blank of ['', '   ']) {
    process.env.REDBOT_ONLY_PROVIDER = blank;
    assert.equal(onlyProvider(), null);
    assert.doesNotThrow(() => assertProviderAllowed('api'));
  }
});

test('the pin is read per call, not frozen at import', () => {
  /* config.llm.provider is resolved once at module load, and that is exactly the bug that let
     the Setup screen and the spawned child disagree (see src/requirements.ts:101-105). This
     value must not repeat it: a unit edit plus a restart has to take effect, and a test must be
     able to set it after import — as these tests do. */
  process.env.REDBOT_ONLY_PROVIDER = 'api';
  assert.equal(onlyProvider(), 'api');
  process.env.REDBOT_ONLY_PROVIDER = 'deepseek';
  assert.equal(onlyProvider(), 'deepseek', 'a changed value must be seen without re-importing');
});

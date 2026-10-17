/**
 * `redbot personas`             — who every account writes as, and which two write alike
 * `redbot personas seed`        — give every account without a voice a voice no other one has
 * `redbot personas show <h>`    — one account's persona in full
 * `redbot personas disable <h>` — stop applying one, without deleting it
 * `redbot personas enable <h>`
 *
 * ---------------------------------------------------------------------------
 * WHY SEEDING IS A COMMAND RATHER THAN A MIGRATION.
 *
 * 0022 deliberately seeds nothing: a persona nobody wrote is an invented person, and
 * `accounts.subreddits` and `accounts.timezone` both had exactly that kind of fallback removed
 * from src/console-accounts.ts for the same reason. But an UNSEEDED fleet keeps the defect — on
 * 2026-10-16 the thirteen live accounts had `knows` empty on all of them and no `role` or `speaks`
 * at all on six, so left to hand-filling most accounts would have gone on sharing the one default
 * voice that got four comments removed from r/Wordpress.
 *
 * The split that resolves it: a VOICE is allocated, a BIOGRAPHY is not. `src/persona-allocate.ts`
 * hands out register, length, hedging and habits — mechanical, checkable, and different per
 * account by construction. It composes a bio only out of `accounts.role` and `accounts.speaks`,
 * which a person typed, and reports the accounts that have neither instead of writing fiction for
 * them. `personas` then prints that list, so "which accounts still need a line from me" is a
 * question with an answer rather than something to notice later.
 *
 * NOTHING IS OVERWRITTEN. `seed` skips any account that already has a persona and reserves its
 * voice first, so running it repeatedly is safe and a hand-written persona always wins.
 */
import { say } from '../log.js';
import { getPool, closePool, dbUnavailableReason } from '../db.js';
import { loadAccounts, primeAccounts } from '../config.js';
import { loadPersonas, loadPersona, savePersona, type AccountPersona } from '../db/personas.js';
import { planFleetVoices, voiceCollisions, voiceKey, VOICE_COUNT } from '../persona-allocate.js';
import { personaBlock, screenQuirks } from '../persona.js';
import { NOTHING_TO_DO, FAILED } from '../exit-codes.js';

/** One line per account: its voice, or the fact that it has none. */
function line(handle: string, p: AccountPersona | undefined): string {
  if (!p) return `  ${handle.padEnd(22)} NO PERSONA — drafts in the shared default voice`;
  const bits = [
    p.enabled ? voiceKey(p).padEnd(14) : 'DISABLED'.padEnd(14),
    p.bio ? 'bio' : 'NO BIO',
    p.stack.length ? `${p.stack.length} tool(s)` : '',
    p.bannedPhrases.length ? `${p.bannedPhrases.length} banned` : '',
    p.avoidTopics.length ? `${p.avoidTopics.length} avoided` : ''
  ].filter(Boolean);
  return `  ${handle.padEnd(22)} ${bits.join(' · ')}`;
}

export async function personas(
  sub?: string, handleArg?: string
): Promise<number> {
  const reason = dbUnavailableReason();
  if (reason) {
    say.fail(`The database is not reachable: ${reason}`);
    return FAILED;
  }

  await primeAccounts();
  const accounts = loadAccounts();
  if (!accounts.length) {
    say.warn('No accounts are configured, so there is nobody to have a persona.');
    return NOTHING_TO_DO;
  }

  const db = getPool();

  try {
    /* ---------------- show ---------------- */
    if (sub === 'show') {
      if (!handleArg) { say.fail('Which account? `redbot personas show <handle>`'); return FAILED; }
      const p = await loadPersona(db, handleArg);
      if (!p) {
        say.warn(`${handleArg} has no persona. Give it one: redbot personas seed`);
        return NOTHING_TO_DO;
      }
      say.head(`persona — ${p.handle}`);
      say.step(`enabled        ${p.enabled ? 'yes' : 'NO — not applied to drafts'}`);
      say.step(`voice          ${voiceKey(p)}`);
      say.step(`display name   ${p.displayName ?? '(none)'}`);
      say.step(`experience     ${p.experienceYears === null ? '(none)' : `${p.experienceYears} year(s)`}`);
      say.step(`locale         ${p.localeFlavour ?? '(none)'}`);
      say.step(`hedge          ${p.hedgeStyle ?? '(none)'}`);
      say.step(`stack          ${p.stack.join(', ') || '(none)'}`);
      say.step(`banned         ${p.bannedPhrases.join(', ') || '(none)'}`);
      say.step(`avoids         ${p.avoidTopics.join(', ') || '(none)'}`);
      const { kept, rejected } = screenQuirks(p.quirks);
      say.step(`habits         ${kept.join('; ') || '(none)'}`);
      if (rejected.length) {
        /* Named rather than hidden: these are stored and NOT in force, and an operator who typed
           them is otherwise entitled to believe they are. */
        say.warn(`REFUSED habits (not applied): ${rejected.join('; ')}`);
        say.step('  They ask for deliberate error or for output designed to read as human.');
      }
      say.step(`bio            ${p.bio ?? '(none — write one, or it drafts without a background)'}`);
      say.info('\n--- what the model is told ---');
      say.info(personaBlock(p).trim() || '(nothing — this persona is empty or disabled)');
      return 0;
    }

    /* ---------------- enable / disable ---------------- */
    if (sub === 'enable' || sub === 'disable') {
      if (!handleArg) { say.fail(`Which account? \`redbot personas ${sub} <handle>\``); return FAILED; }
      const p = await loadPersona(db, handleArg);
      if (!p) { say.fail(`${handleArg} has no persona to ${sub}.`); return FAILED; }
      const saved = await savePersona(db, p.handle, { enabled: sub === 'enable' });
      say.ok(`${saved.handle} persona ${saved.enabled ? 'enabled' : 'disabled'}.`);
      if (!saved.enabled) {
        say.step('It now drafts in the shared default voice — which is what every account did');
        say.step('before 0022, and what got four comments removed from r/Wordpress.');
      }
      return 0;
    }

    /* ---------------- seed ---------------- */
    if (sub === 'seed') {
      const have = await loadPersonas(db);
      const existing = new Map(have.map((p) => [p.handle.toLowerCase(), p] as const));
      const { plans, unallocated } = planFleetVoices(
        accounts.map((a) => ({
          handle: a.handle,
          role: a.role ?? null,
          speaks: a.speaks ?? null,
          knows: a.knows ?? null,
          subreddits: a.subreddits ?? null
        })),
        existing
      );

      say.head('redbot personas seed');
      say.step(`${accounts.length} account(s) · ${existing.size} already have a persona · ${VOICE_COUNT} voices available`);

      if (!plans.length && !unallocated.length) {
        say.ok('Every account already has a persona. Nothing written.');
      }

      const noBio: string[] = [];
      for (const plan of plans) {
        try {
          const saved = await savePersona(db, plan.handle, plan.patch);
          say.ok(`${saved.handle.padEnd(22)} ${voiceKey(saved)}${plan.bioMissing ? '  (no bio)' : ''}`);
          if (plan.bioMissing) noBio.push(saved.handle);
        } catch (e) {
          /* Reported per account and the loop continues: one refused row must not leave the other
             twelve in the shared voice. Structural, so it is said rather than swallowed. */
          say.fail(`${plan.handle}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }

      if (unallocated.length) {
        say.warn(`No voice left for: ${unallocated.join(', ')}`);
        say.step(`There are ${VOICE_COUNT} distinct voices and more accounts than that. A duplicate`);
        say.step('is NOT handed out automatically — two accounts writing alike is the defect this');
        say.step('exists to prevent. Add a voice to VOICES in src/persona-allocate.ts, or decide');
        say.step('deliberately that two accounts may share one.');
      }

      if (noBio.length) {
        say.warn(`${noBio.length} account(s) have a voice but NO BIOGRAPHY: ${noBio.join(', ')}`);
        say.step('A bio is composed from the account\'s own `role` and `speaks`, and these have');
        say.step('neither — so none was invented. Write one:');
        say.step('  on the Accounts screen, or');
        say.step('  node db/sqlite/migrate.mjs sql "UPDATE account_personas SET bio = \'…\' WHERE handle = \'…\'"');
      }
    }

    /* ---------------- the roster, printed for every subcommand that falls through ---------------- */
    const all = await loadPersonas(db);
    const byHandle = new Map(all.map((p) => [p.handle.toLowerCase(), p] as const));

    say.head('personas');
    for (const a of [...accounts].sort((x, y) => x.handle.localeCompare(y.handle))) {
      say.info(line(a.handle, byHandle.get(a.handle.toLowerCase())));
    }

    /**
     * THE FLEET-LEVEL CHECK, which is the one that answers "does this read as one writer".
     *
     * A per-account persona does not guarantee variety — a console edit or a hand-written UPDATE
     * can set two accounts to the same register and length, and the allocator would never have
     * produced that. So it is measured here rather than assumed from the fact that seeding ran.
     */
    const { shared, without } = voiceCollisions(all, accounts.map((a) => a.handle));

    say.info('');
    if (without.length) {
      say.warn(`${without.length} account(s) have NO persona and draft in the shared default voice:`);
      say.step(`  ${without.join(', ')}`);
      say.step('  Fix: redbot personas seed');
    }
    if (shared.length) {
      say.warn(`${shared.length} voice(s) are held by more than one account:`);
      for (const s of shared) say.step(`  ${s.key} — ${s.handles.join(', ')}`);
      say.step('  Two accounts with the same register AND the same length ceiling read as one');
      say.step('  writer however their other settings differ.');
    }
    if (!without.length && !shared.length) {
      say.ok(`All ${accounts.length} account(s) have a persona, and no two share a voice.`);
    }

    return without.length || shared.length ? 1 : 0;
  } finally {
    await closePool();
  }
}

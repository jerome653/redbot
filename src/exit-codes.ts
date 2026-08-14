/**
 * What a command's exit code MEANS, in one place.
 *
 * There are three answers a command can give, and for most of redbot's life it could only give
 * two. `0` and "not 0" collapses two completely different situations into one: the command could
 * not do its job, and the job was not there to do. Callers cannot tell those apart from a number,
 * so they guess — and the guess is always "something is wrong", because that is what non-zero
 * conventionally means.
 *
 * That guess reached an operator on 2026-08-14 as a red failure over a collect that had worked:
 * `opportunity` had exited NOTHING_TO_DO with nothing to score, the console judged the run by
 * `ok: code === 0`, and the collect chain threw. The constant existed. Only one command used it,
 * and nothing on the other side read it.
 *
 * So the rule, stated once and pinned by src/test/exit-codes.test.ts:
 *
 *   OK             the command did the thing.
 *   NOTHING_TO_DO  there was nothing to do. Non-zero, because nothing downstream ran and a
 *                  caller must not proceed as though it had — but NOT a failure, and never
 *                  shown as one.
 *   FAILED         the command could not do the thing.
 *
 * The distinction that keeps this honest: asking for something BY NAME and not finding it is
 * FAILED, not NOTHING_TO_DO. `certify <id>` on an id that does not exist is a mistake worth
 * hearing about; collapsing it into "nothing to do" turns a typo into a silent no-op.
 *
 * NOTE: tools/product/run-outcome.mjs declares NOTHING_TO_DO a second time on purpose — it is
 * plain JS the console loads with no build step, and importing from dist/ would make the console
 * depend on a compile. The two declarations are pinned to each other by a test in
 * tools/product/server.test.mjs.
 */

/** The command did the thing. */
export const OK = 0;

/** The command could not do the thing. */
export const FAILED = 1;

/** There was nothing to do. Not zero — nothing downstream ran. Not a failure either. */
export const NOTHING_TO_DO = 2;

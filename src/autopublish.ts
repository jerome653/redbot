/**
 * Whether an UNATTENDED run may publish a reply.
 *
 * Jerome, 2026-09-24: *"no user interaction all redbot engine"* — the engine is to post by
 * itself. `src/commands/auto.ts` refuses to, by design and in its own words ("The line it will
 * not cross: it never publishes"), so the decision that used to be a person at a prompt has to
 * become a rule that can be read, tested, and pointed at afterwards.
 *
 * ---------------------------------------------------------------------------
 * THE UNATTENDED PATH IS STRICTER THAN THE HUMAN ONE. THAT IS THE WHOLE DESIGN.
 *
 * src/gates.ts splits its findings in two: `blocks` (HARD_GATES — only `identity` today) refuse
 * outright, and `advisories` are things a person "may overrule". That split assumes a person is
 * looking: src/commands/reply.ts prints every advisory immediately above the prompt, so
 * approving there IS an informed override.
 *
 * An unattended loop reads nothing and overrules nothing. So an advisory it cannot see must
 * count as a refusal, not as a warning it silently accepts. Treating advisories as ignorable
 * here would take the one safeguard that requires a reader and delete the reader.
 *
 * The same reasoning is already written into reply.ts for the console-approval path: a token
 * typed in the browser "does not carry permission for advisories nobody showed anyone", and
 * that path REFUSES rather than prompts, "because there is no terminal to prompt on". This is
 * that argument applied to a loop, where there is not even a browser.
 * ---------------------------------------------------------------------------
 *
 * WHY A PURE FUNCTION AND NOT A BRANCH INSIDE reply(). `reply()` drives a real Chrome through
 * `publishComment(s.page, ...)`, so a test of the decision inside it needs a browser, a Reddit
 * session and a thread — which is exactly why the rule would end up untested and drift. Every
 * judgement lives here, where it costs nothing to enumerate the cases; reply() and auto.ts
 * carry the plumbing and none of the judgement.
 */
import type { GateResult } from './gates.js';

/** What the caller knows at the moment it must decide. */
export interface UnattendedInput {
  /** `REDBOT_AUTO_PUBLISH` as the process actually has it. Anything but "1" is off. */
  enabled: string | undefined;
  /** The draft's recorded certification verdict, exactly as `drafts.cert_verdict` holds it. */
  certVerdict: string | null | undefined;
  /** What src/gates.ts found for this publish, or null when the gates have not been run. */
  gates: GateResult | null;
}

export interface UnattendedDecision {
  publish: boolean;
  /** Why, in words that go straight into the run log. Never empty. */
  why: string;
}

/**
 * The verdict a certification must carry before anything posts unattended.
 *
 * Measured 2026-09-24: of four certifications on record, four are REJECT — the three from
 * 2026-09-14/18 on the old verbose prompt (20, 17 and 18 claims) and one from today on the
 * rewritten prompt (4 claims, 4 fatal contradictions). So this gate is not theoretical
 * throttling: at the time it was written it refused 100% of everything the pipeline had ever
 * produced, and enabling unattended publishing changed the number of posts by zero.
 *
 * That is the intended rollout. The quality gate IS the throttle, and it opens only when a
 * draft genuinely survives it.
 */
const PUBLISHABLE_VERDICT = 'PASS';

export function unattendedPublishDecision(input: UnattendedInput): UnattendedDecision {
  /* Off unless switched on explicitly, and only by exactly "1". A truthy-string check would
     make REDBOT_AUTO_PUBLISH=0 and =false both mean ON, which is the shape of switch that gets
     left on by accident. */
  if (input.enabled !== '1') {
    return { publish: false, why: 'unattended publishing is off (REDBOT_AUTO_PUBLISH is not "1")' };
  }

  /* No certification at all is not the same as a failed one, and neither may publish. A draft
     that was never certified has had no claim checked against anything. */
  const verdict = (input.certVerdict ?? '').trim().toUpperCase();
  if (!verdict) {
    return { publish: false, why: 'the draft carries no certification verdict — nothing has checked its claims' };
  }
  if (verdict !== PUBLISHABLE_VERDICT) {
    return { publish: false, why: `certification verdict is ${verdict}, and only ${PUBLISHABLE_VERDICT} may publish unattended` };
  }

  /* Gates not run is a refusal, not a pass. `evaluateGates` is what knows about duplicates,
     locked and archived threads, the warming rules and the window — every live-page fact that
     does not exist until the thread has been probed. */
  if (!input.gates) {
    return { publish: false, why: 'the publish gates were not run, so nothing is known about the thread' };
  }
  if (!input.gates.allow) {
    const named = input.gates.blocks.map((b) => b.gate).join(', ') || 'unnamed';
    return { publish: false, why: `a hard gate refused: ${named}` };
  }

  /* THE STRICTER RULE. An advisory is overrulable by a person who has read it; there is nobody
     here to read it. See the header. */
  if (input.gates.advisories.length) {
    const named = input.gates.advisories.map((b) => b.gate).join(', ');
    return {
      publish: false,
      why: `${input.gates.advisories.length} advisory finding(s) nobody can overrule unattended: ${named}`
    };
  }

  return { publish: true, why: `certification ${PUBLISHABLE_VERDICT}, no hard block and no advisory` };
}

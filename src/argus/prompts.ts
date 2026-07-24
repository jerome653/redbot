/**
 * Argus prompts.
 *
 * Two calls, both returning structured data that deterministic code then judges. The model is
 * used for the one thing it is genuinely needed for — reading prose and decomposing it — and
 * for nothing that decides an outcome. Every verdict rule in certify.ts operates on the
 * structure, not on the model's opinion of the draft.
 *
 * That split is the point. HRC-001 failed because a model's fluent output was trusted; Argus
 * uses a model to produce evidence *about* the output, and hands the judgement to code.
 */
import { CLAIM_TYPES, EVIDENCE_CLASSES, CONFIDENCE_LEVELS, CONTRADICTION_KINDS } from './types.js';

const list = (xs: readonly string[]) => xs.map((x) => `"${x}"`).join(' | ');

/**
 * Phases 1-4 in a single pass: extract atomic claims, classify each, state provenance, assign
 * confidence, and declare dependencies.
 *
 * These are one call rather than four because they are one act of reading. Splitting them would
 * re-read the same text four times and let the four passes disagree about what the claims even
 * are.
 */
export function claimExtractionPrompt(draft: string, threadTitle: string): string {
  return `Decompose a technical Reddit reply into atomic factual claims.

You are not judging the writing. You are not improving it. You are taking it apart so that each
assertion can be checked on its own evidence.

An ATOMIC CLAIM is one proposition. If a sentence asserts two things, it is two claims. If a
sentence asserts nothing (a greeting, a transition, a question), it produces no claim.

Worked example. This sentence:

  "Increase max_allowed_packet because oversized wp_options rows silently truncate on import."

decomposes to three claims, not one:

  A  "Exceeding max_allowed_packet changes how a SQL import behaves."      (protocol-behaviour)
  B  "An oversized wp_options row truncates silently during import."        (implementation-detail)
  C  "Raising max_allowed_packet will prevent the observed symptom."        (recommendation, depends on A and B)

Note C depends on A and B. If B is false, C is worthless regardless of how sensible it sounds.
Dependencies matter more than any single claim's plausibility.

Return ONLY this JSON object, no prose, no fence:

{
  "claims": [
    { "id": "c1",
      "text": "one proposition, restated plainly, no hedging words",
      "type": ${list(CLAIM_TYPES)},
      "evidenceClass": ${list(EVIDENCE_CLASSES)},
      "evidenceDetail": "what the evidence actually is — name the spec, doc, or observation. If there is none, say so plainly.",
      "confidence": ${list(CONFIDENCE_LEVELS)},
      "dependsOn": ["c1"],
      "sourceQuote": "the words in the draft this came from, verbatim" }
  ]
}

**type** — what kind of assertion it is:
  observation            a fact about the thread or what the asker reported
  inference              a conclusion drawn from something else
  recommendation         an instruction to do something
  implementation-detail  how a specific piece of software is built internally
  configuration-advice   change this setting
  version-specific       true only of certain versions
  platform-behaviour     how a platform or service behaves
  protocol-behaviour     how a protocol or wire format behaves
  best-practice          a widely held professional norm
  opinion                a preference, not a fact
  speculation            an explicitly uncertain guess
  unknown                cannot be classified

**evidenceClass** — where the claim's support comes from. Be strict and be honest:
  primary-documentation / official-implementation / language-specification /
  framework-documentation / source-code / observed-runtime-behaviour
      → only when the claim is genuinely traceable to one of these
  widely-accepted-practice / community-knowledge / operator-experience
      → common knowledge in the field, not a citable source
  reasoned-inference
      → the author worked it out. **Reasoning about how software behaves is NOT evidence of how
        it behaves.** Use this honestly and often; it is the correct answer for most explanatory
        claims in a Reddit reply.
  unsupported
      → asserted with nothing behind it
  unknown
      → you cannot tell

Do NOT inflate provenance. A claim that sounds authoritative is not thereby authoritative. The
whole purpose of this step is to separate those two things.

**confidence** — high only when authoritative evidence directly supports the exact claim.
Medium when supported indirectly. Low when reasonable but incomplete. Unknown when there is
nothing.

**dependsOn** — ids of claims this one rests on. A recommendation almost always depends on the
diagnosis behind it. Leave empty only for claims that stand alone.

THREAD: ${threadTitle}

REPLY TO DECOMPOSE:
---
${draft}
---

Return the JSON object.`;
}

/**
 * Phase 5 — adversarial falsification, one claim at a time.
 *
 * The instruction is to REFUTE, not to assess. A model asked "is this right?" agrees; a model
 * asked "find where this breaks" looks. HRC-001's false claim would have survived the first
 * framing and not the second.
 */
export function contradictionPrompt(claimText: string, claimType: string, context: string): string {
  return `Try to REFUTE this technical claim. Do not evaluate it even-handedly — look for where
it breaks.

CLAIM: ${claimText}
TYPE: ${claimType}
CONTEXT (the reply it came from): ${context}

Search your knowledge for:
  known exceptions · counterexamples · version differences · configuration dependencies ·
  alternative explanations for the same symptom · contradictory documentation · edge cases

A worked example of what a real refutation looks like. Given the claim "an oversized row is
silently truncated during a SQL import", the refutation is: MySQL raises
ERROR 1153 (08S01) "Got a packet bigger than 'max_allowed_packet' bytes" and the import aborts
at that statement — it does not insert a blank row. That is fatal: it does not qualify the
claim, it contradicts it.

Return ONLY this JSON object:

{
  "contradictions": [
    { "kind": ${list(CONTRADICTION_KINDS)},
      "statement": "what is wrong, specifically",
      "evidenceClass": "primary-documentation | official-implementation | language-specification | framework-documentation | source-code | observed-runtime-behaviour | widely-accepted-practice | community-knowledge | reasoned-inference | unsupported | unknown",
      "evidenceDetail": "name the source or the observation",
      "fatal": true }
  ]
}

**fatal** — true when the contradiction defeats the claim outright. False when it merely
qualifies it ("only on MySQL 5.6", "only when strict mode is off"). Be accurate about this;
a qualification reported as fatal is as unhelpful as the reverse.

If the claim genuinely survives every attack, return {"contradictions": []}. An empty result is
a real outcome — do not invent a weak objection to appear rigorous.`;
}

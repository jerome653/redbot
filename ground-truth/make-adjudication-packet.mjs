/**
 * Build an adjudication packet for the claims in a corpus case that no human has ruled on.
 *
 * PHASE E.2 CONSTRAINT, and the reason this file is so plain: the model presents, the human
 * decides. This generator emits the extracted claim, the machine-assigned provenance, the
 * dependency graph, the contradictions raised against it, and nothing else.
 *
 * It deliberately does NOT emit:
 *   - a suggested label
 *   - a recommendation
 *   - an ordering by "likely false"
 *   - any commentary on which way a claim leans
 *
 * Contradictions are reproduced because they are evidence a reviewer should see, and are marked
 * as unverified model output because that is what they are. For this case none of them has been
 * checked against its cited source; the citation-fidelity campaign covered CERT-002 only.
 *
 * Run:  node ground-truth/make-adjudication-packet.mjs <CASE-ID>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const caseId = process.argv[2];
if (!caseId) { console.error('usage: node ground-truth/make-adjudication-packet.mjs <CASE-ID>'); process.exit(1); }

const dir = join(HERE, 'cases', caseId);
const c = JSON.parse(readFileSync(join(dir, 'case.json'), 'utf8'));
const a = c.argus_observed;

const labelled = new Map((c.ground_truth.claim_labels ?? []).map((l) => [l.claim_id, l]));
const open = a.claims.filter((x) => !labelled.has(x.id));

const byClaim = {};
for (const x of a.contradictions) (byClaim[x.claimId] ??= []).push(x);
const epistemic = new Set(a.epistemic.map((e) => e.claimId));
const invalidated = new Map((a.invalidated ?? []).map((i) => [i.claimId, i.becauseOf]));
const ran = new Set(a.refutationRan ?? a.contradictions.map((x) => x.claimId));
const ranKnown = Array.isArray(a.refutationRan);

const L = [];
const p = (s = '') => L.push(s);

p(`# ${caseId} — adjudication packet`);
p();
p(`**${open.length} claims awaiting a decision.** ${labelled.size} of ${a.claims.length} already ruled.`);
p();
p(`Thread: r/${c.thread.subreddit} — ${c.thread.title}`);
p(`Human verdict on the draft as a whole: **${c.human_review.verdict}** (${c.human_review.reviewer}, ${c.human_review.reviewed_at})`);
p();
p('## How to use this');
p();
p('For each claim below, record **TRUE**, **FALSE** or **UNKNOWN**, and the evidence you used.');
p();
p('- **UNKNOWN is a real answer.** It is recorded as `unverifiable` and is not a gap to be filled later.');
p('- Every ruling needs the source you relied on, so the corpus stays externally checkable.');
p('- Nothing below suggests an answer. The contradictions are reproduced because you should see');
p('  what the machine argued, **not** because they are evidence — none of them has been checked');
p('  against its cited source.');
p();
if (!ranKnown) {
  p('> ⚠ This record predates EB-40, so the set of completed refutations is not stored.');
  p('> "refutation completed" below is inferred from which claims received a contradiction and');
  p('> cannot distinguish a refutation that ran and found nothing from one that failed.');
  p();
}

p('## Sources already on record for this case');
p();
p('Attached during earlier review. Listed here because some open claims may touch them. **No');
p('mapping from source to claim is implied.**');
p();
for (const s of c.ground_truth.sources ?? []) {
  p(`- **${s.source_type}** — ${s.assertion}`);
  p(`  <br>${s.source}`);
  if (s.url) p(`  <br><${s.url}>`);
  p();
}

p('## Already ruled');
p();
p('| claim | ruling | expected provenance |');
p('|---|---|---|');
for (const [id, l] of labelled) p(`| ${id} | **${l.truth}** | \`${l.expected_provenance}\` |`);
p();

p('---');
p();
p('## Claims awaiting a decision');
p();

for (const cl of open) {
  const cons = byClaim[cl.id] ?? [];
  p(`### ${cl.id}`);
  p();
  p(`> ${cl.text}`);
  p();
  p('| | |');
  p('|---|---|');
  p(`| machine-assigned type | \`${cl.type}\` |`);
  p(`| machine-assigned provenance | \`${cl.evidenceClass}\` |`);
  p(`| machine-assigned confidence | \`${cl.confidence}\` |`);
  p(`| stated support | ${cl.evidenceDetail && cl.evidenceDetail !== '(none stated)' ? cl.evidenceDetail : '_none stated_'} |`);
  if (cl.dependsOn.length) {
    const deps = cl.dependsOn.map((d) => {
      const l = labelled.get(d);
      return `\`${d}\`${l ? ` (ruled **${l.truth}**)` : ' (not yet ruled)'}`;
    }).join(', ');
    p(`| rests on | ${deps} |`);
  } else {
    p('| rests on | — |');
  }
  if (invalidated.has(cl.id)) p(`| machine marked invalidated because | \`${invalidated.get(cl.id)}\` failed |`);
  p(`| refutation completed | ${ran.has(cl.id) ? 'yes' : 'no — never attacked'} |`);
  p(`| language outruns evidence | ${epistemic.has(cl.id) ? 'flagged' : 'not flagged'} |`);
  p();
  if (cons.length) {
    p(`<details><summary>${cons.length} contradiction(s) raised — unverified model output</summary>`);
    p();
    for (const x of cons) {
      p(`- ${x.fatal ? '**[marked fatal]** ' : ''}\`${x.kind}\` · cites \`${x.evidenceClass}\` — ${String(x.statement).replace(/\s+/g, ' ')}`);
    }
    p();
    p('</details>');
  } else {
    p('_No contradiction was raised against this claim._');
  }
  p();
  p('**DECISION:** `TRUE` / `FALSE` / `UNKNOWN` — ');
  p();
  p('**EVIDENCE:** ');
  p();
  p('**EXPECTED PROVENANCE** (what class the evidence actually warrants): ');
  p();
  p('---');
  p();
}

p('## When every claim is ruled');
p();
p('Transfer the rulings into the `SPEC` block in `ground-truth/build-corpus.mjs`, then run:');
p();
p('```');
p('node ground-truth/validate.mjs --fix');
p('node qa/benchmark/run.mjs');
p('```');
p();
p(`\`validate.mjs\` promotes a case to **calibration: approved** only when all ${a.claims.length} claims`);
p('carry a ruling with an expected provenance. That promotion is the phase\'s success condition.');

writeFileSync(join(dir, 'ADJUDICATION-PACKET.md'), L.join('\n') + '\n', 'utf8');
console.log(`wrote ${join(dir, 'ADJUDICATION-PACKET.md')} — ${open.length} open claims, ${L.length} lines`);

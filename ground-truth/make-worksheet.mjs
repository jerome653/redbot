/**
 * Generate a labelling worksheet for a certification that has no ground truth yet.
 *
 * The worksheet contains QUESTIONS ONLY. Every ground-truth cell is `?`. It exists so a person
 * can label a case in one sitting instead of reconstructing the certification by hand — the
 * mechanical half (claims, provenance, contradictions, dependencies, which refutations ran) is
 * extracted from the record; the judgement half is left empty on purpose.
 *
 * AGTC rule this respects: ground truth never originates from a language model. The
 * contradictions reproduced here are model output and are labelled as leads to verify, never as
 * evidence. Nothing in this file may be copied into a case as an answer.
 *
 * Run:  node ground-truth/make-worksheet.mjs <draftId>
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const draftId = process.argv[2];
if (!draftId) { console.error('usage: node ground-truth/make-worksheet.mjs <draftId>'); process.exit(1); }

const certs = readFileSync(join(ROOT, 'data', 'certifications.jsonl'), 'utf8')
  .split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
const rec = certs.filter((c) => c.draftId === draftId).sort((a, b) => (b.claims ?? []).length - (a.claims ?? []).length)[0];
if (!rec) { console.error(`no certification for ${draftId}`); process.exit(1); }

const drafts = JSON.parse(readFileSync(join(ROOT, 'data', 'drafts.json'), 'utf8'));
const threads = JSON.parse(readFileSync(join(ROOT, 'data', 'threads.json'), 'utf8'));
const draft = drafts.find((d) => d.id === draftId);
const thread = threads.find((t) => t.id === rec.threadId);

const FALSIFIABLE = new Set([
  'implementation-detail', 'version-specific', 'platform-behaviour', 'protocol-behaviour', 'configuration-advice'
]);

// Which refutations completed. Pre-EB-40 records do not carry this; fall back to "attacked".
const ran = new Set(rec.refutationRan ?? rec.contradictions.map((c) => c.claimId));
const ranKnown = Array.isArray(rec.refutationRan);

const byClaim = {};
for (const c of rec.contradictions) (byClaim[c.claimId] ??= []).push(c);
const epistemic = new Set(rec.epistemic.map((e) => e.claimId));
const invalidated = new Map((rec.invalidated ?? []).map((i) => [i.claimId, i.becauseOf]));

const L = [];
const p = (s = '') => L.push(s);

p(`# ${draftId} — labelling worksheet`);
p();
p(`**Thread:** r/${thread.subreddit} — ${thread.title}`);
p(`**Permalink:** ${draft.permalink}`);
p(`**Argus verdict:** ${rec.verdict} · ${rec.claims.length} claims · ${rec.contradictions.length} contradictions ` +
  `(${rec.contradictions.filter((c) => c.fatal).length} fatal) · ${rec.epistemic.length} epistemic · ` +
  `${(rec.invalidated ?? []).length} invalidated`);
p(`**Certified:** ${rec.certifiedAt} · model \`${rec.model}\``);
p();
p('> **This file contains questions, not answers.** Every cell marked `?` must be filled by a');
p('> person from an EXTERNAL source — official documentation, a specification, an RFC, vendor');
p('> documentation, source code, or reproducible runtime behaviour.');
p('>');
p('> **AGTC rule: ground truth never originates from a language model.** The contradictions');
p('> reproduced below are model output and are themselves unverified. They are shown as *leads to');
p('> check*, never as evidence. Copying one into a case as an answer would make the pipeline its');
p('> own examiner — the HRC-001 failure one level up.');
if (!ranKnown) {
  p('>');
  p('> ⚠ This record predates EB-40, so `refutationRan` is not stored. "refutation ran" below is');
  p('> inferred from which claims received a contradiction, and cannot distinguish a refutation');
  p('> that completed and found nothing from one that failed.');
}
p();
p('## The draft, verbatim');
p();
p('```');
p(draft.body);
p('```');
p();
p('## Per-claim worksheet');
p();

for (const c of rec.claims) {
  const cons = byClaim[c.id] ?? [];
  const tags = [
    FALSIFIABLE.has(c.type) ? 'FALSIFIABLE' : null,
    invalidated.has(c.id) ? `invalidated by ${invalidated.get(c.id)}` : null
  ].filter(Boolean);
  p(`### ${c.id}${tags.length ? '  · ' + tags.join(' · ') : ''}`);
  p();
  p(`> ${c.text}`);
  p();
  p('| field | Argus said | ground truth |');
  p('|---|---|---|');
  p(`| type | \`${c.type}\` | ? |`);
  p(`| provenance | \`${c.evidenceClass}\` | **?** ← the calibration measurement |`);
  p(`| confidence | \`${c.confidence}\` | — |`);
  p(`| depends on | ${c.dependsOn.length ? c.dependsOn.map((d) => `\`${d}\``).join(', ') : '—'} | ? |`);
  p(`| refutation ran | ${ran.has(c.id) ? 'yes' : '**no — never attacked**'} | — |`);
  p(`| epistemic flag | ${epistemic.has(c.id) ? '**yes** — language outruns evidence' : 'no'} | ? |`);
  p();
  p('**TRUTH: ?** — one of `true` / `false` / `unverifiable` / `depends`');
  p();
  p('**SOURCE: ?** — what documents it, and whether it was checked today or inherited');
  p();
  if (cons.length) {
    p(`<details><summary>${cons.length} model-generated contradiction(s), ${cons.filter((x) => x.fatal).length} marked fatal — leads to verify, NOT evidence</summary>`);
    p();
    for (const x of cons) {
      const head = x.fatal ? '**[fatal]** ' : '';
      p(`- ${head}\`${x.kind}\` · cites \`${x.evidenceClass}\` — ${String(x.statement).replace(/\s+/g, ' ').slice(0, 320)}`);
    }
    p();
    p('</details>');
  } else {
    p('_No contradiction generated for this claim._');
  }
  p();
}

p('## Corpus-level questions');
p();
p(`- **Expected verdict: ?** — \`REJECT\` / \`ESCALATE\` / \`CERTIFIED\`. Argus said **${rec.verdict}**.`);
p('- **Was that verdict right, and for the right reasons?** ?');
p('- **Extraction — did it miss a claim the draft makes, or invent one that it does not?** ?');
p(`- **Propagation — Argus invalidated ${(rec.invalidated ?? []).length} claim(s)` +
  `${invalidated.size ? ': ' + [...invalidated.entries()].map(([k, v]) => `${k} ← ${v}`).join(', ') : ''}. Correct?** ?`);
p('- **Reviewer: ?**   **Date: ?**');
p();
p('---');
p();
p('When every `?` above is answered, transfer the answers into a `SPEC` block in');
p('`ground-truth/build-corpus.mjs`, then run `build-corpus.mjs` and `validate.mjs --fix`.');

const dir = join(HERE, 'cases', draftId.startsWith('d_c9bd') ? 'CERT-002' : draftId);
if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
const out = join(dir, 'LABELLING-WORKSHEET.md');
writeFileSync(out, L.join('\n') + '\n', 'utf8');
console.log(`wrote ${out} — ${rec.claims.length} claims, ${L.length} lines`);

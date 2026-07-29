/**
 * Argus reports — the eight required artefacts.
 *
 * Phase 9's rule shapes all of them: **a reviewer must not see the prose first.** Reading a
 * fluent paragraph primes you to believe it; by the time you reach the claim you are checking
 * whether it sounds right rather than whether it is right. HRC-001 is the proof — the draft was
 * pleasant to read and false, and the pleasantness came first.
 *
 * So every package below leads with claims, evidence and contradictions, and shows the draft
 * last, after the reviewer already knows what to look for.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../config.js';
import { loadCertifications } from './pipeline.js';
import { terminalClaims } from './graph.js';
import { AUTHORITATIVE, NO_PROVENANCE, FALSIFIABLE_TYPES } from './types.js';
import type { Certification, Claim } from './types.js';
import type { Draft } from '../types.js';

const dir = join(ROOT, 'reports');
const stamp = () => new Date().toISOString().slice(0, 10);

function write(name: string, body: string): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, body, 'utf8');
  return path;
}

const esc = (s: string) => s.replace(/\|/g, '\\|');

const strength = (c: Claim): string =>
  NO_PROVENANCE.has(c.evidenceClass) ? '**none**'
    : AUTHORITATIVE.has(c.evidenceClass) ? 'authoritative'
    : 'non-authoritative';

/* ------------------------------------------------------------------ *
 * Phase 10 — what reference material had to say
 *
 * The default outcome here is "nothing", and that is printed loudly rather than omitted. A
 * section that simply disappears when no corpus had standing reads as a clean bill of health;
 * the honest reading is that every claim in the draft came out of model memory, unchecked
 * against anything, which is the provenance of HRC-001's false claim.
 * ------------------------------------------------------------------ */

function citationSection(cert: Certification): string {
  const c = cert.citations;
  if (!c) return '';

  const covered = c.findings.filter((f) => f.status === 'covered');
  const uncited = c.findings.filter((f) => f.status === 'uncited');
  const broken = c.findings.filter((f) => f.status === 'unavailable');

  const lines: string[] = [
    `\n## 6b. Reference material — ${c.findings.length} of ${cert.claims.length} claim(s) ruled on\n`
  ];

  if (!c.findings.length) {
    lines.push(
      `**No corpus had standing over any claim in this draft.** Nothing here was checked ` +
      `against human-authored reference material — every claim above rests on the model's ` +
      `own memory and on the refutation pass alone. Read this as an absence of evidence, ` +
      `not as evidence of correctness.\n`
    );
  }

  if (uncited.length) {
    lines.push(`### Uncited, inside a corpus that covers the subject\n`);
    for (const f of uncited) {
      const claim = cert.claims.find((x) => x.id === f.claimId);
      lines.push(`- \`${f.claimId}\` ${esc(claim?.text ?? '')}\n  - ${esc(f.detail)}`);
    }
    lines.push('');
  }

  if (covered.length) {
    lines.push(
      `### Material exists on the subject — read it against the claim\n\n` +
      `A match here is **shared vocabulary, not agreement.** Measured 2026-07-24: a false ` +
      `claim matched the very card that contradicts it. These cards are for you to read; ` +
      `nothing has compared them to the claim.\n`
    );
    for (const f of covered) {
      const claim = cert.claims.find((x) => x.id === f.claimId);
      lines.push(`- \`${f.claimId}\` ${esc(claim?.text ?? '')}`);
      for (const h of f.hits) {
        lines.push(`  - \`${h.cardId}\` — ${esc(h.question)} _(${Math.round(h.coverage * 100)}% of the claim's terms)_`);
      }
    }
    lines.push('');
  }

  if (broken.length) {
    lines.push(`### Could not be read\n`);
    for (const f of broken) lines.push(`- \`${f.claimId}\` — ${esc(f.detail)}`);
    lines.push('');
  }

  if (c.corporaSummary.length) {
    lines.push(
      `_Corpora: ${c.corporaSummary.map((s) =>
        `${s.id} (${s.cards === null ? 'unavailable' : `${s.cards} cards`}${s.modified ? `, ${s.modified.slice(0, 10)}` : ''})`
      ).join(' · ')}._\n`
    );
  }

  return lines.join('\n');
}

/* ------------------------------------------------------------------ *
 * Phase 9 — the operator review package
 * ------------------------------------------------------------------ */

export function reviewPackage(cert: Certification, draft: Draft, threadTitle: string): string {
  const fatal = cert.contradictions.filter((c) => c.fatal);
  const unsupported = cert.claims.filter((c) => NO_PROVENANCE.has(c.evidenceClass));
  const terminals = terminalClaims(cert.claims);

  const claimRow = (c: Claim) => {
    const dead = cert.invalidated.find((i) => i.claimId === c.id);
    const contras = cert.contradictions.filter((x) => x.claimId === c.id);
    return `| \`${c.id}\`${dead ? ' ☠' : ''} | ${esc(c.text)} | ${c.type} | ${c.evidenceClass} (${strength(c)}) | ${c.confidence} | ${c.dependsOn.join(', ') || '—'} | ${contras.length ? (contras.some((x) => x.fatal) ? '**fatal**' : String(contras.length)) : '—'} |`;
  };

  return write(`argus-review-${draft.id}.md`, `# Operator Review Package — \`${draft.id}\`

**Thread:** ${threadTitle}
**Verdict:** ${cert.verdict === 'CERTIFIED' ? '✅' : cert.verdict === 'ESCALATE' ? '⚠️' : '⛔'} **${cert.verdict}**
**Certified:** ${cert.certifiedAt.slice(0, 16).replace('T', ' ')} · model ${cert.model}

> Read this in order. The draft is at the bottom on purpose — reading prose first primes you to
> assess whether it *sounds* right instead of whether it *is* right, which is exactly how
> HRC-001 reached the publication queue.

## 1. Thread status

${cert.resolution.resolved ? '⛔ **RESOLVED**' : '🟢 open'} — ${cert.resolution.detail}

${cert.resolution.signals.length
  ? cert.resolution.signals.map((s) => `- \`${s.where}\`${s.byOriginalPoster ? ' **(original poster)**' : ''} — "${esc(s.matched)}"\n  - ${esc(s.context)}`).join('\n')
  : '_No resolution signals._'}

## 2. Verdict reasons

${cert.reasons.map((r) => `- **${r.rule}**${r.claimId ? ` \`${r.claimId}\`` : ''} — ${esc(r.detail)}`).join('\n')}

## 3. Claims — ${cert.claims.length}

${cert.claims.length ? `| id | claim | type | evidence | conf | rests on | contra |
|---|---|---|---|---|---|---|
${cert.claims.map(claimRow).join('\n')}

☠ = invalidated because something it rests on failed.` : '_No claims extracted._'}

## 4. What this reply actually concludes

${terminals.length
  ? terminals.map((c) => `- \`${c.id}\` ${esc(c.text)} — evidence: **${c.evidenceClass}**, confidence **${c.confidence}**`).join('\n')
  : '_No terminal claims._'}

${terminals.some((c) => !AUTHORITATIVE.has(c.evidenceClass) && FALSIFIABLE_TYPES.has(c.type))
  ? '> ⚠️ At least one conclusion asserts how software behaves without authoritative evidence.\n> That is the HRC-001 shape: reasoning about behaviour is not evidence of behaviour.'
  : ''}

## 5. Known uncertainties

${unsupported.length
  ? unsupported.map((c) => `- \`${c.id}\` **${c.evidenceClass}** — ${esc(c.text)}`).join('\n')
  : '_Every claim states a provenance._'}

${cert.epistemic.length
  ? `\n### Language outrunning evidence\n\n${cert.epistemic.map((e) => `- \`${e.claimId}\` ${esc(e.detail)}\n  - > ${esc(e.quote)}`).join('\n')}`
  : ''}

## 6. Contradictions — ${cert.contradictions.length}${fatal.length ? ` (${fatal.length} fatal)` : ''}

${cert.contradictions.length
  ? cert.contradictions.map((c) => `### \`${c.claimId}\` — ${c.kind}${c.fatal ? ' · **FATAL**' : ''}

${esc(c.statement)}

*Evidence:* ${c.evidenceClass} — ${esc(c.evidenceDetail)}`).join('\n\n')
  : '_No contradiction survived the refutation pass._'}

${citationSection(cert)}
---

## 7. The draft, last

> ${draft.body.split('\n').join('\n> ')}

---

### What is still yours to decide

Argus checks that claims are *supported*. It cannot check that they are *true*, and it has no
opinion on whether this reply is worth posting. Those remain human judgements:

- Is the evidence cited actually what it claims to be?
- Does this answer what was asked?
- Would you put your name on it?
`);
}

/* ------------------------------------------------------------------ *
 * Ledgers and aggregate reports
 * ------------------------------------------------------------------ */

export async function claimLedger(): Promise<string> {
  const certs = await loadCertifications();
  const all = certs.flatMap((c) => c.claims.map((cl) => ({ cert: c, claim: cl })));
  const byType = new Map<string, number>();
  for (const { claim } of all) byType.set(claim.type, (byType.get(claim.type) ?? 0) + 1);

  return write('argus-claim-ledger.md', `# Claim Ledger

**Generated:** ${stamp()} · **Certifications:** ${certs.length} · **Claims:** ${all.length}

Every factual assertion Argus has extracted, across every draft. This is the record that makes
"the drafts are usually right" a checkable statement instead of an impression.

## Claims by type

| type | count | falsifiable |
|---|---|---|
${[...byType.entries()].sort((a, b) => b[1] - a[1])
  .map(([t, n]) => `| \`${t}\` | ${n} | ${FALSIFIABLE_TYPES.has(t as never) ? 'yes' : 'no'} |`).join('\n') || '| — | 0 | — |'}

## Every claim

${all.length ? `| draft | id | claim | type | evidence | conf |
|---|---|---|---|---|---|
${all.map(({ cert, claim }) => `| \`${cert.draftId.slice(0, 16)}\` | \`${claim.id}\` | ${esc(claim.text)} | ${claim.type} | ${claim.evidenceClass} | ${claim.confidence} |`).join('\n')}` : '_No claims on record._'}
`);
}

export async function evidenceLedger(): Promise<string> {
  const certs = await loadCertifications();
  const claims = certs.flatMap((c) => c.claims);
  const byClass = new Map<string, number>();
  for (const c of claims) byClass.set(c.evidenceClass, (byClass.get(c.evidenceClass) ?? 0) + 1);

  const authoritative = claims.filter((c) => AUTHORITATIVE.has(c.evidenceClass)).length;
  const none = claims.filter((c) => NO_PROVENANCE.has(c.evidenceClass)).length;

  return write('argus-evidence-ledger.md', `# Evidence Ledger

**Generated:** ${stamp()} · **Claims:** ${claims.length}

Where the claims come from. The distribution is the health metric: a pipeline whose claims are
mostly \`reasoned-inference\` is a pipeline that explains rather than knows.

| | count | share |
|---|---|---|
| Authoritative provenance | ${authoritative} | ${claims.length ? Math.round((authoritative / claims.length) * 100) + '%' : 'no data'} |
| No provenance at all | ${none} | ${claims.length ? Math.round((none / claims.length) * 100) + '%' : 'no data'} |

## By evidence class

| class | count | counts as authoritative |
|---|---|---|
${[...byClass.entries()].sort((a, b) => b[1] - a[1])
  .map(([k, n]) => `| \`${k}\` | ${n} | ${AUTHORITATIVE.has(k as never) ? 'yes' : 'no'} |`).join('\n') || '| — | 0 | — |'}

> **Reasoning about how software behaves is not evidence of how it behaves.**
> \`reasoned-inference\` is an honest answer for most explanatory claims, and it is also the
> class HRC-001's false claim belonged in while being presented as implementation detail.
`);
}

export async function contradictionReport(): Promise<string> {
  const certs = await loadCertifications();
  const all = certs.flatMap((c) => c.contradictions.map((x) => ({ draftId: c.draftId, x })));
  const fatal = all.filter(({ x }) => x.fatal);

  return write('argus-contradiction-report.md', `# Contradiction Report

**Generated:** ${stamp()} · **Contradictions:** ${all.length} · **Fatal:** ${fatal.length}

Every claim is attacked, not assessed. A model asked "is this right?" agrees; a model asked
"find where this breaks" looks.

${all.length ? all.map(({ draftId, x }) => `### \`${draftId.slice(0, 18)}\` / \`${x.claimId}\` — ${x.kind}${x.fatal ? ' · **FATAL**' : ''}

${esc(x.statement)}

*Evidence:* ${x.evidenceClass} — ${esc(x.evidenceDetail)}`).join('\n\n') : '_None recorded._'}
`);
}

export async function confidenceReport(): Promise<string> {
  const certs = await loadCertifications();
  const claims = certs.flatMap((c) => c.claims);
  const byConf = new Map<string, number>();
  for (const c of claims) byConf.set(c.confidence, (byConf.get(c.confidence) ?? 0) + 1);
  const epistemic = certs.flatMap((c) => c.epistemic);

  return write('argus-confidence-report.md', `# Confidence Report

**Generated:** ${stamp()} · **Claims:** ${claims.length}

| confidence | count | may be stated as fact |
|---|---|---|
${['high', 'medium', 'low', 'unknown']
  .map((k) => `| ${k} | ${byConf.get(k) ?? 0} | ${k === 'low' || k === 'unknown' ? '**no**' : 'yes'} |`).join('\n')}

## Language outrunning evidence — ${epistemic.length}

${epistemic.length
  ? epistemic.map((e) => `- \`${e.claimId}\` language **${e.languageCertainty}**, evidence supports **${e.supportedCertainty}**\n  - > ${esc(e.quote)}\n  - ${esc(e.detail)}`).join('\n')
  : '_No claim asserts more than its evidence carries._'}

> Overconfidence is a certification failure, not a style note. The craft gate rewards
> specificity and counts hedges, so a confidently wrong sentence scores *well* there. This is
> the check that disagrees with it.
`);
}

export async function certificationReport(): Promise<string> {
  const certs = await loadCertifications();
  const counts = { CERTIFIED: 0, ESCALATE: 0, REJECT: 0 };
  for (const c of certs) counts[c.verdict]++;

  const ruleCounts = new Map<string, number>();
  for (const c of certs) for (const r of c.reasons) ruleCounts.set(r.rule, (ruleCounts.get(r.rule) ?? 0) + 1);

  return write('argus-certification-report.md', `# Certification Report

**Generated:** ${stamp()} · **Drafts certified:** ${certs.length}

| verdict | count | meaning |
|---|---|---|
| ✅ CERTIFIED | ${counts.CERTIFIED} | every claim adequately supported — a human still reviews it |
| ⚠️ ESCALATE | ${counts.ESCALATE} | human expertise required to resolve something Argus cannot |
| ⛔ REJECT | ${counts.REJECT} | unsupported, contradicted, or false |

## Which rules fired

| rule | times |
|---|---|
${[...ruleCounts.entries()].sort((a, b) => b[1] - a[1]).map(([r, n]) => `| \`${r}\` | ${n} |`).join('\n') || '| — | 0 |'}

## Every certification

${certs.length ? certs.map((c) => `- ${c.verdict === 'CERTIFIED' ? '✅' : c.verdict === 'ESCALATE' ? '⚠️' : '⛔'} **${c.verdict}** \`${c.draftId}\` — ${c.claims.length} claim(s), ${c.contradictions.filter((x) => x.fatal).length} fatal contradiction(s)\n  - ${esc(c.reasons[0]?.detail ?? '')}`).join('\n') : '_None yet._'}
`);
}

export async function generateArgusReports(): Promise<string[]> {
  return [
    await claimLedger(),
    await evidenceLedger(),
    await certificationReport(),
    await contradictionReport(),
    await confidenceReport()
  ];
}

# 8. Evidence index

**Only what has actually been demonstrated.** Not believed, not estimated, not planned.

Anything the project asserts elsewhere and that does not appear here is an assumption. The
absence list at the bottom is the more important half of this document.

**Confidence** is about the *evidence*, not the claim: `high` = directly observed and
reproducible; `medium` = observed once, or observed indirectly; `low` = inferred from a related
observation.

---

## Proven

| # | Observation | Date | Evidence source | Reproducible | Conf | Related |
|---|---|---|---|---|---|---|
| E-01 | Playwright **launching** a browser gets a Reddit block page in all four modes; **attaching** to an operator-started Chrome works | 2026-07-22 | `certification/evidence/2026-07-22-reddit-access.md`; `read` went 0 → 25 threads | yes | high | — |
| E-02 | Reddit serves the block as **HTTP 200 with the block page in the body** | 2026-07-22 | same experiment; a naive status check read it as success | yes | high | — |
| E-03 | Sustained reading triggered HTTP 429 at ~75 page loads in minutes; 9.5 loads/min ran clean | 2026-07-22 | `qa/evidence/phase8-*.log` | partially — needs a live 429 | high | DEFECT-02 |
| E-04 | 4.6 GB of Chrome profile incl. live `reddit_session` cookies was committable | 2026-07-22 | `git check-ignore -v` before/after | yes | high | DEFECT-01 |
| E-05 | The approval gate resolved unrecognised input to "approve, and post" | 2026-07-22 | `ask.test.ts`, 4 regressions incl. one reading the call site | yes | high | DEFECT-08 |
| E-06 | `claude -p` inherits the working directory as agent context; 2 of 3 leaked drafts passed the linter | 2026-07-22 | drafts on disk; fixed by empty scratch dir | yes | high | DEFECT-06 |
| E-07 | Triage instability is caused by an underspecified rubric, **not** temperature — lowering it made spread worse (20 → 25.8) | 2026-07-22 | controlled 3-run experiment | yes | high | DEFECT-07 |
| E-08 | Mechanical gates reduced score spread 19.2 → 6.7; 3 of 6 threads identical across runs | 2026-07-22 | same experiment | yes | high | DEFECT-07 |
| E-09 | The linter passed a real leaked draft; the preamble check read line 1 only | 2026-07-22 | the draft; `disclosure.test.ts` DEFECT-10 cases | yes | high | DEFECT-10 |
| E-10 | Disclosure linter blocks 31/31 adversarial leakage classes with 10/10 must-pass | 2026-07-23 | `node qa/phase4-fuzz.mjs` | yes | high | — |
| E-11 | 3 of 7 pending drafts targeted threads **7–8 years old** (62,975 / 70,180 / 70,627 h) | 2026-07-23 | `threads.json` + `drafts.json` join | yes | high | DEFECT-11 |
| E-12 | Triage scored a `[Guide]` post **72/confidence 90** where its own GATE A specifies 5, and wrote a justification for it | 2026-07-23 | `analysis.json` record for `b5a8b0185c8d` | yes | high | DEFECT-12 |
| E-13 | Opportunity scores saturated: **7 of 14 threads scored exactly 100** | 2026-07-23 | `assessments.json` distribution | yes | high | DEFECT-14 |
| E-14 | **65 of 67 gaps (97%) returned `fillable`** against a WordPress-only competence list | 2026-07-23 | `gaps.json` aggregate | yes | high | DEFECT-15 |
| E-15 | A Vue/Nuxt + Laravel deployment thread scored **92/100** and was assessed "contribute" | 2026-07-23 | `assessments.json` before the competence filter | yes | high | DEFECT-15 |
| E-16 | Four English-word false positives in competence matching: "theme tokens", "the best compromise", "rendering order", lone "cache" | 2026-07-23 | printed match traces over 14 real threads | yes | high | DEFECT-15 |
| E-17 | Every thread on the Phase-3 path was unpublishable — gates required the Phase-1 `analysis.json` | 2026-07-23 | first live pre-flight of `d_c9bd9366f6b9_mrwiupf2` | yes | high | — |
| E-18 | `ageMinutes` is frozen at collection: stored 17.8 h vs true 28.3 h on thread `c14d9d8caa0e` | 2026-07-23 | arithmetic on `ageMinutes` + `collectedAt` | yes | high | — |
| E-19 | 3 of 15 threads in a fresh r/Wordpress collect were `[PROMO]`-tagged and unknown to the filter | 2026-07-23 | `read wordpress` output | yes | medium | DEFECT-13 |
| E-20 | **HRC-001**: a fluent, specific, hedged, brand-safe, lint-clean, novel draft was technically wrong; every automated gate passed it | 2026-07-23 | `reports/HRC-001-custom-css-updraft.md` | yes — the draft is on disk | high | HRC-001 |
| E-21 | MySQL raises `ERROR 1153 (08S01)` and aborts the import on exceeding `max_allowed_packet`; it does not silently insert a blank row | 2026-07-23 | independent web sources; `wp_options.option_value` is LONGTEXT so column truncation cannot apply either | yes | high | HRC-001 |
| E-22 | The gap analyzer returned `alreadyAnswered: false` on a thread whose body contained `UPDATE: … it found all the CSS` plus two OP confirmations | 2026-07-23 | `gaps.json` for `f11d8de68709` vs `threads.json` body | yes | high | HRC-001-A |
| E-23 | Deterministic resolution detection returns `resolved: true`, 4 signals, on that same thread | 2026-07-23 | `redbot certify` → REJECT, 0 model calls; verbatim regression test | yes | high | HRC-001-A |
| E-24 | Argus claim extraction produced 12 correctly-typed atomic claims from a real draft | 2026-07-23 | `trace.jsonl` `argus.claims` event | once | medium | — |
| E-25 | The model declared **authoritative** provenance (`official-implementation`, `observed-runtime-behaviour`) for the known-false claim | 2026-07-23 | same trace event, claims c5 and c8 | once | high | ARGUS-001 |
| E-26 | Per-claim refutation hit the 180 s CLI timeout repeatedly (12 claims sequential) | 2026-07-23 | `argus.contradiction.failed` for c2, c3 | yes | high | ARGUS-002 |
| E-27 | Account `docs-architect` has karma **1** | 2026-07-23 | `probe-karma`, recorded to `observations.jsonl` | yes | high | — |
| E-28 | Session plans permit a reply in **46.7%** of cases over 1,000 seeds | 2026-07-23 | deterministic replay | yes | high | — |
| E-29 | Behaviour timings replay exactly from a seed | 2026-07-23 | `behavior.test.ts` | yes | high | — |
| E-30 | 169 tests pass; typecheck clean under `strict` | 2026-07-23 | `npm test`, `tsc --noEmit` | yes | high | — |
| E-31 | Two independent layers prevent an agent from publishing: redbot's TTY refusal, and the Claude Code classifier blocking the `reply` command | 2026-07-23 | observed refusal of both | yes | high | — |
| E-32 | **Argus's claim path completed end to end and returned REJECT on the HRC-001 draft** — 12 claims, **32 contradictions, 16 fatal**, rules `fatal-contradiction` + `overconfident-language` | 2026-07-23 | `certifications.jsonl` record 3; full run output | yes | high | HRC-001 |
| E-33 | The adversarial refutation **independently identified `ERROR 1153`** and cited `primary-documentation` — the same defect human certification found, reached without being told | 2026-07-23 | contradictions on c5, c6, c7, c9, c11 | yes | high | HRC-001, ARGUS-001 |
| E-34 | Argus found **three defects the human review missed**: Additional CSS is keyed by `post_name` from the active theme slug (so an intact row reads empty); `mysqldump --extended-insert` batches rows so "small values restore fine" is false; non-strict-mode column truncation matches the observed symptom better than `max_allowed_packet` | 2026-07-23 | contradictions on c8, c10, c11, cited `official-implementation` | yes | high | HRC-001 |
| E-35 | Refutation **caught claims whose provenance the model had inflated** — c5 (`observed-runtime-behaviour`) and c7 (`official-implementation`) both took fatal contradictions | 2026-07-23 | same run | yes | high | ARGUS-001 |
| E-36 | Claim extraction declared **8 dependency edges** across 12 claims (c9→c5,c7; c10→c5,c7,c9; c11→c5,c6) | 2026-07-23 | certification record | yes | medium | — |
| E-37 | **Argus's rule layer produces all three verdicts.** Replaying the real record under perturbation yielded REJECT, ESCALATE **and CERTIFIED** — previously only REJECT had ever been observed | 2026-07-23 | `qa/ARE-001-argus-replay.mjs` P2/P2b/P4; results in `qa/ARE-001-RESULTS.md` | yes — deterministic, no model | high *(rule layer only, n=1 draft)* | N-06c, R-02b |
| E-38 | **Rule 8 and Phase 6 propagation both fire.** Refutation-ran-on-nothing → ESCALATE with 5 unrefuted falsifiable claims; one upstream claim fatal → **3 claims invalidated** (c9, c10, c11 ← c5) | 2026-07-23 | same harness, P2 and P3 | yes | high | N-06, N-06b |
| E-39 | **All 5 of 5 falsifiable claims were assigned AUTHORITATIVE provenance** (framework-documentation ×2, observed-runtime-behaviour, primary-documentation, official-implementation). Rule 4 escalates falsifiable claims on *non*-authoritative evidence, so **Rule 4 could not fire on this draft at all** | 2026-07-23 | claim table in `qa/ARE-001-RESULTS.md` (M5) | yes | high *(n=1 draft)* | E-25, R-03 |
| E-40 | **With refutation contributing nothing, the known-false HRC-001 draft reaches ESCALATE, not REJECT** — on a single `overconfident-language` issue against c9, a *recommendation*. The false claims c5 and c7 triggered no rule of their own | 2026-07-23 | same harness, P2c | yes | high *(n=1 draft)* | HRC-001, ARGUS-001 |
| E-42 | **Provenance inflation measured as a standing metric: 0 of 9 correct.** Every claim where ground truth declares an expected evidence class received a stronger one — `observed-runtime-behaviour`, `primary-documentation`, `official-implementation` for claims that are reasoned inference | 2026-07-23 | `node qa/benchmark/run.mjs --verbose`; `qa/benchmark/last-run.json` | yes — deterministic | high *(3 cases, 1 draft)* | E-25, E-39, R-03 |
| E-67 | ✅ **FIRST POSITIVE MEASUREMENT OF ARGUS OUTPUT QUALITY. Every claim a human labelled false received a fatal contradiction — 3 of 3, zero false negatives on the adjudicated set.** Computed from Jerome's existing HRC-001 labels (c5, c6, c7), not from new judgement | 2026-07-23 | `docs/13-CALIBRATION-REPORT-V1.md` | yes — deterministic over the case file | high for the 3 claims; **3 claims, 1 draft — not a rate** | E-44, E-63 |
| E-68 | **Verdict agreement: 1 of 1.** Human ruled `incorrect` → appropriate REJECT; Argus returned REJECT. One agreement is not an agreement rate | 2026-07-23 | same report | yes | high for n=1 | E-67 |
| E-69 | **The tension, both halves measured:** Argus caught every human-labelled-false claim, *and* only 3 of 8 fatal contradictions rest on a fully faithful citation. **Right answers, unreliable reasoning.** Whether the verdict was right because of the reasoning or despite it cannot be determined from one case | 2026-07-23 | same report | yes | high | E-63, E-67 |
| E-70 | **Calibration remains uncomputable in five of seven dimensions**, with named denominators: extraction precision/recall (no `expected_claims` authored, anywhere), false positives (9 of 12 HRC-001 claims unadjudicated), full contradiction and evidence-class agreement (3 of 12), any cross-case rate (1 labelled case). No precision or recall computed | 2026-07-23 | same report | yes | high | — |
| E-62 | **CITATION FIDELITY COMPLETE — 13 of 13 Tier-1: FULL 4 · PARTIAL 4 · NONE 4 · UNVERIFIABLE 1.** Every result quoted with a URL. No extrapolation, no interval — a count of what was checked | 2026-07-23 | complete scorecard in `ground-truth/cases/CERT-002/LABELLING-WORKSHEET.md` | yes — retrieval, all URLs recorded | high for the sample; **not a rate for Argus** (one draft, one certification) | E-59 *(NARROWED)*, E-58 *(NARROWED)*, E-61 |
| E-63 | ⚠ **Only 3 of the 8 FATAL contradictions rest on a fully faithful citation.** 3 FULL · 1 PARTIAL · 1 NONE · 1 UNVERIFIABLE · 2 not retrievable (Tier-3 normative). The fatal contradictions are what produced this REJECT | 2026-07-23 | same scorecard | yes | high for the sample | E-60, E-62 |
| E-64 | **Argus produced two mutually inconsistent contradictions against the same claim.** Against c9: #6 asserts homepage catch-all redirects risk soft-404 (documentation **supports**), #8 asserts homepage fallback is endorsed migration practice (documentation says the **opposite**). Only #6 was flagged fatal. The refutation pass has no internal consistency check — stated as an observation, **no rule proposed** | 2026-07-23 | same scorecard | yes | high | E-62 |
| E-65 | **A cited source can contain a limb that cuts against the citing argument.** #7 reports Google's sneaky-redirect definition as requiring cloaking-style mismatch; the policy reads "show users and search engines different content **or show users unexpected content**". The omitted second limb weakens the contradiction's own conclusion | 2026-07-23 | Google Search Essentials spam policies, quoted | yes | high | E-62 |
| E-66 | **Some propositions are unverifiable by retrieval by construction.** #17's load-bearing half is a negative — "Google does not ingest archive.org data as a ranking signal" — and documentation cannot establish an absence. Recorded as UNVERIFIABLE and referred to human review, not resolved | 2026-07-23 | classification in the scorecard | n/a | high | E-61 |
| E-59 | **CITATION FIDELITY — first measurement. 4 FULL · 1 PARTIAL · 2 NONE (n=7 of 13 Tier-1).** New metric: when Argus cites a document, does the document support the specific proposition? Deliberately **not** a correctness score | 2026-07-23 | scorecard in `ground-truth/cases/CERT-002/LABELLING-WORKSHEET.md`, every result quoted with a URL | yes — retrieval | high *(7 of 21 contradictions)* | E-58, E-25 |
| E-60 | ⚠ **A FATAL contradiction cites documentation that does not contain its claim.** #4 (c6) asserts Google's docs frame unnatural-link actions as ranking suppression rather than removal, and that affected pages keep showing "Submitted and indexed". The cited Manual Actions report does **not** distinguish deindexing from ranking suppression — it says "some or all of that site will not be shown in Google search results" — and the "Submitted and indexed" assertion is absent. **The proposition may still be true; the citation is not faithful.** Provenance inflation observed in the REFUTATION pass, not just extraction | 2026-07-23 | same scorecard | yes | high | E-25, E-39, E-44 |
| E-61 | **Contradictions are not uniformly verifiable.** Of 21: **13 Tier-1** (authoritative documentation), **4 Tier-2** (need implementation/experiment — two cite hangout statements or community knowledge), **4 Tier-3** (normative; #11 self-declares `unsupported` and argues from *absence* of documentation). Retrieval can only ever reach Tier 1 | 2026-07-23 | classification in the scorecard | yes | high | — |
| E-58 | **First external check of Argus's CITATIONS: 2 of 2 supported.** c9's contradiction cites `primary-documentation` for homepage catch-all redirects being soft 404s — confirmed verbatim in Google Search Central *Site Moves*: "Don't redirect many old URLs to one irrelevant single URL destination, such as the home page of the new site… might be treated as a `soft 404` error." c14's cites `official-implementation` for Screaming Frog parsing `X-Robots-Tag` — confirmed in its User Guide. **Verifies provenance, NOT the verdict** | 2026-07-23 | quoted with URLs in `ground-truth/cases/CERT-002/LABELLING-WORKSHEET.md` | yes | high *(2 of 21 contradictions checked)* | E-25, E-42, E-44 |
| E-58a | **Citation accurate, certainty overstated by one step.** The source says redirects "**might be treated**" as soft 404; the contradiction says "**gets flagged**". Also: the contradiction named two pages (*HTTP/network errors* and *site moves*); only *site moves* carries the claim — the other two pages checked contain nothing about redirect-target relevance | 2026-07-23 | three Google pages fetched | yes | high | E-44, E-52 |
| E-55 | **HRC-001's ground truth re-verified against primary sources, and both CONFIRM the human verdict.** MySQL 8.4 manual, *Packet Too Large*: "it issues an `ER_NET_PACKET_TOO_LARGE` error **and closes the connection**" — not truncation. Error reference: 1153 / `08S01` / "Got a packet bigger than 'max_allowed_packet' bytes". WordPress `schema.php` (trunk): `option_value longtext NOT NULL` | 2026-07-23 | `ground-truth/cases/HRC-001/case.json` sources, quoted verbatim with URLs | yes | high | E-21 |
| E-55a | **Precision worth keeping:** the MySQL *error reference* page lists code/SQLSTATE/message but does **not** describe abort semantics. The abort behaviour is on the separate *Packet Too Large* page. Two pages, two facts — the earlier record cited one assertion where two sources are needed | 2026-07-23 | both pages fetched | yes | high | E-55 |
| E-56 | **EB-40's fix is validated on real data.** Replaying certification run #4 with the true `refutationRan` supplied reproduces the recorded reasons **exactly**; replaying with the set inferred from contradictions adds a spurious `unrefuted-falsifiable-claim`. The field was the entire cause of that record's irreproducibility | 2026-07-23 | `certify()` replay, both variants | yes — deterministic | high | EB-40, E-53 |
| E-57 | **Genuine rule-set drift exists, and is narrower than previously claimed.** Run #3 still gains `unrefuted-falsifiable-claim` even when the true `refutationRan` is supplied → Rule 8 postdates that record. Run #4 does not → no drift there. **0 of 4 records reproduce reasons exactly; 4 of 4 reproduce the verdict.** Nothing records which rule set produced a certification (EB-42) | 2026-07-23 | same replay | yes | high | EB-42 |
| E-47 | **Certification #2 completed** — `d_c9bd9366f6b9_mrwiupf2`, first run on an UNRESOLVED thread and first to reach the claim path without `--override`. 19 claims · 21 contradictions (8 fatal) · 9 epistemic · 6 invalidated · verdict **REJECT** | 2026-07-23 | `data/certifications.jsonl`; `reports/argus-review-d_c9bd9366f6b9_mrwiupf2.md` | yes | high | — |
| E-48 | **Provenance inflation did NOT reproduce.** HRC-001: 5 of 5 falsifiable claims AUTHORITATIVE. Cert #2: 4 falsifiable → **1 authoritative, 2 supportive, 1 none**. Whole-draft distribution skews weak: 7 `reasoned-inference`, 4 `widely-accepted-practice`, **3 `unknown`**, 2 `observed-runtime-behaviour` | 2026-07-23 | claim table from the record | yes | high — but 2 drafts | E-39, E-44, EB-37 |
| E-49 | **Rule 4 fired, twice** (c6 on `widely-accepted-practice`, c14 on `reasoned-inference`). Rule-4 starvation is **draft-dependent, not systematic** | 2026-07-23 | `.reasons` of the record | yes | high | E-39, E-42 |
| E-50 | **Phase 6 dependency propagation fired in PRODUCTION for the first time** — 6 claims invalidated (c7, c16, c19 ← c6; c10, c18 ← c9; c13 ← c12). Previously only ever seen in synthetic replay | 2026-07-23 | same record, `.invalidated` | yes | high | N-06b, E-38 |
| E-51 | **Cert #2 REJECTs with refutation contributing nothing** — `no-provenance`×3 + `invalidated-dependency`×3 + `falsifiable-claim-weak-evidence`×2 + `low-confidence-as-fact`×1. HRC-001 under the identical perturbation collapsed to ESCALATE (E-40). **Deterministic-layer sufficiency is draft-dependent** | 2026-07-23 | replay of the record through `certify()` | yes — deterministic | high | E-40, EB-36 |
| E-52 | **Confidence is not conditioned on provenance.** c12 (`implementation-detail`) and c17 (`recommendation`) both carry `unknown` provenance with **`high`** confidence — "I cannot say where this comes from" and "I am highly confident" asserted together | 2026-07-23 | claim table | yes | high — 2 of 3 unknown-provenance claims | — |
| E-53 | **Replay fidelity gap (instrumentation).** `certifications.jsonl` does not persist `refutationRan`. Replaying cert #2 by inferring it from the attacked set fires `unrefuted-falsifiable-claim` on c13 — which production did **not**, because c13's refutation completed and returned zero contradictions. Verdict unchanged (REJECT), reasons differ | 2026-07-23 | replay vs `.reasons` of the record | yes | high | E-38 |
| E-54 | `redbot certify` exits **1** on a REJECT verdict, which is indistinguishable from a crash to any caller reading exit codes. The background-task monitor reported the successful run as "failed" | 2026-07-23 | task notification vs run output | yes | high | — |
| E-44 | **Provenance error is unidirectional: 3 of 3 inflated, 0 deflated, mean tier delta +1.00.** Every measured claim was assigned a class one *band* stronger than its evidence supports (supportive → authoritative). Direction, not just inaccuracy | 2026-07-23 | `node qa/benchmark/run.mjs`; `qa/benchmark/last-run.json` `.calibration` | yes — deterministic | **medium — 3 claims, 1 draft.** Direction is clear; rate is not established | E-42, E-39, R-03 |
| E-45 | **Verdict-path coverage is 2 of 6.** Only `correct-REJECT` (×2) and `false-ESCALATE` (×1) have a case. **No `correct-CERTIFIED` example exists**, so the benchmark cannot yet distinguish a strict engine from a broken one | 2026-07-23 | same run, `.verdict_paths` | yes | high | N-06c, EB-17 |
| E-46 | **A case can pass the regression suite and still be a wrong-path verdict.** HRC-001-B PASSES (its `verdict_in` allows ESCALATE) while classifying as **false-ESCALATE**, because ground truth says the draft is incorrect and the appropriate verdict is REJECT | 2026-07-23 | same run — the two sections disagree by design | yes | high | E-40 |
| E-43 | **The benchmark's own refutation metric was defective on first run** — it scored the *recorded* contradictions rather than the ones each case actually ran with, reporting `TP 5` for the case that drops all contradictions. Corrected to read the effective input; the same case now correctly reports **TP 0 / FN 5** | 2026-07-23 | `qa/benchmark/run.mjs` `scoreStages()`; found by running it | yes | high | — |
| E-41 | The fail-closed refutation path **is wired**: `refutationRan` is added only on success (`pipeline.ts:140`), omitted on catch (`:144`), and passed to `certify` (`:164`) — so a timed-out refutation escalates rather than certifying | 2026-07-23 | source read | yes | high | E-26 |

---

## Explicitly NOT proven

This list is the honest state of the project. Every item is a hole in the evidence, not a
pending task.

| # | Not proven | Why it matters | What would settle it |
|---|---|---|---|
| N-01 | **A reply has never been published.** 0 for all time | Every downstream claim about outcomes is empty | one publish |
| N-02 | The publish path — composer selectors, submit, landed-confirmation, comment permalink capture | The single most complex untested path in the system | one publish |
| N-03 | Whether a karma-1 account's comment survives | The core operational unknown | publish + signed-out checkpoint |
| N-04 | The **signed-out observation vector** — never once executed | It is the only check that detects the failure mode ACCOUNT-WARMING describes | one checkpoint |
| ~~N-05~~ | ~~Argus's claim path end to end~~ | **RESOLVED 2026-07-23 — see E-32/E-33/E-34.** Completed, REJECT, 16 fatal contradictions | — |
| N-06 | Whether **Rule 8** changes any real verdict | Written from a trace; in the completed run every falsifiable claim *was* successfully refuted, so Rule 8 never needed to fire | a run where refutation fails on a falsifiable claim |
| N-06b | Whether **Phase 6 dependency propagation** changes any real verdict | 8 edges were declared, but `invalidated: 0` — every downstream claim was *independently* refuted, so nothing needed propagating. Correct behaviour, still unexercised | a run where an upstream claim fails and a downstream one survives refutation |
| N-06c | Whether Argus ever returns **CERTIFIED** on a real draft | Both real verdicts are REJECT. A certification engine that has only ever rejected is not yet shown to discriminate | certify a draft that is actually sound |
| N-07 | Lock/archive detection — no locked thread has ever been opened | Two gates are unexercised; they fail closed, which is safe but unverified | open a locked thread |
| N-08 | **Draft approval rate.** `reviews.jsonl` is empty | "replies a human will publish with little editing" is unmeasured | decide drafts at the prompt |
| N-09 | **Human Regret / stand-behind rate.** `regret.jsonl` is empty | The metric judged most important has zero readings | publish + 24 h |
| N-10 | The novelty threshold (70%) is declared, never fitted | It already produced one probable false positive | operator decisions on overlapping drafts |
| N-11 | Whether the 40/100 opportunity floor is right | Contribute rate of 60% is unvalidated against human judgement | rejection reasons coded `adds-nothing` |
| N-12 | The behaviour engine in a live session — 0 `session.start` events | Every rate in it is declared, none observed | run `redbot session` |
| N-13 | Reading speed, dwell realism, abandon rate | Placeholders presented as behaviour | measurement against a real operator |
| N-14 | Selector drift rate | `selector.miss` has never fired | weeks of operation |
| N-15 | Long-run stability (2 h / 6 h / overnight) | Never attempted | a long session |
| N-16 | Cold-start UX on a clean machine | Never attempted | a second machine |
| N-17 | 17 of 24 operational limits are **declared**; 6 are **provisional** | Only 1 limit in the system is measured | production observation |

---

## Added 2026-07-24 — Phase 16 (determinism) and Phase 10 (citations)

| # | Observation | Why it matters | Where |
|---|---|---|---|
| E-60 | Two runs of a **byte-identical build** on a **byte-identical draft** aligned at **6.3 %** — 1 of 16 claims matched at the pre-registered threshold | Claim extraction is a sampler, not a parser | `PHASE-16-02-DETERMINISM.md` |
| E-61 | Evidence class preserved on **0** aligned claims; the one matched pair moved community-knowledge → framework-documentation and medium → high | Self-declared provenance does not survive re-measurement | `PHASE-16-02` |
| E-62 | Verdict rule `unrefuted-falsifiable-claim` fired in one run and not the other, same input | A rule's participation is a function of the sample | `PHASE-16-02` |
| E-63 | Phase 7 resolution detection **byte-identical across 4 runs, 2 builds, 2 days** | The deterministic layers hold; the inputs to them do not | `PHASE-16-02` |
| E-64 | The build that produced R1/R2 **is not in git**; `src/argus/prompts.ts` (frozen) differs at `07bd842` with no recorded exception | A cited experiment is unreproducible, and nothing detected the frozen-surface change | `PHASE-16-03-BUILD-REPRODUCIBILITY.md` |
| E-65 | Corpus is **16 of 16 REJECT**; Argus has never returned CERTIFIED | Verdict agreement across runs carries ~no information | `PHASE-16-04-VERDICT-AGREEMENT.md` |
| E-66 | SGEN KB coverage of the WordPress claim space is ~0 (17 WordPress cards, all "SGEN does not do that"; 0 for updraft/elementor/woocommerce/jquery) | Grounding drafts in the KB would flag ~100 % of claims — DEFECT-15's shape | `../ARGUS.md` Phase 10 |
| E-67 | The false claim *"SGEN supports installing WordPress plugins"* matched the card that **contradicts** it, at 0.60 term coverage | Term overlap cannot tell agreement from contradiction; `covered` ≠ `supported` | `../ENGINE-FREEZE.md` EX-01 |
| E-68 | Domain profile refactor: 58/58 corpus threads score identically to the pre-move hardcoded tables (36 in scope, both) | The vocabulary moved to data without moving what the corpus measures | `../ENGINE-FREEZE.md` EX-02 |

| # | Still not known | | |
|---|---|---|---|
| N-18 | Whether extraction variance can flip a **verdict** | Every certification is deep inside REJECT; no draft has ever been near a decision boundary | a draft near the line |
| N-19 | Argus's false-positive rate | 0 CERTIFIED outcomes; a truth layer that rejects sound replies leaves no trace | one CERTIFIED draft, judged by a person |

---

## The shape of the evidence

- **31 proven observations**, of which 26 are defects, failures, or negative results.
- **17 explicit holes**, of which N-01 through N-09 all collapse to the same root: *nothing has
  been published, and no operator decision has been recorded.*
- Every proven item about **generation quality** is a failure. There is not one positive
  measurement of contribution quality in this table, because the only instrument for that is a
  human reviewer's verdict and none has been recorded.

That asymmetry is the single most important fact about the project's current state.

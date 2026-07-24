# ADR-0005 — Disclosure is enforced by a linter, not requested in a prompt

**Status:** Accepted · 2026-07-22 · Jerome

## Context
The Appilot prompts instruct the model to mention sgen.com organically and to read as
"100% human", including deliberate typos and fabricated personal history. Undisclosed
promotion by a party with a material connection is an FTC 16 CFR 255 exposure in the US,
a UCPD/DSA exposure in the EU, and a brand exposure everywhere.

A prompt is a request. Models do not always comply with requests.

## Decision
A draft that mentions SGEN, sgen.com, or SGEN products and does not carry the configured
disclosure line **cannot enter the approval queue**. Enforced by `lintDraft()`, which also
rejects: fabricated first-person experience markers, deliberate misspellings, and
engagement-bait closers.

## Consequences
+ The legal requirement holds even when the model drifts.
+ Rejections are visible and countable — a drifting model shows up as a rising reject rate.
− Occasional false positives on legitimate phrasing. Acceptable; the linter explains itself.

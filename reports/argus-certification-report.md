# Certification Report

**Generated:** 2026-07-29 · **Drafts certified:** 3

| verdict | count | meaning |
|---|---|---|
| ✅ CERTIFIED | 0 | every claim adequately supported — a human still reviews it |
| ⚠️ ESCALATE | 0 | human expertise required to resolve something Argus cannot |
| ⛔ REJECT | 3 | unsupported, contradicted, or false |

## Which rules fired

| rule | times |
|---|---|
| `overconfident-language` | 19 |
| `fatal-contradiction` | 11 |
| `falsifiable-claim-weak-evidence` | 8 |
| `invalidated-dependency` | 3 |
| `contested-contradiction` | 1 |

## Every certification

- ⛔ **REJECT** `d_eef1e76628fc_ms60u3aj` — 8 claim(s), 4 fatal contradiction(s)
  - alternative-explanation: The claim's disjunction (freelancer / agency / friend) is not exhaustive. A website can exist under an account the user never set up because a hosting provider or domain registrar auto-generates a default placeholder, 'parked domain', or website-builder starter page at signup or on domain registration — with no human 'setting it up' at all. In that case not-user is true but none of freelancer/agency/friend is true, so the conditional fails. [widely-accepted-practice]
- ⛔ **REJECT** `d_fee0044a496c_ms62ds6b` — 15 claim(s), 2 fatal contradiction(s)
  - counterexample: Regeneration does not require replacement/deletion of originals. Several 'replace' plugins (e.g. WebP Express in 'directory structure' mode) write generated .webp files as siblings alongside the untouched original in the uploads tree, rather than overwriting or deleting the source file. A downstream process that reads the uploads folder directly and knows to look for a same-named .webp variant will find it without any file being replaced — only additive regeneration occurred, not replacement. [community-knowledge]
- ⛔ **REJECT** `d_e3f85c727608_ms644wlu` — 7 claim(s), 6 fatal contradiction(s)
  - alternative-explanation: Cache hit/miss ratio is a proxy for cache effectiveness, not a direct measure of performance (response time/TTFB). A preloader's crawl process itself consumes CPU, DB, and I/O on the origin server while it runs; LiteSpeed's own crawler feature exposes throttling controls (thread count, delay between requests, run interval) precisely because unthrottled crawling can degrade concurrent real-user response times. So it is possible for X-LiteSpeed-Cache miss rate to drop after enabling the preloader while actual page load times for real visitors stay flat or worsen during crawl windows — meaning a miss-rate comparison alone can indicate 'success' even when performance did not improve, or can obscure a regression. [community-knowledge]

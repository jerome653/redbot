# ADR-0002 — Browser agent, not Android device automation

**Status:** Accepted · 2026-07-22 · Jerome

## Context
Three routes give software a human-equivalent action surface on Reddit: the official API,
an Android device driven through the Accessibility Service (Appilot's approach), and a
browser driving reddit.com as a logged-in user.

Constraints, all verified (canon T-1..T-10): the API is closed to self-serve, costs $12k/yr
minimum on the commercial tier and may be denied for marketing automation. The device path
is a 5-6 month build requiring Android engineering SGEN does not have, plus phones, SIMs,
proxies and a permanent selector-maintenance rotation. Playwright is already in SGEN's
toolchain.

## Decision
redbot drives reddit.com in a real browser session, per account. No Android, no devices,
no Accessibility Service, no ADB.

## Consequences
+ Days to first working action instead of months.
+ No hardware, no per-device proxy bill, no Android hire.
+ Runs on the stack SGEN already maintains.
+ Web DOM changes less violently than Android view IDs, and selectors stay hot-swappable.
− Still automation of a logged-in account: no Reddit permission required, and none granted.
  Every account risk in canon §7 applies unchanged.
− Browser sessions are heavier per account than API calls. Fine at redbot's volume; it would
  not be at 1000x.

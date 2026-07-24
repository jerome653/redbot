/**
 * Draft gate. Runs on every draft before a human is shown it, and again immediately before
 * publishing. A prompt is a request; models drift. This is the thing that holds.
 *
 * Policy: redbot writes answers, not advertising. A generated reply must not name the
 * operator's employer at all. If a human deliberately adds it during review, the disclosure
 * line must accompany it — that is the FTC 16 CFR 255 position, checked rather than hoped for.
 */
import { config } from './config.js';

const org = config.brand.org;
const BRAND = new RegExp(`\\b${org}\\b|${org.toLowerCase()}\\.com`, 'i');

/** Phrases that claim a personal history the model does not have. */
const FABRICATED_EXPERIENCE: RegExp[] = [
  /\bI (?:had|hit|ran into|dealt with) this exact\b/i,
  /\blast (?:year|month|quarter) I\b/i,
  /\bmy client\b/i,
  /\bon a (?:recent|past) (?:build|project)\b/i,
  /\bI (?:lost|wasted) (?:two|three|\d+) (?:days|hours)\b/i,
  /\bwhen I was (?:building|working)\b/i
];

/** Closers that farm replies instead of ending the answer. */
const ENGAGEMENT_BAIT: RegExp[] = [
  /\bhope (?:this|that) helps\b/i,
  /\blet me know if\b/i,
  /\bhappy to help\b/i,
  /\bfeel free to (?:ask|reach out|dm)\b/i,
  /\bwould you like me to\b/i
];

/** Sales register — the tell that a reply stopped answering and started selling. */
const SALES_LANGUAGE: RegExp[] = [
  /\byou should (?:try|check out|switch to|use)\s+\w+\.(?:com|io|app)/i,
  /\b(?:we|our team) (?:offer|provide|built|make)\b/i,
  /\bsign up (?:for|at)\b/i,
  /\bfree trial\b/i,
  /\bdiscount code\b/i
];

/**
 * Assistant/agent artefacts that must never reach Reddit.
 *
 * DEFECT-06 (2026-07-22, CRITICAL): `claude -p` runs as a full Claude Code agent in the
 * working directory. Executed inside this repo it inherited CLAUDE.md, memory pins and
 * plan mode, and returned drafts containing plan-file notes, internal tool names and a
 * local Windows path. Two of three such drafts PASSED the linter as it then stood.
 *
 * The primary fix is running the CLI in an empty scratch directory (see llm.ts). This list
 * is the backstop for anything that still slips through.
 */
const AGENT_LEAKAGE: RegExp[] = [
  /ExitPlanMode|AskUserQuestion|TodoWrite/i,
  /plan mode|plan file|rule-check/i,
  /[A-Za-z]:[\\/]{1,2}Users[\\/]/i,
  /(?:^|\s)\/(?:home|Users)\/[A-Za-z0-9._-]+\//,
  /CLAUDE\.md/i,
  /\bcwd\b/i,
  /saved to (?:the )?plan/i,
  /this session'?s toolset/i,
  /memory pin|astroturf/i,
  /delivering direct/i,
  /\btool(?:s)? (?:un)?available\b/i
];

/**
 * Preamble the model addresses to US rather than to the thread.
 *
 * DEFECT-06 residual: after the plan-mode fix, one draft in four still opened with
 * "Draft below, WP Super Cache diagnosis angle, ready to edit/post." — correct content,
 * wrong audience. A Reddit reply never announces that it is a draft.
 *
 * Checked against the FIRST LINE only, so a reply that legitimately uses the word "draft"
 * later on is unaffected.
 */
const META_PREAMBLE: RegExp[] = [
  /^\s*(?:here(?:'s| is)\s+)?(?:the\s+|a\s+|your\s+)?draft\b/i,
  /^\s*draft (?:below|follows|written|reply)/i,
  /\bready (?:to|for) (?:edit|review|post|you)\b/i,
  /^\s*(?:reddit )?reply draft\s*:/i,
  /\bangle\s*,?\s*ready\b/i,
  /^\s*(?:as requested|per your request)\b/i,

  /* DEFECT-10: tool- and permission-state commentary addressed to the operator. The model
   * narrating what it could or could not reach is never part of a Reddit reply. */
  /^\s*one sec\b/i,
  /\bpermission (?:gate|denied|prompt)\b/i,
  /\bblocked by (?:a )?(?:permission|classifier|gate|hook|policy)\b/i,
  /\b(?:site|page|url) fetch (?:blocked|failed|denied)\b/i,
  /\bwritten from generic diagnosis\b/i,
  /\bno (?:site|page)-specific confirm(?:ation)?\b/i,
  /\bcould not (?:fetch|reach|verify) (?:the )?(?:site|page|url)\b.*\bso\b/i
];

/**
 * DEFECT-10: a marker that hands a draft over to a reader — "Here's the draft reply:",
 * "Here is my suggested answer:", often followed by a `---` rule. Distinct from
 * META_PREAMBLE because it can sit several lines down, after other operator-facing text.
 */
const HANDOFF_MARKER: RegExp[] = [
  /\bhere(?:'s| is)\s+(?:the|my|a|your)\s+(?:draft|suggested|proposed)\b/i,
  /\bhere(?:'s| is)\s+(?:the|my|a)\s+(?:reply|answer|response|comment)\s*:/i,
  /^\s*-{3,}\s*$/m
];

/**
 * Assistant self-reference. A Reddit reply is written by a person; it never says what
 * model produced it, never says "as an AI", never discusses tokens or generation.
 * Phase 4 fuzz: all of these passed the linter before this list existed.
 */
const ASSISTANT_VOICE: RegExp[] = [
  /\bas an ai\b|\bi am an ai\b|\bi'?m an ai\b/i,
  /\bI am Claude\b|\bClaude,? an AI\b|\bmade by Anthropic\b/i,
  /\bclaude-(?:sonnet|haiku|opus)\b|\bgpt-[0-9]/i,
  /\b(?:output |input )?tokens\b.*\b(?:used|cost|spent)\b|\b(?:used|cost) (?:about )?\d+ (?:output |input )?tokens\b/i,
  /\bgenerated (?:with|by) (?:claude|gpt|an? (?:ai|model|llm))\b/i,
  /\bas (?:a )?(?:language|large language) model\b/i,
  /\bI (?:cannot|can't) (?:verify|access|browse) your (?:server|site|system)\b/i
];

/**
 * Prompt scaffolding echoed back into the output. These are literal fragments of redbot's
 * own instructions — if they appear in a draft, the model is reciting rather than answering.
 */
const PROMPT_ECHO: RegExp[] = [
  /\bdrafting FOR a human\b|\bnot AS a human\b/i,
  /\bHARD RULES?\b\s*[:\-—]/i,
  /\bSUGGESTED ANGLE\b\s*[:\-—]/i,
  /\bWHAT MAKES IT GOOD\b/i,
  /\bnever invent a personal experience\b/i,
  /\bOUTPUT\b\s*\n\s*Return ONLY/i,
  /\bwhy this thread was selected\b/i,
  /\bexisting comments \(do not repeat/i
];

/**
 * Internal machinery: environment variables, config keys, our own identifiers.
 */
const INTERNAL_REFS: RegExp[] = [
  /\bANTHROPIC_API_KEY\b|\bREDBOT_[A-Z_]+\b|\bCLAUDE_CONFIG_DIR\b/,
  /\bredbot\b/i,
  /\b(?:threads|drafts|analysis)\.json\b|\bhistory\.jsonl\b/i,
  /\bdisclosure\.ts\b|\bconfig\.ts\b|\bselectors\.ts\b/i
];

/**
 * Chain-of-thought / working-out that belongs in the model's head, not in a reply.
 */
const INTERNAL_REASONING: RegExp[] = [
  /\blet me think(?: about this)?(?: step by step)?\b/i,
  /\bstep by step,? (?:first|I)\b/i,
  /\bfirst,? I need to (?:consider|figure out|decide)\b/i,
  /\bI(?:'ll| will| am going to| shall)\s+(?:now\s+)?(?:write|save|create|generate|produce)\s+(?:the|a|this)\s+(?:file|draft|reply|plan|document)\b/i,
  /\bmy (?:reasoning|thought process) (?:is|was)\b/i
];

export interface LintResult {
  ok: boolean;
  issues: string[];
  mentionsBrand: boolean;
  hasDisclosure: boolean;
}

function firstMatch(list: RegExp[], body: string): boolean {
  return list.some((re) => re.test(body));
}

export function lintDraft(body: string): LintResult {
  const issues: string[] = [];
  const mentionsBrand = BRAND.test(body);
  const hasDisclosure = body.includes(config.brand.disclosureLine);

  if (mentionsBrand) {
    if (config.brand.forbidMention) {
      issues.push(`names ${org} — generated replies must not mention the operator's employer at all`);
    } else if (!hasDisclosure) {
      issues.push(`mentions ${org} without the disclosure line: "${config.brand.disclosureLine}"`);
    }
  }

  if (firstMatch(AGENT_LEAKAGE, body)) {
    issues.push('assistant/agent text leaked into the draft — not a Reddit reply');
  }
  if (firstMatch(ASSISTANT_VOICE, body)) {
    issues.push('reply refers to itself as an AI or names the model');
  }
  if (firstMatch(PROMPT_ECHO, body)) {
    issues.push('prompt scaffolding echoed into the reply');
  }
  if (firstMatch(INTERNAL_REFS, body)) {
    issues.push('internal identifier, env var or data file named in the reply');
  }
  if (firstMatch(INTERNAL_REASONING, body)) {
    issues.push('internal reasoning left in the reply');
  }
  /**
   * DEFECT-10 (2026-07-22): a real draft leaked past this check. It opened with tool-state
   * commentary ("One sec — checked site fetch, blocked by permission gate. Reply written from
   * generic diagnosis") and only announced "Here's the draft reply:" on the *third* line,
   * followed by a `---` rule. Scanning line 1 alone missed both.
   *
   * A preamble is by definition at the top, so scan the opening block rather than one line —
   * but stop there, so the word "draft" in the body of a genuine reply is still fine.
   */
  const lines = body.trim().split('\n');
  const opening = lines.slice(0, 6).join('\n');
  if (firstMatch(META_PREAMBLE, opening)) {
    issues.push('opens by addressing the operator, not the thread — strip the preamble');
  }
  if (firstMatch(HANDOFF_MARKER, opening)) {
    issues.push('contains a draft/answer handoff marker before the reply itself');
  }
  if (firstMatch(FABRICATED_EXPERIENCE, body)) {
    issues.push('claims a personal experience the model cannot have');
  }
  if (firstMatch(ENGAGEMENT_BAIT, body)) {
    issues.push('engagement-bait closer');
  }
  if (firstMatch(SALES_LANGUAGE, body)) {
    issues.push('sales language — this is an answer, not a pitch');
  }
  if (body.trim().length < 40) {
    issues.push('too short to be a useful answer');
  }

  return { ok: issues.length === 0, issues, mentionsBrand, hasDisclosure };
}

/**
 * If a HUMAN added a brand mention during review, attach the disclosure line.
 * Never used on generated text — generated text may not mention it at all.
 */
export function ensureDisclosure(body: string): string {
  if (!BRAND.test(body)) return body;
  if (body.includes(config.brand.disclosureLine)) return body;
  return `${body.trimEnd()}\n\n${config.brand.disclosureLine}`;
}

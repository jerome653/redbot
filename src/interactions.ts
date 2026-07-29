/**
 * The immutable interaction record — `data/interactions.jsonl`.
 *
 * **FROZEN SCHEMA, 2026-07-23, before the first publish.** Decided ahead of the evidence
 * because of a pattern this project has now hit three times: review timing, the pre-edit draft
 * body, and child-reply text were each unrecoverable once the moment had passed. A field added
 * after the first ten interactions is a field that is empty for the first ten interactions.
 *
 * THE GOVERNING PRINCIPLE, and the reason this file stores nothing clever:
 *
 *     Never invent an aggregate before collecting its raw observations.
 *
 * So there is no "helpful contribution rate" here, and no trust score, expertise score or trend.
 * Those are derived later, from these rows, when enough rows exist to derive them honestly. What
 * is stored is what a browser rendered at a moment in time.
 *
 * Three rules this schema enforces:
 *
 *   1. **Append-only.** A row is never edited. A later checkpoint is a new row, so the history
 *      of a comment's score is the sequence of rows, not a mutated field.
 *   2. **Absent is null, and null is recorded.** Every key is always present. `score: null` means
 *      "looked, Reddit did not render one"; a missing key would mean "this version did not look".
 *      Those are different facts and the difference is not recoverable later.
 *   3. **`humanLabel` is never written by a machine.** Whether a reply was corrective,
 *      supportive, neutral or moderation-related is a judgement. The same rule that governs the
 *      Ground Truth Corpus applies here: a model may not fill its own answer key.
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA, ensureData } from './config.js';

import { getPool } from './db.js';
import { insertInteraction, selectInteractions } from './db/logs.js';

export const interactionsPath = join(DATA, 'interactions.jsonl');

/** Bump only for a breaking change, and migrate rather than reinterpret old rows. */
export const INTERACTION_SCHEMA_VERSION = '1.0';

export type InteractionKind = 'publish' | 'checkpoint';

/** One rendered comment beneath our reply, as the page showed it. */
export interface ObservedReply {
  /** Reddit's own id for the comment node, when the attribute is present. */
  thingId: string | null;
  author: string | null;
  /** True when the author is the thread's original poster. */
  byOriginalPoster: boolean;
  /** True when the author is the account that published our reply. */
  byUs: boolean;
  /**
   * The comment text, verbatim and untruncated.
   *
   * EB-32: `observe` previously recorded only a COUNT. "Was a correction posted beneath it?" is
   * the strongest available signal that a certification was wrong, and a count cannot answer it.
   * A deleted comment is gone from the page, so this is the only durable copy.
   */
  body: string;
  /**
   * Reddit's rendered relative age, e.g. "3 hr. ago", exactly as displayed.
   *
   * EB-33: time-to-first-interaction is not derivable from four coarse checkpoints. Reddit
   * renders the age on every comment; storing the string keeps the fact without pretending to a
   * precision the page does not offer. `timestamp` carries the machine-readable form when the
   * markup provides one.
   */
  renderedAge: string | null;
  /** ISO timestamp from a `datetime` attribute, when present. Null is common and expected. */
  timestamp: string | null;
  score: number | null;
  depth: number | null;
  /** Reddit marks moderator/admin comments. Null when the attribute is absent. */
  distinguished: string | null;
  /**
   * What kind of reply this is — corrective, supportive, neutral, moderation.
   *
   * **Human-labelled only.** Left null by every automated path, forever. A model classifying
   * the reaction to its own output is the HRC-001 failure one level up.
   */
  humanLabel: null;
}

/** What the thread looked like at one moment. */
export interface ObservedThread {
  locked: boolean | null;
  archived: boolean | null;
  /** Post score as rendered. Null when Reddit does not expose it on the node. */
  postScore: number | null;
  /** Comment count as rendered, not as counted by us. */
  commentCount: number | null;
  /** Thread age in hours at this moment, derived from collection data. */
  ageHours: number | null;
}

/** Our own comment, as the page showed it. */
export interface ObservedSelf {
  /** False means not visible on this vector — which is the observation, not a failure. */
  present: boolean;
  score: number | null;
  /** Reddit's removal/deletion notice, verbatim. Null when none is shown. */
  removalNotice: string | null;
  /** Direct replies to our comment. */
  directReplyCount: number | null;
  /** How the node was located, so a null result is debuggable. */
  via: string;
}

export interface InteractionRecord {
  schemaVersion: string;
  ts: string;
  kind: InteractionKind;
  draftId: string;
  threadId: string;
  /** The thread permalink. */
  permalink: string;
  /** Our comment's own permalink, once Reddit exposes one. */
  commentPermalink: string | null;
  commentId: string | null;
  account: string | null;
  /** 'publish' rows carry null; checkpoint rows carry the checkpoint name. */
  checkpoint: string | null;
  /** Minutes since publication. 0 on the publish row. */
  elapsedMinutes: number;
  /** Which browser vector this was observed through. */
  vector: 'signed-in' | 'signed-out' | 'publish';
  thread: ObservedThread;
  self: ObservedSelf | null;
  /** Every comment beneath our reply that the page rendered. Empty array means none rendered. */
  replies: ObservedReply[];
  /** Free-text note about how the observation was taken. Never an interpretation of it. */
  note: string;
}

export async function appendInteraction(record: InteractionRecord): Promise<void> {
  await insertInteraction(getPool(), record);
}

export async function loadInteractions(): Promise<InteractionRecord[]> {
  return selectInteractions(getPool());
}

/**
 * Every row for one draft, oldest first.
 *
 * Deliberately the only accessor beyond the raw load. Anything that looks like a rate or a
 * trend belongs in a reporting layer built when there is something to report — not here.
 */
export async function interactionsFor(draftId: string): Promise<InteractionRecord[]> {
  return (await loadInteractions())
    .filter((r) => r.draftId === draftId)
    .sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
}

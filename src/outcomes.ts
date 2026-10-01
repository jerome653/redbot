/**
 * Did the comment survive, and where? Per-subreddit outcomes for everything published.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT src/insights.ts OR src/health.ts
 *
 * `insights.ts` measures the funnel BEFORE publishing — where candidates are lost.
 * `health.ts` measures ONE ACCOUNT's state and answers "may it publish".
 * Neither answers the question this does: of what we actually posted, what is still there,
 * BROKEN DOWN BY THE COMMUNITY IT WAS POSTED TO.
 *
 * That breakdown is the whole point. Measured 2026-10-01 on the first six comments this install
 * published — all from one account, one template, inside 41 hours:
 *
 *   r/Wordpress    4 published, 4 removed    ("Comment removed by moderator")
 *   r/webhosting   2 published, 2 visible    (scores 0 and -1)
 *
 * The account was the same in both rows, so the account is not what moved. Without the split by
 * subreddit, those six read as "33% survival" and point nowhere.
 * ---------------------------------------------------------------------------
 *
 * THE RULE THAT DECIDES WHETHER THE NUMBERS LIE: the LATEST signed-out reading per comment wins.
 *
 * A comment is observed repeatedly and its state CHANGES. t1_pcizrg8 has a `reply-visible-
 * signed-out` row from 2026-09-28T22:47Z and a `reply-absent-signed-out` row from
 * 2026-10-01T00:29Z — it was genuinely visible then and genuinely gone now. Counting rows, or
 * taking the first, reports it as both. Only the most recent reading is the current state.
 *
 * SIGNED-OUT ONLY. src/commands/observe.ts says it at the top: a signed-in reading answers a
 * different question, because the author sees their own removed comment intact. Measured on all
 * four removals — signed in they render with their score and no notice at all.
 *
 * THREE STATES, NOT TWO. A comment never read signed-out is `unobserved`. It is not visible and
 * it is not removed, and defaulting it to either would manufacture the answer. `unobserved` is
 * reported so a survival count can never be read as covering more than it measured.
 */

/** One published comment, as much as is needed to attribute and locate it. */
export interface PublishedComment {
  /** Reddit's `t1_…` id, or null for a row written before the field existed. */
  commentId: string | null;
  /** The permalink the observations are keyed by. */
  permalink: string;
  subreddit: string;
  /** Draft id, so a row in the report can be traced back. */
  draftId: string;
}

/** One observation row, narrowed to the fields this module reads. */
export interface OutcomeObservation {
  ts: string;
  kind: string;
  vector: string;
  permalink: string | null;
  /** `reply-marked-removed` carries Reddit's notice here; the visible/absent kinds carry a bool. */
  value: unknown;
}

export type CommentState = 'visible' | 'removed' | 'unobserved';

export interface CommentOutcome {
  draftId: string;
  commentId: string | null;
  subreddit: string;
  permalink: string;
  state: CommentState;
  /** When the reading that produced `state` was taken. Null when never observed signed-out. */
  observedAt: string | null;
  /** Reddit's own words, verbatim, when a notice was recorded. Never paraphrased. */
  removalNotice: string | null;
}

export interface SubredditOutcome {
  subreddit: string;
  published: number;
  visible: number;
  removed: number;
  unobserved: number;
  /**
   * removed / (visible + removed), or null when nothing there has been observed signed-out.
   *
   * `unobserved` is deliberately OUT of the denominator — a rate over comments nobody looked at
   * is not a rate. `observed` is carried alongside so the figure can never be quoted without
   * its sample size.
   */
  removalRate: number | null;
  observed: number;
  /** Deduped, verbatim. Evidence for the count, so the count does not have to be trusted. */
  removalNotices: string[];
  lastObservedAt: string | null;
}

/** Normalised for keying: observations and drafts do not always agree on trailing slash or case. */
function keyOf(permalink: string | null | undefined): string {
  if (!permalink) return '';
  const trimmed = permalink.trim().toLowerCase();
  const withoutOrigin = trimmed.replace(/^https?:\/\/[^/]+/, '');
  return withoutOrigin.replace(/\/+$/, '');
}

/**
 * The subreddit a permalink names, from the permalink itself.
 *
 * Used only as a FALLBACK when a published row carries no subreddit — `threads.subreddit` is the
 * recorded fact and wins. Returns null rather than a guess when the path is not Reddit-shaped,
 * because a row filed under the wrong community is worse than a row filed under "unknown".
 */
export function subredditFromPermalink(permalink: string | null | undefined): string | null {
  if (!permalink) return null;
  const m = /\/r\/([A-Za-z0-9_]+)\//.exec(permalink);
  return m?.[1] ?? null;
}

const SIGNED_OUT_STATE: Record<string, CommentState> = {
  'reply-visible-signed-out': 'visible',
  'reply-absent-signed-out': 'removed'
};

/**
 * Per-comment current state, then the per-subreddit roll-up.
 *
 * Pure: every input is passed in, nothing is read from disk or the database here, so the rule
 * above can be tested on rows rather than by publishing to Reddit and waiting two days.
 */
export function summarizeOutcomes(input: {
  published: readonly PublishedComment[];
  observations: readonly OutcomeObservation[];
}): { comments: CommentOutcome[]; subreddits: SubredditOutcome[] } {
  /* Signed-out state readings, latest per permalink. Sorted ascending and overwritten so the last
     write is the newest; an unsorted input would otherwise make the result depend on row order. */
  const byTs = [...input.observations].sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));

  const latestState = new Map<string, { ts: string; state: CommentState }>();
  const latestNotice = new Map<string, { ts: string; notice: string }>();

  for (const o of byTs) {
    if (o.vector !== 'signed-out') continue;
    const k = keyOf(o.permalink);
    if (!k) continue;

    const state = SIGNED_OUT_STATE[o.kind];
    if (state) latestState.set(k, { ts: o.ts, state });

    if (o.kind === 'reply-marked-removed' || o.kind === 'reply-marked-deleted') {
      /* The notice is stored as JSON, so a string arrives quoted. Unwrap it rather than printing
         Reddit's words wrapped in quotation marks that Reddit did not write. */
      const raw = typeof o.value === 'string' ? o.value : JSON.stringify(o.value ?? '');
      let notice = raw;
      try {
        const parsed: unknown = JSON.parse(raw);
        if (typeof parsed === 'string') notice = parsed;
      } catch { /* not JSON — it is already the plain string */ }
      if (notice.trim()) latestNotice.set(k, { ts: o.ts, notice: notice.trim() });
    }
  }

  const comments: CommentOutcome[] = input.published.map((p) => {
    const k = keyOf(p.permalink);
    const hit = latestState.get(k);
    const notice = latestNotice.get(k);
    return {
      draftId: p.draftId,
      commentId: p.commentId,
      subreddit: p.subreddit || subredditFromPermalink(p.permalink) || 'unknown',
      permalink: p.permalink,
      state: hit?.state ?? 'unobserved',
      observedAt: hit?.ts ?? null,
      /* A notice only belongs on a comment the latest reading calls removed. Keeping a stale
         notice on one that has since come back would report a removal that is over. */
      removalNotice: hit?.state === 'removed' ? notice?.notice ?? null : null
    };
  });

  const bySub = new Map<string, SubredditOutcome>();
  for (const c of comments) {
    let row = bySub.get(c.subreddit);
    if (!row) {
      row = {
        subreddit: c.subreddit,
        published: 0, visible: 0, removed: 0, unobserved: 0,
        removalRate: null, observed: 0, removalNotices: [], lastObservedAt: null
      };
      bySub.set(c.subreddit, row);
    }
    row.published++;
    if (c.state === 'visible') row.visible++;
    else if (c.state === 'removed') row.removed++;
    else row.unobserved++;
    if (c.removalNotice && !row.removalNotices.includes(c.removalNotice)) {
      row.removalNotices.push(c.removalNotice);
    }
    if (c.observedAt && (row.lastObservedAt === null || c.observedAt > row.lastObservedAt)) {
      row.lastObservedAt = c.observedAt;
    }
  }

  const subreddits = [...bySub.values()].map((r) => {
    const observed = r.visible + r.removed;
    return { ...r, observed, removalRate: observed ? r.removed / observed : null };
  });

  /* Worst first, then by sample size: a subreddit that removed everything is the row to read, and
     between two equal rates the one with more evidence behind it goes first. */
  subreddits.sort((a, b) =>
    (b.removalRate ?? -1) - (a.removalRate ?? -1) || b.observed - a.observed
      || a.subreddit.localeCompare(b.subreddit));

  return { comments, subreddits };
}

/**
 * The same roll-up, over this install's real data.
 *
 * Separated from `summarizeOutcomes` so the rule above stays testable without a database. The
 * published set comes from `drafts` joined to `threads` for the subreddit — `threads.subreddit` is
 * the recorded fact and is preferred over parsing it back out of a URL.
 *
 * `observeUrl` is reused rather than reimplemented: it is what `observe` navigated to, so it is
 * what the observation rows are keyed by. Picking a different candidate out of the same three
 * fields here would silently fail to match any observation at all.
 */
export async function computeOutcomes(): Promise<{
  comments: CommentOutcome[];
  subreddits: SubredditOutcome[];
}> {
  const { loadDrafts, loadThreads } = await import('./store.js');
  const { loadObservations } = await import('./health.js');
  const { observeUrl } = await import('./commands/observe.js');

  const threads = await loadThreads();
  const published = (await loadDrafts())
    .filter((d) => d.status === 'published')
    .map((d) => {
      const t = threads.find((x) => x.id === d.threadId);
      const permalink = observeUrl(d);
      return {
        draftId: d.id,
        commentId: d.commentId ?? null,
        permalink,
        subreddit: t?.subreddit ?? subredditFromPermalink(permalink) ?? 'unknown'
      };
    });

  const observations = (await loadObservations()).map((o) => ({
    ts: o.ts,
    kind: o.kind as string,
    vector: o.vector as string,
    permalink: o.permalink ?? null,
    value: o.value ?? null
  }));

  return summarizeOutcomes({ published, observations });
}

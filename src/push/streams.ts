/**
 * The twelve event streams, and what may leave the machine on each.
 *
 * ONE SOURCE OF TRUTH. The allow-list here is the privacy boundary: a column not named in
 * `fields` is never read into an event, so adding a column to a table cannot leak it by default.
 * That is the whole reason this is an allow-list rather than a list of things to strip — a
 * deny-list silently fails open the moment somebody adds `body_v2`.
 *
 * WHAT IS DELIBERATELY ABSENT. `trace` has no stream. The receiving service rejects it (`400`),
 * and the reason is in its volume: 1,114 rows from 12 runs on the reference database, 674 of them
 * `debug` level. It is diagnostic telemetry, not dashboard data.
 *
 * `credentials`, `thread_comments`, `account_machines` and `schema_migrations` are absent for the
 * reasons in API-SPEC-FOR-ADMIN.md §5 — sealed secrets, other people's comment bodies,
 * machine-local bindings, and a table with no cursor.
 */

/** Which columns identify a row's position in its stream. Order matters — it is the sort order. */
export type CursorCols = readonly [string] | readonly [string, string];

/**
 * Columns that are JSON held in a TEXT column, and MUST reach the wire as strings.
 *
 * WHY THIS EXISTS. `src/db.ts` rehydrates these on the way out — measured against the live
 * corpus, `subreddits` comes back as the array `["mobilelegends"]`, not the string
 * `"[\"mobilelegends\"]"`, and `history.data` as an object, and `observations.value` as the
 * number 1. That is correct for the engine, which wants the value.
 *
 * It is WRONG on the wire. The API specification handed to the receiving side documents these as
 * JSON-in-TEXT, its author confirmed "fields you documented as JSON-held-in-TEXT stay as your
 * strings — we do not parse them for you", and its `activity.data` allow-list PARSES the field
 * before deciding whether to keep it. Sending an object where a string was promised breaks a path
 * their integration suite already validated.
 *
 * So the rehydration is undone for exactly these fields, on the way out, and nowhere else.
 */
export const JSON_TEXT_FIELDS: Readonly<Record<string, readonly string[]>> = {
  draft: ['novelty_issues', 'lint_issues'],
  certification: ['refutation_ran'],
  activity: ['data'],
  observation: ['value', 'vector'],
  decision: ['observed'],
  interaction: ['vector'],
  review: ['quality', 'gates', 'novelty', 'contribution'],
  /* Not a stream, but the account list uses the same rule. */
  accounts: ['subreddits', 'knows']
};

/**
 * Re-encode a rehydrated value back to the JSON string the column stores.
 *
 * A value that is already a string is returned untouched — double-encoding `"[]"` into `"\"[]\""`
 * would be its own defect.
 */
export function asJsonText(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  return typeof value === 'string' ? value : JSON.stringify(value);
}

export interface ChildSpec {
  /** The child table. */
  table: string;
  /** Its column that points back at the parent row. */
  on: string;
  /** Allow-listed columns, same rule as the parent. */
  fields: readonly string[];
}

export interface StreamSpec {
  /** Path segment: POST /v2/events/<name> */
  name: string;
  table: string;
  cursor: CursorCols;
  /** `insert` for append-only tables, `upsert` where rows change after creation. */
  op: 'insert' | 'upsert';
  fields: readonly string[];
  /** Rows carried inside the parent event rather than streamed separately. */
  children?: Record<string, ChildSpec>;
  /** The parent column a child's `on` matches. Defaults to the last cursor column. */
  childKey?: string;
}

export const STREAMS: readonly StreamSpec[] = [
  {
    name: 'thread', table: 'threads', cursor: ['updated_at', 'id'], op: 'upsert',
    fields: ['id', 'subreddit', 'upvotes', 'comment_count', 'age_minutes', 'source', 'query',
      'collected_at', 'created_at', 'updated_at']
  },
  {
    name: 'thread_screened', table: 'thread_prefilter', cursor: ['updated_at', 'thread_id'],
    op: 'upsert',
    fields: ['thread_id', 'kind', 'checked_at', 'created_at', 'updated_at']
  },
  {
    name: 'assessment', table: 'opportunity_assessments', cursor: ['updated_at', 'thread_id'],
    op: 'upsert',
    fields: ['thread_id', 'verdict', 'score', 'assessed_at', 'created_at', 'updated_at']
  },
  {
    name: 'gap_analysis', table: 'gap_analyses', cursor: ['updated_at', 'thread_id'], op: 'upsert',
    fields: ['thread_id', 'already_answered', 'headroom', 'analyzed_at', 'model',
      'created_at', 'updated_at'],
    children: { gaps: { table: 'gaps', on: 'thread_id', fields: ['position', 'kind', 'fillable'] } }
  },
  {
    name: 'draft', table: 'drafts', cursor: ['updated_at', 'id'], op: 'upsert',
    fields: ['id', 'thread_id', 'account', 'status', 'model', 'has_disclosure', 'novelty_issues',
      'lint_issues', 'cert_verdict', 'cert_at', 'cert_claims', 'cert_fatal_contradictions',
      'created_at', 'decided_at', 'updated_at']
  },
  {
    name: 'certification', table: 'certifications', cursor: ['id'], op: 'insert',
    fields: ['id', 'draft_id', 'thread_id', 'verdict', 'certified_at', 'model', 'model_analyze',
      'model_draft', 'resolution_resolved', 'refutation_ran', 'created_at'],
    childKey: 'id',
    children: {
      claims: {
        table: 'certification_claims', on: 'cert_id',
        fields: ['claim_id', 'type', 'evidence_class', 'confidence']
      },
      reasons: {
        table: 'certification_reasons', on: 'cert_id', fields: ['rule', 'claim_id']
      },
      contradictions: {
        table: 'certification_contradictions', on: 'cert_id',
        fields: ['claim_id', 'kind', 'evidence_class', 'fatal']
      },
      epistemicIssues: {
        table: 'certification_epistemic_issues', on: 'cert_id',
        fields: ['claim_id', 'language_certainty', 'supported_certainty']
      }
    }
  },
  {
    name: 'review', table: 'reviews', cursor: ['id'], op: 'insert',
    fields: ['id', 'ts', 'draft_id', 'thread_id', 'decision', 'reason_code', 'operator',
      'review_seconds', 'total_seconds', 'edit_chars_before', 'edit_chars_after', 'edit_retained',
      'quality', 'gates', 'novelty', 'contribution']
  },
  {
    name: 'decision', table: 'confirmations', cursor: ['id'], op: 'insert',
    fields: ['id', 'ts', 'action', 'account', 'job_id', 'confirmed', 'source', 'observed',
      'visibility', 'ms']
  },
  {
    name: 'interaction', table: 'interactions', cursor: ['id'], op: 'insert',
    fields: ['id', 'schema_version', 'ts', 'kind', 'draft_id', 'thread_id', 'account',
      'checkpoint', 'elapsed_minutes', 'vector']
  },
  {
    name: 'observation', table: 'observations', cursor: ['id'], op: 'insert',
    fields: ['id', 'ts', 'account', 'kind', 'vector', 'checkpoint', 'value']
  },
  {
    name: 'regret', table: 'regret', cursor: ['id'], op: 'insert',
    fields: ['id', 'ts', 'draft_id', 'thread_id', 'kind', 'category', 'hours_after_publish',
      'operator']
  },
  {
    name: 'activity', table: 'history', cursor: ['id'], op: 'insert',
    fields: ['id', 'ts', 'kind', 'account', 'subreddit', 'status', 'data']
  }
] as const;

export const streamByName = (name: string): StreamSpec | undefined =>
  STREAMS.find((s) => s.name === name);

/**
 * Key names the receiving service rejects a whole batch for, at any nesting depth,
 * case-insensitively. Checked here as well as there — a batch refused by the server is a wasted
 * request and a wasted rate-limit slot, and this is the class of mistake where finding out late
 * means having already transmitted it.
 *
 * `profile_dir`, `debug_port` and `selected` are machine-local; `cookies` and `session` are the
 * Reddit session. Matching is on the EXACT key, so `session_id` and `selected_at` are fine.
 */
export const FORBIDDEN_KEYS: readonly string[] = [
  'profile_dir', 'debug_port', 'selected', 'cookies', 'session'
];

/**
 * Every forbidden key found in a value, as `path.to.key`. Empty means safe.
 *
 * Walks arrays and nested objects, because the server does — a payload that only fails on the
 * server has already left the machine, which for these five keys is the entire thing being
 * prevented.
 */
export function forbiddenKeysIn(value: unknown, path = ''): string[] {
  const found: string[] = [];
  if (Array.isArray(value)) {
    value.forEach((v, i) => found.push(...forbiddenKeysIn(v, `${path}[${i}]`)));
    return found;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const here = path ? `${path}.${k}` : k;
      if (FORBIDDEN_KEYS.includes(k.toLowerCase())) found.push(here);
      found.push(...forbiddenKeysIn(v, here));
    }
  }
  return found;
}

/**
 * `WHERE` and `ORDER BY` that read strictly forward from a cursor.
 *
 * A KEYSET cursor, not a bare `updated_at >`, and that is not a refinement. Measured on the
 * reference database: `thread_prefilter` holds 87 rows sharing ONE `updated_at` value, and
 * `opportunity_assessments` 30 rows across two. A sender that stops halfway through such a batch
 * and resumes with `updated_at > :ts` skips the remainder of that timestamp — silently, with no
 * gap in any id to notice afterwards. Comparing the primary key as a tiebreak is what makes
 * "strictly after this row" mean what it says.
 *
 * Params are positional to match the façade in src/db.ts.
 */
export function forwardFrom(
  spec: StreamSpec, cursor: Record<string, unknown> | null, limit: number
): { sql: string; params: unknown[] } {
  const [a, b] = spec.cursor;
  const cols = spec.cursor.map((c) => `"${c}"`).join(', ');
  const select = `SELECT * FROM "${spec.table}"`;

  if (!cursor) return { sql: `${select} ORDER BY ${cols} LIMIT ${limit}`, params: [] };

  if (b === undefined) {
    return { sql: `${select} WHERE "${a}" > $1 ORDER BY ${cols} LIMIT ${limit}`, params: [cursor[a]] };
  }
  return {
    sql: `${select} WHERE "${a}" > $1 OR ("${a}" = $2 AND "${b}" > $3) ORDER BY ${cols} LIMIT ${limit}`,
    params: [cursor[a], cursor[a], cursor[b]]
  };
}

/** The cursor value for a row — the object sent as `events[].cursor`. */
export function cursorOf(spec: StreamSpec, row: Record<string, unknown>): Record<string, unknown> {
  const c: Record<string, unknown> = {};
  for (const col of spec.cursor) c[col] = row[col];
  return c;
}

/**
 * Turning database rows into events the service will accept.
 *
 * The allow-list in streams.ts is applied HERE, once, on the way out. Nothing downstream re-reads
 * the row, so a column that is not named cannot reach the wire by any later mistake.
 */
import type { Db } from '../db.js';
import {
  type StreamSpec, cursorOf, forwardFrom, forbiddenKeysIn, JSON_TEXT_FIELDS, asJsonText
} from './streams.js';

export interface PushEvent {
  op: 'insert' | 'upsert';
  cursor: Record<string, unknown>;
  data: Record<string, unknown>;
}

/**
 * Keep only allow-listed columns, and drop nulls.
 *
 * Nulls are dropped rather than sent because they carry no information the receiver does not
 * already have from the field being absent, and they are pure payload weight on a body with a
 * 256 KB cap.
 */
function project(
  row: Record<string, unknown>, fields: readonly string[], jsonText: readonly string[] = []
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = row[f];
    if (v === undefined || v === null) continue;
    /* The façade rehydrates JSON-in-TEXT columns; the wire contract promises strings. */
    out[f] = jsonText.includes(f) ? asJsonText(v) : v;
  }
  return out;
}

/**
 * The next batch of events for one stream, strictly after `cursor`.
 *
 * Child rows are fetched per parent. That is N+1 queries against a local SQLite file for the two
 * streams that have children, which is the right trade here: batches are small, the file is on
 * the same disk, and one join would fan out the parent row across its children and need
 * de-duplicating afterwards — a join is guilty of fan-out until proven otherwise, and this one
 * is guilty.
 */
export async function nextBatch(
  db: Db, spec: StreamSpec, cursor: Record<string, unknown> | null, limit: number
): Promise<PushEvent[]> {
  const { sql, params } = forwardFrom(spec, cursor, limit);
  const res = await db.query<Record<string, unknown>>(sql, params);

  const jsonText = JSON_TEXT_FIELDS[spec.name] ?? [];
  const events: PushEvent[] = [];
  for (const row of res.rows) {
    const data = project(row, spec.fields, jsonText);

    if (spec.children) {
      const key = spec.childKey ?? spec.cursor[spec.cursor.length - 1]!;
      const parentValue = row[key];
      for (const [name, child] of Object.entries(spec.children)) {
        const kids = await db.query<Record<string, unknown>>(
          `SELECT * FROM "${child.table}" WHERE "${child.on}" = $1`, [parentValue]
        );
        data[name] = kids.rows.map((k) => project(k, child.fields));
      }
    }

    events.push({ op: spec.op, cursor: cursorOf(spec, row), data });
  }
  return events;
}

export interface Envelope {
  v: 1;
  installId: string;
  machine?: string;
  stream: string;
  sentAt: string;
  events: PushEvent[];
}

export function envelopeFor(
  spec: StreamSpec, installId: string, machine: string | null, events: PushEvent[], now: string
): Envelope {
  return {
    v: 1,
    installId,
    ...(machine ? { machine } : {}),
    stream: spec.name,
    sentAt: now,
    events
  };
}

/**
 * Refuse to transmit a batch containing a key the service forbids.
 *
 * The server rejects these too, so this is not the only guard — it is the one that runs BEFORE
 * the bytes leave. For `cookies`, `session`, `profile_dir`, `debug_port` and `selected`, "the
 * server would have rejected it" is not a consolation: the point is that they never travel.
 *
 * Throws rather than filtering. A forbidden key means the allow-list in streams.ts and the schema
 * have diverged, and quietly stripping it would hide that until somebody read a dashboard and
 * wondered where a field went.
 */
export function assertSendable(envelope: Envelope): void {
  const hits = forbiddenKeysIn(envelope.events);
  if (hits.length) {
    throw new Error(
      `refusing to send ${envelope.stream}: forbidden key(s) present — ${hits.join(', ')}. ` +
      'The allow-list in src/push/streams.ts no longer matches the schema.'
    );
  }
}

/** Bytes on the wire for this envelope, so a batch can be sized before it is sent. */
export const sizeOf = (envelope: Envelope): number => Buffer.byteLength(JSON.stringify(envelope));

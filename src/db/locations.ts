/**
 * account_locations — where an account's browser reported itself, and the only writer of
 * `accounts.timezone`.
 *
 * `accounts.timezone` used to be hand-typed configuration with a hardcoded fallback, and it is
 * what the browser ANNOUNCES (src/proxy/align.ts drives `Emulation.setTimezoneOverride` from it).
 * From 0018 it is a RECORD OF A MEASUREMENT: a detection lands here, and the same transaction
 * updates the column. Nothing else should write it.
 *
 * DECOUPLED FROM HOW THE VALUE IS OBTAINED, on purpose. `LocationDetection` below is defined
 * against the COLUMNS of account_locations and nothing else — not against the browser-side shape
 * that produces it, which is a separate piece of work with its own transport and its own parser.
 * This half has to be storable and testable without a browser, and a type shared with the probe
 * would make every change to the probe a change to the schema's public surface.
 */
import type { Db } from '../db.js';
import { withTransaction } from '../db.js';

/**
 * One detection, as the table stores it.
 *
 * `ip`, `timezone` and `via` are required because the table requires them, and the timezone is
 * required for the reason 0018 states: a record with no zone is a FAILED detection, and a failed
 * detection must leave `accounts.timezone` alone rather than write a hole into the record. The
 * caller decides it failed; this refuses to store it either way.
 *
 * Everything else is optional because "the provider did not say" is a real answer and a different
 * one from "the provider said no" — flattening the two would turn silence into a clean bill of
 * health, which is the reading that gets an account caught.
 */
export interface LocationDetection {
  /** The address the lookup was answered for. */
  ip: string;
  /** IANA zone, e.g. America/Los_Angeles. The whole reason the row exists. */
  timezone: string;
  /** How the detection was made. Same closed domain as account_exit_ips.via. */
  via: 'vet' | 'launch' | 'run' | 'doctor';
  /** Two letters, upper-case — the database enforces the case so comparisons cannot miss. */
  countryCode?: string | null;
  regionName?: string | null;
  city?: string | null;
  /** Seconds east of UTC, as reported. */
  offsetSeconds?: number | null;
  proxy?: boolean | null;
  hosting?: boolean | null;
  /** Overrides the row's timestamp. For tests; production lets the column default fire. */
  at?: string;
}

/**
 * A detection as it comes BACK, which is not quite the shape that went in.
 *
 * `at` is a Date here and a string on the way in, so this deliberately does not inherit it.
 * src/db.ts reads the stored DDL and converts any column whose CHECK carries the timestamp
 * marker `LIKE '____-__-__T%Z'` into a Date — the same mechanism that turns `col IN (0, 1)`
 * into a boolean. 0018 writes `at` with that marker, so a Date is what the facade hands back,
 * and saying so here is better than a type that quietly disagrees with the runtime.
 */
export interface StoredLocation extends Omit<LocationDetection, 'at'> {
  id: number;
  handle: string;
  at: Date;
}

/**
 * BOOLEANS CROSS THE FACADE ON THEIR OWN, IN BOTH DIRECTIONS, and this file must not
 * second-guess it.
 *
 * src/db.ts converts a boolean parameter to 0/1 on the way in, and on the way out it reads the
 * stored DDL and converts any column whose CHECK contains `col IN (0, 1)` back to true/false.
 * `proxy` and `hosting` are written with exactly that marker in 0018, so they arrive as real
 * booleans — MEASURED, after a hand-rolled `x.proxy === 1` here returned `false` for a stored 1.
 *
 * That mistake is worth leaving a note about because of HOW it passed: the `proxy: false` case
 * asserted correctly while being wrong for the same reason, since `0 === 1` and `'0' === 1` are
 * both false. Only the `true` case could tell the difference.
 *
 * So nothing here coerces. A defensive `Number(v) === 1` would also have papered over a missing
 * CHECK, and src/db.ts says in as many words that a column without its marker is a schema bug
 * that should show. The round trip is asserted in src/test/account-timezone.test.ts instead.
 */
const orNull = <T>(v: T | null | undefined): T | null => (v === undefined ? null : v);

/**
 * Record a detection AND move `accounts.timezone` to match it, in one transaction.
 *
 * ONE TRANSACTION, not two statements. The row is the evidence for the column; a crash between
 * them would leave either a zone nothing accounts for, or evidence the account is not acting on.
 * Both are the un-provenanced state 0018 exists to remove, so neither is allowed to exist.
 *
 * THE HANDLE IS RESOLVED TO ITS STORED SPELLING FIRST, for the reason src/db/proxies.ts gives
 * about `setRelayPort`: `handle` is a foreign key with no `lower()` in it, so "striking_mousse6841"
 * would be refused where "Striking_Mousse6841" is the account — and what a person would see is a
 * constraint name, not "no such account".
 *
 * Returns the id of the row written.
 */
export async function recordAccountLocation(
  _db: Db, handle: string, detection: LocationDetection
): Promise<number> {
  return withTransaction(async (tx) => {
    const known = await tx.query<{ handle: string }>(
      'SELECT handle FROM accounts WHERE lower(handle) = lower($1)', [handle]
    );
    const real = known.rows[0]?.handle;
    if (!real) throw new Error(`"${handle}" is not a configured account.`);

    const cols = ['handle', 'ip', 'country_code', 'region_name', 'city',
                  'timezone', 'offset_seconds', 'proxy', 'hosting', 'via'];
    const vals: unknown[] = [
      real, detection.ip, detection.countryCode ?? null, detection.regionName ?? null,
      detection.city ?? null, detection.timezone, detection.offsetSeconds ?? null,
      orNull(detection.proxy), orNull(detection.hosting), detection.via
    ];
    /* `at` defaults in the schema. Named only when a caller supplies one, so production keeps
       using the database's own clock rather than whatever the calling machine believes. */
    if (detection.at !== undefined) { cols.push('at'); vals.push(detection.at); }

    const ph = cols.map((_, i) => `$${i + 1}`).join(',');
    await tx.query(`INSERT INTO account_locations (${cols.join(',')}) VALUES (${ph})`, vals);

    /* The column and the ledger move together, or neither does. */
    await tx.query('UPDATE accounts SET timezone = $1 WHERE handle = $2', [detection.timezone, real]);

    const row = await tx.query<{ id: number }>(
      'SELECT id FROM account_locations WHERE handle = $1 ORDER BY id DESC LIMIT 1', [real]
    );
    return Number(row.rows[0]?.id ?? 0);
  });
}

/**
 * The most recent detection for one account, or null when it has never been measured.
 *
 * Null is a real answer and the one 0018 makes normal: an account nobody has measured has no
 * location, and src/window.ts refuses to schedule it until something does.
 */
export async function latestAccountLocation(db: Db, handle: string): Promise<StoredLocation | null> {
  const r = await db.query<{
    id: number; handle: string; at: Date; ip: string; country_code: string | null;
    region_name: string | null; city: string | null; timezone: string;
    offset_seconds: number | null; proxy: boolean | null; hosting: boolean | null; via: string;
  }>(
    `SELECT id, handle, at, ip, country_code, region_name, city, timezone,
            offset_seconds, proxy, hosting, via
       FROM account_locations
      WHERE lower(handle) = lower($1)
      ORDER BY at DESC, id DESC
      LIMIT 1`,
    [handle]
  );
  const x = r.rows[0];
  if (!x) return null;
  return {
    id: x.id, handle: x.handle, at: x.at, ip: x.ip,
    countryCode: x.country_code, regionName: x.region_name, city: x.city,
    timezone: x.timezone, offsetSeconds: x.offset_seconds,
    proxy: x.proxy, hosting: x.hosting,
    via: x.via as LocationDetection['via']
  };
}

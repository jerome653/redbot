/**
 * What this install has already sent, and who it is.
 *
 * A FILE beside `machine-id`, for the same reason `machine-id` is one: it belongs to this
 * computer's data directory and must survive an app update and a reinstall. Measured while
 * writing this: `machine-id` created at 18:24 was still byte-identical after the app was
 * uninstalled once and reinstalled twice, because `%APPDATA%\redbot` is a different directory
 * from the program and `deleteAppDataOnUninstall: false` keeps it.
 *
 * NOT in the database, deliberately. The watermark records what a REMOTE service has
 * acknowledged; putting it in the same transaction as the rows being read would imply an
 * atomicity across the network that does not exist. It is also what you most want to be able to
 * delete by hand when a backfill goes wrong.
 *
 * FAILS FORWARD, NOT BACKWARD. A watermark that is lost re-sends events the server already has,
 * and the server de-duplicates on `(installId, stream, cursor)` — so the cost is bandwidth. A
 * watermark that advances too far loses events permanently. Every doubt here resolves toward
 * re-sending.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { DATA } from '../config.js';

export const installIdPath = (): string => join(DATA, 'install-id');
export const pushStatePath = (): string => join(DATA, 'push-state.json');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * This install's identity, created once and stable forever after.
 *
 * NOT the machine id. `machineId()` answers "which computer" and comes from the hostname —
 * measured on the development machine, the packaged install and the repository checkout both
 * report `Dan` while holding completely different databases (53 rows against 2,870). Keyed on
 * that, two installs would overwrite each other's dashboard. This is random per install and
 * cannot collide.
 *
 * `REDBOT_INSTALL_ID` overrides without writing to disk, mirroring `REDBOT_MACHINE`, so a test
 * can be a second install without there being one.
 */
export function installId(): string {
  const forced = process.env.REDBOT_INSTALL_ID;
  if (forced) {
    if (!UUID_RE.test(forced)) {
      throw new Error(`REDBOT_INSTALL_ID is not a UUID: ${forced}`);
    }
    return forced.toLowerCase();
  }

  const file = installIdPath();
  if (existsSync(file)) {
    const saved = readFileSync(file, 'utf8').trim();
    if (UUID_RE.test(saved)) return saved.toLowerCase();
    // A corrupt file must not silently mint a new identity — that would look like a new install
    // to the dashboard and orphan every event already sent under the old one.
    throw new Error(
      `${file} does not contain a UUID. Fix it or delete it; deleting means the dashboard sees ` +
      'this install as a new one.'
    );
  }

  const id = randomUUID();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, id, 'utf8');
  return id;
}

export interface PushState {
  /** stream name → the cursor of the last event the server acknowledged. */
  cursors: Record<string, Record<string, unknown>>;
  /** stream name → ISO timestamp of the last successful push. Reporting only. */
  lastSentAt?: Record<string, string>;
  /** The account list version last accepted, so an unchanged list is not re-sent. */
  accountsListVersion?: number;
  /** Fingerprint of the list at that version — what "unchanged" is measured against. */
  accountsFingerprint?: string;
  /** The ETag of the last list PULLED, so an unchanged one costs a 304 rather than a body. */
  accountsEtag?: string;
  /**
   * Where the dashboard is, when it was set from the console rather than the environment.
   *
   * Persisted for the same reason the operator choice is: a desktop app has no shell to export
   * `REDBOT_SYNC_URL` in, so a value that lived only in the environment could never be set by
   * somebody who never opens a terminal. Not a secret — the tokens are, and they go to the vault.
   */
  syncUrl?: string;
}

const EMPTY: PushState = { cursors: {} };

/** Read the watermarks. A missing or unreadable file reads as "nothing sent yet". */
export function readPushState(): PushState {
  try {
    const file = pushStatePath();
    if (!existsSync(file)) return { ...EMPTY, cursors: {} };
    const raw = JSON.parse(readFileSync(file, 'utf8')) as Partial<PushState>;
    const cursors = raw && typeof raw.cursors === 'object' && raw.cursors ? raw.cursors : {};
    return {
      cursors: cursors as PushState['cursors'],
      ...(raw?.lastSentAt ? { lastSentAt: raw.lastSentAt } : {}),
      ...(typeof raw?.accountsListVersion === 'number'
        ? { accountsListVersion: raw.accountsListVersion } : {}),
      ...(typeof raw?.accountsFingerprint === 'string'
        ? { accountsFingerprint: raw.accountsFingerprint } : {}),
      ...(typeof raw?.accountsEtag === 'string' ? { accountsEtag: raw.accountsEtag } : {}),
      ...(typeof raw?.syncUrl === 'string' ? { syncUrl: raw.syncUrl } : {})
    };
  } catch {
    /* Fails forward: an unreadable watermark re-sends, and the server de-duplicates. */
    return { ...EMPTY, cursors: {} };
  }
}

/**
 * Write the watermarks.
 *
 * Through a temp file and a rename, because a half-written `push-state.json` reads as "nothing
 * sent" on the next run and triggers a full backfill — recoverable, but a rename is atomic on
 * both NTFS and POSIX and costs nothing.
 */
export function writePushState(state: PushState): void {
  const file = pushStatePath();
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2) + '\n', 'utf8');
  renameSync(tmp, file);
}

/** Record that a stream has been acknowledged up to `cursor`. */
export function advance(
  state: PushState, stream: string, cursor: Record<string, unknown>, at: string
): PushState {
  return {
    ...state,
    cursors: { ...state.cursors, [stream]: cursor },
    lastSentAt: { ...(state.lastSentAt ?? {}), [stream]: at }
  };
}

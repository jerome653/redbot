/**
 * WHY a publish could not proceed — one measured cause, never a list of maybes.
 *
 * Three of the five `publish.fail` rows on cardinal between 2026-10-26 and 10-30 read "comment
 * composer not found — logged out, or thread locked?", which ORs three causes with three
 * different owners: sign the browser in, nothing to do because the thread is closed, or the
 * markup moved and redbot needs a code change. A message that will not choose hands the
 * operator the diagnosis the machine was standing in front of the page to do. The rows are
 * quoted in full in src/test/publish-cause.test.ts, where each one has a fixture.
 *
 * So each fact is read separately and the verdict names the ONE that explains the refusal. A
 * fact that cannot be read is said to be unreadable rather than resolved by guessing: a wrong
 * cause is worse than an admitted unknown, because it sends the operator somewhere else.
 */
import type { Page } from 'playwright';
import { sel } from './selectors.js';
import { firstUsable } from './scrape.js';

export type PublishCause =
  /** The page is rendered for nobody — no signed-in session in this profile. */
  | 'signed-out'
  /** Reddit has closed comments on the thread. */
  | 'locked'
  /** The thread is old enough that Reddit refuses comments on it. */
  | 'archived'
  /** Signed in, thread open, and the composer still cannot be found or opened: markup drift. */
  | 'composer-missing'
  /** The submit control is on the page and not usable. */
  | 'submit-disabled'
  /** The submit control is not on the page at all. */
  | 'submit-missing'
  /** Submitted, and the landing could not be established either way. */
  | 'unconfirmed'
  /** A fact the page would not answer, so no cause can be named. */
  | 'undetermined';

export interface CauseVerdict {
  cause: PublishCause;
  /** What an operator is told. One cause, and what to do about it. */
  message: string;
}

/**
 * Lock and archive notices, as Reddit words them. Shared with `thread-state.ts` so the probe the
 * gate reads and the probe the publish path reads cannot disagree — two halves of the publish
 * path disagreeing about the same fact is what TIER0-BLOCKER-2026-07-27 was.
 */
export const LOCK_NOTICE = /this (?:thread|post) (?:is|has been) (?:locked|archived)|comments? (?:are|is) locked|archived post/i;

export interface LockState {
  locked: boolean;
  archived: boolean;
  /** False when the page text could not be read — the facts below are then "not proven false". */
  readable: boolean;
}

/** Was this selector resolved to an element at all? Absence is a fact; a throw is not. */
const present = async (page: Page, selector: string): Promise<boolean> =>
  page.locator(selector).first().count().then((n) => n > 0).catch(() => false);

/**
 * Lock / archive, from the notice text AND the post element's own attributes.
 *
 * Both, because neither is sufficient: the attribute is absent on markup that still renders the
 * notice, and the notice wording changes. Absence of the attribute is not proof of absence of a
 * lock, which is why the text check runs regardless.
 */
export async function readLockState(page: Page): Promise<LockState> {
  let locked = false;
  let archived = false;
  let readable = true;

  const bodyText = await page.locator('body').innerText().catch(() => null);
  if (bodyText == null) {
    readable = false;
  } else {
    const notice = LOCK_NOTICE.exec(bodyText);
    if (notice) {
      const hit = notice[0].toLowerCase();
      locked = /lock/.test(hit);
      archived = /archiv/.test(hit);
    }
  }

  const postEl = page.locator('shreddit-post').first();
  if (await postEl.count().then((n) => n > 0).catch(() => false)) {
    const lockedAttr = await postEl.getAttribute('locked').catch(() => null);
    const archivedAttr = await postEl.getAttribute('archived').catch(() => null);
    if (lockedAttr !== null && lockedAttr !== 'false') locked = true;
    if (archivedAttr !== null && archivedAttr !== 'false') archived = true;
  }

  return { locked, archived, readable };
}

/**
 * Is this page rendered for a signed-in account?
 *
 * `null` — could not tell — is a real answer and is reported as one. A signed-in marker is
 * looked for FIRST because a signed-in page can also carry a login link in its footer, and the
 * reverse mistake ("signed out" on a signed-in page) sends an operator to re-authenticate a
 * session that was fine.
 */
export async function readSignedIn(page: Page): Promise<boolean | null> {
  for (const s of sel.signedInMarker) if (await present(page, s)) return true;
  for (const s of sel.signedOutMarker) if (await present(page, s)) return false;
  return null;
}

export interface PageState {
  /** null = the page would not say. */
  signedIn: boolean | null;
  locked: boolean | null;
  archived: boolean | null;
  composerPresent: boolean;
}

/** Everything the page can be asked before a single character is typed into it. */
export async function probePageState(page: Page): Promise<PageState> {
  const signedIn = await readSignedIn(page);
  const lock = await readLockState(page);
  const editor = await firstUsable(page, sel.commentEditor);
  const trigger = editor ? null : await firstUsable(page, sel.commentBoxTrigger);
  return {
    signedIn,
    locked: lock.locked ? true : lock.readable ? false : null,
    archived: lock.archived ? true : lock.readable ? false : null,
    composerPresent: Boolean(editor || trigger)
  };
}

/**
 * The verdict. `null` means nothing blocks the publish — the composer is reachable.
 *
 * Order matters and is by what the operator must do: a signed-out profile explains every other
 * absence on the page, so it is read first and the lock state is not even mentioned (it cannot
 * be trusted on a page rendered for nobody). Archive before lock, because Reddit archives are
 * permanent while a lock can be lifted.
 */
export function explainBlockedPublish(s: PageState): CauseVerdict | null {
  if (s.signedIn === false) {
    return {
      cause: 'signed-out',
      message: 'signed out — Reddit rendered this thread for nobody, so no composer exists on it. ' +
        'Sign this account\'s browser profile in, then send the draft again. Nothing was typed.'
    };
  }
  if (s.archived === true) {
    return {
      cause: 'archived',
      message: 'the thread is archived — Reddit does not accept new comments on it, and that does not ' +
        'expire. Nothing was typed. This draft cannot be published here; pick another thread.'
    };
  }
  if (s.locked === true) {
    return {
      cause: 'locked',
      message: 'the thread is locked — a moderator has closed comments on it. Nothing was typed. ' +
        'There is nothing to fix at this end; the draft can be published only if the lock is lifted.'
    };
  }
  if (s.composerPresent) return null;

  const unreadable: string[] = [];
  if (s.signedIn === null) unreadable.push('the signed-in state');
  if (s.locked === null || s.archived === null) unreadable.push('the lock state');
  if (unreadable.length > 0) {
    return {
      cause: 'undetermined',
      message: `no comment composer on the thread, and the cause could not be determined — ${unreadable.join(' and ')} ` +
        'could not be read off the page. Open the thread in this account\'s browser and look. Nothing was typed.'
    };
  }

  return {
    cause: 'composer-missing',
    message: 'signed in, and the thread is neither locked nor archived, and there is still no comment ' +
      'composer — the composer selectors in src/reddit/selectors.ts have drifted from Reddit\'s ' +
      'markup. This needs a code change, not an operator action. Nothing was typed.'
  };
}

/** Is any submit control on the page, usable or not? */
export async function submitControlPresent(page: Page): Promise<boolean> {
  for (const s of sel.commentSubmit) if (await present(page, s)) return true;
  return false;
}

/**
 * The submit control refused. Present-but-inert and absent are different problems with different
 * owners: the first is Reddit holding the button until it accepts the composer's contents, the
 * second is a selector that no longer matches anything. The old message said both at once.
 */
export function explainMissingSubmit(controlPresent: boolean): CauseVerdict {
  return controlPresent
    ? {
      cause: 'submit-disabled',
      message: 'the Comment button is present on the thread but DISABLED — Reddit keeps it disabled until ' +
        'it accepts what is in the composer (an editor still settling, or content it will not take). ' +
        'The reply was typed and nothing was submitted.'
    }
    : {
      cause: 'submit-missing',
      message: 'the Comment button is not on the page at all — the submit selectors in ' +
        'src/reddit/selectors.ts no longer match Reddit\'s markup. This needs a code change. ' +
        'The reply was typed and nothing was submitted.'
    };
}

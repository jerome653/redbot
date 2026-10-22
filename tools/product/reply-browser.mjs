/**
 * Which account a reply runs as, and making sure that account's Chrome is open first.
 *
 * Two production failures on cardinal, 20-21 Oct (see reply-browser.test.mjs):
 *
 *   - the console sent a draft as whichever account the UI had selected, and the identity gate
 *     (src/gates.ts) refused it as "written for ryangrowth12, but signed in as Big_Variation_8580";
 *   - every browser-driving action as an account whose Chrome boot had not opened died on
 *     "No debuggable Chrome at http://127.0.0.1:9226".
 *
 * Kept out of server.mjs with its dependencies passed in, the same way boot-browsers.mjs and
 * browser-start.mjs are, so both decisions are tested without a database, a browser or a server.
 */

/**
 * The account a reply to `draft` must run as.
 *
 * A draft that names its account is sent as that account, whatever the console has selected — a
 * reply written in one account's voice is never sent from another's, and the identity gate in the
 * child stays as defence in depth rather than the only thing standing in the way. A draft with no
 * account keeps the old rule: the account the request named, else the only configured account.
 *
 * @returns {{ account: string|null, overrode: string|null, note: string|null }}
 */
export function replyAccount({ draft, requested, sole }) {
  const own = draft && draft.account ? String(draft.account) : '';
  const asked = requested ? String(requested) : '';
  if (own) {
    const overrode = asked && asked !== own ? asked : null;
    return {
      account: own,
      overrode,
      note: overrode
        ? `this draft was written for ${own}, so it is sent as ${own} (the console had ${overrode} selected)`
        : null
    };
  }
  return { account: asked || (sole ? String(sole) : null), overrode: null, note: null };
}

/**
 * Open `handle`'s Chrome if nothing is running on its debug port.
 *
 * Only a FREE port is opened. A port held by another program, or one whose owner could not be
 * proven, is left exactly as it was before this existed: moving or reclaiming a port is
 * launchChrome's decision when a person presses Open Chrome, not a side effect of a reply. A status
 * read that fails is treated the same way — unknown, so the run proceeds as it always did.
 *
 * @param deps  status(handle) -> port state ('free'|'running'|'foreign'|'unknown')
 *              open(handle)   -> { ok, error? }   (launchChrome in the server)
 *              log(line)      -> void             (the run log)
 * @returns {Promise<{ ok: true, opened: boolean } | { ok: false, error: string }>}
 */
export async function ensureBrowser(handle, { status, open, log }) {
  let state;
  try { state = await status(handle); } catch { state = 'unknown'; }
  if (state !== 'free') return { ok: true, opened: false };

  log(`${handle}'s Chrome was not running — opening it on demand`);
  let r;
  try { r = await open(handle); } catch (e) { r = { ok: false, error: String((e && e.message) || e) }; }
  if (!r || !r.ok) {
    return {
      ok: false,
      error: `${handle}'s Chrome was not running and redbot could not open it: ${(r && r.error) || 'no reason given'}`
    };
  }
  log(`opened ${handle}'s Chrome on demand`);
  return { ok: true, opened: true };
}

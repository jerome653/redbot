/**
 * Where is this account actually exiting from, right now?
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS ITS OWN MODULE.
 *
 * The Accounts card already answered this question, in `exitLine()` inside index.html. The header
 * chip — the green "connected" the operator actually looks at — answered a different question
 * ("is a browser up?") and said nothing about the exit. Two surfaces, one fact, and only one of
 * them told the truth about it.
 *
 * That is the D-01 shape this codebase has already been bitten by: a report and the thing it
 * reports on drifting apart because each surface re-derived it. So the posture is computed ONCE,
 * here, from the same two inputs `/api/ports` already publishes, and every surface renders what
 * this returns. A new screen cannot invent a state, and fixing a rule fixes it everywhere.
 *
 * TWO INPUTS, TWO DIFFERENT CLAIMS — the distinction is the whole point:
 *   `proxy`  the RECORD: which address was vetted, where it is, when it was proven.
 *   `relay`  the LIVE FACT: whether a listener is up in this process and what the world saw
 *            through it a moment ago.
 * Rendering the record alone would print "exit Los Angeles" over a browser doing nothing of the
 * kind — the wrong reassurance the exit screen exists to prevent.
 *
 * NULL IS NOT ZERO. `proxy === undefined` means "the question could not be asked" (no database, or
 * 0016 not applied) and must stay `unknown`. Saying "no proxy" there would read as "you are
 * exiting from your home address", which might be false — and a wrong reassurance is worse than
 * silence. Same posture `src/ports.ts` takes about a port it cannot prove.
 */

/** The states, ordered from least to most certain. Kept identical to the Accounts card's vocabulary. */
export const EXIT_STATES = ['unknown', 'none', 'unvetted', 'ready', 'live', 'changed', 'stranded'];

/**
 * @param proxy  the account_proxies record, `null` for none-configured, `undefined` for unreadable
 * @param relay  the live RelayState, or null when no relay is up for this account
 * @param opts   `browserUp` — whether this account's Chrome is actually open
 * @returns {{state:string, tag:string, word:string, place:string|null, ip:string|null, detail:string}}
 */
export function exitPosture(proxy, relay, opts = {}) {
  const browserUp = !!opts.browserUp;

  if (proxy === undefined) {
    return {
      state: 'unknown', tag: 'no', word: 'exit unknown', place: null, ip: null,
      detail: 'The exit could not be read, so this says nothing about where traffic leaves from.'
    };
  }

  if (!proxy || !proxy.enabled) {
    return {
      state: 'none', tag: 'no', word: 'no proxy', place: null, ip: null,
      detail: 'No exit is configured, so this account uses this computer’s own connection.'
    };
  }

  const place = placeOf(proxy);

  /* Un-vetted is a warning, never a success: `proxy vet` has not proven the address, and an
     unproven address must not be presented as protection. */
  if (!proxy.pinnedExitIp || !proxy.vettedAt) {
    return {
      state: 'unvetted', tag: 'no', word: 'exit not checked',
      place, ip: null,
      detail: `An address is configured${place ? ` in ${place}` : ''} but has never passed the check.`
    };
  }

  const relayUp = !!(relay && relay.running);

  /* Chrome fails closed on a dead proxy — MEASURED: zero connections, no fallback to the direct
     line. So a running browser with a dead relay is not leaking; it simply cannot load anything.
     Worth stating, because "every page is broken" otherwise looks like the internet. */
  if (browserUp && !relayUp) {
    return {
      state: 'stranded', tag: 'no', word: 'exit down',
      place, ip: proxy.pinnedExitIp,
      detail: 'The browser is open and its relay is not. Nothing leaks — nothing loads either.'
    };
  }

  if (!relayUp) {
    /* The ordinary resting state: the relay starts with the browser. Future tense on purpose —
       the address is a plan, not a fact, until something is carrying traffic. */
    return {
      state: 'ready', tag: 'ok', word: 'exit ready',
      place, ip: proxy.pinnedExitIp,
      detail: `Will exit from ${place || proxy.pinnedExitIp}.`
    };
  }

  /* The relay is up and answering from an address that is NOT the pinned one. Loud by design:
     this is the drift the launch halt refuses to start on. */
  if (relay.exitIp && relay.matchedPin === false) {
    return {
      state: 'changed', tag: 'no', word: 'exit CHANGED',
      place, ip: relay.exitIp,
      detail: `Answering from ${relay.exitIp}, not the vetted ${proxy.pinnedExitIp}.`
    };
  }

  return {
    state: 'live', tag: 'ok', word: 'exit live',
    place, ip: relay.exitIp || proxy.pinnedExitIp,
    detail: `Exiting from ${place || relay.exitIp || proxy.pinnedExitIp}.`
  };
}

/** "Los Angeles, US" from whatever the record actually holds. Null when it holds nothing. */
export function placeOf(proxy) {
  if (!proxy) return null;
  const bits = [proxy.region, proxy.country].filter((s) => typeof s === 'string' && s.trim());
  if (!bits.length) return proxy.label && String(proxy.label).trim() ? String(proxy.label).trim() : null;
  return bits.join(', ');
}

/** One short string for a status line: "Los Angeles, US · 191.96.254.138". */
export function exitBadge(posture) {
  if (!posture) return '';
  const bits = [posture.place, posture.ip].filter(Boolean);
  return bits.join(' · ');
}

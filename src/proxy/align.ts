/**
 * Making the BROWSER agree with the address it is exiting from.
 *
 * ---------------------------------------------------------------------------
 * WHY A PROXY ALONE MAKES AN ACCOUNT EASIER TO SPOT, NOT HARDER
 *
 * The IP comes from network routing; the timezone and WebRTC come from the machine. Change only
 * the IP and you manufacture a contradiction that one line of JavaScript can read — a US address
 * announcing Manila time, or a page quietly collecting a public address the proxy never carried.
 * Both are stronger signals than an unproxied account gives off at all. So this module is not
 * hardening bolted onto the exit; without it the exit is worse than nothing.
 *
 * ---------------------------------------------------------------------------
 * WHAT WAS MEASURED, AND WHAT IT RULED OUT (PROXY-PLAN §1c, §1e — Chrome 150, this machine)
 *
 *   TZ=America/New_York as an environment variable   IGNORED — still Asia/Manila
 *   --lang=en-US as a launch flag                    IGNORED — navigator.language unchanged
 *   CDP Emulation.setTimezoneOverride                WORKS — Manila -> New York, +8 -> -4
 *   ...and it survives navigation                    YES
 *   ...on a tab redbot did not create                NO — reports Asia/Manila
 *
 *   CDP Emulation.setLocaleOverride                  MOVES Intl ONLY — navigator.language does
 *                                                    NOT follow it (2026-08-04, Chrome 150.0.7871.187:
 *                                                    de-DE/fr-FR/en-GB each left navigator.language
 *                                                    at en-US while Intl followed every time;
 *                                                    reproduced independently on Chrome 151.0.7922.72)
 *   CDP Emulation.setUserAgentOverride               MOVES navigator.language, navigator.languages
 *     with acceptLanguage                            and the Accept-Language header — and does NOT
 *                                                    move Intl. So BOTH are sent; see `cover`.
 *   context.on('page') hook, human types a URL       PROTECTED
 *   context.on('page') hook, window.open (0 latency) PROTECTED — the feared race did not occur
 *
 *   WebRTC, no mitigation                            LEAKS a real public address over UDP
 *   WebRTC, init script on the CONTEXT               blocked, 0 candidates — including on a tab
 *                                                    redbot did not create
 *
 * There is therefore NO launch-flag way to do any of this. Only CDP, and only for pages this
 * process is attached to — which is why the connection is HELD open for as long as the browser
 * lives, and why it lives in the same process as the relay. Quitting redbot drops the exit AND the
 * alignment together, so the two failure modes coincide instead of hiding each other.
 *
 * ---------------------------------------------------------------------------
 * THE RESIDUAL, STATED RATHER THAN BURIED
 *
 * A tab opened while redbot is not attached is not covered. That is the same limit §1c records,
 * and it is not closable from here — `WebRtcIPHandling` is an enterprise policy and no working
 * Chrome 150 command-line flag is confirmed.
 */
import type { Browser, BrowserContext, Page } from 'playwright';

/**
 * The fence, as it is injected into every document.
 *
 * A DEAD CONSTRUCTOR rather than a deleted property. `delete window.RTCPeerConnection` is trivially
 * detectable and, worse, is itself a signal: a browser missing WebRTC entirely is rarer than one
 * that has it. This leaves the name in place and makes construction throw the same
 * `NotAllowedError` a user-denied permission produces — which is a state real browsers reach.
 *
 * Exported so a test can assert what is installed rather than trusting that something was.
 */
export function webrtcFence(): void {
  const refuse = function (): never {
    throw new DOMException('WebRTC is not available in this browser.', 'NotAllowedError');
  };
  /* Named so a stack trace in the page console says what happened rather than "anonymous". */
  const BlockedRTCPeerConnection = function BlockedRTCPeerConnection(): never { return refuse(); };
  BlockedRTCPeerConnection.prototype = {};

  for (const name of ['RTCPeerConnection', 'webkitRTCPeerConnection', 'mozRTCPeerConnection',
                      'RTCDataChannel', 'RTCPeerConnectionIceEvent']) {
    try {
      Object.defineProperty(window, name, {
        configurable: false, enumerable: false, writable: false, value: BlockedRTCPeerConnection
      });
    } catch {
      /* A build that refuses to redefine the property leaves the hole open. Nothing here can
         close it, and pretending otherwise would be the lie this module exists to avoid. */
    }
  }
}

export class AlignmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AlignmentError';
  }
}

/**
 * Does this timezone belong to that country?
 *
 * `Intl.Locale.prototype.getTimeZones` is the runtime's own IANA mapping — measured present on
 * Node 24.18.0 and on the Electron 43 build this app ships (also 24.18.0). A hand-kept list of US
 * zones would be a second source of truth that goes stale the next time IANA moves one.
 *
 * IT IS A NODE 24 API, AND THAT IS A REQUIREMENT, NOT A PREFERENCE. Measured on CI 2026-08-26:
 * on Node 22.x the method is absent, this function answers `unknown` for `America/New_York` in
 * the US, and `alignmentRefusal` therefore stops refusing — a browser announcing Asia/Manila
 * from a US address would launch. `package.json` engines says >=24.0.0 for this reason; it used
 * to say >=22.13, which permitted the runtime on which the check fails open.
 *
 * Three answers, not two. `unknown` is what a runtime without the API, or a country the runtime
 * does not know, must produce — and the caller has to decide what to do about it rather than
 * being handed a confident `false`.
 */
export function timezoneMatchesCountry(
  timezone: string | null | undefined, country: string | null | undefined
): 'yes' | 'no' | 'unknown' {
  if (!timezone || !country || !/^[A-Za-z]{2}$/.test(country)) return 'unknown';
  const locale = Intl.Locale.prototype as unknown as { getTimeZones?: () => string[] };
  if (typeof locale.getTimeZones !== 'function') return 'unknown';
  let zones: string[] | undefined;
  try {
    zones = (new Intl.Locale(`und-${country.toUpperCase()}`) as unknown as
             { getTimeZones(): string[] }).getTimeZones();
  } catch {
    return 'unknown';
  }
  if (!zones || !zones.length) return 'unknown';
  return zones.some((z) => z.toLowerCase() === timezone.toLowerCase()) ? 'yes' : 'no';
}

/**
 * The IANA zone a US city sits in — so an exit's reported city can SUGGEST the account timezone
 * that `timezoneMatchesCountry` then accepts, rather than the operator guessing and tripping the
 * launch refusal in `alignmentRefusal`.
 *
 * A curated table, deliberately, not a geo database. A Webshare US exit lands in a bounded set of
 * datacenter metros, and the alternative — bundling a city→coordinate→timezone dataset — is
 * megabytes and a new dependency to answer what a lookup answers. Two rules keep it honest:
 *
 *   1. An UNKNOWN city returns `null`, never a default. A confident wrong zone is the exact
 *      IP/timezone contradiction alignment exists to refuse; "I don't know, you pick" is safe,
 *      a guessed `America/New_York` is not.
 *   2. A city whose name is AMBIGUOUS across zones (Portland OR/ME, Arlington VA/TX, Aurora CO/IL,
 *      Glendale AZ/CA, Columbia, Springfield) is OMITTED, so it falls to `null` rather than
 *      resolving to whichever state the table's author happened to think of first.
 *
 * The Webshare list API returns `city_name` only — no state — which is why this is keyed on city
 * and why the ambiguous names cannot be disambiguated here.
 */
const US_CITY_ZONES: ReadonlyMap<string, string> = (() => {
  const byZone: Record<string, string[]> = {
    'America/New_York': [
      'new york', 'brooklyn', 'queens', 'the bronx', 'bronx', 'manhattan', 'staten island',
      'buffalo', 'rochester', 'albany', 'syracuse', 'yonkers', 'white plains',
      'piscataway', 'newark', 'jersey city', 'secaucus', 'edison', 'elizabeth', 'clifton',
      'boston', 'cambridge', 'quincy', 'worcester', 'providence', 'hartford', 'stamford', 'new haven',
      'philadelphia', 'pittsburgh', 'allentown', 'harrisburg', 'scranton', 'erie',
      'washington', 'ashburn', 'herndon', 'reston', 'sterling', 'manassas', 'chantilly', 'leesburg',
      'richmond', 'virginia beach', 'norfolk', 'baltimore', 'boydton',
      'atlanta', 'columbus', 'savannah', 'augusta', 'macon',
      'miami', 'orlando', 'tampa', 'jacksonville', 'fort lauderdale', 'west palm beach',
      'boca raton', 'tallahassee', 'gainesville', 'saint petersburg', 'st petersburg',
      'charlotte', 'raleigh', 'durham', 'greensboro', 'winston-salem', 'cary',
      'cleveland', 'cincinnati', 'dayton', 'akron', 'toledo',
      'detroit', 'grand rapids', 'ann arbor', 'lansing',
      'indianapolis', 'louisville', 'lexington', 'knoxville', 'chattanooga',
      'charleston', 'wilmington'
    ],
    'America/Chicago': [
      'chicago', 'naperville', 'aurora il', 'rockford', 'peoria',
      'dallas', 'fort worth', 'houston', 'austin', 'san antonio', 'plano', 'irving', 'garland',
      'mesquite', 'frisco', 'mckinney', 'corpus christi', 'laredo', 'lubbock',
      'oklahoma city', 'tulsa', 'kansas city', 'wichita', 'topeka', 'overland park',
      'omaha', 'lincoln', 'des moines', 'cedar rapids',
      'minneapolis', 'saint paul', 'st paul', 'rochester mn',
      'milwaukee', 'madison', 'green bay',
      'memphis', 'nashville', 'new orleans', 'baton rouge', 'shreveport', 'little rock', 'jackson',
      'st louis', 'saint louis', 'springfield mo'
    ],
    'America/Denver': [
      'denver', 'colorado springs', 'boulder', 'fort collins', 'lakewood', 'aurora co',
      'salt lake city', 'provo', 'ogden', 'west valley city',
      'albuquerque', 'santa fe', 'las cruces', 'rio rancho', 'el paso',
      'boise', 'nampa', 'meridian', 'cheyenne', 'billings', 'helena', 'bozeman'
    ],
    'America/Phoenix': [
      'phoenix', 'tucson', 'mesa', 'chandler', 'scottsdale', 'tempe', 'gilbert',
      'surprise', 'yuma', 'flagstaff', 'goodyear'
    ],
    'America/Los_Angeles': [
      'los angeles', 'san francisco', 'san jose', 'oakland', 'san diego', 'sacramento', 'fresno',
      'long beach', 'santa clara', 'sunnyvale', 'mountain view', 'palo alto', 'fremont', 'san mateo',
      'redwood city', 'santa ana', 'anaheim', 'irvine', 'riverside', 'bakersfield', 'stockton',
      'modesto', 'chula vista', 'santa barbara', 'san bernardino', 'hayward', 'berkeley',
      'seattle', 'tacoma', 'spokane', 'bellevue', 'redmond', 'kent', 'renton', 'everett', 'kirkland',
      'las vegas', 'henderson', 'north las vegas', 'reno', 'sparks', 'carson city',
      'hillsboro', 'beaverton', 'eugene', 'gresham', 'bend'
    ],
    'America/Anchorage': ['anchorage', 'fairbanks', 'juneau', 'wasilla'],
    'Pacific/Honolulu': ['honolulu', 'pearl city', 'hilo', 'kailua', 'kapolei']
  };
  const m = new Map<string, string>();
  for (const [zone, cities] of Object.entries(byZone)) {
    for (const c of cities) m.set(c, zone);
  }
  return m;
})();

/** Normalise a reported city to the table's key form: first comma-part, lower-case, single-spaced. */
function normalizeCity(city: string): string {
  const head = city.split(',')[0] ?? city;
  return head.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * The IANA timezone for a US exit's city, or null when it is unknown or ambiguous.
 *
 * Null is a first-class answer, not a failure — see the table's header. The caller shows the zone
 * as a copy-and-paste suggestion for the account timezone; on null it asks the operator to choose,
 * which is the correct thing to do rather than pick one for them.
 */
export function usZoneForCity(city: string | null | undefined): string | null {
  if (!city || typeof city !== 'string') return null;
  return US_CITY_ZONES.get(normalizeCity(city)) ?? null;
}

/**
 * Why this account may not be launched through its exit yet, or null when it may.
 *
 * Separate from `alignBrowser` and pure, because it has to run BEFORE a window is opened. Finding
 * out that the timezone contradicts the address only after Chrome is on screen means either
 * closing a window in the operator's face or letting a mismatched browser reach Reddit — and the
 * second one cannot be undone for that account.
 *
 * ---------------------------------------------------------------------------
 * WHAT BOTH MESSAGES USED TO SAY, AND WHY NEITHER CAN SAY IT ANY MORE
 *
 * Both branches ended by sending the operator to set the account's timezone "on the Accounts
 * screen". That was accurate while the zone was a typed field — and the same field is what made
 * the refusal necessary so often: its placeholder was Asia/Manila, every account on this machine
 * inherited it, and the connection egresses from San Jose. Eight accounts announcing the wrong
 * hemisphere, and a refusal courteously offering to let somebody type another guess.
 *
 * The zone is measured in the browser now and `accounts.timezone` is written from that
 * measurement, so the box is gone from the Accounts screen and a refusal cannot point at it. A
 * message that names a control which does not exist is worse than a vague one: it teaches the
 * reader that the refusal is confused, and the next thing they look for is the way around it.
 *
 * The register changes with it. When a measurement contradicts the exit record, two instruments
 * are describing different places and the interesting question is which of them is wrong. That is
 * a reason to stop and look, not an errand to run — so neither branch hands out a fix, and both
 * say what would have to be true for the launch to proceed.
 */
export function alignmentRefusal(
  handle: string, timezone: string | null | undefined,
  country: string | null | undefined, region: string | null | undefined
): string | null {
  const verdict = timezoneMatchesCountry(timezone, country);
  if (verdict === 'yes') return null;

  const where = [region, country].filter(Boolean).join(', ') || 'its exit';
  if (verdict === 'no') {
    return `${handle} exits from ${where}, but the timezone measured in its browser is ${timezone}. `
         + 'A browser that announces one part of the world from an address in another is one of the '
         + 'most reliable proxy tells there is, and it is read by a single line of JavaScript. '
         + 'Nothing here was typed: the zone is what the browser itself reported and the address is '
         + 'what the exit check proved, so this is two measurements disagreeing rather than a field '
         + 'filled in wrongly. Find out which of them is describing a different machine — whether '
         + 'the exit still carries this account\'s traffic, whether it has moved, and whether the '
         + 'browser was measured going through it or around it. redbot will launch once they agree.';
  }
  return `redbot could not confirm that the timezone measured in ${handle}'s browser (${
           timezone || 'none recorded'}) belongs to ${where}, so it will not point the browser at `
       + 'the exit. An unverified match is not a match. There are three ways to arrive here and not '
       + 'one of them is a value to correct: nothing has measured this account yet, the exit record '
       + 'does not say which country it is in, or this runtime cannot answer for that country at '
       + 'all. Which one it is decides what happens next, so find that out rather than launching '
       + 'past it.';
}

/**
 * How a cover attempt ended.
 *
 * Three states and not two, because the count alone cannot tell the two failures apart and the
 * MESSAGE has to. `covered` is the ordinary path; the other two are both zero coverage.
 */
export type CoverOutcome = 'covered' | 'vanished' | 'refused';

/**
 * Which kind of failure a thrown cover was — the distinction the swallowing `catch` said could
 * not be drawn at that seam.
 *
 * It can be drawn, and cheaply: a page that shut mid-flight answers `isClosed()` true, which
 * Playwright resolves synchronously off state it already holds. A page that is still open and
 * still threw refused the call. The old comment was right that the two must not be conflated and
 * wrong that nothing could separate them, so the fail-open was never actually required.
 */
export function coverOutcome(page: { isClosed(): boolean }): 'vanished' | 'refused' {
  return page.isClosed() ? 'vanished' : 'refused';
}

/**
 * Whether a browser that has just been covered may be used — null to proceed, a message to stop.
 *
 * FAIL-CLOSED, IN THE SAME SHAPE AS THE FENCE. A failed `addInitScript` already threw and closed
 * the browser; a failed `Emulation.setTimezoneOverride` was swallowed and nothing read the count
 * before navigating, so a launch covering ZERO pages returned ok and went to Reddit announcing
 * whatever the host machine says. The fence and the override are the same promise made twice —
 * that this browser will not announce something untrue — and enforcing only one of them left the
 * more easily read signal unguarded. `timezoneMatchesCountry` calls a zone that contradicts the
 * exit one of the most reliable proxy tells there is; an uncovered page IS that contradiction.
 *
 * WHY BOTH INSTRUMENTS. The outcome says what happened to the page about to be navigated; the
 * count says whether anything at all was covered. They should never disagree, and if they do,
 * one of them is broken — which is not a state to pick a winner in. Reading both also means a
 * later edit that increments the count from somewhere else cannot quietly re-open the door.
 *
 * WHY A VANISHED PAGE STILL STOPS THE LAUNCH. A page closing mid-flight is ordinary and stays
 * tolerated everywhere it can be: every page after the first is covered from a `page` event whose
 * outcome is deliberately dropped. It stops things only here, where it was the ONLY page, because
 * the very next statement would navigate an uncovered tab and a tab does not announce a correct
 * zone on the grounds that its predecessor closed politely. What the distinction buys is the
 * diagnosis — telling somebody their browser "refused" when the tab merely shut sends them
 * hunting a fault that is not there.
 */
export function coverageRefusal(
  handle: string, timezone: string, outcome: CoverOutcome, pagesAligned: number
): string | null {
  if (outcome === 'covered' && pagesAligned > 0) return null;

  if (outcome === 'vanished') {
    return `The tab redbot was aligning for ${handle} closed before the timezone override (${
             timezone}) could be applied, so no page was covered and the browser was not sent to `
         + 'Reddit. A page closing mid-flight is ordinary and is tolerated everywhere else; it '
         + 'stops a launch only when it was the only page there was, because what comes next is a '
         + 'navigation, and an uncovered tab announces this machine\x27s own zone rather than the '
         + 'one the exit carries.';
  }

  if (outcome === 'refused') {
    return `${handle}'s browser refused the timezone override (${timezone}), so it was not sent `
         + 'to Reddit. An uncovered page announces the zone of the machine redbot is running on, '
         + 'and a browser saying one part of the world from an address in another is the single '
         + 'most reliable proxy tell there is. This is the same rule the WebRTC fence is held to '
         + 'a few lines below, and for the same reason: both are the browser being stopped from '
         + 'announcing something untrue.';
  }

  /* `covered` with nothing counted. The two instruments disagree, so neither is trusted. */
  return `redbot could not confirm that any page in ${handle}'s browser carries the timezone `
       + `override (${timezone}): the cover reported success and the page count is still zero. `
       + 'That is a contradiction rather than a result, so the browser was not sent to Reddit.';
}

/** A CDP connection held open for as long as the browser it is aligning. */
export interface AlignedBrowser {
  handle: string;
  endpoint: string;
  timezone: string;
  locale: string | null;
  /** How many pages have had the override applied — a hook that never fires is visible. */
  readonly pagesAligned: number;
  close(): Promise<void>;
}

const aligned = new Map<string, AlignedBrowser>();

/** The alignment held for this account, if any. */
export function alignmentFor(handle: string): AlignedBrowser | null {
  return aligned.get(handle.toLowerCase()) ?? null;
}

export function alignmentStates(): { handle: string; timezone: string; pagesAligned: number }[] {
  return [...aligned.values()].map((a) => ({
    handle: a.handle, timezone: a.timezone, pagesAligned: a.pagesAligned
  }));
}

/** Drop this account's CDP connection. The browser stays open; it simply stops being covered. */
export async function stopAlignment(handle: string): Promise<boolean> {
  const key = handle.toLowerCase();
  const a = aligned.get(key);
  if (!a) return false;
  aligned.delete(key);
  await a.close();
  return true;
}

export async function stopAllAlignments(): Promise<void> {
  const all = [...aligned.values()];
  aligned.clear();
  await Promise.all(all.map((a) => a.close().catch(() => {})));
}

/**
 * Attach to a freshly spawned Chrome, cover it, and only then send it anywhere.
 *
 * ORDER IS THE WHOLE POINT. The browser is spawned on `about:blank` — deliberately, and it is why
 * the login URL left `launchChrome`'s command line. A Chrome-created login tab is one redbot never
 * touched: it would carry the machine's real timezone and a live `RTCPeerConnection` during
 * MANUAL SIGN-IN, which is the single moment the account's identity is being fixed and the one
 * moment neither can be allowed to be wrong.
 *
 * So: connect, install the fence on the CONTEXT (which covers pages this process did not create),
 * apply the timezone to every page there is and every page that appears, and navigate last.
 */
export async function alignBrowser(opts: {
  endpoint: string;
  handle: string;
  timezone: string;
  /** e.g. "en-US". Null skips the locale override; the timezone is the load-bearing one. */
  locale?: string | null;
  /** Where to send the first tab once it is covered. Omitted leaves it on about:blank. */
  openUrl?: string;
  connectTimeoutMs?: number;
}): Promise<AlignedBrowser> {
  const { chromium } = await import('playwright');

  let browser: Browser;
  try {
    browser = await chromium.connectOverCDP(opts.endpoint, {
      timeout: opts.connectTimeoutMs ?? 20_000, ...({ noDefaults: true } as object)
    });
  } catch (e) {
    throw new AlignmentError(
      `redbot could not attach to ${opts.handle}'s browser to align it (${
        e instanceof Error ? e.message : String(e)}).`
    );
  }

  const context: BrowserContext | undefined = browser.contexts()[0];
  if (!context) {
    await browser.close().catch(() => {});
    throw new AlignmentError(
      `${opts.handle}'s browser reported no context, so nothing could be aligned in it.`
    );
  }

  let pagesAligned = 0;

  /**
   * Applied per PAGE, because `Emulation.setTimezoneOverride` is a CDP call against a target and
   * there is no context-wide form of it. The init script above is the opposite — installed once on
   * the context, inherited by every document.
   */
  const cover = async (page: Page): Promise<CoverOutcome> => {
    try {
      const cdp = await context.newCDPSession(page);
      await cdp.send('Emulation.setTimezoneOverride', { timezoneId: opts.timezone });
      if (opts.locale) {
        /**
         * BOTH CALLS, because they move DIFFERENT properties and neither moves the other's.
         *
         * `setLocaleOverride` was here alone and was described as the route to navigator.language.
         * It is not — measured twice, independently, on Chrome 150.0.7871.187 and 151.0.7922.72:
         * it moves `Intl` (dates, numbers, collation) and leaves navigator.language untouched.
         * `setUserAgentOverride` with `acceptLanguage` is what moves navigator.language,
         * navigator.languages and the Accept-Language header — and it leaves `Intl` alone.
         *
         * A US address announcing en-PH is the contradiction this module exists to remove, so
         * sending only one of these left half the job undone in the half nobody was looking at.
         *
         * The user-agent is handed straight back unchanged: this call REQUIRES a userAgent, and
         * inventing one here would forge a second identity signal to fix a language one.
         */
        await cdp.send('Emulation.setLocaleOverride', { locale: opts.locale });
        const ua = await page.evaluate(() => navigator.userAgent);
        await cdp.send('Emulation.setUserAgentOverride', {
          userAgent: ua, acceptLanguage: opts.locale
        });
      }
      pagesAligned++;
      return 'covered';
    } catch {
      /**
       * A page that closed mid-flight is the ordinary case here and is still not a failure.
       *
       * What changed is only that the two are now TOLD APART rather than both swallowed. The
       * earlier note said a genuine refusal "is not distinguishable from it at this seam" — it
       * is, by asking the page whether it is closed, which Playwright answers synchronously from
       * state it already holds. See coverOutcome().
       *
       * NOTHING IS DECIDED HERE. This still returns rather than throwing, because most calls into
       * it come from the `page` event below, where there is no caller to throw to and where a
       * background tab opening and closing must never fail a launch. The decision is made once,
       * by the caller that is about to navigate.
       */
      return coverOutcome(page);
    }
  };

  try {
    await context.addInitScript(webrtcFence);
  } catch (e) {
    await browser.close().catch(() => {});
    throw new AlignmentError(
      `The WebRTC fence could not be installed in ${opts.handle}'s browser (${
        e instanceof Error ? e.message : String(e)}), so it was not sent to Reddit. Without the `
      + 'fence a page can read this connection\'s real public address over UDP, which the proxy '
      + 'never carries.'
    );
  }

  /* Every tab that appears from now on — including ones a person opens by hand. The outcome is
     dropped on purpose: there is no caller to refuse on behalf of, and a background tab that
     opens and shuts must not retrospectively fail a launch that is already covered. */
  context.on('page', (p: Page) => { void cover(p); });

  const first: Page = context.pages()[0] ?? await context.newPage();
  const outcome = await cover(first);

  /**
   * THE GATE, AND IT SITS BEFORE THE NAVIGATION ON PURPOSE.
   *
   * This is the line whose absence made a failed override fail-OPEN: `cover` swallowed the error,
   * nothing read the count, and the next statement sent an uncovered browser to Reddit announcing
   * the host machine's zone. Closing the browser rather than returning an unusable handle is what
   * the fence install does a few lines up, and the two failures deserve the same answer.
   */
  const refusal = coverageRefusal(opts.handle, opts.timezone, outcome, pagesAligned);
  if (refusal) {
    await browser.close().catch(() => {});
    throw new AlignmentError(refusal);
  }

  if (opts.openUrl) {
    /* `domcontentloaded`, not `load`: Reddit keeps connections open long after the page is usable,
       and waiting for `load` would hold this call open for the life of the tab. */
    await first.goto(opts.openUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 })
      .catch(() => { /* the operator can navigate; a slow first paint is not a launch failure */ });
  }

  const entry: AlignedBrowser = {
    handle: opts.handle,
    endpoint: opts.endpoint,
    timezone: opts.timezone,
    locale: opts.locale ?? null,
    get pagesAligned() { return pagesAligned; },
    close: async () => { await browser.close().catch(() => {}); }
  };
  aligned.set(opts.handle.toLowerCase(), entry);
  return entry;
}

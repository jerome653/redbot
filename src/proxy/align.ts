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
 */
export function alignmentRefusal(
  handle: string, timezone: string | null | undefined,
  country: string | null | undefined, region: string | null | undefined
): string | null {
  const verdict = timezoneMatchesCountry(timezone, country);
  if (verdict === 'yes') return null;

  const where = [region, country].filter(Boolean).join(', ') || 'its exit';
  if (verdict === 'no') {
    return `${handle} exits from ${where}, but its timezone is set to ${timezone}. A browser that `
         + 'announces one part of the world from an address in another is one of the most reliable '
         + 'proxy tells there is, and it is read by a single line of JavaScript. Set the account\'s '
         + `timezone to the ${country} zone matching ${region || 'that address'} on the Accounts `
         + 'screen, then start the browser again.';
  }
  return `redbot could not confirm that ${handle}'s timezone (${timezone || 'unset'}) belongs to `
       + `${where}, so it will not point the browser at the exit. An unverified match is not a `
       + 'match — set the timezone from the address the check reported.';
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
  const cover = async (page: Page): Promise<void> => {
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
    } catch {
      /* A page that closed mid-flight is the ordinary case here and not a failure. A page that
         genuinely refused the override is not distinguishable from it at this seam; the count
         above is what makes "the hook never fired" visible to the console. */
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

  /* Every tab that appears from now on — including ones a person opens by hand. */
  context.on('page', (p: Page) => { void cover(p); });

  const first: Page = context.pages()[0] ?? await context.newPage();
  await cover(first);

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

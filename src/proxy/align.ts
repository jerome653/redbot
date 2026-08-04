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
      if (opts.locale) await cdp.send('Emulation.setLocaleOverride', { locale: opts.locale });
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

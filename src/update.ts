/**
 * Is there a newer redbot than the one running?
 *
 * WHAT THIS DOES NOT DO, AND WHY.
 *
 * It does not install anything. `electron-updater` can replace a Windows app in place, and it was
 * considered and rejected: an unsigned NSIS package installed silently by a background process is
 * the shape of an attack, not of a feature, and this installer is unsigned (electron-builder.yml
 * says so and explains that a certificate is a purchase nobody has made). Swapping the running
 * binary without a signature to verify would mean trusting whatever the network returned.
 *
 * So this only ever ANSWERS A QUESTION. The person clicks, their own browser opens, and they run
 * the installer themselves — the same trust decision they made the first time, made again
 * deliberately. That is also why the download link points at the GitHub release rather than at
 * anything this app fetched: the bytes never pass through redbot.
 *
 * WHAT IT SENDS. One unauthenticated GET to api.github.com. No token, no identifier, no version
 * of anything in the query — the response is the full release list and the comparison happens
 * here. Nothing about this machine leaves it.
 *
 * IT FAILS SILENT. Offline, rate-limited, DNS broken, GitHub down, repository renamed: every one
 * of those returns `{ ok: false }` with a reason, and the console renders nothing. An update
 * notice is a convenience; a red error bar because a laptop is on a train is not.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './config.js';

/**
 * Where releases are published. Overridable so a fork does not have to patch source, and so the
 * tests can point at a repository that does not exist and assert the failure is quiet.
 */
export const UPDATE_REPO = process.env.REDBOT_UPDATE_REPO ?? 'jerome653/redbot';

/** Semantic-ish version: the three numbers, and whatever the tag said after them. */
export interface Version {
  major: number;
  minor: number;
  patch: number;
  /** `-desktop` from `v0.1.0-desktop`. Carried for display; it does NOT affect ordering. */
  suffix: string;
}

/**
 * Parse `v0.1.0-desktop`, `0.1.0`, `v2.10.3` → numbers.
 *
 * The suffix is deliberately ignored when ordering. Strict semver says `0.1.0-desktop` PRECEDES
 * `0.1.0`, which would make the very release this app ships from look older than the app itself
 * and hide every future update behind a tag-naming accident. Three numbers is the whole rule, and
 * it is the rule a person reads off the tag too.
 */
export function parseVersion(raw: string | null | undefined): Version | null {
  if (typeof raw !== 'string') return null;
  const m = /^\s*v?(\d+)\.(\d+)\.(\d+)(.*)$/.exec(raw.trim());
  if (!m) return null;
  return {
    major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), suffix: (m[4] ?? '').trim()
  };
}

/** Strictly newer, comparing major then minor then patch. Equal versions are NOT newer. */
export function isNewer(candidate: Version, current: Version): boolean {
  if (candidate.major !== current.major) return candidate.major > current.major;
  if (candidate.minor !== current.minor) return candidate.minor > current.minor;
  return candidate.patch > current.patch;
}

/** The version this build reports, read from the package.json that ships inside the app. */
export function currentVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version?: string };
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export interface ReleaseInfo {
  tag: string;
  name: string;
  url: string;
  publishedAt: string;
  prerelease: boolean;
  /** The asset THIS platform can install, when the release carries one. Null is normal,
   *  not an error: a release with no build for this platform has nothing to offer here. */
  download: { name: string; url: string; size: number } | null;
}

export type UpdateResult =
  | { ok: true; current: string; latest: string; newer: boolean; release: ReleaseInfo | null }
  | { ok: false; current: string; reason: string };

/**
 * Only ever hand the page an `https:` URL.
 *
 * These strings come off the network and end up as an `href` the operator clicks. A
 * `javascript:` value there would run in the renderer, and `http:` would send somebody to fetch
 * an executable over a channel nobody can vouch for. It would take a compromise of GitHub's API
 * to produce either, which is exactly the kind of "cannot happen" that a one-line check is
 * cheaper than reasoning about.
 */
function safeUrl(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback;
  try {
    return new URL(raw).protocol === 'https:' ? raw : fallback;
  } catch {
    return fallback;
  }
}

/** A release the app could offer: published, not a draft, and with a parseable tag. */
interface RawRelease {
  tag_name?: unknown; name?: unknown; html_url?: unknown; published_at?: unknown;
  draft?: unknown; prerelease?: unknown;
  assets?: Array<{ name?: unknown; browser_download_url?: unknown; size?: unknown }>;
}

/**
 * Which asset in a release is the one THIS machine could install.
 *
 * The filter used to be `/\.exe$/i` unconditionally, with a comment reasoning that Windows is the
 * only platform the app packages for. The packaging is a fact about the BUILD; the platform the
 * check runs on is not the same fact, and conflating them meant a Linux console offered
 * `redbot-Setup-3.5.1.exe` under a button that says "Download the installer" — a file that cannot
 * be run on the machine being told to run it.
 *
 * A platform with no matching asset resolves to no download at all, and the card falls back to the
 * release page. That is the honest answer, and it is the answer Linux gets until a release
 * actually carries an AppImage (electron-builder.yml `linux:`).
 */
const ASSET_FOR_PLATFORM: Record<string, RegExp> = {
  win32: /\.exe$/i,
  linux: /\.AppImage$/i,
  darwin: /\.dmg$/i
};

/**
 * The newest usable release in a GitHub `/releases` payload.
 *
 * `/releases/latest` is NOT used, and that is measured rather than assumed: against this
 * repository it answers **404**, because the only published release is flagged as a prerelease and
 * that endpoint silently excludes them. An update check that used it would report "you are up to
 * date" forever while releases piled up. So the full list is read and ordered here.
 *
 * Ordered by VERSION, not by publish date — a hotfix to an older line can be published after a
 * newer release, and date order would then offer a downgrade.
 */
export function pickLatest(payload: unknown, platform: string = process.platform): ReleaseInfo | null {
  if (!Array.isArray(payload)) return null;
  const usable = (payload as RawRelease[])
    .filter((r) => r && r.draft !== true && typeof r.tag_name === 'string')
    .map((r) => ({ raw: r, v: parseVersion(r.tag_name as string) }))
    .filter((x): x is { raw: RawRelease; v: Version } => x.v !== null);
  if (!usable.length) return null;

  usable.sort((a, b) => (isNewer(a.v, b.v) ? -1 : isNewer(b.v, a.v) ? 1 : 0));
  const best = usable[0]!.raw;

  /* The asset this platform can actually run. An unknown platform matches nothing rather than
     falling back to the Windows installer — see ASSET_FOR_PLATFORM. */
  const wanted = ASSET_FOR_PLATFORM[platform];
  const asset = wanted
    ? (best.assets ?? []).find(
      (a) => typeof a?.name === 'string' && wanted.test(a.name as string)
        && typeof a.browser_download_url === 'string')
    : undefined;

  const releasesPage = `https://github.com/${UPDATE_REPO}/releases`;
  const downloadUrl = asset ? safeUrl(asset.browser_download_url, '') : '';

  return {
    tag: String(best.tag_name),
    name: typeof best.name === 'string' && best.name ? best.name : String(best.tag_name),
    url: safeUrl(best.html_url, releasesPage),
    publishedAt: typeof best.published_at === 'string' ? best.published_at : '',
    prerelease: best.prerelease === true,
    /* An asset whose URL did not survive the scheme check is dropped rather than downgraded to
       the release page: a button labelled "Download the installer" must download the installer. */
    download: asset && downloadUrl
      ? {
        name: String(asset.name),
        url: downloadUrl,
        size: typeof asset.size === 'number' ? asset.size : 0
      }
      : null
  };
}

/**
 * Ask GitHub whether there is a newer release.
 *
 * `fetchImpl` and `current` are injectable so the tests can drive every branch — a newer release,
 * the same one, a rate-limited response, a socket that never answers — without a network.
 * `platform` joins them for the same reason: which asset is offered depends on it, and that has
 * to be provable from one machine.
 */
export async function checkForUpdate(opts: {
  fetchImpl?: typeof fetch;
  current?: string;
  platform?: string;
  timeoutMs?: number;
} = {}): Promise<UpdateResult> {
  const current = opts.current ?? currentVersion();
  const doFetch = opts.fetchImpl ?? fetch;
  const here = parseVersion(current);
  if (!here) return { ok: false, current, reason: `this build's version ("${current}") is not readable` };

  let payload: unknown;
  try {
    const res = await doFetch(`https://api.github.com/repos/${UPDATE_REPO}/releases?per_page=20`, {
      headers: { accept: 'application/vnd.github+json', 'user-agent': 'redbot-update-check' },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 6000)
    });
    if (!res.ok) {
      /* 403 with no token is the rate limit, and it is the one an operator is most likely to hit.
         Naming it beats "request failed", which sends people looking for a network problem. */
      return {
        ok: false, current,
        reason: res.status === 403
          ? 'GitHub rate-limited the update check — it will work again within the hour'
          : `GitHub answered ${res.status}`
      };
    }
    payload = await res.json();
  } catch (e) {
    return {
      ok: false, current,
      reason: e instanceof Error && e.name === 'TimeoutError'
        ? 'the update check timed out' : 'could not reach GitHub'
    };
  }

  const release = pickLatest(payload, opts.platform ?? process.platform);
  if (!release) return { ok: true, current, latest: current, newer: false, release: null };

  const there = parseVersion(release.tag)!;
  return { ok: true, current, latest: release.tag, newer: isNewer(there, here), release };
}

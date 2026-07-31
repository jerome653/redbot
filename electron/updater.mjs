/**
 * Installing a newer redbot, in place, without the operator handling a file.
 *
 * ---------------------------------------------------------------------------
 * THIS REVERSES A DECISION src/update.ts MADE, AND SAYS SO.
 *
 * `src/update.ts` checks GitHub for a newer release and deliberately stops there — it opens the
 * release page and lets the person download and run the installer themselves. Its header explains
 * why it refused to go further: the NSIS package is unsigned, and "an unsigned installer installed
 * silently by a background process is the shape of an attack".
 *
 * That reasoning was about a BACKGROUND process. What this module adds is not background: it runs
 * only when somebody clicks "Apply update". Nothing here is scheduled, nothing polls, and nothing
 * downloads a byte until that click. `autoDownload` and `autoInstallOnAppQuit` are both turned OFF
 * below — they default to ON in electron-updater, so leaving them alone would have produced exactly
 * the silent background updater src/update.ts was right to reject.
 *
 * WHAT ACTUALLY GUARANTEES THE BYTES. Not a certificate — there isn't one. electron-updater's
 * `verifySignature` (NsisUpdater.js) reads `publisherName` out of `app-update.yml` and returns null
 * — verification skipped — when it is absent, which is the unsigned case, so no signature is
 * checked. What IS checked is the SHA512 in `latest.yml`: AppUpdater passes `fileInfo.info.sha512`
 * into the download, so an installer that does not match the published digest is rejected. The
 * trust anchor is therefore HTTPS plus the GitHub release, not a code-signing certificate. Anyone
 * who can serve that feed can serve an executable this app will run. Buying a certificate and
 * setting `win.certificateFile` is what would close that, and it remains unbought.
 *
 * NO ELECTRON AT IMPORT TIME. `electron-updater`'s `autoUpdater` is a lazy getter that constructs
 * an NsisUpdater, which reads `app.getVersion()` on construction — under plain Node that throws
 * `Cannot read properties of undefined (reading 'getVersion')`. Measured by requiring the package
 * outside Electron. So the module is never imported at load; `loadAutoUpdater` is injected and
 * called on first use, which is also what lets updater.test.mjs drive every branch with a fake.
 * ---------------------------------------------------------------------------
 */

/**
 * The one place a raw electron-updater error becomes something a person can act on.
 *
 * Kept pure and exported so the tests can pin the mapping without an Electron process. The default
 * arm returns the message unchanged rather than a generic "update failed" — a message nobody can
 * search for is worse than a slightly technical one.
 */
export function explainError(e) {
  const msg = e instanceof Error ? e.message : String(e);
  const code = e && typeof e === 'object' && 'code' in e ? String(e.code) : '';

  /* The two that are not really errors from where the operator sits. */
  if (/ERR_UPDATER_NO_PUBLISHED_VERSIONS/.test(code + msg)) return 'no release has been published yet';
  if (/ERR_UPDATER_LATEST_VERSION_NOT_FOUND/.test(code + msg)) return 'the release feed has no version for this platform';

  /* app-update.yml is written into the package by electron-builder from the `publish` block. Its
     absence means either a dev run or a build made without that block — both worth naming exactly,
     because "cannot find module" sends people looking for a missing dependency. */
  if (/app-update\.yml/i.test(msg)) {
    return 'this build has no update feed configured (app-update.yml is missing)';
  }
  /**
   * The release exists but was published WITHOUT its metadata.
   *
   * Measured against the real feed from a packaged build: `v1.0.2` on GitHub carries only the
   * installer, so electron-updater's request for `latest.yml` answers 404 and the check fails. That
   * file is what carries the version and the SHA512 the download is verified against, so a release
   * without it cannot be updated to, no matter how new it is.
   *
   * Named explicitly because the raw error is a 404 wrapped in "Please double check that your
   * authentication token is correct", which sends people hunting for a token problem they do not
   * have — the repository is public and no token is involved.
   */
  if (/Cannot find latest\.yml|latest\.yml in the latest release/i.test(msg)) {
    return 'the newest release was published without latest.yml — a release must include it, and the .blockmap, next to the installer';
  }
  if (/ERR_UPDATER_INVALID_SIGNATURE/.test(code + msg)) {
    return 'the downloaded installer was rejected: it is not signed by the expected publisher';
  }
  /* sha512 mismatch. This is the check that stands in for a signature here, so its failure gets
     said plainly rather than folded into a generic network error. */
  if (/sha512 checksum mismatch|checksum mismatch/i.test(msg)) {
    return 'the download did not match the published checksum and was discarded';
  }
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|ENETUNREACH|net::/i.test(code + msg)) {
    return 'could not reach the update server';
  }
  if (/status code 404/i.test(msg)) return 'the update feed was not found (404)';
  if (/status code 403|rate limit/i.test(msg)) return 'the update server refused the request (403 — possibly rate-limited)';
  return msg;
}

/**
 * Ordering two version strings without pulling in a semver dependency.
 *
 * Same three-numbers-only rule as src/update.ts `parseVersion`/`isNewer`, and for the same reason:
 * a `-desktop` style suffix must not make a release sort BEFORE the plain version, which is what
 * strict semver prerelease ordering would do. Duplicated rather than imported because this file
 * runs in the Electron main process and `dist/update.js` is compiled output that a dev run may not
 * have built yet — a version comparison is not worth a load-order dependency.
 */
export function isNewerVersion(candidate, current) {
  const parse = (raw) => {
    const m = /^\s*v?(\d+)\.(\d+)\.(\d+)/.exec(String(raw ?? ''));
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
  };
  const a = parse(candidate); const b = parse(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

/**
 * The updater, as the rest of the app sees it.
 *
 * Everything it depends on is injected, so the whole state machine is testable under plain Node:
 *   loadAutoUpdater  () => electron-updater's autoUpdater (or a fake)
 *   isPackaged       whether this is an installed build
 *   currentVersion   the running version, for display and for the newer? comparison
 *   log              boot_log, so an update attempt lands in the same file as everything else
 *   broadcast        (state) => void, pushed to the renderer on every transition
 *   allowDev         run against a dev feed instead of refusing (REDBOT_DEV_UPDATES=1)
 */
export function createUpdater({
  loadAutoUpdater,
  isPackaged,
  currentVersion,
  log = () => {},
  broadcast = () => {},
  allowDev = false
} = {}) {
  /**
   * One state object, pushed whole on every change.
   *
   * Whole rather than diffs because the renderer can be reloaded at any moment (the menu has a
   * Reload item) and a page that missed the transitions it was not alive for would show a stale
   * button. A fresh page asks for `snapshot()` and gets the truth in one shot.
   *
   * phase: idle | checking | available | none | downloading | ready | installing | error
   */
  let state = {
    phase: 'idle',
    current: currentVersion,
    latest: null,
    newer: false,
    percent: 0,
    transferred: 0,
    total: 0,
    bytesPerSecond: 0,
    reason: null,
    notes: null,
    releaseDate: null,
    supported: Boolean(isPackaged) || Boolean(allowDev)
  };

  const set = (patch) => {
    state = { ...state, ...patch };
    try { broadcast(state); } catch { /* a UI that has gone away must not break the install */ }
    return state;
  };

  let updater = null;      // the electron-updater instance, once loaded
  let inFlight = null;     // the running check/apply promise, so a double click cannot start two
  let downloaded = false;  // an update is on disk and quitAndInstall can be called

  /**
   * Load and configure electron-updater exactly once.
   *
   * The three assignments are the whole "nothing happens on its own" contract, and they are
   * ASSIGNMENTS RATHER THAN DEFAULTS ON PURPOSE — electron-updater ships `autoDownload = true` and
   * `autoInstallOnAppQuit = true`, so omitting these lines would mean a check silently pulled 100 MB
   * and staged an install for the next quit. That is the behaviour this app must not have.
   */
  function ensure() {
    if (updater) return updater;
    const au = loadAutoUpdater();

    au.autoDownload = false;          // a check must never fetch anything
    au.autoInstallOnAppQuit = false;  // a download must never install itself on quit
    au.allowDowngrade = false;        // the feed pointing backwards must not roll the app back

    /**
     * Look at ALL releases, not only the ones GitHub calls "latest".
     *
     * This is not a preference, it is a correctness fix, and it is the same trap src/update.ts
     * already documented for this repository. Read from electron-updater 6.8.9's source:
     *
     *   - `AppUpdater` sets `allowPrerelease = hasPrereleaseComponents(currentVersion)`. This app's
     *     version is `1.0.2`, which has no prerelease component, so it defaults to FALSE.
     *   - With it false, `GitHubProvider.getLatestVersion()` takes the `else` branch and calls
     *     `getLatestTagName()`, which requests `github.com/<owner>/<repo>/releases/latest`.
     *   - That endpoint SILENTLY EXCLUDES PRERELEASES. src/update.ts records measuring exactly this
     *     against this repository: it answers 404, because the published release is a prerelease.
     *
     * So a release published as a prerelease would be invisible and the button would report a
     * failure forever. With this true and no channel set, the provider reads the releases Atom feed
     * and takes its newest entry instead — which finds normal releases and prereleases alike.
     *
     * Taking the feed's NEWEST-BY-DATE entry cannot cause a downgrade here: `allowDowngrade` is
     * false above, and `check()` gates the button on this module's own `isNewerVersion`. The worst
     * case is that no update is offered, never that an older one is installed.
     */
    au.allowPrerelease = true;

    /* electron-updater's logger interface is {info,warn,error,debug}. Routed into boot.log so an
       update that failed on somebody else's machine is in the file they can be asked to send. */
    au.logger = {
      info: (m) => log(`updater    ${m}`),
      warn: (m) => log(`updater W  ${m}`),
      error: (m) => log(`updater E  ${m}`),
      debug: () => {}
    };

    /* In a dev run there is no app-update.yml inside a package, so electron-updater refuses. This
       switch makes it read `dev-app-update.yml` from the project root instead — off unless asked
       for, because a dev build installing a release build over itself is not a thing to do by
       accident. */
    if (!isPackaged && allowDev) au.forceDevUpdateConfig = true;

    au.on('download-progress', (p) => {
      set({
        phase: 'downloading',
        percent: Math.max(0, Math.min(100, Math.round(p?.percent ?? 0))),
        transferred: p?.transferred ?? 0,
        total: p?.total ?? 0,
        bytesPerSecond: p?.bytesPerSecond ?? 0
      });
    });

    au.on('update-downloaded', (info) => {
      downloaded = true;
      set({ phase: 'ready', percent: 100, latest: info?.version ?? state.latest });
    });

    /* electron-updater emits 'error' as an EventEmitter event. An EventEmitter with no 'error'
       listener THROWS on emit and would take the main process down with it, so this handler is
       load-bearing even though the promise chains below also catch. */
    au.on('error', (e) => {
      const reason = explainError(e);
      log(`updater E  ${reason}`);
      set({ phase: 'error', reason });
    });

    updater = au;
    return au;
  }

  /** Neither verb means anything in a dev run, and saying so beats a stack trace in the UI. */
  function unsupported() {
    const reason = 'updates are only available in the installed app';
    set({ phase: 'error', reason });
    return { ok: false, reason, ...state, phase: 'error' };
  }

  /**
   * Ask the feed what the newest release is. Downloads NOTHING — `autoDownload` is off.
   *
   * The newer? answer is computed here rather than trusted from `updateInfo`, because
   * `checkForUpdates` resolves with the latest release whether or not it is newer than the running
   * build; `updateInfo.version` equal to the current version is the normal up-to-date case, not an
   * update.
   */
  async function check() {
    if (!state.supported) return unsupported();
    if (inFlight) return inFlight.then(() => ({ ok: true, ...state }), () => ({ ok: false, ...state }));

    const run = (async () => {
      set({ phase: 'checking', reason: null });
      const au = ensure();
      const result = await au.checkForUpdates();
      const version = result?.updateInfo?.version ?? null;
      const newer = version ? isNewerVersion(version, state.current) : false;
      set({
        phase: newer ? 'available' : 'none',
        latest: version,
        newer,
        releaseDate: result?.updateInfo?.releaseDate ?? null,
        notes: typeof result?.updateInfo?.releaseNotes === 'string' ? result.updateInfo.releaseNotes : null,
        reason: null
      });
      log(`updater    check: running ${state.current}, feed has ${version ?? 'nothing'} → ${newer ? 'update available' : 'up to date'}`);
      return { ok: true, ...state };
    })().catch((e) => {
      const reason = explainError(e);
      set({ phase: 'error', reason });
      return { ok: false, reason, ...state, phase: 'error' };
    }).finally(() => { inFlight = null; });

    inFlight = run;
    return run;
  }

  /**
   * Download the update and install it, silently, then come back up on the new version.
   *
   * `quitAndInstall(true, true)` — verified against BaseUpdater.js in electron-updater 6.8.9, where
   * the signature is `(isSilent, isForceRunAfter)` positionally. isSilent runs the NSIS package
   * with no window and no wizard; isForceRunAfter relaunches the app afterwards. Both are needed
   * for the operator to experience this as "the app restarted, now it is newer" rather than as an
   * installer appearing. Note the source detail: when isSilent is FALSE, electron-updater ignores
   * isForceRunAfter and uses `autoRunAppAfterInstall` instead — so silent and relaunch are coupled,
   * and passing (true, true) is the only combination that gives both.
   *
   * The install is per-user (nsis.perMachine: false in electron-builder.yml), which is why no UAC
   * prompt interrupts it. A per-machine install would need elevation and could not be silent.
   *
   * A check is folded in when the caller has not run one, so "Apply" works from a cold page.
   */
  async function apply() {
    if (!state.supported) return unsupported();
    if (state.phase === 'installing') return { ok: true, ...state };
    if (inFlight) await inFlight.catch(() => {});

    const run = (async () => {
      const au = ensure();

      /* Nothing known yet, or a previous check said nothing was there: ask once more. Cheap, and
         it means the button is never dead because the page was opened before a release landed. */
      if (!downloaded && !state.newer) {
        set({ phase: 'checking', reason: null });
        const result = await au.checkForUpdates();
        const version = result?.updateInfo?.version ?? null;
        const newer = version ? isNewerVersion(version, state.current) : false;
        set({ phase: newer ? 'available' : 'none', latest: version, newer });
        if (!newer) {
          log('updater    apply: nothing newer to install');
          return { ok: true, installed: false, ...state };
        }
      }

      if (!downloaded) {
        set({ phase: 'downloading', percent: 0, reason: null });
        log(`updater    downloading ${state.latest}`);
        /* Resolves with the installer path(s). The sha512 from latest.yml is enforced inside this
           call — see the header. A mismatch throws and nothing is installed. */
        await au.downloadUpdate();
        downloaded = true;
        set({ phase: 'ready', percent: 100 });
      }

      set({ phase: 'installing' });
      log(`updater    installing ${state.latest} silently, and relaunching`);
      /* Returns void and quits the app. Anything after it is not reliably reached, so the state is
         published BEFORE the call — the renderer's last painted frame should say "installing". */
      au.quitAndInstall(true, true);
      return { ok: true, installed: true, ...state, phase: 'installing' };
    })().catch((e) => {
      const reason = explainError(e);
      /* A failed download must not leave `downloaded` true — the next click has to fetch again
         rather than try to install a file that was discarded. */
      downloaded = false;
      set({ phase: 'error', reason });
      return { ok: false, reason, ...state, phase: 'error' };
    }).finally(() => { inFlight = null; });

    inFlight = run;
    return run;
  }

  return {
    check,
    apply,
    /** For a page that has just loaded and missed every transition. */
    snapshot: () => ({ ok: true, ...state })
  };
}

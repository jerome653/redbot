/**
 * The desktop shell's entire contract with the page.
 *
 * ---------------------------------------------------------------------------
 * THIS FILE USED TO EXPOSE NOTHING, AND THE REASON IT NO LONGER DOES IS WORTH KEEPING.
 *
 * The renderer is `tools/product/index.html`, which talks to its own loopback server over `fetch`
 * exactly as it does in a browser. Every screen, every action and the publish path already work
 * through that server, and the server's `hostIsLocal` / `originIsLocal` guards are what make that
 * safe. So the standing rule stands: DO NOT add a `runCommand(...)` bridge here. That would create
 * a second command surface beside `/api/run`'s `PUBLIC_ACTIONS` allow-list — one the allow-list
 * does not cover and `server.test.mjs` does not test. Two paths to "execute something" is one more
 * than this app should have.
 *
 * The updater is the one thing that genuinely CANNOT go through that server, and it is worth being
 * precise about why, because "it was easier" would not be a good enough reason:
 *
 *   - `tools/product/server.mjs` runs as a CHILD PROCESS, spawned with ELECTRON_RUN_AS_NODE=1. It
 *     is plain Node. It has no `app`, no `BrowserWindow`, and no way to quit and relaunch the
 *     desktop app — which is the entire job of applying an update.
 *   - `electron-updater` only functions in the Electron MAIN process: its `autoUpdater` is a lazy
 *     getter that constructs an NsisUpdater, which reads `app.getVersion()` on construction. Under
 *     plain Node that throws (measured — see electron/updater.mjs).
 *
 * So the bridge below is narrow on purpose. It exposes THREE VERBS AND ONE SUBSCRIPTION, all about
 * updates, none of them parameterised: nothing here takes a command, a path, a URL or a version, so
 * there is no argument a compromised page could supply to make it do something else. The worst a
 * caller can do is ask whether an update exists, or install the one the configured feed published.
 *
 * The feed is NOT settable from here — it is baked into the package as `app-update.yml` at build
 * time. A page that could choose the update source would be a page that could choose what
 * executable this app installs.
 *
 * CommonJS on purpose — Electron preload scripts are not ESM. `ipcRenderer` and `contextBridge`
 * are both available under `sandbox: true`; the sandboxed preload's `require` shim provides them.
 * ---------------------------------------------------------------------------
 */
const { contextBridge, ipcRenderer } = require('electron');

/** One channel name, in one place, so the preload and main.mjs cannot drift apart. */
const STATUS = 'redbot:update-status';

contextBridge.exposeInMainWorld('redbotDesktop', {
  /** True when the console is being shown by the desktop shell. Read-only, and that is all. */
  isDesktop: true,

  updates: {
    /** Ask the feed whether a newer release exists. Downloads nothing. */
    check: () => ipcRenderer.invoke('redbot:update-check'),

    /**
     * Download and install, silently, then relaunch. THE ONLY PATH TO AN INSTALL.
     *
     * Nothing else in this app calls it: there is no timer, no check-on-launch that leads here,
     * and `autoInstallOnAppQuit` is off. An update happens because somebody clicked, or it does
     * not happen.
     */
    apply: () => ipcRenderer.invoke('redbot:update-apply'),

    /** The current phase, for a page that has just (re)loaded and missed the transitions. */
    snapshot: () => ipcRenderer.invoke('redbot:update-snapshot'),

    /**
     * Progress and phase changes, pushed from the main process.
     *
     * Returns an unsubscribe function. The raw IpcRendererEvent is deliberately NOT passed through
     * — it carries `sender` and `ports`, which are main-process handles the page has no business
     * holding.
     */
    onStatus: (cb) => {
      if (typeof cb !== 'function') return () => {};
      const handler = (_event, state) => cb(state);
      ipcRenderer.on(STATUS, handler);
      return () => ipcRenderer.removeListener(STATUS, handler);
    }
  }
});

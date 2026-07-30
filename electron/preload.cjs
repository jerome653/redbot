/**
 * Deliberately almost empty.
 *
 * A preload script's job is to hand the renderer capabilities it would not otherwise have. This
 * renderer needs none: it is `tools/product/index.html`, which talks to its own loopback server
 * over `fetch` exactly as it does in a browser. Every screen, every action and the publish path
 * already work through that server, and the server's `hostIsLocal` / `originIsLocal` guards are
 * what make it safe.
 *
 * So nothing is exposed. Adding a `window.redbot.runCommand(...)` bridge here would create a
 * SECOND command surface beside `/api/run`'s `PUBLIC_ACTIONS` allow-list — one that the allow-list
 * does not cover and `server.test.mjs` does not test. Two paths to "execute something" is one more
 * than this app should have.
 *
 * It exists at all because `contextIsolation: true` with no preload leaves no way to tell the page
 * it is running inside the desktop app rather than a browser tab. One boolean is the whole
 * contract, and it carries no authority: the page may render differently, it cannot DO more.
 *
 * CommonJS on purpose — Electron preload scripts are not ESM.
 */
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('redbotDesktop', {
  /** True when the console is being shown by the desktop shell. Read-only, and that is all. */
  isDesktop: true
});

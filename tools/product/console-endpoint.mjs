/**
 * WHERE THE RUNNING CONSOLE IS, FOR A PROCESS THAT IS NOT ELECTRON.
 *
 * `electron/console-port.mjs` writes the chosen port into `<userData>/console-port.json`, and
 * `app.getPath('userData')` is the only thing in the app that knows where `<userData>` is. A
 * systemd unit, a cron job or a shell script has no `app`, so it cannot ask - and the one that
 * tried instead ran the CLI directly, which is how `redbot-karma.service` ended up driving
 * Chrome with no idea whether the rotation was holding it.
 *
 * MEASURED on cardinal 2026-10-22: `/home/samui/.config/redbot/console-port.json` -> 40547, and
 * `ss -ltnp` shows `electron ... server.mjs --port 40547` listening on 127.0.0.1:40547. The two
 * agree, which is the whole contract this module depends on.
 *
 * The rule is Electron's, restated once here rather than hardcoded per caller:
 *   linux    $XDG_CONFIG_HOME or $HOME/.config    /<name>
 *   darwin   $HOME/Library/Application Support    /<name>
 *   win32    %APPDATA%                            \<name>
 * `main.mjs:118` calls `app.setName('redbot')` when not packaged, so <name> is APP_NAME below.
 *
 * A PORT FILE IS A CLAIM ABOUT A PROCESS THAT MAY HAVE EXITED. `consoleBase` returns a URL, not
 * a promise that anything answers it; the caller's own request is the liveness check.
 */
import { readFileSync } from 'node:fs';
import { join, posix, win32 } from 'node:path';
import { PORT_FILE } from '../../electron/console-port.mjs';

/** `app.setName('redbot')` - electron/main.mjs:118. */
export const APP_NAME = 'redbot';

/**
 * The directory Electron would call `userData`, from the environment alone.
 * @returns {string|null} null when the platform's home variable is unset - a guess at that point
 *   would be a path in some other account, and reading someone else's port file is worse than
 *   failing.
 */
export function userDataDir(env = process.env, platform = process.platform, name = APP_NAME) {
  /* Join with the TARGET platform's separator, not the host's. `platform` is a parameter, so
     this function is answerable about a platform it is not running on - and the first test that
     asked it for a Windows path got `AppData\Roaming/redbot` back from a Linux `join`. */
  if (platform === 'win32') return env.APPDATA ? win32.join(env.APPDATA, name) : null;
  if (platform === 'darwin') return env.HOME ? posix.join(env.HOME, 'Library', 'Application Support', name) : null;
  const base = env.XDG_CONFIG_HOME || (env.HOME ? posix.join(env.HOME, '.config') : null);
  return base ? posix.join(base, name) : null;
}

/**
 * `http://127.0.0.1:<port>` for the console this install last started, or null when there is no
 * readable port on file.
 */
export function consoleBase(dir, read = readFileSync) {
  /* Return BEFORE touching the filesystem. `join(null, …)` throws and the catch below would
     return null anyway, so this guard only earns its place by what it does not do: a resolver
     that failed must not go on to read a path built from its failure. */
  if (!dir) return null;
  let port;
  try { port = Number(JSON.parse(read(join(dir, PORT_FILE), 'utf8'))?.port); }
  catch { return null; }
  /* Same bounds console-port.mjs:63 accepts when it reads the file back - a port it would have
     refused to reuse is not one to send a request to either. */
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return null;
  return `http://127.0.0.1:${port}`;
}

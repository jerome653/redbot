/**
 * A stand-in for "a browser holding a debugging port", for the port-status tests.
 *
 * WHY NOT REAL CHROME. What `src/ports.ts` actually decides is ownership, and it decides it
 * from the owning process's `--user-data-dir` — not from anything Chrome-specific. So the
 * honest fixture is any process that listens on a port with that flag on its command line,
 * and using one keeps the suite from depending on which browser the machine running it has
 * installed, or from opening windows on somebody's desktop.
 *
 * The flag is passed AFTER the script path on purpose: node parses its own options before the
 * script name, so `node --user-data-dir=x fixture.mjs` is an error, while
 * `node fixture.mjs 9301 --user-data-dir=x` puts the flag in argv — and therefore in the
 * command line the OS reports, which is the only place ports.ts reads it from.
 *
 *   node port-fixture.mjs <port> --user-data-dir=<dir>
 */
import { createServer } from 'node:net';

const port = Number(process.argv[2]);
if (!Number.isInteger(port)) {
  console.error('usage: port-fixture.mjs <port> --user-data-dir=<dir>');
  process.exit(2);
}

const server = createServer((socket) => socket.end());
server.on('error', (e) => { console.error(`fixture could not listen on ${port}: ${e.message}`); process.exit(1); });
server.listen(port, '127.0.0.1', () => {
  // The parent waits for this line rather than sleeping, so the test never races the listener.
  console.log(`listening ${port}`);
});

/**
 * The failure these guard against is silent: a wrong directory reads no port file, `consoleBase`
 * returns null, and the caller falls back to "the console is not running" on a box where it is.
 * So the platform rules are asserted as whole paths, not as "it returns a string".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { userDataDir, consoleBase, APP_NAME } from './console-endpoint.mjs';

const reader = (contents) => () => {
  if (contents === null) throw new Error('ENOENT');
  return contents;
};

test('linux uses XDG_CONFIG_HOME when set, and the home .config when it is not', () => {
  assert.equal(userDataDir({ HOME: '/home/samui' }, 'linux'), '/home/samui/.config/redbot');
  assert.equal(userDataDir({ HOME: '/home/samui', XDG_CONFIG_HOME: '/cfg' }, 'linux'), '/cfg/redbot');
});

test('THE PATH ON CARDINAL: redbot-karma.service pins HOME=/home/samui', () => {
  assert.equal(userDataDir({ HOME: '/home/samui' }, 'linux'), '/home/samui/.config/redbot',
    'this is where console-port.json was measured on 2026-10-22, holding port 40547');
});

test('darwin and win32 follow their own rule, not the linux one', () => {
  assert.equal(userDataDir({ HOME: '/Users/j' }, 'darwin'),
    '/Users/j/Library/Application Support/redbot');
  assert.equal(userDataDir({ APPDATA: 'C:\\Users\\j\\AppData\\Roaming' }, 'win32'),
    'C:\\Users\\j\\AppData\\Roaming\\redbot');
  assert.equal(userDataDir({ HOME: '/Users/j' }, 'win32'), null,
    'HOME is not APPDATA - guessing would read some other install');
});

test('a missing home variable is null, never a relative path', () => {
  assert.equal(userDataDir({}, 'linux'), null);
  assert.equal(userDataDir({}, 'darwin'), null);
  assert.equal(userDataDir({}, 'win32'), null);
});

test('the app name is the one main.mjs sets, and is overridable for a second install', () => {
  assert.equal(APP_NAME, 'redbot');
  assert.equal(userDataDir({ HOME: '/h' }, 'linux', 'redbot-dev'), '/h/.config/redbot-dev');
});

test('a port on file becomes a loopback base URL', () => {
  assert.equal(consoleBase('/d', reader('{"port":40547}')), 'http://127.0.0.1:40547');
});

test('no file, unreadable file, or junk in it is null rather than a thrown boot', () => {
  assert.equal(consoleBase('/d', reader(null)), null);
  assert.equal(consoleBase('/d', reader('not json')), null);
  assert.equal(consoleBase('/d', reader('{}')), null);
  assert.equal(consoleBase(null, reader('{"port":40547}')), null, 'userDataDir could not resolve');
});

test('an unresolved directory is not read from at all', () => {
  let read = false;
  const spy = () => { read = true; return '{"port":40547}'; };
  assert.equal(consoleBase(null, spy), null);
  assert.equal(consoleBase(undefined, spy), null);
  assert.equal(consoleBase('', spy), null);
  assert.equal(read, false, 'a path built from a failed resolve is not a path to open');
});

test('a port console-port.mjs would refuse to reuse is not one to send a request to', () => {
  for (const port of [0, 80, 1023, 65536, -1, 1.5]) {
    assert.equal(consoleBase('/d', reader(JSON.stringify({ port }))), null, `port ${port}`);
  }
  assert.equal(consoleBase('/d', reader('{"port":"40547"}')), 'http://127.0.0.1:40547',
    'JSON.stringify writes a number, but a hand-edited file may quote it');
});

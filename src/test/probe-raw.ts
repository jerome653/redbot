/**
 * Diagnostic 4: drive Chrome over raw CDP — no Playwright anywhere in the stack.
 *
 * If this is ALSO blocked, the cause is not Playwright and not CDP instrumentation;
 * it is the profile or the network.
 *
 * Prereq: Chrome started by hand with --remote-debugging-port=9222
 * Run: node dist/test/probe-raw.js [url]
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DATA } from '../config.js';

const url = process.argv[2] ?? 'https://www.reddit.com/r/wordpress/hot/';
const base = 'http://127.0.0.1:9222';

const targets = (await (await fetch(`${base}/json/list`)).json()) as Array<{
  id: string; type: string; url: string; webSocketDebuggerUrl: string;
}>;

let target = targets.find((t) => t.type === 'page');
if (!target) {
  const created = (await (await fetch(`${base}/json/new?about:blank`, { method: 'PUT' })).json()) as typeof targets[number];
  target = created;
}
console.log(`target: ${target.id}  ${target.url}`);

const ws = new WebSocket(target.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map<number, (v: any) => void>();

ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(String(ev.data));
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)!(msg.result);
    pending.delete(msg.id);
  }
});

function send(method: string, params: Record<string, unknown> = {}): Promise<any> {
  const id = ++seq;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

await new Promise<void>((r) => ws.addEventListener('open', () => r()));
console.log('cdp connected (raw websocket, no Playwright)');

await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url });
await new Promise((r) => setTimeout(r, 8000));

const evalRes = await send('Runtime.evaluate', {
  expression: `JSON.stringify({
    title: document.title,
    text: (document.body ? document.body.innerText : '').slice(0, 200),
    anchors: document.querySelectorAll('a[href*="/comments/"]').length,
    href: location.href
  })`,
  returnByValue: true
});

const info = JSON.parse(evalRes.result.value as string) as {
  title: string; text: string; anchors: number; href: string;
};

const blocked = /blocked by network security|please wait for verification|whoa there/i.test(info.text);

console.log(`\n== raw CDP`);
console.log(`   href    : ${info.href}`);
console.log(`   title   : ${info.title || '(empty)'}`);
console.log(`   blocked : ${blocked ? 'YES' : 'no'}`);
console.log(`   /comments/ anchors : ${info.anchors}`);
console.log(`   text    : ${info.text.replace(/\s+/g, ' ').slice(0, 160)}`);

const shot = await send('Page.captureScreenshot', { format: 'png' });
const out = join(DATA, 'probe-raw.png');
writeFileSync(out, Buffer.from(shot.data as string, 'base64'));
console.log(`   screenshot: ${out}`);

ws.close();

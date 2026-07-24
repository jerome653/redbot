/** Phase 8: measure 429 recovery. Polls reddit via raw CDP, logs first success. */
import { writeFileSync, appendFileSync } from 'node:fs';
const OUT = 'qa/evidence/phase8-recovery.log';
const start = Date.now();
appendFileSync(OUT, `watch started ${new Date().toISOString()}\n`);

async function probe() {
  const list = await (await fetch('http://127.0.0.1:9222/json/list')).json();
  const t = list.find(x => x.type === 'page');
  if (!t) return 'no-target';
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0; const p = new Map();
  ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { p.get(m.id)(m); p.delete(m.id); } });
  const send = (m, q = {}) => { const i = ++id; return new Promise(r => { p.set(i, r); ws.send(JSON.stringify({ id: i, method: m, params: q })); }); };
  await new Promise(r => ws.addEventListener('open', () => r()));
  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate', { url: 'https://www.reddit.com/r/wordpress/hot/' });
  await new Promise(r => setTimeout(r, 8000));
  const r = await send('Runtime.evaluate', { returnByValue: true,
    expression: 'document.title + "||" + document.body.innerText.slice(0,80) + "||" + document.querySelectorAll("shreddit-post").length' });
  ws.close();
  return r.result?.result?.value ?? 'no-value';
}

for (let i = 0; i < 40; i++) {
  const mins = ((Date.now() - start) / 60000).toFixed(1);
  let v = 'err';
  try { v = String(await probe()); } catch (e) { v = 'probe-error: ' + e.message.slice(0, 60); }
  const clean = v.replace(/\s+/g, ' ').slice(0, 150);
  const ok = !/429|isn.t working|blocked by network/i.test(clean) && /shreddit|Wordpress/i.test(clean);
  appendFileSync(OUT, `+${mins}min  ${ok ? 'RECOVERED' : 'still limited'}  ${clean}\n`);
  if (ok) { appendFileSync(OUT, `RECOVERY at +${mins} minutes\n`); break; }
  await new Promise(r => setTimeout(r, 120000));
}

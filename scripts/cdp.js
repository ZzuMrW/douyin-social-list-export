#!/usr/bin/env node
// Minimal Chrome DevTools Protocol driver — no external deps.
// Requires Node 18+ (global fetch) / Node 22+ (global WebSocket).
//
// Usage:
//   node cdp.js list                          # list all targets/tabs
//   node cdp.js newtab <url>                  # open a new tab
//   node cdp.js url                           # print current page url
//   node cdp.js shot <out.png>                # screenshot current viewport
//   node cdp.js eval "<js expression>"        # evaluate JS, print result
//   node cdp.js evalfile <file.js>            # evaluate a JS file (awaits promises)
//   node cdp.js click "<js expr -> element>"  # real mouse click at element center
//   node cdp.js front                         # bring target window to front
//
// Env:
//   CDP_PORT   remote debugging port (default 9444)
//   CDP_MATCH  substring of the target URL to pick (defaults to *.douyin.com, else first page)

const fs = require('fs');

const PORT = process.env.CDP_PORT || '9444';
const BASE = `http://127.0.0.1:${PORT}`;

async function listTargets() {
  const r = await fetch(`${BASE}/json/list`);
  return r.json();
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.onopen = () => resolve(ws);
    ws.onerror = (e) => reject(new Error('ws error: ' + (e.message || 'unknown')));
  });
}

let msgId = 0;
function send(ws, method, params = {}, timeoutMs = 30000) {
  const id = ++msgId;
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout: ${method}`)), timeoutMs);
    const onMsg = (ev) => {
      let data;
      try { data = JSON.parse(ev.data); } catch { return; }
      if (data.id === id) {
        clearTimeout(t);
        ws.removeEventListener('message', onMsg);
        if (data.error) reject(new Error(method + ' -> ' + JSON.stringify(data.error)));
        else resolve(data.result);
      }
    };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function getPageTarget() {
  const targets = await listTargets();
  const pages = targets.filter(t => t.type === 'page' && !t.url.startsWith('chrome-extension://'));
  if (process.env.CDP_MATCH) {
    const m = pages.find(t => t.url.includes(process.env.CDP_MATCH));
    if (m) return m;
  }
  const dy = pages.find(t => /douyin\.com/.test(t.url));
  return dy || pages[0];
}

function print(v) {
  console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 2));
}

(async () => {
  const cmd = process.argv[2];

  if (cmd === 'newtab') {
    const url = process.argv[3];
    const r = await fetch(`${BASE}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' });
    const t = await r.json();
    console.log(JSON.stringify({ id: t.id, url: t.url }));
    return;
  }
  if (cmd === 'list') {
    const t = await listTargets();
    for (const x of t) console.log(`${x.type}\t${x.url}`);
    return;
  }

  const target = await getPageTarget();
  if (!target) { console.error('no page target'); process.exit(1); }
  const ws = await connect(target.webSocketDebuggerUrl);

  if (cmd === 'shot') {
    const out = process.argv[3] || 'shot.png';
    await send(ws, 'Page.enable');
    const res = await send(ws, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    fs.writeFileSync(out, Buffer.from(res.data, 'base64'));
    console.log('saved ' + out);
  } else if (cmd === 'eval' || cmd === 'evalfile') {
    const expr = cmd === 'eval' ? process.argv[3] : fs.readFileSync(process.argv[3], 'utf8');
    const res = await send(ws, 'Runtime.evaluate', {
      expression: expr,
      returnByValue: true,
      awaitPromise: true,
      userGesture: true,
    }, 180000);
    if (res.exceptionDetails) {
      console.error('EXCEPTION: ' + JSON.stringify(res.exceptionDetails.exception || res.exceptionDetails));
      process.exit(2);
    }
    print(res.result.value);
  } else if (cmd === 'click') {
    const expr = process.argv[3];
    const r = await send(ws, 'Runtime.evaluate', {
      expression: `(()=>{const el=${expr}; if(!el) return null; el.scrollIntoView({block:'center'}); const b=el.getBoundingClientRect(); return {x:Math.round(b.left+b.width/2), y:Math.round(b.top+b.height/2), w:Math.round(b.width), h:Math.round(b.height)};})()`,
      returnByValue: true,
      userGesture: true,
    });
    const pt = r.result.value;
    if (!pt) { console.error('element not found'); process.exit(1); }
    await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt.x, y: pt.y, button: 'none' });
    await send(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
    await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: pt.x, y: pt.y, button: 'left', clickCount: 1 });
    console.log('clicked at ' + pt.x + ',' + pt.y);
  } else if (cmd === 'front') {
    await send(ws, 'Page.enable');
    await send(ws, 'Page.bringToFront');
    console.log('brought to front');
  } else if (cmd === 'url') {
    const res = await send(ws, 'Runtime.evaluate', { expression: 'location.href', returnByValue: true });
    console.log(res.result.value);
  } else {
    console.error('usage: node cdp.js list|newtab <url>|shot <out.png>|eval <expr>|evalfile <file>|click <expr>|front|url');
    process.exit(1);
  }

  ws.close();
})().catch(e => { console.error('ERROR: ' + e.message); process.exit(1); });

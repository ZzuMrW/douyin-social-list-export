#!/usr/bin/env node
// Harvest a lazy-loading list from an already-open, already-logged-in page
// (e.g. the Douyin 粉丝 / 关注 modal) and write it to a JSON file.
//
// Strategy: the list is NOT virtualized, so the goal is to make the page load
// everything into the DOM, then read it all at once. Loading is slow (seconds),
// so we do: scroll a step -> dispatch a real 'scroll' event -> wait -> re-read,
// and only stop after N consecutive rounds with no new rows.
// Rows are de-duplicated by DOM element identity (NOT by avatar URL — two users
// can share the same avatar image).
//
// Usage:
//   node harvest.js <out.json> [--port 9444] [--match douyin]
//                    [--interval 6] [--idle 4] [--max-rounds 40] [--step 0.8]
//
// Options:
//   --interval    seconds to wait after each scroll step        (default 6)
//   --idle        stop after this many rounds with no new rows  (default 4)
//   --max-rounds  hard cap on rounds                            (default 40)
//   --step        scroll step as a fraction of the viewport     (default 0.8)
//   --match       substring of the target URL to attach to      (default douyin)

const fs = require('fs');

const argv = process.argv.slice(2);
const out = argv[0] || 'harvest.json';
const opt = (name, def) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 ? argv[i + 1] : def;
};

const PORT = opt('port', process.env.CDP_PORT || '9444');
const MATCH = opt('match', 'douyin');
const INTERVAL = Number(opt('interval', 6));
const IDLE = Number(opt('idle', 4));
const MAX_ROUNDS = Number(opt('max-rounds', 40));
const STEP = Number(opt('step', 0.8));

const BASE = `http://127.0.0.1:${PORT}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------------------------------------------------------------- CDP plumbing

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    ws.onopen = () => resolve(ws);
    ws.onerror = (e) => reject(new Error('ws error: ' + (e.message || 'unknown')));
  });
}

let msgId = 0;
function send(ws, method, params = {}, timeoutMs = 180000) {
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

// ------------------------------------------------------- in-page instrumentation

const INIT_EXPR = `(() => {
  window.__dyIds = new WeakMap();
  const LABELS = new Set(['回关','相互关注','已关注','关注','移除','确认移除','取消','互相关注','取消关注']);
  const OPS    = new Set(['移除','确认移除','取消','取消关注']);
  const BADGES = new Set(['直播中','认证徽章','回关']);
  const norm = s => (s || '').replace(/\\s+/g, ' ').trim();

  // Innermost scroll container that actually holds list rows.
  // NOTE: the page has several scrollable divs; picking the one with the
  // smallest scrollHeight is WRONG (it grabs the page-level container).
  // Pick the smallest clientHeight among those containing an avatar <img>.
  function scroller() {
    const marked = document.querySelector('[data-e2e="user-fans-container"]');
    if (marked) return marked;
    const all = [...document.querySelectorAll('div')].filter(e => {
      const s = getComputedStyle(e);
      return /auto|scroll/.test(s.overflowY)
        && e.scrollHeight > e.clientHeight + 20
        && e.querySelector('img[src*="avatar"]');
    });
    return all.sort((a, b) => a.clientHeight - b.clientHeight)[0] || null;
  }

  function rows() {
    const sc = scroller();
    if (!sc) return [];
    const btns = [...sc.querySelectorAll('*')].filter(
      e => e.children.length === 0 && LABELS.has(norm(e.textContent))
    );
    const out = [];
    for (const b of btns) {
      // climb to the smallest ancestor holding exactly ONE avatar = one row
      let p = b.parentElement;
      while (p && p.querySelectorAll('img[src*="avatar"]').length !== 1) p = p.parentElement;
      if (!p) continue;
      if (!window.__dyIds.has(p)) window.__dyIds.set(p, 'r' + (++window.__dyN));
      const img = p.querySelector('img[src*="avatar"]');
      const lines = (p.innerText || '').split('\\n').map(x => x.trim()).filter(Boolean);
      if (!lines.length) continue;
      // skip leading status badges (e.g. 直播中) that overlay the nickname
      let k = 0;
      while (k < lines.length - 1 && BADGES.has(lines[k])) k++;
      const name = lines[k];
      const rel = lines.find(l => LABELS.has(l) && !OPS.has(l)) || '';
      const signature = p.querySelector('.ceyzKypd');
      const sig = signature ? norm(signature.innerText) : lines.slice(k + 1).filter(l => !LABELS.has(l) && !BADGES.has(l) && !/^\\d+\\+?个作品未看$/.test(l)).join(' ');
      const link = p.querySelector('a[href*="/user/"]');
      out.push({ id: window.__dyIds.get(p), name, sig, rel, avatar: img.src, url: link ? link.href : '' });
    }
    return out;
  }

  window.__dyN = 0;
  window.__dy = { scroller, rows };
  return 'installed';
})()`;

const STEP_EXPR = `(() => {
  if (!window.__dy) return JSON.stringify({ error: 'not installed' });
  const sc = window.__dy.scroller();
  const before = sc ? Math.round(sc.scrollTop) : 0;
  if (sc) {
    const step = Math.max(240, Math.round(sc.clientHeight * ${STEP}));
    sc.scrollTop = Math.min(sc.scrollTop + step, sc.scrollHeight);
    // real scroll event is what triggers the lazy loader
    sc.dispatchEvent(new Event('scroll', { bubbles: true }));
  }
  const rows = window.__dy.rows();
  return JSON.stringify({
    atBottom: sc ? (sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 4) : true,
    scrollTop: sc ? Math.round(sc.scrollTop) : 0,
    scrollHeight: sc ? sc.scrollHeight : 0,
    clientHeight: sc ? sc.clientHeight : 0,
    renderedAvatars: sc ? sc.querySelectorAll('img[src*="avatar"]').length : 0,
    moved: sc ? Math.round(sc.scrollTop) !== before : false,
    rows,
    footer: document.querySelector('[data-e2e="user-fans-footer"]')?.innerText || '',
  });
})()`;

const NUDGE_EXPR = `(() => {
  const sc = window.__dy && window.__dy.scroller();
  if (!sc) return 'no-scroller';
  sc.scrollTop = Math.max(0, sc.scrollTop - Math.round(sc.clientHeight * 0.6));
  sc.dispatchEvent(new Event('scroll', { bubbles: true }));
  sc.scrollTop = sc.scrollHeight;
  sc.dispatchEvent(new Event('scroll', { bubbles: true }));
  return 'nudged';
})()`;

// ------------------------------------------------------------------------ main

(async () => {
  const targets = await (await fetch(`${BASE}/json/list`)).json();
  const pages = targets.filter(t => t.type === 'page' && !t.url.startsWith('chrome-extension://'));
  const target = pages.find(t => t.url.includes(MATCH)) || pages[0];
  if (!target) { console.error('no page target on port ' + PORT); process.exit(1); }
  console.log('target: ' + target.url);

  const ws = await connect(target.webSocketDebuggerUrl);
  const evalIn = async (expr) => {
    const r = await send(ws, 'Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true, userGesture: true });
    if (r.exceptionDetails) throw new Error('page exception: ' + JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails));
    return r.result.value;
  };

  console.log('init: ' + await evalIn(INIT_EXPR));

  const map = new Map();
  let idle = 0;
  let last = null;

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const snap = JSON.parse(await evalIn(STEP_EXPR));
    if (snap.error) { console.error(snap.error); break; }

    let added = 0;
    for (const r of snap.rows) { if (!map.has(r.id)) added++; map.set(r.id, r); }

    idle = added === 0 ? idle + 1 : 0;
    last = snap;
    console.log(
      `round ${String(round).padStart(2)} | +${String(added).padStart(3)} | total ${String(map.size).padStart(3)}` +
      ` | st=${snap.scrollTop}/${snap.scrollHeight} ch=${snap.clientHeight}` +
      ` | rendered=${snap.renderedAvatars} | bottom=${snap.atBottom} | idle=${idle}`
    );

    if (snap.atBottom && idle >= IDLE) break;

    await sleep(INTERVAL * 1000);

    // At the bottom the loader needs a different trigger: wobble the scroll
    // position to force it to fetch the next page.
    if (snap.atBottom) { await evalIn(NUDGE_EXPR); await sleep(INTERVAL * 1000); }
  }

  const rows = [...map.values()];
  const result = {
    capturedAt: new Date().toISOString(),
    complete: Boolean(last && last.atBottom && idle >= IDLE),
    footer: last ? last.footer : '',
    count: rows.length,
    scrollTop: last ? last.scrollTop : 0,
    scrollHeight: last ? last.scrollHeight : 0,
    clientHeight: last ? last.clientHeight : 0,
    renderedAvatars: last ? last.renderedAvatars : 0,
    rows,
  };
  fs.writeFileSync(out, JSON.stringify(result, null, 1), 'utf8');
  ws.close();

  const rel = {};
  for (const r of rows) rel[r.rel || '(空)'] = (rel[r.rel || '(空)'] || 0) + 1;
  console.log(`\ncount=${rows.length} id_unique=${new Set(rows.map(r => r.id)).size} rel=${JSON.stringify(rel)}`);
  console.log(`rows_in_dom=${result.renderedAvatars}`);
  console.log('written -> ' + out);
  if (rows.length < result.renderedAvatars) {
    console.warn('WARN: fewer rows extracted than avatars rendered — re-run after a pause to collect the rest.');
  }
})().catch(e => { console.error('ERROR: ' + e.message); process.exit(1); });

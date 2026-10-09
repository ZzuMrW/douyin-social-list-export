// Single-snapshot collector — run with: node cdp.js evalfile collect-list.js
// Reads whatever rows are currently in the DOM (the list is NOT virtualized,
// so once loading has finished this returns everything). Prints JSON.
// Use harvest.js instead when the list still needs scrolling to finish loading.
(() => {
  const norm = s => (s || '').replace(/\s+/g, ' ').trim();
  const LABELS = new Set(['回关', '相互关注', '已关注', '关注', '移除', '确认移除', '取消', '互相关注', '取消关注']);
  const OPS = new Set(['移除', '确认移除', '取消', '取消关注']);
  const BADGES = new Set(['直播中', '认证徽章', '回关']);

  // Innermost scroll container that holds list rows:
  // must contain an avatar <img>, then take the smallest clientHeight.
  const scs = [...document.querySelectorAll('div')].filter(e => {
    const s = getComputedStyle(e);
    return /auto|scroll/.test(s.overflowY) && e.scrollHeight > e.clientHeight + 20;
  });
  let sc = document.querySelector('[data-e2e="user-fans-container"]');
  for (const e of scs) {
    if (document.querySelector('[data-e2e="user-fans-container"]')) break;
    if (!e.querySelector('img[src*="avatar"]')) continue;
    if (!sc || e.clientHeight < sc.clientHeight) sc = e;
  }
  if (!sc) return JSON.stringify({ error: 'no scroller', rows: [] });

  // only buttons INSIDE the modal list
  const btns = [...sc.querySelectorAll('*')].filter(
    e => e.children.length === 0 && LABELS.has(norm(e.textContent))
  );

  const seen = new Map(); // row element -> row data (dedupe by element identity)
  for (const b of btns) {
    // climb to the smallest ancestor holding exactly ONE avatar = the row
    let p = b.parentElement;
    while (p && p.querySelectorAll('img[src*="avatar"]').length !== 1) p = p.parentElement;
    if (!p || seen.has(p)) continue;
    const img = p.querySelector('img[src*="avatar"]');
    const lines = (p.innerText || '').split('\n').map(x => x.trim()).filter(Boolean);
    if (!lines.length) continue;
    // skip leading status badges (e.g. 直播中) that overlay the nickname
    let k = 0;
    while (k < lines.length - 1 && BADGES.has(lines[k])) k++;
    const name = lines[k];
    const rel = lines.find(l => LABELS.has(l) && !OPS.has(l)) || '';
    const signature = p.querySelector('.ceyzKypd');
    const sig = signature ? norm(signature.innerText) : lines.slice(k + 1).filter(l => !LABELS.has(l) && !BADGES.has(l) && !/^\d+\+?个作品未看$/.test(l)).join(' ');
    const link = p.querySelector('a[href*="/user/"]');
    seen.set(p, { name, sig, rel, avatar: img.src, url: link ? link.href : '' });
  }

  const rows = [...seen.values()];
  return JSON.stringify({
    capturedAt: new Date().toISOString(),
    footer: document.querySelector('[data-e2e="user-fans-footer"]')?.innerText || '',
    count: rows.length,
    scrollTop: Math.round(sc.scrollTop),
    scrollHeight: sc.scrollHeight,
    clientHeight: sc.clientHeight,
    renderedAvatars: sc.querySelectorAll('img[src*="avatar"]').length,
    rows,
  });
})()

#!/usr/bin/env node
// Build the two deliverables from harvested JSON:
//   1) <name>.csv  — UTF-8 **with BOM** + CRLF, opens cleanly in Excel
//   2) <name>.html — single self-contained file, avatars inlined as data URIs
//                    (works offline), with a search box and relation filters
//
// Usage:
//   node build-export.js --in following_raw.json \
//        --csv 抖音关注列表.csv --html 抖音关注列表.html \
//        --title "抖音关注列表" --account "示例用户" --douyin-id "example_id" \
//        --total 100 --facet-label "关注"
//
// Options:
//   --in            input JSON from harvest.js / collect-list.js   (required)
//   --csv           output csv path          (default: <title>.csv)
//   --html          output html path         (default: <title>.html)
//   --title         headline text            (default: 抖音列表)
//   --account       account nickname shown in the header
//   --douyin-id     douyin id shown in the header
//   --total         count shown on the platform profile page
//                   (used to explain any shortfall automatically)
//   --facet-label   关注 / 粉丝  — only used in wording
//   --no-inline     skip downloading avatars, keep remote URLs

const fs = require('fs');

const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf('--' + name);
  return i >= 0 ? argv[i + 1] : def;
};
const flag = name => argv.includes('--' + name);

const input = opt('in', null);
if (!input) { console.error('missing --in <json>'); process.exit(1); }

const title = opt('title', '抖音列表');
const account = opt('account', '');
const douyinId = opt('douyin-id', '');
const total = opt('total', null);
const facetLabel = opt('facet-label', '关注');
const CSV = opt('csv', title + '.csv');
const HTML = opt('html', title + '.html');

const raw = JSON.parse(fs.readFileSync(input, 'utf8'));
const rows = (raw.rows || []).filter(r => r.name);

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function csvCell(v) {
  const s = (v == null ? '' : String(v));
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// ------------------------------------------------------------------ avatars

async function inlineAvatars(list) {
  let ok = 0;
  await Promise.all(list.map(async (r) => {
    if (!r.avatar) return;
    try {
      const res = await fetch(r.avatar, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (!res.ok) return;
      const buf = Buffer.from(await res.arrayBuffer());
      const type = res.headers.get('content-type') || 'image/jpeg';
      r.avatarInline = `data:${type};base64,${buf.toString('base64')}`;
      ok++;
    } catch { /* fall back to the remote url */ }
  }));
  return ok;
}

// --------------------------------------------------------------------- main

(async () => {
  let inlined = 0;
  if (!flag('no-inline')) {
    process.stdout.write('downloading avatars... ');
    inlined = await inlineAvatars(rows);
    console.log(inlined + '/' + rows.length);
  }

  // ---- CSV
  const head = ['序号', '昵称', '关系', '个性签名', '头像链接'];
  const lines = [head.join(',')];
  rows.forEach((r, i) => {
    lines.push([i + 1, r.name, r.rel, r.sig, r.avatar].map(csvCell).join(','));
  });
  // BOM so Excel detects UTF-8; CRLF for Windows
  fs.writeFileSync(CSV, '\uFEFF' + lines.join('\r\n') + '\r\n', 'utf8');

  // ---- HTML
  const rels = [...new Set(rows.map(r => r.rel).filter(Boolean))];
  const counts = {};
  rows.forEach(r => { counts[r.rel] = (counts[r.rel] || 0) + 1; });

  const stats = [];
  if (total) stats.push(`<div class="stat"><b>${esc(total)}</b><span>主页显示${esc(facetLabel)}数</span></div>`);
  stats.push(`<div class="stat"><b>${rows.length}</b><span>已获取</span></div>`);
  rels.forEach(rel => stats.push(`<div class="stat"><b>${counts[rel]}</b><span>${esc(rel)}</span></div>`));

  const chips = [`<span class="chip on" data-f="__all">全部</span>`]
    .concat(rels.map(rel => `<span class="chip" data-f="${esc(rel)}">${esc(rel)}</span>`))
    .join('');

  const cards = rows.map((r, i) => `
    <div class="row" data-rel="${esc(r.rel)}">
      <div class="idx">${i + 1}</div>
      <img class="av" src="${esc(r.avatarInline || r.avatar)}" alt="" loading="lazy"
           onerror="this.style.visibility='hidden'">
      <div class="meta">
        <div class="name">${esc(r.name)}</div>
        <div class="sig">${r.sig ? esc(r.sig) : '<span class="empty">（无个签）</span>'}</div>
      </div>
      <div class="rel">${r.rel ? `<span class="badge">${esc(r.rel)}</span>` : ''}</div>
    </div>`).join('');

  const meta = [account && '账号：' + esc(account), douyinId && '抖音号：' + esc(douyinId),
    '抓取时间：' + new Date().toLocaleString('zh-CN')].filter(Boolean).join('　·　');

  let shortfall = '';
  if (total && Number(total) > rows.length) {
    shortfall = `主页显示 ${esc(total)} 人，本次获取 ${rows.length} 人；差额通常来自抖音侧限制（例如「剩余用户来自抖音火山版，请前往对应 APP 查看」）。<br>`;
  }

  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
  :root{ --ink:#0f172a; --sub:#5b6b82; --line:#e6eaf2; --bg:#f5f7fb; --card:#fff; }
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--ink);
       font-family:"PingFang SC","Microsoft YaHei",-apple-system,"Segoe UI",Roboto,sans-serif}
  .wrap{max-width:880px;margin:0 auto;padding:32px 20px 60px}
  .head{background:linear-gradient(135deg,#0f172a,#334155);color:#fff;border-radius:18px;padding:26px 28px;
        box-shadow:0 10px 30px rgba(15,23,42,.18)}
  .head h1{margin:0 0 6px;font-size:22px;letter-spacing:.5px}
  .head p{margin:0;color:#c7d0dd;font-size:13px}
  .stats{display:flex;gap:30px;margin-top:18px;flex-wrap:wrap}
  .stat b{display:block;font-size:22px;font-weight:700}
  .stat span{font-size:12px;color:#aab6c6}
  .toolbar{display:flex;align-items:center;justify-content:space-between;margin:22px 4px 10px;gap:12px;flex-wrap:wrap}
  .toolbar h2{font-size:15px;margin:0;font-weight:600}
  .tools{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  input[type=search]{border:1px solid var(--line);background:#fff;border-radius:10px;padding:8px 12px;font-size:13px;
        width:220px;outline:none;color:var(--ink)}
  input[type=search]:focus{border-color:#94a3b8;box-shadow:0 0 0 3px rgba(148,163,184,.18)}
  .chip{border:1px solid var(--line);background:#fff;border-radius:999px;padding:6px 14px;font-size:12.5px;
        cursor:pointer;color:#475569;user-select:none}
  .chip.on{background:#0f172a;color:#fff;border-color:#0f172a}
  .list{background:var(--card);border:1px solid var(--line);border-radius:16px;overflow:hidden;
        box-shadow:0 6px 18px rgba(15,23,42,.05)}
  .row{display:flex;align-items:center;gap:14px;padding:13px 18px;border-bottom:1px solid var(--line)}
  .row:last-child{border-bottom:none}
  .row:hover{background:#fafbfe}
  .idx{width:30px;text-align:right;color:#9aa7b8;font-size:12px;font-variant-numeric:tabular-nums}
  .av{width:44px;height:44px;border-radius:50%;object-fit:cover;background:#eef1f6;flex:none}
  .meta{flex:1;min-width:0}
  .name{font-size:15px;font-weight:600;margin-bottom:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .sig{font-size:12.5px;color:var(--sub);line-height:1.5;
       display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
  .empty{color:#b6c0cd}
  .rel{flex:none}
  .badge{display:inline-block;padding:3px 10px;border-radius:999px;font-size:12px;white-space:nowrap;
         background:#eef2f7;color:#475569}
  .note{margin-top:16px;font-size:12.5px;color:var(--sub);line-height:1.8;background:#fff;
        border:1px dashed var(--line);border-radius:12px;padding:14px 16px}
  @media (max-width:520px){ .stats{gap:18px} input[type=search]{width:100%} .row{padding:11px 14px;gap:10px} }
</style>
</head>
<body>
<div class="wrap">
  <div class="head">
    <h1>${esc(title)}</h1>
    <p>${meta}</p>
    <div class="stats">${stats.join('')}</div>
  </div>

  <div class="toolbar">
    <h2 id="title">全部（${rows.length} 人）</h2>
    <div class="tools">
      ${chips}
      <input id="q" type="search" placeholder="搜索昵称或签名…">
    </div>
  </div>

  <div class="list" id="list">${cards}
  </div>

  <div class="note">
    ${shortfall}列表按抖音网页版「综合排序」原序导出，共 ${rows.length} 人。<br>
    头像与昵称均来自抖音公开页面；头像已内嵌，离线也能正常显示。
  </div>
</div>

<script>
  const q = document.getElementById('q');
  const rows = [...document.querySelectorAll('#list .row')];
  const titleEl = document.getElementById('title');
  let filter = '__all';

  function apply() {
    const k = q.value.trim().toLowerCase();
    let shown = 0;
    rows.forEach(r => {
      const okRel = filter === '__all' || r.dataset.rel === filter;
      const okTxt = !k || r.innerText.toLowerCase().includes(k);
      const vis = okRel && okTxt;
      r.style.display = vis ? '' : 'none';
      if (vis) shown++;
    });
    titleEl.textContent = (filter === '__all' ? '全部' : filter) + '（' + shown + ' 人）';
  }

  q.addEventListener('input', apply);
  document.querySelectorAll('.chip').forEach(c => c.addEventListener('click', () => {
    document.querySelectorAll('.chip').forEach(x => x.classList.remove('on'));
    c.classList.add('on');
    filter = c.dataset.f;
    apply();
  }));
</script>
</body>
</html>
`;

  fs.writeFileSync(HTML, html, 'utf8');

  console.log('rows=' + rows.length);
  console.log('inlined=' + inlined);
  console.log('csv=' + CSV);
  console.log('html=' + HTML);
})().catch(e => { console.error('ERROR: ' + e.message); process.exit(1); });

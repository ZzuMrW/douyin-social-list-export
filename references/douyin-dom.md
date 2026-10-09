# 抖音网页版 DOM 结构与选择器参考

采集时若页面改版导致选择器失效，用这里的探测方法重新定位。

## 关键页面

| 页面 | URL |
|---|---|
| 首页 | `https://www.douyin.com` |
| 自己主页 | `https://www.douyin.com/user/self` |
| 他人主页 | `https://www.douyin.com/user/<sec_uid>` |

## 选择器

| 元素 | 选择器 | 备注 |
|---|---|---|
| 登录按钮（判断是否已登录） | `[data-e2e="login-button"]` | 存在即未登录 |
| 主页「粉丝」入口 | `[data-e2e="user-info-fans"]` | 点击打开粉丝弹层 |
| 主页「关注」入口 | `[data-e2e="user-info-follow"]` | 点击打开关注弹层 |
| 弹层内列表滚动容器 | `[data-e2e="user-fans-container"]` | 当前粉丝与关注弹层通用；失效才探测滚动容器 |
| 列表底部提示 | `[data-e2e="user-fans-footer"]` | 用于判定加载结束及平台限制 |
| 个性签名节点 | `.ceyzKypd` | 当前实测，类名改版需重新探测；不要混入“作品未看”状态 |
| 列表行 | 含「恰好 1 个 `img[src*="avatar"]`」的最近祖先 | 从关系按钮向上爬得到 |
| 关系按钮文本 | `已关注` / `相互关注` / `回关` | `回关` 出现在粉丝列表 |
| 操作按钮文本 | `移除` / `确认移除` / `取消` / `取消关注` | 不能当作关系 |
| 头像图片 | `img[src*="avatar"]`，CDN 为 `p11.douyinpic.com/aweme/.../aweme-avatar/...` | 无签名可直接下载 |

## 探测方法（选择器失效时用）

列出页面所有 `data-e2e` 标识：

```bash
node cdp.js eval "JSON.stringify([...new Set([...document.querySelectorAll('[data-e2e]')].map(e=>e.getAttribute('data-e2e')))])"
```

列出所有可滚动容器及其特征，判断哪个才是列表：

```bash
node cdp.js eval "(()=>{const sc=[...document.querySelectorAll('div')].filter(e=>{const s=getComputedStyle(e);return /auto|scroll/.test(s.overflowY)&&e.scrollHeight>e.clientHeight+20});return JSON.stringify(sc.map(e=>({cls:(e.className||'').toString().slice(0,45),sh:e.scrollHeight,ch:e.clientHeight,st:Math.round(e.scrollTop),imgs:e.querySelectorAll('img[src*=avatar]').length})))})()"
```

优先使用已确认的 data-e2e 容器（短列表即使无溢出也可采集）。失效时选择规则：**同时满足「含 `img[src*=avatar]`」且「`clientHeight` 最小」**的那个。同一页面实测有 3 个可滚动容器：

- `parent-route-container` —— 页面级，`scrollHeight` 很大，会误选
- 弹层外层
- **弹层内列表 `.aQVXLJB7`** —— 正确目标

## 列表行为特征

- **非虚拟化**：实测加载过的行全部保留在 DOM 中，所以可以「让它加载完 → 一次性读 DOM」；仍需核验当前页面行为。
- **懒加载慢**：`scrollTop` 赋值能触发加载，但延迟达数秒。一次滚动到底拿不全，必须多轮「滚动 → 等待 → 再采」。
- **触底文案**：
  - 粉丝列表：`剩余用户来自抖音火山版，请前往对应 APP 查看`（网页端拿不到这部分用户）
  - 关注列表：`暂时没有更多了`
- **排序**：关注列表是「综合排序」，导出顺序即页面原序，不要自行重排。

## 数据字段

```json
{ "id": "r12", "name": "昵称", "sig": "个性签名", "rel": "已关注", "avatar": "https://p11.douyinpic.com/...", "url": "https://www.douyin.com/user/..." }
```

- `id` 是当前采集器 WeakMap 为行 DOM 元素分配的稳定标识，**去重必须用它或元素本身**，不能按头像 URL 去重。重新初始化时重建映射避免旧 ID 冲突。
- `url` 用于独立核验用户数；虚拟化页面应按这个主页链接累计。
- `rel` 可能为空字符串（极少数行没有关系按钮文案）。
- `name` 可能是「直播中」等角标行被跳过后取到的真实昵称。

## 登录态检查

```bash
node cdp.js eval "JSON.stringify({title:document.title, hasLoginBtn: !!document.querySelector('[data-e2e=\"login-button\"]'), profileText: document.querySelector('[data-e2e=\"user-info\"]')?.innerText, userLinks: [...document.querySelectorAll('a[href*=\"/user/\"]')].slice(0,3).map(a=>a.getAttribute('href'))})"
```

`hasLoginBtn` 为 `false`，结合自己主页账号内容确认登录和采集目标，不读取或输出 cookie。登录态保存在独立 `--user-data-dir` 中，下次启动同一目录可复用（若失效需重新扫码）。

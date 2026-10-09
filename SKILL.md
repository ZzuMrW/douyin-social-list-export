---
name: douyin-social-list-export
description: Export the signed-in user's Douyin follower and following lists on Windows via local Chrome and direct CDP, with automatic dependency setup and CSV/offline HTML exports. Use for personal social-list exports, not commerce or livestream analytics. Automated setup and browser startup currently require the user's "帮我审批" mode.
metadata:
  agent_created: "true"
---

# 抖音粉丝 / 关注列表导出

用独立 Chrome 配置和直接 CDP 脚本读取用户自己有权限看到的列表，导出 UTF-8 BOM CSV 和内嵌头像的离线 HTML。无需另行调用浏览器控制技能，也无需 agent-browser、Playwright、Puppeteer 或 Chromium 下载。

## 环境与审批要求

| 要求 | 检查 / 处理 |
|---|---|
| Windows 10 / 11，有可用桌面 | 登录二维码需要用户本人操作 |
| PowerShell 5.1+ | 使用 PowerShell 执行本技能的 Windows 命令 |
| Node.js 22+，全局 fetch / WebSocket 可用 | 优先复用 PATH 或 Codex 提供的运行时；缺失或版本过低时自动安装 LTS |
| Google Chrome | 检测 PATH、系统和用户安装目录；缺失时自动安装 |
| WinGet | 仅补装软件时必需；没有 WinGet 则报告缺项与官方安装入口 |
| 网络和回环连接 | 访问抖音、头像 CDN、本机调试端口；安装时还需访问软件源 |
| 工作目录可写，调试端口空闲 | 中间产物及独立配置放 work/，交付物放 outputs/ |

**当前仅在“帮我审批”模式下自动完成依赖安装和浏览器启动。**这是本技能当前的使用要求，不是其他模式在所有机器上必然失败的结论。先核对当前聊天的权限控件或会话信息，不自行修改 Codex 设置。

- 使用技能先检查环境；在“帮我审批”模式下直接安装缺失依赖，不重复询问是否安装已授权的必要软件。
- 其他模式先做只读检查，说明需切换到“帮我审批”才能自动安装 / 启动。用户自行启动后，在当前工具允许范围内连接已有 CDP 会话继续采集。
- “帮我审批”仍可能拒绝动作。遇到 `blocked by policy` 或审批拒绝，停止被拒绝动作，说明原始错误和已知原因；不通过换 CMD、改脚本包装或换工具重试同一被拒绝动作。
- 登录扫码、短信和验证码由用户本人完成。安装器若要求许可条款、UAC 或当前工具不能代办的交互，交接这一具体步骤后继续。

[官方 Auto-review 文档](https://learn.chatgpt.com/docs/sandboxing/auto-review)：选择输入框下方的 Approve for me；配置中为 `approvals_reviewer="auto_review"` 配合支持交互的审批策略。`approval_policy="never"` 不等于“帮我审批”。技能不能覆盖组织策略或会话权限。

## 1. 自动检查与补齐依赖

每次使用执行 `scripts/ensure-environment.ps1`。只安装实际缺失的软件；已有合格版本不升级，不安装 npm 包，不启动浏览器。

```powershell
# 在“帮我审批”及当前执行权限允许时：默认自动补齐依赖
& '<skill>/scripts/ensure-environment.ps1'
# 其他模式：先做只读检查
& '<skill>/scripts/ensure-environment.ps1' -CheckOnly
# 可指定 Codex 提供的合格运行时，避免重复安装
& '<skill>/scripts/ensure-environment.ps1' -NodePath '<bundled-node.exe>'
```

补装使用 WinGet `OpenJS.NodeJS.LTS` 和 `Google.Chrome`，不关闭 TLS 验证、执行策略或浏览器沙箱。安装后重新发现真实可执行文件，验证 Node 版本及 API。WinGet 缺失、网络失败、协议未接受或权限拒绝时报告具体阻塞。后续使用返回的 `nodePath` / `chromePath` 完整路径，不假设父进程 PATH 已自动刷新。

## 2. 启动或连接浏览器

默认端口 `9444`，被占用时确认是否已有目标会话；仅普通端口冲突时改用空闲端口。独立配置目录 `<cwd>/work/douyin-profile`，保留既有登录态；要求全新登录时另建目录，不删除旧配置。

Windows 当前实测使用默认 Chrome 沙箱即可；早期 Bash 的进程回收经验不能当作通用要求。不加 `--no-sandbox`、`dangerouslyDisableSandbox` 或长期 sleep 宿主。

```powershell
# 路径来自前置检查结果；配置路径带空格时需要引号
Start-Process -FilePath $chromePath -ArgumentList @('--remote-debugging-port=9444',('--user-data-dir="'+$profilePath+'"'),'--no-first-run','--no-default-browser-check','--new-window','https://www.douyin.com/user/self')
$env:CDP_PORT='9444'
& $nodePath '<skill>/scripts/cdp.js' list
```

浏览器为用户登录的可见窗口。验证回环 `/json/version` 和抖音 page target；不把调试端口暴露到其他网络。只使用当前工具支持且允许的审批参数。自动启动被拒绝则停止该动作，提供可审阅的手动命令。用户完成启动后重新核验连接，后续动作仍遵循当前权限。

## 3. 登录与核验账号

通过 `cdp.js shot <work/登录.png>`、`front` 展示页面；用户本人扫码。结合登录按钮消失、自己主页的昵称 / 抖音号和计数确认登录，不读取或输出 cookie 值。仅没有登录按钮不足以证明登录成功。读取当前账号和计数，不使用文档里的示例账号作为采集目标。

## 4. 采集粉丝和关注

```powershell
& $nodePath '<skill>/scripts/cdp.js' click 'document.querySelector("[data-e2e=\"user-info-fans\"]")'
& $nodePath '<skill>/scripts/harvest.js' '<cwd>/work/followers_raw.json' --port 9444 --match douyin --interval 6 --idle 4 --max-rounds 100
# 关注：打开 user-info-follow，或探测弹层中的 role=tab 后切换“关注”
```

优先 `[data-e2e="user-fans-container"]`，当前粉丝和关注弹层都使用它；失效再用头像和滚动容器探测。详见 [DOM 参考](references/douyin-dom.md)。

- 每轮滚动等待约 6 秒；到底时上下轻移触发下一批。只有触底且连续无新增才能停止，非触底的暂时无新增不算完整。
- 按行 DOM 元素去重，保留主页链接用于核验；不能按头像 URL 去重。
- 跳过直播角标，签名优先读签名节点，排除“2个作品未看”等 UI 状态。
- 关系限 `已关注 / 相互关注 / 互相关注 / 回关 / 关注`，排除 `移除 / 确认移除 / 取消 / 取消关注`。
- 实测页面非虚拟化，但需检查是否改版；虚拟化时按用户主页链接累计，不依赖复用的 DOM 节点。
- 核对 `count`、`renderedAvatars`、主页计数及底部提示。达到轮数上限不等于完整，交付时说明未确认完整。

粉丝底部可能显示“剩余用户来自抖音火山版，请前往对应 APP 查看”，网页无法获取这部分。关注底部通常显示“暂时没有更多了”。旧导出必须标为旧快照，不能冒充新数据。

## 5. 导出和校验

```powershell
& $nodePath '<skill>/scripts/build-export.js' --in '<cwd>/work/following_raw.json' --csv '<cwd>/outputs/抖音关注列表.csv' --html '<cwd>/outputs/抖音关注列表.html' --title '抖音关注列表' --account '<当前昵称>' --douyin-id '<当前抖音号>' --total '<当前主页关注数>' --facet-label '关注'
```

粉丝同样导出 CSV / HTML。验证 CSV BOM `EF BB BF`、中文及行数，HTML 行数、内嵌头像数和搜索 / 关系筛选；下载失败报告实际内嵌数量，不宣称全部离线可用。直接 CDP 打开成品并截图检查布局，关闭自己创建的预览标签。

JSON、截图和登录配置放 work/；最终文件放 outputs/ 并用完整路径链接。保持登录窗口，除非用户要求关闭。不要将抓取数据、配置、cookie 或截图提交到公开仓库。

## 脚本

| 文件 | 用途 |
|---|---|
| `scripts/ensure-environment.ps1` | 环境检查及缺失依赖自动安装；`-CheckOnly` 只读 |
| `scripts/cdp.js` | list / newtab / shot / eval / evalfile / click / front / url；CDP_PORT / CDP_MATCH |
| `scripts/harvest.js` | 滚动、等待、按行去重，触底且稳定才停止 |
| `scripts/collect-list.js` | 已加载列表单次快照 |
| `scripts/build-export.js` | JSON 转 BOM CSV、内嵌头像 HTML |

不代填凭据、不绕过验证码、不逆向接口；保持合理读取间隔，只处理用户已授权的账号页面。

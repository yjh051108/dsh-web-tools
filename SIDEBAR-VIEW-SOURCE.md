# 侧边栏里的浏览器视图：从哪来、怎么被 agent 接上（**只读侦查 · 2026-09-19**）

> 回答 CEO 派的那条：「**"侧边栏有头操控"要求说清"侧边栏里那个视图怎么被 agent 接上"**」
> 作者：`product-director` · **只读**（未改 `desktop/`、未改 `dsh-agent-browser`）

## 一 · 一句话

**侧边栏里那个视图是 `dsh-agent-browser` 插件建的 `<webview>`**；
它建好后**把 `webContentsId` 登记给壳桥** ⇒ 于是 `/targets` 里出现它、**带 `cdpUrl`** ⇒
**agent（包括 `web-tools` 的 `headed` 通道）就读 `/targets` 拿 `cdpUrl` 接上去。**

⇒ ★★ **"有头 = 接上侧边栏里那一个"** —— 不是"另开一个浏览器"。

## 二 · 视图有**两种来源**（这是关键区分）

```
来源 A：侧边栏 tab（`dsh-agent-browser` 插件）
  · 谁建：插件在 `sidebar.right.pane.tab` 座位里 createElement('webview')
  · 分区：`persist:dsh-agent-browser-${identity}`（index.js:1368）
  · 登记：api.register(id, props.instanceId, props.windowId)  ← ★ **三个参数都报**
  · 生命周期：属于**侧边栏那格 pane**（你切走会被 park，见 §四）

来源 B：独立桌面窗口（壳自己）
  · 谁建：`desktop/main.js:567 createBrowserWindow()` ⇒ `browser.html` 里建 webview
  · 分区：`persist:dsh-browser-${instance.id}`（browser.html:99）
  · 登记：`api.register(id)`  ← ⚠️ **只报 1 个参数**（不报 instanceId/windowId）
```

⇒ ★ ★ **两者都会进同一个 `/targets`**（壳桥的 `browserTargets` 是一张表）⇒
**`web-tools` 的 `headed` 通道对两者都成立**（它只挑"有 cdpUrl 且非 pending"的那个）。

## 三 · ★★ 两层身份：`instanceId` + `windowId`（**这就是"能不能区分"的答案**）

`desktop/main.js:516-522` 逐字注释：

```
// 两层身份，缺一不可：
//   instanceId = 哪份 cookie（同一个浏览器的多份登录）
//   windowId   = 哪个窗口（DSH 里一个会话就是一个窗口）
// 只报 cookie 身份的话，宿主分不清"我这个窗口的页面"和"别的窗口的页面"，
// 多窗口同时开着时命令会打到别人那一页上。
```

**`windowId` 的值从哪来**（`dsh-agent-browser/lib/types/client/index.js`）：
```
:645  const paneSession = typeof props.sessionId === 'string' && props.sessionId !== ''
        ? props.sessionId : currentSessionId;
:105  let currentSessionId = '';                     // 框架告诉它这个 panel 属于哪个会话
:229  function announceSession(sessionId) { currentSessionId = sessionId; … }
⇒ :1370  windowId: paneSession                       // ★ 就是**会话 id**
```

⇒ ★★ **即：`windowId` = 那个 pane 所属的 DSH **会话 id** —— 与"一个会话一个窗口"对齐。**
⇒ 而 `web-tools` 的 `headed` **目前只按 `id` 认视图**（不筛 `windowId`）——
   在多窗口同时开着多个视图时，**它挑 generation 最大的那个**（`pickShellTarget` 的排序）。

⚠️ **这是我实现上的一个已知边界**（诚实说明）：
```
现在：`headed` 选"最新登记且有 cdpUrl"的视图 ⇒ **单视图时完全正确**；
      多视图并存时 ⇒ **可能不是"你这个会话"那个**（而 `/targets` 里 `windowId` 是有的 ⇒ **可修**）
```
**★ 可修，且 API 已确认存在**（不是"应该能"）：
```
`dsh-agent-browser` 用的就是它（`lib/types/client/index.js:466-491` 逐字）：
    const sessions = ctx.sessions;
    const list = sessions?.list;
    readSelectedSession = () => list.getSnapshot().current;   // ← ★ 当前会话 id
    list.subscribe(announceSelected);                          // ← ★ 切会话会回调
⇒ 注释 `:182-188` 逐字：「`sessions.list.current` **is the GUI's own answer**
   and works before any browser tab exists」
⇒ ★★ 即：**`ctx.sessions.list.getSnapshot().current` 就是"当前会话"的正式答案**
   （比我在面板 B163 里用的 `ctx.sidebarRight.binding` 更正式；两者可互为佐证）

⇒ 修法：`web-tools` 若也能拿到当前会话 id ⇒ `pickShellTarget` 加上
   `t.windowId === 当前会话id` 的过滤 ⇒ **多视图也能精确挑到"你这个会话"那个**
⚠️ 而 `web-tools` 是**插件（host 侧）**，它的 `ctx` 未必有 `sessions`（那是 client 侧服务）
   ⇒ **要核**（**我没核**，标未获取）—— 可能得让 client 半把会话 id 传下来，或走别的通道
```

## 四 · 视图的"取走/放回"（park）—— 它不会因为切走就消失

```
embed.js:107-123  parkWindow(windowId, entries)   // 切走时把该窗口的页面**停到一边**（仍登记、仍活着）
embed.js:143-154  takeParked(windowId, tabId)     // 切回时**取回**（不重建、登录态在）
embed.js:133      shellBridge()?.unregister(...)  // 只在这时才注销
```
⇒ ★ **一句话**：侧边栏切走 ⇒ 视图被 park（**不销毁、不注销**）⇒ agent 仍能通过 CDP 驱动它。

## 五 · 在**普通浏览器**里开 DSH 会怎样（诚实说明）

`dsh-agent-browser/lib/types/client/embed.js` 头部逐字：
```
· Electron app (DSH desktop shell): a <webview> element exists and renders the page itself.
  This is the good path, and the view is registered with the shell …
· Ordinary browser (a tab at 127.0.0.1:3080): no <webview>, no way to embed a browser engine,
  and third-party pages refuse to be framed. The panel says so instead of pretending,
  and the host-side streaming path remains available as the honest fallback.
```
⇒ ★ **即：在浏览器标签页里开 DSH ⇒ 侧边栏没有 `<webview>` ⇒ 那条路不存在**，
面板**如实说**而不是假装；退路是"宿主侧推流"（`data-mode="stream"`）。
⇒ ★★ **这与 `web-tools` 的 `headed` 判据【一致】**：两者都要求"在桌面壳里"。

## 六 · 端到端：一条命令的两端

```
① 视图出现：侧边栏「浏览器」tab（`dsh-agent-browser` 的 `kind: 'agent-browser'`，title `浏览器`）
② 它登记  ：webview 的 `dom-ready` ⇒ `api.register(webContentsId, instanceId, windowId)`
③ 壳桥记账：`browserTargets.set(id, {contents, generation, instanceId, windowId})`
④ agent 读 ：`GET http://127.0.0.1:3091/targets` ⇒ 拿到 `cdpUrl: ws://127.0.0.1:3092/?targetId=<id>`
⑤ agent 连 ：`web-tools` 的 `headed` ⇒ `connectOnce(cdpUrl)` ⇒ 后续复用同一套 `cdp()`
```

## 七 · 边界

- 本文件**只读**：未改 `desktop/`、未改 `dsh-agent-browser`、未改 `web-tools`。
- `dsh-agent-browser` **不在 OMC 套件内**（它是独立插件）⇒ 若要在它里面加东西，**归属另议**。

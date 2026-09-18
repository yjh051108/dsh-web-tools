# 有头操控（headed channel）· 完整方案

> 面向使用者。一句话：**让 agent 在【你正看着的那个浏览器窗口】里干活** ——
> 它看到的、你看到的、它截图截到的，是**同一个页面**。

---

## 一 · "有头"到底指什么

**指一个【在 Electron 壳里、你能看见的浏览器窗口】里的页面。**

```
            ┌──────────────────────────────────────────┐
            │  DSH 桌面壳（DSH-Desktop / electron）      │
            │                                          │
 你看见 ──▶ │   ┌────────────────────────────────┐     │
            │   │  │ 浏览器视图（webview）        │     │  ◀── agent 通过 CDP 驱动**同一个**
            │   │  │  ← headed 通道连的是这里     │     │      页面：它导航、它截图
            │   │  └────────────────────────────────┘     │
            │   │  （侧边栏 / 独立浏览器窗口）            │
            └──────────────────────────────────────────┘
```

★ **它不是"另一种 headless"** —— 它是**同一份页面、两个操作者**：
你可以用鼠标点它，agent 可以同时用 CDP 驱动它。**你能接管，它能接手。**

---

## 二 · ⚠️ 它只在什么时候可用（**先读这条**）

```
★ 必须在【由桌面壳启动的 dsh 进程】里。
  判据：环境变量 `DSH_SHELL_BRIDGE_URL` 存在（壳在 main.js:131 注入）。

  · 桌面壳里                ⇒ ✅ 有头可用
  · 你单独跑 `dsh web`      ⇒ ❌ 有头不可用（该变量为空）
  · 你在别的机器/容器里跑    ⇒ ❌ 有头不可用
```

⚠️ **不可用时它会【明确报错】，不会偷偷退回无头** ——
因为"偷偷退回"会让你以为**截图就是你看到的那个页面**（而其实不是）。
要无头请**显式**传 `channel: "headless"`。

---

## 三 · 两条通道的区别（★ 用户最关心的在第三列）

| | **headless**（默认） | **headed**（有头） |
|---|---|---|
| 跑的是谁 | 本插件**自己 spawn** 的 Chrome（`--headless`） | **壳里那个 views** —— 你在侧边栏/窗口里看到的那个 |
| 你能看见吗 | ❌ 看不见 | ✅ **看得见**（就是同一个窗口） |
| 你能接管吗 | ❌ 不能 | ✅ **能**（鼠标点它即可） |
| **登录态** | ❌ **无**（每次都是干净的新 profile） | ✅ **有** —— 见下面第五节（**实测**） |
| 谁持有页面 | 本插件（独立 `profileDir`，空闲即回收） | **壳**（`<webview>`，随窗口生命周期） |
| 截图能与人互证吗 | ❌ 不能（你看不到它截了什么） | ✅ **能**（你看着它截） |
| 你的界面 cookie 会泄露给它吗 | —（它没有你的 cookie） | ❌ **不会**（分区隔离，见第五节） |
| 并发 | 单例·单页（多会话会抢同一页） | 同样单例·单页 |
| 前置 | 有 Chrome 即可 | ★ **必须在桌面壳里** |

**怎么选**：**要在"你看得见的那个页面"上干活 ⇒ `headed`**；
**要快速、干净、可并发的渲染验证 ⇒ `headless`**（默认）。

---

## 四 · 接线点（实现者看这里）

```js
// 壳 → dsh 进程（desktop/main.js:131）
env.DSH_SHELL_BRIDGE_URL = `http://127.0.0.1:${BRIDGE_PORT}`   // 默认 3091

// 桥的两个端点（desktop/main.js:387-424）
POST {DSH_SHELL_BRIDGE_URL}/open-window    body: { instanceId }   ⇒ 开一个浏览器窗口
GET  {DSH_SHELL_BRIDGE_URL}/targets        ⇒ [{
     id, generation, pending, url, title,
     instanceId,                                   // 这个视图属于哪份 cookie 身份
     windowId,
     cdpUrl: "ws://127.0.0.1:3092/?targetId=<id>"  // ★ 直接喂给 CDP 客户端
   }]

GET  {DSH_SHELL_BRIDGE_URL}/selfcheck      ⇒ { mainWindowStorage, targets[], isolated }
                                            // ★ 断言"视图与主窗口 cookie 分区隔离"
```

**本插件怎么用它**（`src/index.js`）：`headed` 时**不 spawn、不杀进程**，
只把 `connectOnce()` 的入参从"自己那份 `/json/list` 的 `webSocketDebuggerUrl`"
换成**壳给的 `cdpUrl`** —— 后面 `cdp()` / `Page.navigate` / `Page.captureScreenshot` **完全复用**。
⇒ **零新依赖**（依然是 Node 22 内置的全局 `WebSocket`）。

---

## 五 · ★ 登录态：机制已实测（**端到端那半标"未获取"**）

**问题**：有头通道能不能看到"用户在那个浏览器里登录过的状态"？

**实测读数**（只读，未动用户界面）：

```
$ curl http://127.0.0.1:3091/selfcheck
{
  "mainWindowId": 1,
  "mainWindowStorage": "C:\\Users\\…\\Roaming\\deepseek-harness-desktop",
  "targets": [],
  "isolated": true,                 ← ★ 壳自己断言：内嵌视图与主窗口各自独立
  "targetIsNotMainWindow": true
}
```

**机制（读代码得到，可复核）**：
```
· 浏览器视图的 webview 带独立持久分区（desktop/browser.html:99）：
      view.setAttribute('partition', `persist:dsh-browser-${instance.id}`)
· 主窗口没有 partition 声明（main.js:320-329）⇒ 用默认 session
⇒ ★ 结论（三层，别混）：
   ① ★ **有头通道 = 该视图【自己那份 persist 分区】的登录态**
        ⇒ 你在**那个浏览器窗口里**登录某站点 ⇒ `headed` 截图**看得到** ✅
   ② ❌ **不共享 DSH 界面自己的 cookie** —— 这是**安全设计**（`isolated:true`），
        否则"agent 打开的任意网页"就能读到你的 DSH 登录态
   ③ ❌ **不共享 headless 那条通道的 cookie** —— 它用完全独立的 `profileDir`
```

> ⚠️ **诚实边界**：测的时候 `/targets` 是**空的**（壳里没开视图）⇒
> 「**在一个真实视图里登录后、`headed` 确实截到登录态**」这**端到端那一步我没有观测**。
> 机制三层**都读到了**（分区名 / 主窗口无分区 / `isolated:true`），**端到端标【未获取】**。

---

## 六 · 怎么自己验（三步，30 秒）

```
① 在桌面壳里打开一个浏览器视图
     · 侧边栏「浏览器」面板里开（或让 agent 跑一次 `POST /open-window`）
     · 也可看 `web_status` → `channels.headed.ready` 是否为 true

② 在那个视图里【手动登录一个站点】（例如你在用的某个后台）

③ 让 agent 跑：  web_shot { url: "<那个站点的地址>", channel: "headed" }
   ⇒ ★ 看截图里是不是【你已经登录的样子】（头像/用户名在，而不是登录页）
   ⇒ ★ 而你自己看着那个窗口 ⇒ 页面应与截图**一致**
```

**失败时它怎么说**（不会静默回落）：
```
{ ok:false, channel:"headed",
  error:"有头通道不可用：未检测到 DSH_SHELL_BRIDGE_URL ⇒ 你现在不是在【桌面壳】里跑（例如是 `dsh web`）。…" }
```
或
```
{ ok:false, channel:"headed",
  error:"有头通道不可用：壳桥在（http://127.0.0.1:3091）但没有可用视图（/targets 为空）" }
```

---

## 七 · 已知限制（**诚实**）

```
① ★ **壳没起 ⇒ 有头不可用**（而 headless 仍可用）—— 这是最常撞的一条
② ★ **壳里没开视图 ⇒ 有头不可用**（`/targets` 为空）—— 需要先开一个浏览器视图
③ ★ **单例·单页**：多会话/多模型同时用会抢同一页（互相导航、标签被顶掉）；
    两套浏览器（本插件的无头 vs browser-harness 的 Edge）**互不相通**、截图不能互证
④ ★ **有头不 spawn、也不回收**视图 —— 它的生命周期属于**壳的窗口**（你关窗口它就没了）
⑤ ⚠️ **不要在别的机器上指望它**：`DSH_SHELL_BRIDGE_URL` 指向 `127.0.0.1`，只在**同一台机**上有效
```

---

## 八 · 变更

| 版本 | 内容 |
|---|---|
| v0.1.3 | 并发提示（三处齐）· Linux `/proc` 实例匹配 · 纠正"WSL headless Chromium"的错误表述 |
| v0.2.0 | ★ **有头通道**：`web_status` / `web_shot` / `web_dom` 加 `channel: "headless" \| "headed"`（**默认 headless**）· 不可用时**明确报错、不静默回落** |

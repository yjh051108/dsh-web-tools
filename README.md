# @dsh-external/dsh-web-tools

浏览器工具插件（**全局 bundle 装配**）：`web_status` / `web_shot` / `web_dom`。

- **来源**：由预设内化模块 `preset/router-3/browser-tools.mjs`（v3.2.14）原样搬迁，实现零改动。
- **定调变更**（2026-09-08，用户）：浏览器工具**退回插件形态并全局安装**——所有会话、所有预设常驻，
  不再依赖某个预设装配。（前一版定调 2026-08-30 为「内化为预设模块，勿以插件形式注入」，见
  早先归档仓的 `README-已内化.md`，本版推翻。）

## 能力

| 工具 | 作用 |
|---|---|
| `web_status` | 两条通道各自的就绪状态（headless 的 Chrome/端口/profile + **headed 的壳桥/targets**） |
| `web_shot` | 导航 + 等待 + 截图 → PNG 文件（`read_image` 直读）；`channel` 选通道 |
| `web_dom` | 导航 + 回读标题与页面文本（断言回读，替代 dump-dom）；`channel` 选通道 |

## ★ 两条通道（v0.2.0 · `channel: "headless" | "headed"`）

**默认 `headless`**（不传 `channel` ⇒ 行为与 v0.1.x 完全一致）。

| | `headless`（默认） | `headed` |
|---|---|---|
| 跑的是谁 | 本插件**自己 spawn** 的 Chrome（`--headless`） | **electron 壳里那个你能看见的视图** |
| 看得见吗 | ❌ | ✅ 就是同一个窗口 |
| 你能接管吗 | ❌ | ✅ 鼠标直接点它 |
| **登录态** | ❌ 无（干净新 profile） | ✅ **有**（该视图自己的 `persist:dsh-browser-*` 分区） |
| 截图能与人互证吗 | ❌ | ✅ 你看着它截 |
| 前置 | 有 Chrome 即可 | ★ **必须在桌面壳启动的 dsh 里** |

> ★★ **"有头"不是"另一种 headless"** —— 它是**同一份页面、两个操作者**：你能点它，agent 能同时用 CDP 驱动它。
>
> ⚠️ **不可用时它会明确报错，绝不静默回落**（否则你会以为"截图 = 你看到的那个页面"而其实不是）。
> 要无头请**显式**传 `channel:"headless"`。
>
> 📖 **完整方案（含接线点、登录态机制与实测、三步自验、已知限制）见 [`HEADED-CHANNEL.md`](./HEADED-CHANNEL.md)。**

## 实现要点（与预设版一致）

- 复用系统 Chrome（可配置路径），**单实例**；调用后摘页回 `about:blank`（空页零渲染）
- CDP over Node 22 全局 `WebSocket`，**零第三方依赖**（只用 `node:` 内建）
- profile 目录落在 `DSH_HOME` 下，地址 `127.0.0.1`

## 进程释放纪律（v0.1.2，用户定向「千万不要出现多后台忘了清后台防止爆炸内存」）

| 触发 | 行为 |
|---|---|
| 插件卸载/热重载 | `release('unload')`：关 WS → 杀 child → 杀同 profile 残留 |
| 空闲超时 | `idleMs`（默认 **10min**，0=关闭）后自动释放；重建约 1–2s |
| 宿主进程退出 | `process.once('exit')` 同步杀同 profile 残留（防孤儿常驻） |
| 多实例 | `ensureBrowser` 发现同 profile 主进程 >1 → 杀干净单例重建（**不只提醒**） |

> `web_status` 的 `instances` 只数**主进程**（`--type=` 是 Chrome 子进程标志；旧实现把 renderer/gpu 一起数，单实例误报 10 个）。

## 两套浏览器 / 并发提示（v0.1.3）

| | 本插件 `dsh-web-tools` | `browser-harness` 技能 |
|---|---|---|
| 浏览器 | **本机 Windows 上的 Chrome**（`chromePath` 默认 `C:\Program Files\Google\Chrome\Application\chrome.exe`），**headless** | 用户机器上的 Windows Edge，**可见窗口** |
| 连接 | CDP `127.0.0.1:9339`（插件自己 spawn） | CDP `ws://127.0.0.1:9222` |
| profile | 独立 `profileDir`（默认 `DSH_HOME/.web-shot-profile`） | 用户日常 profile（带登录态） |
| 共享性 | **单例·单页**——一个宿主一个浏览器一个页面 | 单实例·多标签——全机共享标签栏 |

- **同一时刻只让一个 agent 操作浏览器**：本插件单例单页，多会话/多模型并发会互相导航、抢同一页；两套浏览器**不共享 cookie/登录态/标签**，一套的截图不能当作另一套的证据。
- 别用 `browser-harness` 去驱动本插件的 9339 实例（会被本插件的释放纪律回收）；需要真并行时给每个任务配独立浏览器实例/云浏览器。
- 提示落点：三个工具描述（模型每轮可见）+ `web_status` 的 `shared` / `otherBrowsers` / `otherBrowserHint` 字段 + 本文档 + `browser-harness` 技能文档。
- Linux/WSL 实例管理（v0.1.3）：`instances` 计数与「同 profile 残留清理」改走 `/proc` 精确匹配本 profile 主进程（原实现只认 `powershell.exe`，本机 ENOENT → 恒 0/空转）——只碰自己的 chromium，不动用户 Edge。

## 配置（可选，profile 插件 config 覆盖）

```yaml
- id: dsh-web-tools
  name: '@dsh-external/dsh-web-tools'
  config:
    port: 9339
    chromePath: 'C:\Program Files\Google\Chrome\Application\chrome.exe'
    profileDir: 'C:\Users\<you>\.dsh\.web-shot-profile'
    width: 1280
    height: 720
    idleMs: 600000        # 空闲释放毫秒数（0=永不自动释放）
```

## 构建 / 装配 / 冒烟 / 回归

```bash
node scripts/build.mjs                      # src → lib（纯 JS，零编译）
node smoke.mjs                              # 冒烟：fake ctx 捕获 register，真跑三工具
                                            # 非 Windows 需显式给浏览器：node smoke.mjs lib/index.js '{"chromePath":"/usr/bin/chromium"}'
npm test                                    # 契约回归：并发提示 + /proc 实例匹配（不启浏览器）
node test/release.test.mjs                  # 真机回归（Windows）：卸载/空闲/多实例三条释放路径
# 全局装配（注入器环境内）：
dev_install_package D:/dsh/02-web-ui/dsh-web-tools
```

// concurrency-hint.test — 两套浏览器并发提示 + Linux 实例管理（v0.1.3）。
// 用法：node test/concurrency-hint.test.mjs   （不启浏览器，纯契约 + /proc 探测；退出码 0=全过）
// 覆盖：① 三个工具描述都挂并发提示 ② web_status 输出面含 shared/otherBrowsers/otherBrowserHint
//       ③ profileChromePids 只按本 profile 匹配主进程（Linux /proc，不碰别的浏览器）
//       ④ detectOtherBrowser 对死端口返回 running=false（只读探测，不控制）
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import fs from 'node:fs'

// ★★ `ROOT` 必须用 `fileURLToPath`（**不许用 `new URL().pathname`**）
// ```
// 【缺陷（2026-09-19 修）】原写法：`new URL(import.meta.url).pathname`
//   ⇒ ★ `pathname` **【不解码】百分号编码** —— 实证（目录名带 `~` 时）：
//       `import.meta.url    = file:///C:/Users/…/_tilde%7Eprobe/probe.mjs`
//       `new URL().pathname = /C:/Users/…/_tilde%7Eprobe/probe.mjs`   ← **留着 `%7E`** ❌
//       `fileURLToPath      = C:\Users\…\_tilde~probe\probe.mjs`      ← **正确解码** ✅
//   ⇒ ★★ 而 Windows 的 **8.3 短路径名**（如 `C:\Users\<账户前 6 字符>~1`）**含 `~`** ⇒ **那条路径算错 ⇒ ENOENT**
//     ⇒ ⚠️ 即：**只在【短路径名】下崩**（**长用户名下可能碰巧能跑**）——
//       所以"在我这儿能跑"【不构成证据】（`B119` 那族：环境变了，结论就变）
//   ⇒ ★ 判据：**同一个目录里的三个 test 只该有一种写法** ⇒
//     本仓 `test/headed-channel.test.mjs` 早就是对的写法 ⇒ **本文件与 `release.test.mjs` 对齐它** ✅
// ```
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ENTRY = path.join(ROOT, 'lib', 'index.js')
const SRC = fs.readFileSync(path.join(ROOT, 'src', 'index.js'), 'utf8')

const results = []
const T = async (name, fn) => {
  try { const r = await fn(); results.push('PASS ' + name + (r ? ' :: ' + r : '')) }
  catch (e) { results.push('FAIL ' + name + ' :: ' + e.message) }
}

const boot = async (config) => {
  const tools = {}
  const ctx = {
    tools: { register: (t) => { tools[t.name] = t; return t } },
    effect: (fn) => { const d = fn(); return d },
    get: () => undefined, on: () => {}, provide: () => {},
  }
  const mod = await import(pathToFileURL(ENTRY).href + '?t=' + Date.now())
  mod.apply(ctx, { idleMs: 0, ...config })
  return { tools, mod }
}

const SHARED_KEY = '同一时刻只让一个 agent'

await T('① 三个工具描述都挂并发提示（模型每轮可见）', async () => {
  const { tools } = await boot({})
  const names = ['web_status', 'web_shot', 'web_dom']
  const missing = names.filter((n) => !(tools[n] && tools[n].description.includes(SHARED_KEY)))
  if (missing.length) throw new Error('缺提示: ' + missing.join(',') + ' | 实际: ' + names.map((n) => (tools[n] || {}).description).join(' || '))
  const other = names.filter((n) => !tools[n].description.includes('browser-harness'))
  if (other.length) throw new Error('未点名另一套浏览器: ' + other.join(','))
  return '3/3 描述含「' + SHARED_KEY + '」+ 点名 browser-harness'
})

await T('② web_status 输出面含 shared/otherBrowsers/otherBrowserHint', async () => {
  for (const k of ['shared: SHARED_BROWSER_HINT', 'otherBrowsers:', 'otherBrowserHint: OTHER_BROWSER_HINT']) {
    if (!SRC.includes(k)) throw new Error('src 缺字段 ' + k)
  }
  const mod = await boot({})
  for (const k of ['SHARED_BROWSER_HINT', 'OTHER_BROWSER_HINT', 'detectOtherBrowser']) {
    if (!(k in mod.mod)) throw new Error('未导出 ' + k)
  }
  if (!mod.mod.SHARED_BROWSER_HINT.includes(SHARED_KEY)) throw new Error('SHARED_BROWSER_HINT 文案漂移')
  if (!mod.mod.OTHER_BROWSER_HINT.includes('不共享')) throw new Error('OTHER_BROWSER_HINT 未说清不共享')
  return '三字段齐 + 两个常量已导出'
})

await T('③ profileChromePids 只按本 profile 匹配主进程（Linux /proc）', async () => {
  const mod = await boot({})
  const probe = path.join(os.tmpdir(), 'webtools-pidprobe-' + Date.now())
  if (typeof mod.mod.profileChromePids !== 'function') throw new Error('未导出 profileChromePids')
  if (process.platform !== 'linux') {
    const r = mod.mod.profileChromePids(probe)
    if (r !== null) throw new Error('非 Linux 应返回 null 走 powershell 路径，实际 ' + JSON.stringify(r))
    return '非 Linux：返回 null（走 powershell 路径）'
  }
  // 造进程：① 主进程（argv 含 --user-data-dir=<profile>）② 子进程（--type=）
  // ③ 只在命令行里**提到**该路径、没有 --user-data-dir= 标记的进程（宿主/shell/冒烟脚本形态）。
  // 注意 `node -e code --xxx` 会被 node 当自己的选项拒（bad option），必须走脚本文件形态；
  // 脚本路径之后的 --xxx 才是脚本参数。
  const sleeper = path.join(os.tmpdir(), 'webtools-sleeper-' + Date.now() + '.mjs')
  fs.writeFileSync(sleeper, 'setTimeout(() => {}, 60000)\n')
  const main = spawn(process.execPath, [sleeper, '--user-data-dir=' + probe], { stdio: 'ignore' })
  const sub = spawn(process.execPath, [sleeper, '--user-data-dir=' + probe, '--type=renderer'], { stdio: 'ignore' })
  const talker = spawn(process.execPath, [sleeper, 'text-mentions-' + probe], { stdio: 'ignore' })
  try {
    await new Promise((r) => setTimeout(r, 400))
    const pids = mod.mod.profileChromePids(probe, process.execPath)
    if (!pids.includes(main.pid)) throw new Error('未匹配到主进程 pid=' + main.pid + ' pids=' + JSON.stringify(pids))
    if (pids.includes(sub.pid)) throw new Error('--type= 子进程未被过滤 pid=' + sub.pid)
    if (pids.includes(talker.pid)) throw new Error('无 --user-data-dir= 标记的进程被误匹配 pid=' + talker.pid)
    const other = mod.mod.profileChromePids(path.join(os.tmpdir(), 'webtools-nobody-' + Date.now()), process.execPath)
    if (other.length !== 0) throw new Error('无关 profile 误匹配 ' + JSON.stringify(other))
    // 防自杀锁（2026-09-08 冒烟实测事故：smoke 进程被自己 SIGKILL）：宿主/shell/脚本都不是
    // 浏览器可执行文件，即使命令行里带 --user-data-dir= 也必须挡掉。
    const wrongExe = mod.mod.profileChromePids(probe, '/usr/bin/chromium')
    if (wrongExe.length !== 0) throw new Error('可执行文件不符仍被匹配（会误杀宿主/冒烟进程）: ' + JSON.stringify(wrongExe))
    const noExeArg = mod.mod.profileChromePids(probe)
    if (noExeArg.includes(main.pid)) throw new Error('无 chromePath 兜底未挡住非 chrome 进程 pid=' + main.pid)
    return '主进程命中 / 子进程过滤 / 无标记不匹配 / 无关 profile 空 / 可执行文件不符不匹配（pids=' + JSON.stringify(pids) + '）'
  } finally {
    for (const p of [main, sub, talker]) { try { p.kill('SIGKILL') } catch { } }
    try { fs.rmSync(sleeper, { force: true }) } catch { }
  }
})

await T('④ detectOtherBrowser 死端口 → running=false（只读探测）', async () => {
  const mod = await boot({})
  const dead = await mod.mod.detectOtherBrowser('http://127.0.0.1:9', 800)
  if (dead.running !== false) throw new Error('死端口应为 false，实际 ' + JSON.stringify(dead))
  if (dead.url !== 'http://127.0.0.1:9') throw new Error('url 未回传')
  const live = await mod.mod.detectOtherBrowser()
  if (typeof live.running !== 'boolean') throw new Error('缺 running 字段 ' + JSON.stringify(live))
  return '死端口 false；默认端点 running=' + live.running + (live.browser ? ' browser=' + live.browser : '')
})

console.log(results.join('\n'))
const failed = results.filter((x) => x.startsWith('FAIL'))
console.log(failed.length ? 'CONCURRENCY-HINT-TEST-FAIL=' + failed.length : 'CONCURRENCY-HINT-TEST-OK')
process.exit(failed.length ? 1 : 0)

// release.test — 浏览器进程释放纪律真机回归（v0.1.2）。
// 用法：node test/release.test.mjs   （需要系统 Chrome）
// 退出码三态（与 check-all 一致）：**0 = 全过 · 1 = 有失败 · 2 = 未获取（无 Chrome ⇒ 显式 SKIP）**
// 覆盖：① 卸载清 ② 空闲超时自动释放 ③ 多实例自动回收 + 重建单例
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'

// ★★ `ROOT` 必须用 `fileURLToPath`（**不许用 `new URL().pathname`**）
// ```
// 【缺陷（2026-09-19 修）】原写法漏了百分号解码 ⇒ 而 Windows 的 8.3 短路径名（`<账户前 6 字符>~1`）
//   含 `~`（URL 里编码成 `%7E`）⇒ 路径算错 ⇒ `ENOENT`。
//   ⇒ ★ 实证与判据见 `test/concurrency-hint.test.mjs` 同一处的长注释 ✅
//   ⇒ ★★ 判据：**三个 test 只该有一种写法**（`fileURLToPath`）—— 本仓 `headed-channel` 早就是对的 ✅
// ```
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ENTRY = path.join(ROOT, 'lib', 'index.js')
const PROFILE = path.join(os.tmpdir(), 'webtools-release-test-profile')

/* ══════════════════════════════════════════════════════════════════════════
 * ★★ 前置探测：这个判据需要【真浏览器】⇒ 没有就**显式 SKIP + exit 2**。
 *
 * 为什么要有这段（2026-09-19）：
 *   本文件的三条判据都要**真 Chrome**（启动 / 空闲释放 / 多实例回收）。
 *   而没有 Chrome 时，旧行为是：每条都抛错 ⇒ 收成 `FAIL …` ⇒ `RELEASE-TEST-FAIL=3` + `exit 1`。
 *   ⇒ ⚠️ **那不是假绿**（它确实报错）—— 但**"报错"与"报未获取"语义不同**：
 *     · `exit 1`（FAIL）= **"它坏了"** ⇒ 人去查代码
 *     · `exit 2`（未获取）= **"这条判据没跑成"** ⇒ 而**必须显式说出原因**，否则下一个人会以为跑过了
 *   ⇒ 所以这里与 `check-all` 的三态对齐：**0 = 过 · 1 = 失败 · 2 = 未获取** ✅
 *
 * ⚠️ **探测方式**：读 `src/index.js` 里那个**真实的 `chromePath`**（硬编码默认值）⇒ `existsSync`。
 *   **不要用"缩 PATH"那种探法** —— 实测无效（那个路径是硬编码的，PATH 变了也不影响它）。
 *   ⇒ 判据：**"我造了环境"要能指出"那个变量在哪一行被读"** ✅
 * ══════════════════════════════════════════════════════════════════════════ */
const CHROME_PATH = (() => {
  // ⚠️ 读**本测试真正加载的那个文件**（`ENTRY` = `lib/index.js`）优先；
  //    源码形态（只有 `src/`、未 build）时退回 `src/index.js`。
  for (const rel of ['lib/index.js', 'src/index.js']) {
    try {
      const src = fs.readFileSync(path.join(ROOT, rel), 'utf8')
      const m = src.match(/chromePath:\s*'((?:[^'\\]|\\.)*)'/)
      if (m) return m[1].replace(/\\\\/g, '\\').replace(/\\'/g, "'")
    } catch { /* 试下一个 */ }
  }
  return ''
})()
const CHROME_EXISTS = CHROME_PATH !== '' && fs.existsSync(CHROME_PATH)
// ★ 兜底开关（供 CI 显式模拟；**判据②用的是"真造环境"**，见下）
const FORCED_NO_CHROME = process.env.WEBTOOLS_NO_CHROME === '1'
if (FORCED_NO_CHROME || CHROME_EXISTS === false) {
  console.log('SKIP: 无系统 Chrome ⇒ 未获取（本判据要真浏览器）')
  console.log('  探测的路径（来自本测试加载的那个文件的 chromePath）= ' + (CHROME_PATH || '(未取到)'))
  console.log('  existsSync = ' + (CHROME_PATH ? fs.existsSync(CHROME_PATH) : 'n/a')
    + (FORCED_NO_CHROME ? '（★ 本次由 WEBTOOLS_NO_CHROME=1 强制模拟）' : ''))
  console.log('  ⇒ 三条判据（启动 / 空闲释放 / 多实例回收）都需要真 Chrome；')
  console.log('     本条**没有跑**，不是"通过"，也不是"失败" ⇒ 退出码 2 = 未获取。')
  process.exit(2)
}

const chromeCount = () => {
  try {
    // 只数主进程；过滤在 JS 里做（PowerShell 传参吞 `-notmatch '--type='`，实测空输出）
    const r = spawnSync('powershell.exe', ['-NoProfile', '-Command',
      `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Select-Object -ExpandProperty CommandLine`],
      { encoding: 'utf8', timeout: 15000 })
    const lines = String(r.stdout || '').split(/\r?\n/).filter(Boolean)
    return lines.filter((l) => l.includes(PROFILE) && !l.includes('--type=')).length
  } catch { return -1 }
}
const waitFor = async (fn, ms = 8000, step = 300) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, step)) }
  return fn()
}
const results = []
const T = async (name, fn) => {
  try { const r = await fn(); results.push('PASS ' + name + (r ? ' :: ' + r : '')) }
  catch (e) { results.push('FAIL ' + name + ' :: ' + e.message) }
}

const boot = async (config) => {
  const tools = {}
  const cleanups = []
  const ctx = {
    tools: { register: (t) => { tools[t.name] = t; return t } },
    effect: (fn) => { const d = fn(); if (typeof d === 'function') cleanups.push(d); return d },
    get: () => undefined, on: () => {}, provide: () => {},
  }
  const mod = await import(pathToFileURL(ENTRY).href + '?t=' + Date.now())
  mod.apply(ctx, { profileDir: PROFILE, idleMs: 0, ...config })
  return { tools, cleanup: () => { for (const c of cleanups.reverse()) { try { c() } catch { } } } }
}

// 清理可能的历史残留
spawnSync('powershell.exe', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -match '${PROFILE.replace(/\\/g, '\\\\')}' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`], { stdio: 'ignore', timeout: 15000 })

let A = null
await T('启动一次浏览器（web_status）', async () => {
  A = await boot({ idleMs: 0 })
  const r = await A.tools.web_status.execute({})
  if (!r.ok) throw new Error(JSON.stringify(r))
  const n = chromeCount()
  if (n < 1) throw new Error('chrome 未起来 count=' + n)
  return 'chrome=' + r.chrome + ' instances=' + n
})

await T('① 卸载清：cleanup 后同 profile chrome 归 0', async () => {
  A.cleanup()
  const n = await waitFor(() => (chromeCount() === 0 ? 1 : 0), 8000)
  if (n !== 1) throw new Error('残留 count=' + chromeCount())
  return 'count=0'
})

await T('② 空闲超时自动释放（idleMs=1500）', async () => {
  const B = await boot({ idleMs: 1500 })
  const r = await B.tools.web_status.execute({})
  if (!r.ok) throw new Error(JSON.stringify(r))
  if (chromeCount() < 1) throw new Error('chrome 未起来')
  const ok = await waitFor(() => (chromeCount() === 0 ? 1 : 0), 9000)
  if (!ok) throw new Error('空闲未释放 count=' + chromeCount())
  B.cleanup()
  return 'idle 释放后 count=0'
})

await T('③ 多实例回收 + 重建单例', async () => {
  const C = await boot({ idleMs: 0 })
  await C.tools.web_status.execute({})
  // 人为再起一个同 profile 的 chrome（模拟泄漏的旧例）
  const { spawn } = await import('node:child_process')
  const extra = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    ['--headless', '--no-sandbox', '--remote-debugging-port=0', '--user-data-dir=' + PROFILE + '-extra', 'about:blank'],
    { stdio: 'ignore' })
  await new Promise((r) => setTimeout(r, 1500))
  const before = chromeCount()
  const r = await C.tools.web_status.execute({})
  if (!r.ok) throw new Error(JSON.stringify(r))
  const after = r.instances
  try { extra.kill() } catch { }
  spawnSync('powershell.exe', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -match '${(PROFILE + '-extra').replace(/\\/g, '\\\\')}' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`], { stdio: 'ignore', timeout: 15000 })
  if (after !== 1) throw new Error('多实例未回收：before=' + before + ' after=' + after)
  C.cleanup()
  return 'before=' + before + ' → after=1（单例）'
})

// 收尾
spawnSync('powershell.exe', ['-NoProfile', '-Command', `Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -match '${PROFILE.replace(/\\/g, '\\\\')}' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }`], { stdio: 'ignore', timeout: 15000 })
try { fs.rmSync(PROFILE, { recursive: true, force: true }) } catch { }
try { fs.rmSync(PROFILE + '-extra', { recursive: true, force: true }) } catch { }

console.log(results.join('\n'))
const failed = results.filter((x) => x.startsWith('FAIL'))
console.log(failed.length ? 'RELEASE-TEST-FAIL=' + failed.length : 'RELEASE-TEST-OK')
process.exit(failed.length ? 1 : 0)

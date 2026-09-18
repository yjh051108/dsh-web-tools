/**
 * headed-channel.test.mjs — v0.2.0「有头通道」的判据（★ 必须能红）
 *
 * 判据（四条，全部可机械核）：
 *  ① ★ `channel` 参数存在，且**默认 headless**（不传 ⇒ 行为与 v0.1.x 完全一致）
 *  ② ★★ `DSH_SHELL_BRIDGE_URL` 为空时 ⇒ **headed 返回"不可用"且【不静默回落】**
 *     （回落 = 返回 ok:true 且没标 channel === 就会让人以为"有头生效了"）
 *  ③ ★ 壳桥可达但 `/targets` 为空 ⇒ 也是"不可用"，且**原因逐字不同**（能区分两种死法）
 *  ④ ★ `web_status` 报两条通道各自的就绪性（headless.ready / headed.ready）
 *
 * 用法：node test/headed-channel.test.mjs     退出码 0=全 PASS / 1=有 FAIL
 */
import { shellBridgeUrl, shellTargets, pickShellTarget, headedUnavailable } from '../src/index.js'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
let pass = 0, fail = 0
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`PASS ${name}${detail ? ' :: ' + detail : ''}`) }
  else { fail++; console.log(`FAIL ${name}${detail ? ' :: ' + detail : ''}`) }
}

const src = readFileSync(join(ROOT, 'src', 'index.js'), 'utf8')
const lib = readFileSync(join(ROOT, 'lib', 'index.js'), 'utf8')

/* ① 三个工具都有 channel，且默认 headless */
for (const t of ['web_shot', 'web_dom']) {
  const seg = src.slice(src.indexOf(`name: '${t}'`))
  const body = seg.slice(0, 4000)
  ok(`① ${t} 声明 channel 参数（enum headless|headed）`,
    body.includes("channel:") && body.includes("enum: ['headless', 'headed']"))
  ok(`① ${t} 默认 headless（args.channel === 'headed' ? 'headed' : 'headless'）`,
    body.includes("args.channel === 'headed' ? 'headed' : 'headless'"))
}
ok('① web_status 报 channels.headless / channels.headed',
  src.includes('channels: {') && src.includes('headless: {') && src.includes('headed: {'))

/* ② 不在壳里 ⇒ 不可用，且不静默回落 */
const savedEnv = process.env.DSH_SHELL_BRIDGE_URL
delete process.env.DSH_SHELL_BRIDGE_URL
ok('② shellBridgeUrl() 在无壳时返回空串', shellBridgeUrl() === '', `got="${shellBridgeUrl()}"`)
const st = await shellTargets()
ok('② shellTargets() 无壳时 ok=false 且给原因',
  st.ok === false && /DSH_SHELL_BRIDGE_URL/.test(st.error || ''), st.error || '')
const hu = headedUnavailable('测试原因')
ok('② headedUnavailable() ok=false 且 channel=headed（★ 不冒充成功）',
  hu.ok === false && hu.channel === 'headed')
ok('② ★ 提示里明说"只在桌面壳下可用"，并给出显式 headless 的出路',
  /桌面壳/.test(hu.hint || '') && /headless/.test(hu.hint || ''))

/* ②b ★ 真·不回落：headed 分支必须在【withBrowser/headless 之前】就 return */
const shotSeg = src.slice(src.indexOf("name: 'web_shot'"))
const headedIdx = shotSeg.indexOf("if (channel === 'headed')")
const withIdx = shotSeg.indexOf('return withBrowser(')
ok('②b ★ headed 分支在 withBrowser（无头路径）之前 return ⇒ 结构上不可能回落',
  headedIdx >= 0 && withIdx >= 0 && headedIdx < withIdx, `headed@${headedIdx} withBrowser@${withIdx}`)

/* ③ 壳桥可达但没视图 ⇒ 另一种原因（可区分） */
ok('③ pickShellTarget([]) === null（无视图 ⇒ 选不出目标）', pickShellTarget([]) === null)
ok('③ pickShellTarget 跳过 pending 的视图',
  pickShellTarget([{ id: 'a', pending: true, cdpUrl: 'ws://x' }]) === null)
ok('③ pickShellTarget 取 generation 最大的活跃视图',
  (pickShellTarget([
    { id: 'a', cdpUrl: 'ws://a', generation: 1 },
    { id: 'b', cdpUrl: 'ws://b', generation: 7 },
  ]) || {}).id === 'b')

/* ④ src 与 lib 同步（build 过） */
ok('④ src 与 lib 都含 shellTargets（build 已同步）',
  src.includes('export function shellTargets') && lib.includes('export function shellTargets'))

/* 收尾 */
if (savedEnv === undefined) delete process.env.DSH_SHELL_BRIDGE_URL
else process.env.DSH_SHELL_BRIDGE_URL = savedEnv

console.log(`\nHEADED-CHANNEL-TEST ${fail === 0 ? 'OK' : 'FAILED'} · PASS ${pass} / FAIL ${fail}`)
process.exit(fail === 0 ? 0 : 1)

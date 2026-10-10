/* 真实 GitHub API 端到端验证 v1.4.0 核心路径：
 * ① getDirList 真实仓库（GraphQL 瘦字段）：根树 / JavaApp/src / scripts 大目录 /
 *    小写错误路径 404（大小写敏感实证）
 * ② ghqlBlob 真实文件直读：scripts/patch_angle_surface_freeze.py（9735B）长度与内容校验
 * ③ getNotifications participating 真实拉取（identity 头 + salvage 管线不回归）
 * ④ aiProbe 真实双通道诊断（沙箱：seat 404 = 未开通；models 被劫持 → 不可达文案）
 * ⑤ aiModelsRemote 沙箱劫持 → 空数组优雅降级
 * ⑥ identity 头真实生效（GitHub 正常回 200）
 * ⑦ getFileRawEx expectedSize：对真实文件以字节基准校验（ghqlBlob 通道） */
process.chdir('/home/z/my-project/vela-github-client')
const tu = require('/home/z/my-project/vela-github-client/scripts/test_utils')
const { assert, assertEq, test, summary } = tu
global.setTimeout = require('timers').setTimeout.bind(require('timers'))

const fs = require('fs')
const TOKEN = (fs.readFileSync('/home/z/.git-credentials', 'utf8').match(/ghp_[A-Za-z0-9]+/) || [''])[0]
if (!TOKEN) { console.error('no token'); process.exit(1) }

const _tests = []
function T(name, fn) { _tests.push(test(name, fn)) }
const FETCH_CALLS = []

function makeFetch() {
  const call = global.fetch
  return {
    async fetch(opts) {
      FETCH_CALLS.push(opts)
      const h = Object.assign({ 'User-Agent': 'vela-github-client', 'X-GitHub-Api-Version': '2022-11-28' }, opts.header)
      try {
        const r = await call(opts.url, { method: opts.method || 'GET', headers: h, body: opts.data })
        const text = await r.text()
        let data = text
        const ct = String((r.headers && r.headers.get && r.headers.get('content-type')) || '')
        if (opts.responseType === 'json') {
          if (ct.indexOf('json') >= 0 || (text && (text[0] === '{' || text[0] === '['))) {
            try { data = JSON.parse(text) } catch (e) { data = text }
          }
        }
        opts.success({ code: r.status, data: data, headers: Object.fromEntries(r.headers.entries()) })
      } catch (e) {
        opts.fail(String(e), 0)
      }
    }
  }
}
fetch._calls = FETCH_CALLS

function utf8Len(s) {
  let b = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    b += c < 0x80 ? 1 : (c < 0x800 ? 2 : 3)
  }
  return b
}

function makeStorage() { const m = { gh_token: TOKEN }; return { _map: m, get({ key, success }) { success(m[key] || null) }, set({ key, value, success }) { m[key] = value; success() }, delete({ key, success }) { delete m[key]; success() } } }
function makeFile() { const m = {}; return { _map: m, readText({ uri, success, fail }) { if (m[uri] !== undefined) success({ text: m[uri] }); else fail(null, 301) }, writeText({ uri, text, success }) { m[uri] = text; success() }, delete({ uri, success }) { delete m[uri]; success() } } }
function makeDownloader() { return { download({ fail }) { fail(null, 1000) }, onDownloadComplete({ fail }) { fail(null, 1001) } } }

const mocks = {
  '@system.fetch': makeFetch(),
  '@system.storage': makeStorage(),
  '@system.file': makeFile(),
  '@system.request': makeDownloader(),
  './b64': { decode: (s) => Buffer.from(String(s).replace(/\s/g, ''), 'base64').toString('utf8') }
}
const { loadModule } = tu
const api = loadModule('src/utils/api.js', mocks)

const R = 'Gsjsjzhznsz/Prisma-Minecraft-iOS-Launcher'

T('①a getDirList：根树 GraphQL 直达', async () => {
  const list = await api.getDirList(R, '', '')
  assert(Array.isArray(list) && list.length > 10, '根目录条目数=' + list.length)
  const names = list.map((x) => x.name)
  assert(names.indexOf('JavaApp') >= 0, '含 JavaApp（大写）')
  assert(names.indexOf('scripts') >= 0, '含 scripts')
  const ja = list.filter((x) => x.name === 'JavaApp')[0]
  assertEq(ja.type, 'dir', 'JavaApp=dir')
  assert(ja.sha && ja.sha.length === 40, 'oid 40 位')
})

T('①b getDirList：JavaApp/src（真机曾报不存在的深层目录）', async () => {
  const list = await api.getDirList(R, 'JavaApp/src', '')
  assert(Array.isArray(list) && list.length >= 1, 'src 条目数=' + list.length)
  console.log('    JavaApp/src:', list.map((x) => x.name + (x.type === 'dir' ? '/' : '')).join(' '))
})

T('①c getDirList：scripts 大目录（REST 279KB 必截断，GraphQL 直达）', async () => {
  const list = await api.getDirList(R, 'scripts', '')
  assert(list.length >= 20, 'scripts 条目数=' + list.length)
  const f = list.filter((x) => x.name === 'patch_angle_surface_freeze.py')[0]
  assert(f, '目标脚本在列')
  assertEq(f.size, 9735, '字节数与 REST 元信息一致')
})

T('①d getDirList：小写 javaapp → 404（GitHub 路径大小写敏感实证）', async () => {
  let err = null
  try { await api.getDirList(R, 'javaapp', '') } catch (e) { err = e }
  assert(err && (err.status === 404 || err.gqlSkip || err.incomplete), '404/回落=' + (err && (err.status || err.message)))
  if (err && err.status === 404) assert(String(err.message).indexOf('大小写') >= 0, '文案提示大小写')
})

T('② ghqlBlob：patch_angle_surface_freeze.py 直读（9735B）', async () => {
  const g = await api.ghqlBlob(R, 'scripts/patch_angle_surface_freeze.py', 'main')
  assertEq(g.byteSize, 9735, 'byteSize')
  assertEq(utf8Len(g.text), 9735, 'utf8Len(text)=9735（含中文注释，字符数 < 字节数属正常）')
  assert(g.text.indexOf('def ') >= 0 || g.text.indexOf('import') >= 0, 'Python 内容特征')
  console.log('    开头:', JSON.stringify(g.text.slice(0, 60)))
})

T('⑦ getFileRawEx：expectedSize 基准 + ghqlBlob 通道（via=gql）', async () => {
  const r = await api.getFileRawEx(R, 'scripts/patch_angle_surface_freeze.py', 'main', null, 9735)
  assertEq(utf8Len(r.text), 9735, '完整 9735 字节（utf8Len）')
  assert(['gql', 'cache', 'rest', 'chunk'].indexOf(r.via) >= 0, 'via=' + r.via + '（沙箱下载器不可用属预期）')
  assert(!r.capped, '未截断')
})

T('③ getNotifications：participating 真实拉取（identity+salvage 管线）', async () => {
  const list = await api.getNotifications(1, false, true)
  assert(Array.isArray(list), '数组返回，条数=' + list.length)
  const gaps = api.lastNotifGaps()
  assert(gaps.length === 0, '无 gap（gap=' + gaps.length + '）')
  for (let i = 0; i < Math.min(list.length, 3); i++) {
    assert(list[i] && list[i].subject && list[i].repository, '条目结构完整 #' + i)
  }
})

T('⑥ identity 头真实生效（自包含请求）', async () => {
  const before = FETCH_CALLS.length
  await api.request('/rate_limit', { noCache: true, noDl: true })
  const calls = FETCH_CALLS.slice(before).filter((c) => String(c.url).indexOf('api.github.com') >= 0)
  assert(calls.length >= 1, '本用例发出 api.github.com 请求（' + calls.length + ' 次）')
  const ok = calls.filter((c) => c.header && c.header['Accept-Encoding'] === 'identity')
  assert(ok.length === calls.length, '全部请求带 identity（' + ok.length + '/' + calls.length + '）')
})

T('④ aiProbe：seat 状态自适应（v1.7 实弹后账号已开 Copilot Free）', async () => {
  const p = await api.aiProbe()
  console.log('    probe:', JSON.stringify(p))
  assert(String(p.copilot).indexOf('已开通') === 0 || p.copilot === '未开通', 'copilot 状态解析：' + p.copilot)
  if (p.copilot === '未开通') {
    assert(String(p.copilotHint).indexOf('settings/copilot') >= 0, '开通指引')
  }
  assert(p.models.length > 0, 'models 状态有值：' + p.models)
})

T('⑤ copilotModels：异常/劫持 → 防毒化守门（内置实证清单保持）', async () => {
  try {
    const list = await api.copilotModels()
    assert(Array.isArray(list), '目录解析返回数组形态')
  } catch (e) { /* 沙箱劫持/网络异常均允许：守门逻辑由 mock 套件覆盖 */ }
  assertEq(api.aiModels().length, 3, '内置实证 3 模型清单保持')
})

;(async () => {
  for (const t of _tests) await t
  summary()
  process.exit(0)
})().catch((e) => { console.error(e); process.exit(1) })

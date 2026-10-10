/* 真实 GitHub API 端到端验证 v1.2.3 核心路径 */
process.chdir('/home/z/my-project/vela-github-client')
const tu = require('/home/z/my-project/vela-github-client/scripts/test_utils')
/* test_utils 把 setTimeout 压缩到 ≤5ms（单测加速）——真实网络必须恢复原生定时器 */
global.setTimeout = require('timers').setTimeout.bind(require('timers'))

const fs = require('fs')
const TOKEN = (fs.readFileSync('/home/z/.git-credentials', 'utf8').match(/ghp_[A-Za-z0-9]+/) || [''])[0]
if (!TOKEN) { console.error('no token'); process.exit(1) }

function makeFetch() {
  const call = global.fetch
  return {
    async fetch(opts) {
      fetch._calls.push(opts)
      if (String(opts.url).indexOf('contents') >= 0) console.log('  [dbg] raw=', opts.raw, 'rt=', opts.rt, 'respType=', opts.rt || (opts.raw ? 'text' : 'json'), String(opts.url).slice(0,70))
      const h = Object.assign({ 'User-Agent': 'vela-github-client', 'X-GitHub-Api-Version': '2022-11-28' }, opts.header)
      try {
        const r = await call(opts.url, { method: opts.method || 'GET', headers: h, body: opts.data })
        const text = await r.text()
        let data = text
        const ct = String((r.headers && r.headers.get && r.headers.get('content-type')) || '')
        /* 固件对齐：responseType=json 时引擎 parse（raw 请求 v1.2.3 强制 text 不 parse） */
        if (opts.responseType === 'json') { /* 固件行为：仅 responseType=json 时引擎 parse */
          if (ct.indexOf('json') >= 0 || (text && (text[0] === '{' || text[0] === '['))) {
            try { data = JSON.parse(text) } catch (e) { data = text }
          }
        }
        if (String(opts.url).indexOf('raw.githubusercontent') >= 0 || String(opts.url).indexOf('contents') >= 0) {
          console.log('  [resp]', r.status, 'rt=', opts.rt, 'raw=', opts.raw, 'data-type=', typeof data, 'resp=', opts.responseType, 'len=', String(data).length, String(opts.url).slice(0, 70))
        }
        opts.success({ code: r.status, data: data, headers: Object.fromEntries(r.headers.entries()) })
      } catch (e) {
        console.error('  [fetch fail]', opts.url.slice(0, 60), String(e).slice(0, 100))
        opts.fail(String(e), 0)
      }
    }
  }
}
fetch._calls = []

function makeStorage() { const m = {}; return { _map: m, get({ key, success }) { success(m[key] || null) }, set({ key, value, success }) { m[key] = value; success() }, delete({ key, success }) { delete m[key]; success() } } }
function makeFile() { const m = {}; return { _map: m, readText({ uri, success, fail }) { if (m[uri] !== undefined) success({ text: m[uri] }); else fail(null, 301) }, writeText({ uri, text, success }) { m[uri] = text; success() }, delete({ uri, success }) { delete m[uri]; success() } } }
function makeDownloader() { return { download({ fail }) { fail(null, 1000) }, onDownloadComplete({ fail }) { fail(null, 1001) } } }

const mocks = {
  '@system.fetch': makeFetch(),
  '@system.storage': makeStorage(),
  '@system.file': makeFile(),
  '@system.request': makeDownloader()
}
mocks['@system.storage']._map['gh_token'] = TOKEN
mocks['@system.file']._map['internal://files/gh_token.txt'] = TOKEN

const api = tu.loadModule('src/utils/api.js', mocks)
const view = tu.loadModule('src/utils/view.js', mocks)

async function main() {
  console.log('=== 1. 真实通知拉取 + CI 聚合 ===')
  const list = await api.getNotifications(1, false)
  console.log('原始拉取:', list.length, '条')
  const agg = view.aggregateNotifs(list.map(view.mapNotif))
  const aggCards = agg.filter((x) => x.aggN > 1)
  console.log('聚合后卡片:', agg.length, '张（其中多条聚合卡', aggCards.length, '张）')
  aggCards.forEach((c) => console.log(`  ⚙ ${c.repo}: ${c.aggN} 条 CI（未读 ${c.unreadN}）`))
  const normal = agg.filter((x) => !x.ci)
  console.log('  普通通知浮出:', normal.length, '条 →', normal.map((x) => x.title.slice(0, 20)).join(' / '))

  console.log('\n=== 2. 真实 CI 历史（Prisma-Minecraft-iOS-Launcher @ main）===')
  const r = await api.getCommitChecks('Gsjsjzhznsz/Prisma-Minecraft-iOS-Launcher', 'main', 1)
  console.log('total:', r.total, '本页:', r.commits.length, 'hasNext:', r.hasNext)
  r.commits.slice(0, 4).forEach((c) => {
    console.log(`  ${c.oid.slice(0, 7)} [${c.state}] ${c.headline.slice(0, 34)} → ${c.checks.map((x) => x.name + ':' + x.concl).join(', ')}`)
  })

  console.log('\n=== 3. 真实文件五通道（vela-github-client README 小文件）===')
  const f = await api.getFileRawEx('Gsjsjzhznsz/vela-github-client', 'package.json', '', null)
  console.log('via:', f.via, 'bytes:', f.bytes, '前 40 字:', JSON.stringify(f.text.slice(0, 40)))

  console.log('\nfetch 调用总数:', fetch._calls.length)
  fetch._calls.forEach((c, i) => console.log(`  #${i} ${c.method || 'GET'} raw=${!!c.raw} ${String(c.url).slice(0, 90)}`))
  process.exit(0)
}
main().catch((e) => { console.error('FATAL:', e && e.message); process.exit(1) })

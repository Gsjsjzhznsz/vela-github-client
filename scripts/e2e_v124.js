/* 真实 GitHub API 端到端验证 v1.2.4 核心路径：
 * ① CI 历史默认分支（defaultBranchRef 根修，BandQQ 真数据）
 * ② 真实通知拉取（gap 机制 + 计数对齐）
 * ③ hl.js 对真实源码文件全量分词（性能 + 无损） */
process.chdir('/home/z/my-project/vela-github-client')
const tu = require('/home/z/my-project/vela-github-client/scripts/test_utils')
global.setTimeout = require('timers').setTimeout.bind(require('timers'))

const fs = require('fs')
const TOKEN = (fs.readFileSync('/home/z/.git-credentials', 'utf8').match(/ghp_[A-Za-z0-9]+/) || [''])[0]
if (!TOKEN) { console.error('no token'); process.exit(1) }

function makeFetch() {
  const call = global.fetch
  return {
    async fetch(opts) {
      fetch._calls.push(opts)
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
const hl = tu.loadModule('src/utils/hl.js', mocks)

async function main() {
  console.log('=== 1. CI 历史：默认分支 defaultBranchRef（BandQQ，修复前必报「分支不存在」）===')
  const t0 = Date.now()
  const r = await api.getCommitChecks('Gsjsjzhznsz/BandQQ', '', 1)
  console.log('耗时', Date.now() - t0, 'ms total:', r.total, '本页:', r.commits.length, 'hasNext:', r.hasNext)
  r.commits.slice(0, 3).forEach((c) => {
    console.log(`  ${c.oid.slice(0, 7)} [${c.state}] ${c.headline.slice(0, 30)} → ${c.checks.map((x) => x.name + ':' + x.concl).join(', ')}`)
  })

  console.log('\n=== 2. 真实通知（gap 透传 + 计数）===')
  const list = await api.getNotifications(1, false)
  const gaps = api.lastNotifGaps()
  console.log('拉取:', list.length, '条, gaps:', JSON.stringify(gaps))
  const agg = view.aggregateNotifs(list.map(view.mapNotif))
  const realUnread = agg.reduce((s, it) => s + (it.unread ? (it.aggN > 1 ? (it.unreadN || 0) : 1) : 0), 0)
  console.log('聚合卡:', agg.length, '张；真实未读计数（标题应显示）:', realUnread)
  agg.slice(0, 5).forEach((c) => console.log(`  ${c.ci ? '⚙' : '·'} ${c.repo} — ${c.aggN > 1 ? c.aggN + ' 条 CI（未读 ' + c.unreadN + '）' : c.title.slice(0, 24)}`))

  console.log('\n=== 3. hl.js 真实源码全量分词（api.js 58KB）===')
  const src = fs.readFileSync('src/utils/api.js', 'utf8').replace(/\r/g, '')
  const lines = src.split('\n')
  const st = hl.buildBlockState(lines, 'clike')
  let tokens = 0
  const t1 = Date.now()
  for (let i = 0; i < lines.length; i++) {
    const s = lines[i].length > 160 ? lines[i].slice(0, 160) + '…' : lines[i]
    tokens += hl.tokenizeLine(s, st[i].lg, st[i].inb).length
  }
  const ms = Date.now() - t1
  console.log('行数:', lines.length, 'tokens:', tokens, '全量分词耗时:', ms, 'ms（真机每页 18 行约', Math.max(1, Math.round(ms / lines.length * 18)), 'ms）')
  /* 无损抽查：前 3 行 token 拼接 == 原行 */
  for (let i = 0; i < 3; i++) {
    const s = lines[i].length > 160 ? lines[i].slice(0, 160) + '…' : lines[i]
    const back = hl.tokenizeLine(s, st[i].lg, st[i].inb).map((t) => t.s).join('')
    console.log('  无损行', i + 1, back === s ? 'OK' : 'MISMATCH: ' + JSON.stringify(back.slice(0, 60)))
  }
  /* code.ux 场景抽查：hl.js 自身（md 围栏）与 package.json（json） */
  const md = fs.readFileSync('README.md', 'utf8').replace(/\r/g, '').split('\n')
  const mst = hl.buildBlockState(md, 'md')
  const fenceRows = mst.filter((x) => x.lg !== 'md' && x.lg !== 'plain').length
  console.log('README 围栏内代码行（按声明语言分词）:', fenceRows)
  const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
  const pkgToks = hl.tokenizeLine('"version": "1.2.4",', 'json', false)
  console.log('package.json 行分词:', pkgToks.map((t) => t.s + ':' + t.c).join(' | '), '（version 应为 key）')

  console.log('\nfetch 调用总数:', fetch._calls.length)
  process.exit(0)
}
main().catch((e) => { console.error('FATAL:', e && (e.stack || e.message)); process.exit(1) })

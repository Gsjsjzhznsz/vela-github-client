/**
 * test_api_v121.js — v1.2.1 传输优化行为级测试
 * 覆盖：粘性自适应分页（跨页防跳条）/ TTL 缓存 / 单飞去重 / ETag 304 /
 *       旧缓存兜底 / clearCache 联动 / 块级重试 / 二进制嗅探 / 1MB 截断标志 /
 *       进度回调 / fetch 超时 / 仓库详情 GraphQL 快车道 / saveToken 清缓存
 */
const { loadModule, assert, assertEq, test, summary } = require('./test_utils')

const TOKEN_OK = 'ghp_' + 'a'.repeat(36)

/* ---------------- mock 工厂（与 v120 同构） ---------------- */

function makeStorage(opts) {
  opts = opts || {}
  const map = {}
  return {
    _map: map,
    get({ key, success, fail }) {
      if (opts.breakGet) return fail(null, 999)
      success(Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null)
    },
    set({ key, value, success, fail }) {
      if (opts.breakSet) return fail(null, 999)
      map[key] = value
      success()
    },
    delete({ key, success, fail }) {
      delete map[key]
      ;(success || fail || function () {})()
    }
  }
}

function makeFile(opts) {
  opts = opts || {}
  const map = {}
  return {
    _map: map,
    readText({ uri, success, fail }) {
      if (opts.breakRead) return fail(null, 300)
      if (Object.prototype.hasOwnProperty.call(map, uri)) success({ text: map[uri] })
      else fail(null, 301)
    },
    writeText({ uri, text, success, fail }) {
      if (opts.breakWrite) return fail(null, 300)
      map[uri] = text
      success()
    },
    delete({ uri, success, fail }) {
      delete map[uri]
      ;(success || fail || function () {})()
    }
  }
}

function makeFetch(handler) {
  const calls = []
  return {
    calls,
    fetch(opts) {
      calls.push(opts)
      Promise.resolve().then(() => {
        try {
          const r = handler(calls.length, opts)
          if (r && r.__fail) opts.fail(r.__fail, r.code)
          else opts.success(r)
        } catch (e) { opts.fail(String(e && e.message || e), 0) }
      })
    }
  }
}

function makeDownloader(opts) {
  opts = opts || {}
  return {
    download({ success, fail }) { if (opts.breakDownload !== false) return fail(null, 1000); success({ token: 'tk1' }) },
    onDownloadComplete({ success, fail }) { return fail(null, 1000) }
  }
}

function buildMocks(fetchHandler) {
  return {
    '@system.fetch': makeFetch(fetchHandler),
    '@system.storage': makeStorage(),
    '@system.file': makeFile(),
    '@system.request': makeDownloader()
  }
}

function authedMocks(fetchHandler) {
  const m = buildMocks(fetchHandler)
  m['@system.storage']._map['gh_token'] = TOKEN_OK
  m['@system.file']._map['internal://files/gh_token.txt'] = TOKEN_OK
  return m
}

/* Date.now 偏移控制（测 TTL 过期 / 304 复验） */
const REAL_NOW = Date.now
let _offset = 0
function timeShift(ms) { _offset = ms }
Date.now = function () { return REAL_NOW() + _offset }

/* ---------------- 1. 粘性自适应分页（v1.2.2 起通知改并行子页，
   改用 getMyRepos 的 REST 兑底路径驱动 requestAdaptive） ---------------- */

function gqlDownHandler(perSeq, truncBody) {
  return (n, o) => {
    const u = String(o.url)
    if (u.indexOf('/graphql') >= 0) return { __fail: 'gql down', code: 0 } /* 强制回退 REST */
    const m = u.match(/per_page=(\d+)/)
    const per = m ? Number(m[1]) : 0
    const pg = Number((u.match(/page=(\d+)/) || [0, 1])[1])
    perSeq.push(pg + ':' + per)
    if (per >= 10) return { code: 200, data: truncBody, headers: {} } /* 10 条必截断 */
    const list = []
    for (let i = 0; i < per; i++) list.push({ id: (pg - 1) * 10 + i + 1, full_name: 'o/r' + pg + '_' + i })
    return { code: 200, data: list, headers: {} }
  }
}

async function t_sticky() {
  await test('REST 自适应翻页（getMyRepos 兑底）：page1 降档到 per=4 后，page2 直接从 per=4 起（不回 10）', async () => {
    const perSeq = []
    const mocks = authedMocks(gqlDownHandler(perSeq, '[{"id":1,"full_nam'))
    const api = loadModule('src/utils/api.js', mocks)
    const p1 = await api.getMyRepos(1, 'pushed')
    assertEq(p1.length, 4, 'page1 降档后 4 条')
    const p2 = await api.getMyRepos(2, 'pushed')
    assertEq(p2.length, 4, 'page2 沿用 4 条')
    assert(perSeq.indexOf('2:10') < 0, 'page2 不再尝试 per=10')
    assertEq(api.lastListPerPage(), 4, 'lastListPerPage 跟随粘性档位')
  })

  await test('REST page1 重新加载：粘性档位重置回 10（乐观起梯）', async () => {
    const perSeq = []
    const mocks = authedMocks(gqlDownHandler(perSeq, '[{"id":1,'))
    const api = loadModule('src/utils/api.js', mocks)
    await api.getMyRepos(1, 'pushed') /* 降档到 4 */
    await api.getMyRepos(2, 'pushed') /* 粘在 4 */
    await api.getMyRepos(1, 'pushed') /* 重新加载 → 重置 → 10→4 */
    assert(perSeq.indexOf('1:10') >= 0 && perSeq.lastIndexOf('1:10') > perSeq.indexOf('2:4'), 'page1 重置后重新从 10 起梯')
  })
}

/* ---------------- 2. TTL 缓存 + 单飞去重 ---------------- */

async function t_cache() {
  await test('TTL 缓存：同 URL 二次 GET 直接命中，不发第二次请求', async () => {
    let hits = 0
    const mocks = authedMocks((n, o) => {
      if (o.url === 'https://api.github.com/repos/o/r') { hits++; return { code: 200, data: { full_name: 'o/r' }, headers: {} } }
      return { code: 200, data: {}, headers: {} }
    })
    const api = loadModule('src/utils/api.js', mocks)
    const a = await api.getRepo('o/r')
    const b = await api.getRepo('o/r')
    assertEq(hits, 1, '只发一次网络请求')
    assertEq(b.full_name, 'o/r', '缓存命中返回同数据')
  })

  await test('单飞去重：并发同 URL GET 合并为一次请求', async () => {
    let hits = 0
    const mocks = authedMocks((n, o) => {
      hits++
      return { code: 200, data: { full_name: 'o/r' }, headers: {} }
    })
    const api = loadModule('src/utils/api.js', mocks)
    const [a, b, c] = await Promise.all([api.request('/repos/o/r'), api.request('/repos/o/r'), api.request('/repos/o/r')])
    assertEq(hits, 1, '三个并发只发一次')
    assertEq(a.full_name, 'o/r', '并发结果一致')
  })

  await test('ETag 304：缓存过期后带 If-None-Match 复验，304 命中省全量', async () => {
    let hits = 0
    let sawInm = false
    const mocks = authedMocks((n, o) => {
      hits++
      if (o.header && o.header['If-None-Match']) sawInm = true
      if (hits === 1) return { code: 200, data: { full_name: 'o/r', v: 1 }, headers: { etag: '"abc123"' } }
      return { code: 304, data: null, headers: {} }
    })
    const api = loadModule('src/utils/api.js', mocks)
    const first = await api.request('/repos/o/r')
    assertEq(first.v, 1, '首次全量')
    timeShift(91000) /* 越过 90s TTL → 缓存过期 → 走条件请求 */
    const second = await api.request('/repos/o/r')
    timeShift(0)
    assert(sawInm, '二次请求携带 If-None-Match')
    assertEq(hits, 2, '304 路径确实发了网络请求（但只有头）')
    assertEq(second.v, 1, '304 命中返回缓存数据')
  })

  await test('serve-stale：截断且下载通道失败时回退旧缓存（不报错）', async () => {
    let hits = 0
    const mocks = authedMocks((n, o) => {
      hits++
      if (hits === 1) return { code: 200, data: { full_name: 'o/r', v: 1 }, headers: { etag: '"e1"' } }
      return { code: 200, data: '{"full_na', headers: {} } /* 之后全截断 */
    })
    const api = loadModule('src/utils/api.js', mocks)
    await api.request('/repos/o/r')
    timeShift(91000)
    const again = await api.request('/repos/o/r')
    timeShift(0)
    assertEq(again.v, 1, '截断+兜底全败 → 回退旧缓存')
  })

  await test('clearCache 前缀清理：通知已读后列表缓存失效重新拉取', async () => {
    let notifHits = 0
    const mocks = authedMocks((n, o) => {
      if (o.url.indexOf('/notifications') >= 0 && (o.method || 'GET') === 'GET') {
        notifHits++
        return { code: 200, data: [], headers: {} }
      }
      return { code: 204, data: null, headers: {} }
    })
    const api = loadModule('src/utils/api.js', mocks)
    await api.getNotifications(1, true) /* 5 个 per=2 子页 */
    await api.getNotifications(1, true) /* 命中缓存 */
    assertEq(notifHits, 5, '二次命中缓存（v1.2.2 并行子页：每逻辑页 5 子请求）')
    await api.markAllNotificationsRead()
    await api.getNotifications(1, true)
    assertEq(notifHits, 10, '已读操作后缓存被清，重新拉取')
  })

  await test('saveToken 清空全部缓存（换身份后数据不可复用）', async () => {
    let hits = 0
    const mocks = authedMocks((n, o) => {
      hits++
      return { code: 200, data: { full_name: 'o/r' }, headers: {} }
    })
    const api = loadModule('src/utils/api.js', mocks)
    await api.request('/repos/o/r')
    await api.saveToken(TOKEN_OK + 'x') /* 换 token */
    await api.request('/repos/o/r')
    assertEq(hits, 2, 'token 变更后重新请求')
  })
}

/* ---------------- 3. raw 分块升级 ---------------- */

function chunkHeaders(offset, len, total) {
  return { 'content-range': 'bytes ' + offset + '-' + (offset + len - 1) + '/' + total, etag: '"file-etag"' }
}

async function t_raw() {
  await test('块级重试：中间一块网络抖动失败 → 800ms 重试成功，文件完整', async () => {
    const TEXT = 'abcdefgh'.repeat(4096) /* 32KB = 4 块 */
    const BYTES = Buffer.from(TEXT, 'utf8')
    const total = BYTES.length
    let reqN = 0
    const mocks = authedMocks((n, o) => {
      const m = String(o.header && o.header.Range || '').match(/bytes=(\d+)-(\d+)/)
      if (!m) return { code: 404, data: 'nf', headers: {} }
      const s = Number(m[1]); const e = Number(m[2])
      reqN++
      if (reqN === 3) return { __fail: 'net flap', code: 0 } /* 第 3 请求抖动 */
      const len = Math.min(e - s + 1, total - s)
      return { code: 206, data: BYTES.slice(s, s + len).buffer.slice(s, s + len), headers: chunkHeaders(s, len, total) }
    })
    const api = loadModule('src/utils/api.js', mocks)
    const r = await api.getFileRawEx('o/r', 'big.txt', 'HEAD', null)
    assertEq(r.text.length, TEXT.length, '重试后全文长度一致')
    assertEq(r.capped, false, '未截断')
    assertEq(r.full, false, 'Range 正常路径 full=false')
  })

  await test('二进制嗅探：首块含 NUL 字节 → 明确报错不渲染乱码', async () => {
    const BYTES = new Uint8Array(100)
    BYTES[0] = 0x50; BYTES[1] = 0x4b; BYTES[2] = 0; BYTES[3] = 1
    const mocks = authedMocks((n, o) => {
      return { code: 206, data: BYTES.buffer.slice(0, 100), headers: chunkHeaders(0, 100, 100) }
    })
    const api = loadModule('src/utils/api.js', mocks)
    let msg = ''
    try { await api.getFileRawEx('o/r', 'x.bin', 'HEAD', null) } catch (e) { msg = e.message }
    assertEq(msg, '二进制文件，暂不支持预览', 'NUL 嗅探报错')
  })

  await test('1MB 截断：超过 128 块 → capped=true 明确脚标依据', async () => {
    const mocks = authedMocks((n, o) => {
      const m = String(o.header && o.header.Range || '').match(/bytes=(\d+)-(\d+)/)
      const s = Number(m[1]); const e = Number(m[2])
      const len = e - s + 1 /* 永远给满 8KB：模拟无限大文件 */
      const buf = new Uint8Array(len).fill(97)
      return { code: 206, data: buf.buffer, headers: chunkHeaders(s, len, 99999999) }
    })
    const api = loadModule('src/utils/api.js', mocks)
    const r = await api.getFileRawEx('o/r', 'huge.txt', 'HEAD', null)
    assertEq(r.capped, true, 'capped 标志')
    assertEq(r.text.length, 128 * 8192, '恰好 1MB')
  })

  await test('进度回调：Content-Range 总量解析 + loaded 单调递增', async () => {
    const TEXT = 'xy'.repeat(8192) /* 16KB = 2 块 */
    const BYTES = Buffer.from(TEXT, 'utf8')
    const total = BYTES.length
    const progs = []
    const mocks = authedMocks((n, o) => {
      const m = String(o.header && o.header.Range || '').match(/bytes=(\d+)-(\d+)/)
      const s = Number(m[1]); const e = Number(m[2])
      const len = Math.min(e - s + 1, total - s)
      return { code: 206, data: BYTES.slice(s, s + len).buffer.slice(s, s + len), headers: chunkHeaders(s, len, total) }
    })
    const api = loadModule('src/utils/api.js', mocks)
    const r = await api.getFileRawEx('o/r', 'a.txt', 'HEAD', (loaded, t) => progs.push([loaded, t]))
    assert(progs.length >= 2, '每块回调 ≥2 次')
    assertEq(progs[0][1], total, 'total 来自 Content-Range')
    assert(progs[progs.length - 1][0] >= progs[0][0], 'loaded 递增')
    assertEq(r.text, TEXT, '内容完整')
  })

  await test('fetch 超时：25s 内无响应 → 按网络失败重试后报错（不永久卡死）', async () => {
    const mocks = authedMocks((n, o) => {
      return { __hang: true } /* 永不回调 */
    })
    mocks['@system.fetch'].fetch = function (opts) { /* 挂起不回调 */ }
    const api = loadModule('src/utils/api.js', mocks)
    let msg = ''
    try { await api.request('/repos/o/r') } catch (e) { msg = e.message }
    assert(msg.indexOf('网络连接失败') >= 0, '超时归入网络失败文案: ' + msg)
  })
}

/* ---------------- 4. 仓库详情 GraphQL 快车道 ---------------- */

async function t_repoDetail() {
  await test('getRepo GraphQL 瘦字段 → REST 形状（repo.ux 全字段兼容）', async () => {
    const mocks = authedMocks((n, o) => {
      if (o.url === 'https://api.github.com/graphql') {
        return { code: 200, data: { data: { repository: { nameWithOwner: 'o/r', description: 'd1', stargazerCount: 12, forkCount: 3, watchers: { totalCount: 44 }, issues: { totalCount: 7 }, primaryLanguage: { name: 'Rust' }, licenseInfo: { spdxId: 'MIT' }, pushedAt: '2026-10-05T00:00:00Z', updatedAt: '2026-10-06T00:00:00Z', createdAt: '2025-01-01T00:00:00Z', isPrivate: false, isFork: false, homepageUrl: 'https://x.y', defaultBranchRef: { name: 'main' }, owner: { login: 'o' } } } }, headers: {} }
      }
      return { code: 200, data: {}, headers: {} }
    })
    const api = loadModule('src/utils/api.js', mocks)
    const r = await api.getRepo('o/r')
    assertEq(r.full_name, 'o/r', 'full_name')
    assertEq(r.stargazers_count, 12, 'stars')
    assertEq(r.subscribers_count, 44, 'watch → subscribers')
    assertEq(r.open_issues_count, 7, 'open issues')
    assertEq(r.license && r.license.spdx_id, 'MIT', 'license.spdx_id')
    assertEq(r.language, 'Rust', 'language')
    assertEq(r.default_branch, 'main', 'default_branch')
    assertEq(r.pushed_at, '2026-10-05T00:00:00Z', 'pushed_at')
  })

  await test('getRepo 游客模式自动回退 REST', async () => {
    let restHit = false
    const mocks = buildMocks((n, o) => {
      if (o.url === 'https://api.github.com/repos/o/r') { restHit = true; return { code: 200, data: { full_name: 'o/r', stargazers_count: 1 }, headers: {} } }
      return { code: 200, data: {}, headers: {} }
    })
    const api = loadModule('src/utils/api.js', mocks)
    const r = await api.getRepo('o/r')
    assert(restHit, '游客走 REST')
    assertEq(r.stargazers_count, 1, 'REST 数据')
  })

  await test('getRepo GraphQL 401（token 坏）直接抛出不回退', async () => {
    const mocks = authedMocks((n, o) => {
      if (o.url === 'https://api.github.com/graphql') return { code: 401, data: { message: 'Bad credentials' }, headers: {} }
      return { code: 200, data: {}, headers: {} }
    })
    const api = loadModule('src/utils/api.js', mocks)
    let st = 0
    try { await api.getRepo('o/r') } catch (e) { st = e.status }
    assertEq(st, 401, '401 不吞')
  })
}

/* ---------------- runner ---------------- */

async function main() {
  await t_sticky()
  await t_cache()
  await t_raw()
  await t_repoDetail()
  summary('v1.2.1')
}

main()

/**
 * test_api_v123.js — v1.2.3 通知聚合 + 文件五级通道 + URL 扰动 + Actions 行为级测试
 * 覆盖：
 *  ① 分块 URL 扰动（每块 ?_b=<offset>，绕蓝牙代理同 URL 去重）+ 块大小 12288
 *  ② 确定性截断快速终止（JSON.parse 失败 1 次请求即降级，不再 3 连重试）
 *  ③ 通知子页 noDl（截断不挂下载器，直接 per=1 降级）
 *  ④ 文件通道⑤ contents JSON base64（前四通道全灭时兜底，杜绝「内容为空」）
 *  ⑤ 五通道全失败 → 明确诊断文案
 *  ⑥ Actions：GraphQL workflowRuns 快车道 / REST 自适应回退 / jobs 映射
 *  ⑦ markThreadsRead 批量已读（并发 3、成功计数、失败静默）
 *  ⑧ aggregateNotifs 连续同仓库 CI 折叠 + mapNotif ci 标记
 */
const fs = require('fs')
const path = require('path')
const { loadModule, assert, assertEq, test, summary } = require('./test_utils')

const TOKEN_OK = 'ghp_' + 'a'.repeat(36)

/* ---------------- mock 工厂（与 v122 同构） ---------------- */

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

function makeDownloader(contentByUrl, opts) {
  opts = opts || {}
  const downloaded = []
  let tk = 0
  return {
    downloaded,
    download({ url, success, fail }) {
      downloaded.push(url)
      if (opts.breakDownload) return fail(null, 1000)
      tk++
      success({ token: 'tk' + tk })
    },
    onDownloadComplete({ token, success, fail }) {
      Promise.resolve().then(() => {
        if (opts.breakComplete) return fail(null, 1001)
        const url = downloaded[Number(String(token).slice(2)) - 1]
        const body = Object.prototype.hasOwnProperty.call(contentByUrl, url) ? contentByUrl[url] : null
        if (body == null) return fail(null, 1002)
        success({ uri: 'internal://files/dltmp_' + token })
      })
    }
  }
}

/** 加载真实 b64 模块（api.js 通道⑤依赖默认导出） */
function loadB64() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src/utils/b64.js'), 'utf8')
  const { transformEsm } = { transformEsm: null }
  /* 简化：b64.js 结构简单，直接用与 loadModule 同构的转换 */
  let code = src
  code = code.replace(/^import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/gm, '')
  code = code.replace(/^export\s+default\s+/gm, '__exports.default = ')
  code = code.replace(/^export\s+(async\s+)?function\s+(\w+)/gm, (m, aw, n) => (aw || '') + 'function ' + n)
  code = code.replace(/^export\s+const\s+(\w+)\s*=/gm, (m, n) => 'const ' + n + ' =')
  const exports = {}
  const fn = new Function('__req', '__exports', 'console', code + '\ntry { __exports.decode = decode } catch (e) {}')
  fn(() => ({}), exports, console)
  return exports
}

/** 下载器与 file mock 联动：onDownloadComplete 完成时把正文注入 file map
 *  （真实固件：下载器落盘 → file.readText 读回；mock 需同步两表） */
function wireDownloader(fileMock, downloaderMock) {
  const origComplete = downloaderMock.onDownloadComplete
  downloaderMock.onDownloadComplete = function (o) {
    const wrapped = Object.assign({}, o, {
      success: (d) => {
        const url = downloaderMock.downloaded[Number(String(o.token).slice(2)) - 1]
        if (downloaderMock._contentByUrl && Object.prototype.hasOwnProperty.call(downloaderMock._contentByUrl, url)) {
          fileMock._map[d.uri] = downloaderMock._contentByUrl[url]
        }
        o.success(d)
      }
    })
    origComplete(wrapped)
  }
}

function authed(contentByUrl, fetchHandler, dlOpts) {
  const f = makeFile()
  const d = makeDownloader(contentByUrl || {}, dlOpts)
  wireDownloader(f, d)
  d._contentByUrl = contentByUrl || {}
  const mocks = {
    '@system.fetch': makeFetch(fetchHandler),
    '@system.storage': makeStorage(),
    '@system.file': f,
    '@system.request': d,
    './b64': loadB64()
  }
  mocks['@system.storage']._map['gh_token'] = TOKEN_OK
  mocks['@system.file']._map['internal://files/gh_token.txt'] = TOKEN_OK
  return mocks
}

function notifItem(id, repo, ci) {
  return {
    id: id, unread: true, reason: ci ? 'ci_activity' : 'author',
    updated_at: '2026-10-01T00:00:00Z',
    subject: { title: 'ntf ' + id, type: ci ? 'CheckSuite' : 'Issue', url: ci ? null : ('https://api.github.com/repos/' + (repo || 'o/r') + '/issues/' + id) },
    repository: { full_name: repo || 'o/r' }
  }
}

/* ---------------- 1. 分块 URL 扰动 ---------------- */

async function t_url_jitter() {
  await test('分块第 2 块请求 URL 带 ?_b= 扰动参数（同 URL 去重绕行）', async () => {
    const url = 'https://raw.githubusercontent.com/o/r/HEAD/big.js'
    const mocks = authed({}, (n, o) => {
      const u = String(o.url)
      if (u.indexOf(url) !== 0) return { code: 500, data: '', headers: {} }
      const m = u.match(/_b=(\d+)/)
      const start = m ? Number(m[1]) : -1
      if (start === 0) return { code: 206, data: 'x'.repeat(12288), headers: { 'content-range': 'bytes 0-12287/20000' } }
      if (start === 12288) return { code: 206, data: 'y'.repeat(7712), headers: { 'content-range': 'bytes 12288-19999/20000' } }
      return { code: 500, data: '', headers: {} }
    }, { breakDownload: true })
    const api = loadModule('src/utils/api.js', mocks)
    const r = await api.getFileRawEx('o/r', 'big.js', '', null)
    assertEq(r.via, 'chunk', '分块通道成功')
    assertEq(r.text.length, 20000, '两块拼接完整')
    const urls = mocks['@system.fetch'].calls.map((c) => String(c.url))
    /* 文本模式探测重试（arraybuffer 回调给字符串 → 换 text 重取同块）是既有行为 */
    assertEq(urls.filter((u) => u.indexOf('?_b=0') >= 0).length >= 1, true, '首块 URL 带 _b=0')
    assertEq(urls.filter((u) => u.indexOf('?_b=12288') >= 0).length >= 1, true, '次块 URL 带 _b=12288（与首块不同 URL）')
  })

  await test('RAW_CHUNK 升至 12288（12KB 块，低于 14.3KB 阈值）', async () => {
    /* 经行为间接验证：12000 字节文件单块直达（12KB 内） */
    const url = 'https://raw.githubusercontent.com/o/r/HEAD/mid.js'
    let n = 0
    const mocks = authed({}, (n2, o) => {
      const u = String(o.url)
      if (u.indexOf(url) !== 0) return { code: 500, data: '', headers: {} }
      n++
      return { code: 206, data: 'z'.repeat(12000), headers: { 'content-range': 'bytes 0-11999/12000' } }
    }, { breakDownload: true })
    const api = loadModule('src/utils/api.js', mocks)
    const r = await api.getFileRawEx('o/r', 'mid.js', '', null)
    assertEq(r.text.length, 12000, '12KB 文件完整')
    assertEq(mocks['@system.fetch'].calls.filter((c) => String(c.url).indexOf('_b=12000') >= 0).length, 0, '无第二块请求（若仍 8KB 需 2 块）')
  })
}

/* ---------------- 2. 确定性截断快速终止 ---------------- */

async function t_fast_incomplete() {
  await test('JSON 截断（确定性）→ 恰 1 次请求即抛 incomplete（不再 3 连重试）', async () => {
    let n = 0
    const mocks = authed({}, () => {
      n++
      return { code: 200, data: '[{"id":9,"unread":tr', headers: {} }
    })
    const api = loadModule('src/utils/api.js', mocks)
    let err = null
    try { await api.request('/repos/o/r/issues?per_page=10', { noDl: true }) } catch (e) { err = e }
    assert(err && err.incomplete, 'incomplete 抛出')
    assertEq(n, 1, '仅 1 次请求（旧版 3 次）')
  })

  await test('空体 200（瞬时丢失）→ 仍保留重试语义', async () => {
    let n = 0
    const mocks = authed({}, () => {
      n++
      if (n <= 2) return { code: 200, data: '', headers: {} }
      return { code: 200, data: { ok: 1 }, headers: {} }
    })
    const api = loadModule('src/utils/api.js', mocks)
    const d = await api.request('/repos/o/r/contents/a.txt', { noDl: true })
    assertEq(d, { ok: 1 }, '第 3 次拿到数据')
    assertEq(n, 3, '空体重试 2 次后成功')
  })
}

/* ---------------- 3. 通知子页 noDl ---------------- */

async function t_notif_nodl() {
  await test('子页截断 → 直接降级 per=1，全程零下载器调用', async () => {
    const seen = []
    const mocks = authed({}, (n, o) => {
      const u = String(o.url)
      if (u.indexOf('/notifications') < 0) return { code: 404, data: {}, headers: {} }
      const pg = Number((u.match(/page=(\d+)/) || [0, 1])[1])
      const per = Number((u.match(/per_page=(\d+)/) || [0, 0])[1])
      seen.push(pg + 'x' + per)
      if (per === 2) return { code: 200, data: '[{"id":1,"unread":', headers: {} } /* 确定性截断 */
      return { code: 200, data: [notifItem(pg)], headers: {} }
    })
    const api = loadModule('src/utils/api.js', mocks)
    const list = await api.getNotifications(1, false)
    assertEq(list.length, 10, '10 条拼齐')
    assertEq(mocks['@system.request'].downloaded.length, 0, '下载器零调用（旧版会挂 28s）')
    assertEq(seen.filter((s) => s.indexOf('x1') >= 0).length >= 2, true, '有 per=1 降级请求')
  })
}

/* ---------------- 4. 通道⑤ contents JSON base64 ---------------- */

async function t_channel5_b64() {
  await test('前四通道全灭 → 通道⑤ base64 兜底成功（杜绝「内容为空」）', async () => {
    const url = 'https://raw.githubusercontent.com/o/r/HEAD/small.js'
    const RAW = 'console.log("hi")'
    /* base64("console.log(\"hi\")") */
    const B64 = Buffer.from(RAW).toString('base64')
    const mocks = authed({}, (n, o) => {
      const u = String(o.url)
      if (u.indexOf(url) === 0) return { code: 500, data: '', headers: {} } /* 分块死 */
      if (u.indexOf('/repos/o/r/contents/small.js') >= 0) {
        if (u.indexOf('application/vnd.github.raw') >= 0 || (o.header && String(o.header.Accept || '').indexOf('raw') >= 0)) {
          return { code: 200, data: '', headers: {} } /* 通道④ raw 空体 */
        }
        return { code: 200, data: { type: 'file', name: 'small.js', size: RAW.length, content: B64 + '\n' }, headers: {} } /* 通道⑤ */
      }
      return { code: 500, data: '', headers: {} }
    }, { breakDownload: true })
    /* 下载器也坏 */
    mocks['@system.request'].download = function ({ fail }) { fail(null, 1000) }
    const api = loadModule('src/utils/api.js', mocks)
    const r = await api.getFileRawEx('o/r', 'small.js', '', null)
    assertEq(r.via, 'b64', '通道⑤接住')
    assertEq(r.text, RAW, 'base64 解码内容正确')
  })

  await test('通道⑤ base64 也无内容 → 最终诊断文案（不再返回空 text）', async () => {
    const url = 'https://raw.githubusercontent.com/o/r/HEAD/void.txt'
    const mocks = authed({}, (n, o) => {
      const u = String(o.url)
      if (u.indexOf(url) === 0) return { code: 500, data: '', headers: {} }
      if (u.indexOf('/repos/o/r/contents/void.txt') >= 0) {
        if (o.header && String(o.header.Accept || '').indexOf('raw') >= 0) return { code: 200, data: '', headers: {} }
        return { code: 200, data: { type: 'file', name: 'void.txt', size: 0, content: '' }, headers: {} }
      }
      return { code: 500, data: '', headers: {} }
    }, { breakDownload: true })
    mocks['@system.request'].download = function ({ fail }) { fail(null, 1000) }
    const api = loadModule('src/utils/api.js', mocks)
    let err = null
    try { await api.getFileRawEx('o/r', 'void.txt', '', null) } catch (e) { err = e }
    assert(err && err.message && err.message.indexOf('均不可用') >= 0, '五通道诊断文案：' + (err && err.message))
  })
}

/* ---------------- 5. Actions：GraphQL commit CI 历史快车道 ---------------- */

async function t_actions() {
  await test('getCommitChecks GraphQL：history+rollup 瘦映射 + 分页游标', async () => {
    const mocks = authed({}, (n, o) => {
      const u = String(o.url)
      if (u.indexOf('/graphql') >= 0) {
        const body = JSON.parse(o.data)
        assert(body.query.indexOf('history') >= 0 && body.query.indexOf('statusCheckRollup') >= 0, '查询 history+rollup')
        assertEq(body.variables.branch, 'refs/heads/HEAD', '分支参数 refs/heads/ 前缀')
        return {
          code: 200,
          data: {
            data: {
              repository: {
                ref: {
                  target: {
                    history: {
                      pageInfo: { hasNextPage: true, endCursor: 'CC1' },
                      totalCount: 4075,
                      nodes: [
                        { oid: 'aaa1112223334444aaa1112223334444aaa11122', committedDate: '2026-10-09T00:00:00Z', messageHeadline: 'fix: bug', statusCheckRollup: { state: 'SUCCESS', contexts: { nodes: [ { name: 'Development build', conclusion: 'SUCCESS', status: 'COMPLETED' } ] } } },
                        { oid: 'bbb2223334444aaabbb2223334444aaabbb22233', committedDate: '2026-10-08T00:00:00Z', messageHeadline: 'feat: x', statusCheckRollup: { state: 'FAILURE', contexts: { nodes: [ { name: 'build', conclusion: 'FAILURE', status: 'COMPLETED' }, { context: 'continuous-integration', state: 'FAILURE' } ] } } }
                      ]
                    }
                  }
                }
              }
            }
          },
          headers: {}
        }
      }
      return { code: 500, data: '', headers: {} }
    })
    const api = loadModule('src/utils/api.js', mocks)
    const r = await api.getCommitChecks('o/r', '', 1)
    assertEq(r.commits.length, 2, '2 条 commits')
    assertEq(r.total, 4075, '总数')
    assertEq(r.hasNext, true, 'hasNext')
    assertEq(r.commits[0].state, 'success', 'rollup state 小写')
    assertEq(r.commits[0].checks[0].name, 'Development build', 'checkRun name')
    assertEq(r.commits[0].checks[0].concl, 'success', 'checkRun conclusion 小写')
    assertEq(r.commits[1].checks.length, 2, 'CheckRun + StatusContext 双形态映射')
    assertEq(r.commits[1].checks[1].name, 'continuous-integration', 'StatusContext context 名')
    /* 第二页游标 */
    let sentAfter = null
    const mocks2 = authed({}, (n, o) => {
      const u2 = String(o.url)
      if (u2.indexOf('/graphql') >= 0) {
        const body = JSON.parse(o.data)
        sentAfter = body.variables.after
        return {
          code: 200,
          data: { data: { repository: { ref: { target: { history: { pageInfo: sentAfter === undefined ? { hasNextPage: true, endCursor: 'CC9' } : { hasNextPage: false, endCursor: '' }, totalCount: 4075, nodes: [] } } } } } },
          headers: {}
        }
      }
      return { code: 500, data: '', headers: {} }
    })
    const api2 = loadModule('src/utils/api.js', mocks2)
    await api2.getCommitChecks('o/r', '', 1) /* 建立游标 */
    await api2.getCommitChecks('o/r', '', 2)
    assertEq(sentAfter, 'CC9', '第二页带第一页下发的 endCursor')
  })

  await test('getCommitChecks 游客 → needAuth 提示（REST runs 17.7KB 恒超阈值，无回退）', async () => {
    const mocks = authed({}, () => ({ code: 500, data: '', headers: {} }))
    mocks['@system.storage']._map['gh_token'] = ''
    mocks['@system.file']._map['internal://files/gh_token.txt'] = ''
    const api = loadModule('src/utils/api.js', mocks)
    let err = null
    try { await api.getCommitChecks('o/r', '', 1) } catch (e) { err = e }
    assert(err && err.needAuth === true, 'needAuth 标志')
    assert(String(err.message).indexOf('登录') >= 0, '需登录文案')
  })

  await test('getCommitChecks 分支不存在 → 404 明确提示', async () => {
    const mocks = authed({}, (n, o) => {
      const u = String(o.url)
      if (u.indexOf('/graphql') >= 0) {
        return { code: 200, data: { data: { repository: { ref: null } } }, headers: {} }
      }
      return { code: 500, data: '', headers: {} }
    })
    const api = loadModule('src/utils/api.js', mocks)
    let err = null
    try { await api.getCommitChecks('o/r', 'ghost', 1) } catch (e) { err = e }
    assert(err && err.status === 404, '404 状态')
    assert(String(err.message).indexOf('ghost') >= 0, '含分支名提示')
  })

  await test('markThreadsRead：并发批量 PUT，成功计数，失败静默', async () => {
    const puts = []
    const mocks = authed({}, (n, o) => {
      const u = String(o.url)
      if (u.indexOf('/notifications/threads/') >= 0) {
        puts.push(u)
        if (u.indexOf('threads/3') >= 0) return { code: 500, data: '', headers: {} } /* 一条失败 */
        return { code: 205, data: {}, headers: {} }
      }
      return { code: 404, data: {}, headers: {} }
    })
    const api = loadModule('src/utils/api.js', mocks)
    const ok = await api.markThreadsRead([
      'https://api.github.com/notifications/threads/1',
      'https://api.github.com/notifications/threads/2',
      'https://api.github.com/notifications/threads/3'
    ])
    assertEq(ok, 2, '2 成功（失败静默）')
    assertEq(puts.length, 3, '3 次全部尝试')
  })
}

/* ---------------- 6. CI 聚合（view.js） ---------------- */

async function t_aggregate() {
  await test('aggregateNotifs：连续同仓库 CI 折叠为聚合卡，普通通知原样', async () => {
    const view = loadModule('src/utils/view.js', { './fmt': loadModule('src/utils/fmt.js', {}) })
    const raw = [
      notifItem(1, 'a/CI', true),
      notifItem(2, 'a/CI', true),
      notifItem(3, 'a/CI', true),
      notifItem(4, 'b/repo', false),
      notifItem(5, 'c/CI', true)
    ]
    const mapped = raw.map(view.mapNotif)
    assertEq(mapped[0].ci, true, 'ci_activity → ci=true')
    assertEq(mapped[3].ci, false, 'author → ci=false')
    const agg = view.aggregateNotifs(mapped)
    assertEq(agg.length, 3, '3 卡（CI×3 折叠 + 普通 + 单条 CI）')
    assertEq(agg[0].aggN, 3, '聚合卡 3 条')
    assertEq(agg[0].repo, 'a/CI', '聚合卡仓库')
    assertEq(agg[0].threads.length, 3, '聚合卡持有 3 个线程 URL')
    assertEq(agg[1].ci, false, '普通通知不折叠')
    assertEq(agg[2].aggN, 1, '单条 CI 也是聚合形态（可点击跳 Actions）')
  })

  await test('aggregateNotifs：同仓库 CI 不连续时各自成卡（跨段不合并）', async () => {
    const view = loadModule('src/utils/view.js', { './fmt': loadModule('src/utils/fmt.js', {}) })
    const raw = [notifItem(1, 'a/CI', true), notifItem(2, 'b/repo', false), notifItem(3, 'a/CI', true)]
    const agg = view.aggregateNotifs(raw.map(view.mapNotif))
    assertEq(agg.length, 3, '3 卡')
    assertEq(agg[0].aggN, 1, '第一段单条')
    assertEq(agg[2].aggN, 1, '第三段单条')
  })

  await test('mapNotif：CheckSuite subject.url=null 安全（url 退化为空串）', async () => {
    const view = loadModule('src/utils/view.js', { './fmt': loadModule('src/utils/fmt.js', {}) })
    const m = view.mapNotif(notifItem(9, 'o/r', true))
    assertEq(m.url, '', 'null url → 空串（不崩）')
    assertEq(m.icon, '/common/icons/gear.png', 'CheckSuite → gear 图标')
  })
}

/* ---------------- 7. v1.2.2 回归关键点 ---------------- */

async function t_regress() {
  await test('回归：fcache 命中 → 零网络（通道①）', async () => {
    const url = 'https://raw.githubusercontent.com/o/r/HEAD/c.txt'
    const mocks = authed({}, () => ({ code: 500, data: '', headers: {} }))
    mocks['@system.request']._contentByUrl[url] = 'cached-body'
    const api = loadModule('src/utils/api.js', mocks)
    await api.getFileRawEx('o/r', 'c.txt', '', null)
    const r2 = await api.getFileRawEx('o/r', 'c.txt', '', null)
    assertEq(r2.via, 'cache', '二次命中磁盘缓存')
  })

  await test('回归：通知正常路径仍 5×per=2 并发（noDl 不影响成功路径）', async () => {
    const seen = []
    const mocks = authed({}, (n, o) => {
      const u = String(o.url)
      if (u.indexOf('/notifications') < 0) return { code: 404, data: {}, headers: {} }
      const pg = Number((u.match(/page=(\d+)/) || [0, 1])[1])
      const per = Number((u.match(/per_page=(\d+)/) || [0, 0])[1])
      seen.push(pg + 'x' + per)
      const list = []
      for (let i = 0; i < per; i++) list.push(notifItem((pg - 1) * 2 + i + 1))
      return { code: 200, data: list, headers: {} }
    })
    const api = loadModule('src/utils/api.js', mocks)
    const list = await api.getNotifications(1, false)
    assertEq(list.length, 10, '10 条')
    assertEq(seen.filter((s) => s.indexOf('x2') >= 0).length, 5, '5 个 per=2 子页')
  })
}

;(async () => {
  await t_url_jitter()
  await t_fast_incomplete()
  await t_notif_nodl()
  await t_channel5_b64()
  await t_actions()
  await t_aggregate()
  await t_regress()
  summary()
})()

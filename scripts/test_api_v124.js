/**
 * test_api_v124.js — v1.2.4 CI 默认分支根修 + 通知弹性阶梯 + 语法高亮引擎测试
 * 覆盖：
 *  ① getCommitChecks 无分支 → defaultBranchRef 查询（refs/heads/HEAD 根修），
 *    含 statusCheckRollup 映射 / 游标翻页；显式分支 → ref(qualifiedName) 原路径
 *  ② 通知弹性阶梯：per=2 截断 → per=1 → 下载器兜底；gap 段重试；部分段渲染
 *    （list 保留成功段，lastNotifGaps 透传失败段）；404 硬错误仍整页抛出
 *  ③ JSON 歧义截断 2 次重试语义（v1.2.4 弹性策略）独立复核
 *  ④ hl.js：detectLang / clike / json / python / shell / markup / yaml / md 围栏 /
 *    diff / 块注释跨行状态 / token 合并与封顶 / 中文不崩
 */
const fs = require('fs')
const path = require('path')
const { loadModule, assert, assertEq, test, summary } = require('./test_utils')

const TOKEN_OK = 'ghp_' + 'a'.repeat(36)

/* ---------------- mock 工厂（与 v123 同构） ---------------- */

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
    _contentByUrl: contentByUrl,
    download({ url, success, fail }) {
      downloaded.push(url)
      if (opts.breakDownload) return fail(null, 1000)
      tk++
      Promise.resolve().then(() => success({ token: 'tk' + tk }))
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

function loadB64() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src/utils/b64.js'), 'utf8')
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

function notifItem(id, repo, ci) {
  return {
    id: id, unread: true, reason: ci ? 'ci_activity' : 'author',
    updated_at: '2026-10-01T00:00:00Z',
    subject: { title: 'ntf ' + id, type: ci ? 'CheckSuite' : 'Issue', url: ci ? null : ('https://api.github.com/repos/' + (repo || 'o/r') + '/issues/' + id) },
    repository: { full_name: repo || 'o/r' }
  }
}

const GARBAGE = '[{"id":9,"unread":tr'

/* ---------------- 1. CI 默认分支根修 ---------------- */

async function t_ci_default_branch() {
  await test('getCommitChecks 无分支 → defaultBranchRef 查询（不再拼 refs/heads/HEAD）', async () => {
    const gqlQs = []
    const gqlVars = []
    const mocks = authed({}, (n, o) => {
      if (String(o.url).indexOf('/graphql') >= 0) {
        const body = JSON.parse(o.data)
        gqlQs.push(body.query)
        gqlVars.push(body.variables)
        return {
          code: 200,
          data: {
            data: {
              repository: {
                defaultBranchRef: {
                  target: {
                    history: {
                      pageInfo: { hasNextPage: true, endCursor: 'CUR1' },
                      totalCount: 110,
                      nodes: [
                        {
                          oid: '496d5193d678', committedDate: '2026-10-06T13:06:12Z',
                          messageHeadline: 'docs: v1.2.4',
                          statusCheckRollup: {
                            state: 'SUCCESS',
                            contexts: { nodes: [{ name: 'rpk 打包', conclusion: 'SUCCESS', status: 'COMPLETED' }] }
                          }
                        },
                        {
                          oid: '53fb8b170ef', committedDate: '2026-10-06T12:43:57Z',
                          messageHeadline: 'fix: y',
                          statusCheckRollup: { state: 'FAILURE', contexts: { nodes: [{ name: 'lint', conclusion: 'FAILURE', status: 'COMPLETED' }] } }
                        }
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
    const r = await api.getCommitChecks('Gsjsjzhznsz/BandQQ', '', 1)
    assertEq(gqlQs.length, 1, '一次 GraphQL 请求')
    assert(gqlQs[0].indexOf('defaultBranchRef') >= 0, '查询含 defaultBranchRef')
    assert(gqlQs[0].indexOf('refs/heads/HEAD') < 0, '不再拼非法 refs/heads/HEAD')
    assert(gqlQs[0].indexOf('statusCheckRollup') >= 0, '含 CI 状态字段')
    assertEq(r.total, 110, 'totalCount 透传')
    assertEq(r.hasNext, true, 'hasNext')
    assertEq(r.commits.length, 2, '两条 commit')
    assertEq(r.commits[0].state, 'success', 'rollup state 小写映射')
    assertEq(r.commits[0].checks[0].name, 'rpk 打包', 'CheckRun name')
    assertEq(r.commits[0].checks[0].concl, 'success', 'CheckRun conclusion')
    assertEq(r.commits[1].state, 'failure', '失败状态映射')
    /* 游标续页：page2 用 endCursor */
    await api.getCommitChecks('Gsjsjzhznsz/BandQQ', '', 2)
    assertEq(gqlVars[1].after, 'CUR1', 'page2 携带 endCursor 游标')
  })

  await test('getCommitChecks 显式分支 → ref(qualifiedName) 原路径', async () => {
    const gqlQs = []
    const gqlVars = []
    const mocks = authed({}, (n, o) => {
      if (String(o.url).indexOf('/graphql') >= 0) {
        const body = JSON.parse(o.data)
        gqlQs.push(body.query)
        gqlVars.push(body.variables)
        return {
          code: 200,
          data: { data: { repository: { ref: { target: { history: { pageInfo: { hasNextPage: false, endCursor: '' }, totalCount: 1, nodes: [{ oid: 'abc', committedDate: '2026-10-01T00:00:00Z', messageHeadline: 'init', statusCheckRollup: null }] } } } } } },
          headers: {}
        }
      }
      return { code: 500, data: '', headers: {} }
    })
    const api = loadModule('src/utils/api.js', mocks)
    const r = await api.getCommitChecks('o/r', 'dev', 1)
    assert(gqlQs[0].indexOf('ref(qualifiedName') >= 0, 'ref 路径查询')
    assertEq(gqlVars[0].branch, 'refs/heads/dev', '分支限定名正确')
    assertEq(r.commits[0].state, '', 'rollup null → 空状态（无 CI 显示「无状态」）')
  })
}

/* ---------------- 2. 通知弹性阶梯 ---------------- */

async function t_notif_ladder() {
  await test('per=2 截断 + per=1 成功 → 10 条、gap=0、下载器零调用（快速路径回归）', async () => {
    const seen = []
    const mocks = authed({}, (n, o) => {
      const u = String(o.url)
      if (u.indexOf('/notifications') < 0) return { code: 404, data: {}, headers: {} }
      const pg = Number((u.match(/page=(\d+)/) || [0, 1])[1])
      const per = Number((u.match(/per_page=(\d+)/) || [0, 0])[1])
      seen.push(pg + 'x' + per)
      if (per === 2) return { code: 200, data: GARBAGE, headers: {} }
      return { code: 200, data: [notifItem(pg)], headers: {} }
    })
    const api = loadModule('src/utils/api.js', mocks)
    const list = await api.getNotifications(1, false)
    assertEq(list.length, 10, '10 条拼齐')
    assertEq(api.lastNotifGaps().length, 0, '无 gap')
    assertEq(mocks['@system.request'].downloaded.length, 0, '下载器零调用')
    assertEq(seen.filter((s) => s.indexOf('x1') >= 0).length >= 2, true, '有 per=1 降级')
  })

  await test('per=2 + per=1 全截断 → 下载器兜底接住（gap=0）', async () => {
    const dlMap = {}
    for (let pg = 1; pg <= 10; pg++) {
      dlMap['https://api.github.com/notifications?page=' + pg + '&per_page=1&all=false'] = JSON.stringify([notifItem(pg)])
    }
    const mocks = authed(dlMap, (n, o) => {
      const u = String(o.url)
      if (u.indexOf('/notifications') < 0) return { code: 404, data: {}, headers: {} }
      return { code: 200, data: GARBAGE, headers: {} }
    })
    const api = loadModule('src/utils/api.js', mocks)
    const list = await api.getNotifications(1, false)
    assertEq(list.length, 10, '下载器兜底拼齐 10 条')
    assertEq(api.lastNotifGaps().length, 0, '无 gap')
    assert(mocks['@system.request'].downloaded.length >= 10, '下载器被调用（兜底生效）')
    assertEq(list.map((x) => x.id), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], '顺序无缺口')
  })

  await test('fetch+下载器全灭 → 不再整页抛错，list 空 + gaps 记录全部段', async () => {
    const mocks = authed({}, () => ({ code: 200, data: GARBAGE, headers: {} }), { breakDownload: true })
    const api = loadModule('src/utils/api.js', mocks)
    const list = await api.getNotifications(1, false)
    assertEq(list.length, 0, '无数据返回（不 throw）')
    assertEq(api.lastNotifGaps(), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 'v1.5.0：10 单页全记 gap')
  })

  await test('部分段死 → 成功段照常返回（顺序保持），失败段记 gap 可重试', async () => {
    const mocks = authed({}, (n, o) => {
      const u = String(o.url)
      if (u.indexOf('/notifications') < 0) return { code: 404, data: {}, headers: {} }
      const pg = Number((u.match(/page=(\d+)/) || [0, 1])[1])
      /* v1.5.0：单页 7 全灭（截断 GARBAGE + 下载器断供）；其余单页按真实条号供数 */
      if (pg === 7) {
        return { code: 200, data: GARBAGE, headers: {} }
      }
      const list = [notifItem(pg)]
      return { code: 200, data: list, headers: {} }
    }, { breakDownload: true })
    const api = loadModule('src/utils/api.js', mocks)
    const list = await api.getNotifications(1, false)
    assertEq(list.length, 9, '成功段 9 条照常返回（旧版整页报错丢弃）')
    assertEq(list.map((x) => x.id), [1, 2, 3, 4, 5, 6, 8, 9, 10], '顺序保持、缺口位置明确')
    assertEq(api.lastNotifGaps(), [7], '仅单页 7 记 gap')
  })

  await test('段 404（硬错误）→ 仍整页抛出（v1.2.2 契约保留）', async () => {
    const mocks = authed({}, (n, o) => {
      const u = String(o.url)
      if (u.indexOf('/notifications') < 0) return { code: 404, data: {}, headers: {} }
      const pg = Number((u.match(/page=(\d+)/) || [0, 1])[1])
      if (pg === 3) return { code: 404, data: { message: 'Not Found' }, headers: {} }
      return { code: 200, data: [notifItem((pg - 1) * 2 + 1), notifItem((pg - 1) * 2 + 2)], headers: {} }
    })
    const api = loadModule('src/utils/api.js', mocks)
    let err = null
    try { await api.getNotifications(1, false) } catch (e) { err = e }
    assert(err && err.status === 404, '404 直接抛出（不进 gap）')
  })
}

/* ---------------- 3. JSON 歧义重试独立复核 ---------------- */

async function t_json_retry() {
  await test('通用 GET JSON 截断 → 恰 2 次请求（1 次重试后判死）', async () => {
    let n = 0
    const mocks = authed({}, () => {
      n++
      return { code: 200, data: GARBAGE, headers: {} }
    })
    const api = loadModule('src/utils/api.js', mocks)
    let err = null
    try { await api.request('/repos/o/r/issues?per_page=5', { noDl: true }) } catch (e) { err = e }
    assert(err && err.incomplete, 'incomplete 抛出')
    assertEq(n, 2, '2 次请求（v1.2.4 弹性策略）')
  })
}

/* ---------------- 4. hl.js 语法高亮引擎 ---------------- */

async function t_hl() {
  await test('detectLang：常见扩展名 → 家族；无扩展/未知 → plain；大小写不敏感', async () => {
    const hl = loadModule('src/utils/hl.js', {})
    assertEq(hl.detectLang('app.js'), 'clike')
    assertEq(hl.detectLang('main.ts'), 'clike')
    assertEq(hl.detectLang('a/b/main.CPP'), 'clike')
    assertEq(hl.detectLang('svc.py'), 'python')
    assertEq(hl.detectLang('run.sh'), 'shell')
    assertEq(hl.detectLang('pkg.json'), 'json')
    assertEq(hl.detectLang('style.css'), 'css')
    assertEq(hl.detectLang('index.html'), 'markup')
    assertEq(hl.detectLang('ci.yml'), 'yaml')
    assertEq(hl.detectLang('README.md'), 'md')
    assertEq(hl.detectLang('changelog.diff'), 'diff')
    assertEq(hl.detectLang('query.sql'), 'sql')
    assertEq(hl.detectLang('Makefile'), 'plain')
    assertEq(hl.detectLang('data.xyz'), 'plain')
  })

  await test('clike：关键字/字符串/数字/函数/注释/类型分色', async () => {
    const hl = loadModule('src/utils/hl.js', {})
    const toks = hl.tokenizeLine('const x = foo("hi") // note', 'clike', false)
    const seq = toks.map((t) => t.c)
    assert(seq.indexOf('kw') >= 0, '有 kw（const）')
    assert(seq.indexOf('fn') >= 0, '有 fn（foo(）')
    assert(seq.indexOf('str') >= 0, '有 str（"hi"）')
    assert(seq.indexOf('com') >= 0, '有 com（// note）')
    assertEq(toks[0].c, 'kw', '首 token 为关键字')
    /* 拼接还原 = 原行（不丢字符） */
    assertEq(toks.map((t) => t.s).join(''), 'const x = foo("hi") // note', 'token 拼接无损')
  })

  await test('块注释跨行状态：第 2 行整体 com（buildBlockState）', async () => {
    const hl = loadModule('src/utils/hl.js', {})
    const lines = ['/* start', 'still in block */ const a = 1', 'const b = 2']
    const st = hl.buildBlockState(lines, 'clike')
    assertEq(st[0].inb, false, '第 1 行起始不在块内')
    assertEq(st[1].inb, true, '第 2 行起始在块内')
    assertEq(st[2].inb, false, '第 3 行已出块')
    const t2 = hl.tokenizeLine(lines[1], 'clike', st[1].inb)
    assertEq(t2.length, 1, '块内行整体单 token')
    assertEq(t2[0].c, 'com', '整行注释色')
  })

  await test('json：键/字符串/数字/布尔分色 + 无损', async () => {
    const hl = loadModule('src/utils/hl.js', {})
    const line = '{"name": "vela", "n": 42, "ok": true}'
    const toks = hl.tokenizeLine(line, 'json', false)
    assert(toks.some((t) => t.c === 'key' && t.s === '"name"'), '键着 key 色')
    assert(toks.some((t) => t.c === 'num' && t.s === '42'), '数字着 num 色')
    assert(toks.some((t) => t.c === 'kw' && t.s === 'true'), '布尔着 kw 色')
    assertEq(toks.map((t) => t.s).join(''), line, '拼接无损')
  })

  await test('python：def/f 内建/注释/装饰器', async () => {
    const hl = loadModule('src/utils/hl.js', {})
    const t1 = hl.tokenizeLine('def main():', 'python', false)
    assertEq(t1[0].c, 'kw', 'def 为关键字')
    assert(t1.some((t) => t.c === 'fn' && t.s === 'main'), 'main 跟 ( 视为函数')
    const t2 = hl.tokenizeLine('x = len(s)  # 注释', 'python', false)
    assert(t2.some((t) => t.c === 'com'), '注释色')
    assert(t2.some((t) => t.c === 'fn' && t.s === 'len'), '内建函数色')
    const t3 = hl.tokenizeLine('@app.route("/a")', 'python', false)
    assertEq(t3[0].c, 'tag', '装饰器着 tag 色')
  })

  await test('shell：首词命令 fn、关键字 kw、$ 变量、注释', async () => {
    const hl = loadModule('src/utils/hl.js', {})
    const t1 = hl.tokenizeLine('npm run build  # todo', 'shell', false)
    assertEq(t1[0].c, 'fn', 'npm 首词命令')
    const t1b = hl.tokenizeLine('echo "$HOME/bin"  # todo', 'shell', false)
    assertEq(t1b[0].c, 'kw', 'echo 为内建关键字')
    assert(t1b.some((t) => t.c === 'str' && t.s === '"$HOME/bin"'), '字符串整体 str')
    assert(t1b.some((t) => t.c === 'com'), '注释')
    const t2 = hl.tokenizeLine('if [ -f x ]; then', 'shell', false)
    assertEq(t2[0].c, 'kw', 'if 为关键字（优先于首词命令）')
  })

  await test('markup：标签/属性/字符串；yaml：键与布尔', async () => {
    const hl = loadModule('src/utils/hl.js', {})
    const t1 = hl.tokenizeLine('<div class="box" id="a">hi</div>', 'markup', false)
    assert(t1.some((t) => t.c === 'tag' && t.s === '<div'), '开标签')
    assert(t1.some((t) => t.c === 'key' && t.s === 'class'), '属性名 key 色')
    assert(t1.some((t) => t.c === 'str' && t.s === '"box"'), '属性值 str 色')
    assertEq(t1.map((t) => t.s).join(''), '<div class="box" id="a">hi</div>', '拼接无损')
    const t2 = hl.tokenizeLine('debug: false', 'yaml', false)
    assertEq(t2[0].c, 'key', 'yaml 键')
    assert(t2.some((t) => t.c === 'kw' && t.s === 'false'), 'yaml 布尔')
  })

  await test('md 围栏：围栏声明行后内容按声明语言分词（js → clike）', async () => {
    const hl = loadModule('src/utils/hl.js', {})
    const lines = ['# T', '```js', 'const a = 1;', '```', 'text']
    const st = hl.buildBlockState(lines, 'md')
    assertEq(st[2].lg, 'clike', '围栏内行语言 = js')
    assertEq(st[1].lg, 'md', '声明行仍按 md 渲染')
    assertEq(st[4].lg, 'md', '出围栏恢复 md')
    const t2 = hl.tokenizeLine(lines[2], st[2].lg, st[2].inb)
    assertEq(t2[0].c, 'kw', '围栏内 const 高亮为关键字')
  })

  await test('diff：+/­- 行与 hunk 着色', async () => {
    const hl = loadModule('src/utils/hl.js', {})
    assertEq(hl.tokenizeLine('+added line', 'diff', false)[0].c, 'add')
    assertEq(hl.tokenizeLine('-removed line', 'diff', false)[0].c, 'del')
    assertEq(hl.tokenizeLine('@@ -1,3 +1,4 @@', 'diff', false)[0].c, 'num')
    assertEq(hl.tokenizeLine('+++ b/f.js', 'diff', false)[0].c, 'com')
  })

  await test('token 合并/封顶（≤24）与中文行安全', async () => {
    const hl = loadModule('src/utils/hl.js', {})
    const longLine = 'a1 b2 c3 d4 e5 f6 g7 h8 i9 j10 k11 l12 m13 n14 o15 p16 q17 r18 s19 t20 u21 v22 w23 x24 y25 z26'
    const toks = hl.tokenizeLine(longLine, 'clike', false)
    assert(toks.length <= 24, 'token 数封顶 24，实得 ' + toks.length)
    const cn = hl.tokenizeLine('const 名称 = "中文值" // 注释', 'clike', false)
    assertEq(cn.map((t) => t.s).join(''), 'const 名称 = "中文值" // 注释', '中文行分词无损')
    const pl = hl.tokenizeLine('随便一行纯文本', 'plain', false)
    assertEq(pl.length, 1, 'plain 单 token')
  })
}

/* ---------------- main ---------------- */

;(async () => {
  await t_ci_default_branch()
  await t_notif_ladder()
  await t_json_retry()
  await t_hl()
  summary()
})()

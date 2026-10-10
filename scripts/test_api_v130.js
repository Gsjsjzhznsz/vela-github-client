/**
 * test_api_v130.js — v1.3.0 通知 issue 三级通道 + 深目录下载器树 + AI 双通道测试
 * 覆盖：
 *  ① getIssue 三级通道：REST 直达 / 截断→下载器(__via dl) / 截断+下载器失败→
 *    GraphQL 逃生(__bodyTruncated) / 三级全灭抛 incomplete / 404 硬错误直抛
 *  ② getTreeEx：fetch 直达 / 截断→下载器整树 / 非JSON体判死
 *  ③ getNotifications participating 参数透传（URL 断言）
 *  ④ aiChat 双通道：PAT→Models / oauth→Copilot 优先 / oauth→Copilot 失败落 Models /
 *    非JSON体（健康检查 "OK"）报非标准体 / 未登录 needAuth / max_tokens 与模型透传
 *  ⑤ aiTokenKind / aiChannelLabel / aiModels
 *  ⑥ device flow scope 含 copilot（源码断言）
 */
const fs = require('fs')
const path = require('path')
const { loadModule, assert, assertEq, test, summary } = require('./test_utils')

/* v130 顶层异步测试收集器：test() 返回 promise，先全部收集再统一 await */
const _tests = []
function T(name, fn) { _tests.push(test(name, fn)) }

const TOKEN_OK = 'ghp_' + 'a'.repeat(36)
const TOKEN_OAUTH = 'ghu_' + 'b'.repeat(36)

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
  const infos = []
  return {
    calls,
    infos,
    fetch(opts) {
      calls.push(opts)
      Promise.resolve().then(() => {
        try {
          const r = handler(calls.length, opts, infos)
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

/** 通用 mock 环境：tokenKind 决定预置 token 形态 */
function authed(contentByUrl, fetchHandler, dlOpts, tokenKind) {
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
  const tok = tokenKind === 'oauth' ? TOKEN_OAUTH : TOKEN_OK
  mocks['@system.storage']._map['gh_token'] = tok
  mocks['@system.file']._map['internal://files/gh_token.txt'] = tok
  return mocks
}

function apiOf(mocks) {
  return loadModule('src/utils/api.js', mocks)
}

function fetchUrl(opts) {
  return opts && opts.url ? String(opts.url) : ''
}

/* ---------------- ① getIssue 三级通道 ---------------- */

T('getIssue ①a REST 直达（短 body）', async () => {
  const issue = { number: 7, title: 't', body: 'hi', state: 'open', user: { login: 'u' }, comments: 0, labels: [] }
  const mocks = authed({}, (i, o) => {
    assertEq(fetchUrl(o), 'https://api.github.com/repos/a/b/issues/7', 'issue URL')
    return { code: 200, data: JSON.stringify(issue), headers: {} }
  })
  const api = apiOf(mocks)
  const r = await api.getIssue('a/b', 7)
  assertEq(r.title, 't', 'title')
  assert(!r.__bodyTruncated, '不应标记截断')
})

T('getIssue ①b 截断 → 下载器兜底拿回完整数据', async () => {
  const issue = { number: 8, title: 'big', body: 'x'.repeat(50000), state: 'open', comments: 3, labels: [], comments_url: 'https://api.github.com/repos/a/b/issues/8/comments' }
  const mocks = authed({
    'https://api.github.com/repos/a/b/issues/8': JSON.stringify(issue)
  }, (i, o) => {
    // fetch 通道：截断形态（JSON 半截）→ request 内部下载器兑底接住
    return { code: 200, data: '{"number":8,"title":"big","body":"x', headers: {} }
  })
  const api = apiOf(mocks)
  const r = await api.getIssue('a/b', 8)
  assertEq(r.title, 'big', 'title')
  assert(r.body && r.body.length === 50000, 'body 完整（request 内部下载器兜底或显式 ② 层）')
  assert(!r.__bodyTruncated, 'body 未被标记截断')
})

T('getIssue ①c 截断+下载器失败 → GraphQL 逃生（bodyTruncated）', async () => {
  const gqlData = { data: { repository: { issueOrPullRequest: {
    __typename: 'Issue', number: 9, title: 'gql-t', state: 'OPEN', createdAt: '2026-01-01T00:00:00Z',
    author: { login: 'who' }, comments: { totalCount: 2 },
    labels: { nodes: [{ name: 'bug', color: '#d73a4a' }] }
  } } } }
  const mocks = authed({}, (i, o) => {
    const u = fetchUrl(o)
    if (u.indexOf('/issues/9') >= 0) return { code: 200, data: '{"number":9,', headers: {} }
    if (u.indexOf('api.github.com/graphql') >= 0) return { code: 200, data: JSON.stringify(gqlData), headers: {} }
    return { code: 404, data: '{}', headers: {} }
  }, { breakDownload: true })
  const api = apiOf(mocks)
  const r = await api.getIssue('a/b', 9)
  assertEq(r.title, 'gql-t', 'gql title')
  assertEq(r.__bodyTruncated, true, 'bodyTruncated 标志')
  assertEq(r.state, 'open', 'state 小写')
  assertEq(r.labels[0].color, 'd73a4a', 'label color 去井号')
})

T('getIssue ①d 三级全灭 → 抛 incomplete', async () => {
  const mocks = authed({}, (i, o) => {
    const u = fetchUrl(o)
    if (u.indexOf('/issues/10') >= 0) return { code: 200, data: '{"num', headers: {} }
    return { code: 500, data: '{}', headers: {} }
  }, { breakDownload: true })
  const api = apiOf(mocks)
  let err = null
  try { await api.getIssue('a/b', 10) } catch (e) { err = e }
  assert(err && err.incomplete, '应抛 incomplete')
})

T('getIssue ①e 404 硬错误直抛（不降级）', async () => {
  const mocks = authed({}, (i, o) => {
    return { code: 404, data: JSON.stringify({ message: 'Not Found' }), headers: {} }
  })
  const api = apiOf(mocks)
  let err = null
  try { await api.getIssue('a/b', 404) } catch (e) { err = e }
  assert(err && err.status === 404, '404 应直抛')
})

/* ---------------- ② getTreeEx ---------------- */

T('getTreeEx ②a fetch 直达', async () => {
  const tree = { sha: 's1', tree: [{ path: 'a.txt', type: 'blob', sha: 'x', size: 3 }], truncated: false }
  const mocks = authed({}, (i, o) => {
    assertEq(fetchUrl(o), 'https://api.github.com/repos/a/b/git/trees/HEAD', 'tree URL')
    return { code: 200, data: JSON.stringify(tree), headers: {} }
  })
  const api = apiOf(mocks)
  const r = await api.getTreeEx('a/b', 'HEAD')
  assertEq(r.tree.length, 1, 'tree 条目')
})

T('getTreeEx ②b 截断 → 下载器整树', async () => {
  const tree = { sha: 's2', tree: [], truncated: false }
  for (let i = 0; i < 400; i++) tree.tree.push({ path: 'f' + i + '.js', type: 'blob', sha: 'h' + i, size: 100 })
  const mocks = authed({
    'https://api.github.com/repos/a/b/git/trees/deepsha': JSON.stringify(tree)
  }, (i, o) => {
    return { code: 200, data: '{"sha":"deepsha","tree":[{"path":"f0', headers: {} }
  })
  const api = apiOf(mocks)
  const r = await api.getTreeEx('a/b', 'deepsha')
  assertEq(r.tree.length, 400, '下载器整树 400 条')
})

T('getTreeEx ②c 下载器返回非 JSON → 判死', async () => {
  const mocks = authed({
    'https://api.github.com/repos/a/b/git/trees/bad': 'OK'
  }, (i, o) => {
    return { code: 200, data: '{"sha":"bad"', headers: {} }
  })
  const api = apiOf(mocks)
  let err = null
  try { await api.getTreeEx('a/b', 'bad') } catch (e) { err = e }
  assert(err, '非 JSON 应判死')
})

/* ---------------- ③ participating 参数 ---------------- */

T('getNotifications ③a participating=true 透传到 URL', async () => {
  const mocks = authed({}, (i, o) => {
    const u = fetchUrl(o)
    if (u.indexOf('/notifications') >= 0) {
      assert(u.indexOf('participating=true') >= 0, 'URL 应含 participating=true: ' + u)
      return { code: 200, data: '[]', headers: {} }
    }
    return { code: 404, data: '{}', headers: {} }
  })
  const api = apiOf(mocks)
  const r = await api.getNotifications(1, true, true)
  assertEq(r.length, 0, '空列表')
})

T('getNotifications ③b 未传 participating 时 URL 不含该参数', async () => {
  const mocks = authed({}, (i, o) => {
    const u = fetchUrl(o)
    if (u.indexOf('/notifications') >= 0) {
      assert(u.indexOf('participating') < 0, 'URL 不应含 participating: ' + u)
      return { code: 200, data: '[]', headers: {} }
    }
    return { code: 404, data: '{}', headers: {} }
  })
  const api = apiOf(mocks)
  await api.getNotifications(1, false)
})

/* ---------------- ④ aiChat 双通道 ---------------- */

T('aiChat ④a PAT 未授权 → needCopilot（Models 已退役零请求）', async () => {
  const mocks = authed({}, (i, o) => {
    return { code: 404, data: '{}', headers: {} }
  })
  const api = apiOf(mocks)
  let err = null
  try { await api.aiChat([{ role: 'user', content: 'ping' }], {}) } catch (e) { err = e }
  assert(err && err.needCopilot, 'needCopilot 标志')
  assert(String(err.message).indexOf('Copilot') >= 0, '文案指向 Copilot 授权')
  const urls = mocks['@system.fetch'].calls.map(fetchUrl)
  assert(urls.every((u) => u.indexOf('models.github.ai') < 0), 'Models 退役后零请求')
})

T('aiChat ④b oauth → Copilot 优先（token 交换 + chat）', async () => {
  const mocks = authed({}, (i, o) => {
    const u = fetchUrl(o)
    if (u.indexOf('copilot_internal/v2/token') >= 0) {
      return { code: 200, data: JSON.stringify({ token: 'tid=1;exp=9999999999;sku=copilot', expires_at: Math.floor(Date.now() / 1000) + 1800 }), headers: {} }
    }
    if (u.indexOf('api.githubcopilot.com/chat/completions') >= 0) {
      assertEq(o.header.Authorization, 'Bearer tid=1;exp=9999999999;sku=copilot', 'Copilot 临时凭据')
      assertEq(o.header['Copilot-Integration-Id'], 'copilot-developer-cli', '集成头（v1.5.0 CLI 身份）')
      assertEq(o.header['X-GitHub-Api-Version'], '2026-08-01', 'Copilot API 版本头')
      return { code: 200, data: JSON.stringify({ choices: [{ message: { content: 'COPILOT-OK' } }] }), headers: {} }
    }
    return { code: 404, data: '{}', headers: {} }
  }, null, 'oauth')
  const api = apiOf(mocks)
  const r = await api.aiChat([{ role: 'user', content: 'hi' }], {})
  assertEq(r.text, 'COPILOT-OK', 'Copilot 回复')
  assertEq(r.via, 'copilot', 'via copilot')
})

T('aiChat ④c oauth 但凭据交换 404 → needCopilot（不再落 Models）', async () => {
  const mocks = authed({}, (i, o) => {
    const u = fetchUrl(o)
    if (u.indexOf('copilot_internal/v2/token') >= 0) {
      return { code: 404, data: JSON.stringify({ message: 'Not Found' }), headers: {} }
    }
    return { code: 404, data: '{}', headers: {} }
  }, null, 'oauth')
  const api = apiOf(mocks)
  let err = null
  try { await api.aiChat([{ role: 'user', content: 'hi' }], {}) } catch (e) { err = e }
  assert(err && err.needCopilot, 'needCopilot（Models 已退役，无兜底）')
  const urls = mocks['@system.fetch'].calls.map(fetchUrl)
  assert(urls.every((u) => u.indexOf('models.github.ai') < 0), 'Models 零请求')
})

T('aiChat ④d 非JSON体（网关健康检查 "OK"）→ 交换失败 + 原文透出', async () => {
  const mocks = authed({}, (i, o) => {
    return { code: 200, data: 'OK', headers: {} }
  }, null, 'oauth')
  const api = apiOf(mocks)
  let err = null
  try { await api.aiChat([{ role: 'user', content: 'hi' }], {}) } catch (e) { err = e }
  assert(err && (err.message.indexOf('凭据交换失败') >= 0 || err.message.indexOf('OK') >= 0), '非 JSON 体透出原文: ' + (err && err.message))
})

T('aiChat ④e 未登录 → needAuth', async () => {
  const f = makeFile()
  const d = makeDownloader({}, {})
  wireDownloader(f, d)
  const mocks = {
    '@system.fetch': makeFetch(() => ({ code: 200, data: '{}', headers: {} })),
    '@system.storage': makeStorage(),
    '@system.file': f,
    '@system.request': d,
    './b64': loadB64()
  }
  const api = apiOf(mocks)
  let err = null
  try { await api.aiChat([{ role: 'user', content: 'hi' }]) } catch (e) { err = e }
  assert(err && err.needAuth, '应抛 needAuth')
})

T('aiChat ④f Copilot 429 → 状态透传 + 原文文案', async () => {
  const mocks = authed({}, (i, o) => {
    const u = fetchUrl(o)
    if (u.indexOf('copilot_internal/v2/token') >= 0) {
      return { code: 200, data: JSON.stringify({ token: 'tid=1;exp=9999999999;sku=copilot', expires_at: Math.floor(Date.now() / 1000) + 1800 }), headers: {} }
    }
    if (u.indexOf('chat/completions') >= 0) {
      return { code: 429, data: JSON.stringify({ error: { message: 'quota exceeded' } }), headers: {} }
    }
    return { code: 404, data: '{}', headers: {} }
  }, null, 'oauth')
  const api = apiOf(mocks)
  let err = null
  try { await api.aiChat([{ role: 'user', content: 'hi' }]) } catch (e) { err = e }
  assert(err && err.status === 429, '429 透传')
  assert(String(err.message).indexOf('quota exceeded') >= 0, '错误原文透出')
})

/* ---------------- ⑤ AI 辅助 API ---------------- */

T('aiTokenKind/aiChannelLabel/aiModels ⑤', async () => {
  const m1 = authed({}, () => ({ code: 200, data: '{}', headers: {} }))
  const a1 = apiOf(m1)
  await a1.loadToken()
  assertEq(a1.aiTokenKind(), 'pat', 'pat kind')
  assert(a1.aiChannelLabel().indexOf('Copilot') >= 0, 'pat label（v1.5.0 待授权）')

  const m2 = authed({}, () => ({ code: 200, data: '{}', headers: {} }), null, 'oauth')
  const a2 = apiOf(m2)
  await a2.loadToken()
  assertEq(a2.aiTokenKind(), 'oauth', 'oauth kind')
  assert(a2.aiChannelLabel().indexOf('Copilot') >= 0, 'oauth label')

  assert(a2.aiModels().length >= 3, '预设模型 ≥3（v1.5.0 六模型清单）')
  assertEq(a2.aiModels()[0], 'gpt-5-mini', '首模型（Copilot API id 无前缀）')
})

/* ---------------- ⑥ device scope ---------------- */

T('device flow 双模式 ⑥', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src/utils/api.js'), 'utf8')
  assert(/DEVICE_CLIENT_COPILOT\s*=\s*'Iv1\.b507a08c87ecfe98'/.test(src), 'Copilot CLI GitHub App client（ghu_ 可交换）')
  assert(/DEVICE_SCOPE_COPILOT\s*=\s*'read:user'/.test(src), 'Copilot 授权 scope')
  assert(/DEVICE_SCOPE_LOGIN\s*=\s*'repo read:user notifications'/.test(src), '主登录 scope 收敛（非法 scope 不再首试）')
})

/* ---------------- go ---------------- */

;(async () => {
  await Promise.all(_tests)
  summary()
})().catch((e) => { console.error(e); process.exit(1) })

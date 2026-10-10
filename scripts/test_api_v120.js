/**
 * test_api_v120.js — v1.2.0 GraphQL 快车道 + raw Range 分块 + Device Flow 行为级测试
 * 复用 test_utils.js 加载器（依赖注入 @system.* mock）
 */
const { loadModule, assert, assertEq, test, summary } = require('./test_utils')

const TOKEN_OK = 'ghp_' + 'a'.repeat(36)
const GOOD_USER = { login: 'Gsjsjzhznsz', id: 1 }

/* ---------------- mock 工厂（与 v114 同构） ---------------- */

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
    download({ success, fail }) { if (opts.breakDownload) return fail(null, 1000); success({ token: 'tk1' }) },
    onDownloadComplete({ success, fail }) { if (opts.breakComplete) return fail(null, 1000); success({ uri: 'internal://cache/dl' }) }
  }
}

function buildMocks(fetchHandler, storageOpts) {
  return {
    '@system.fetch': makeFetch(fetchHandler),
    '@system.storage': makeStorage(storageOpts),
    '@system.file': makeFile(),
    '@system.request': makeDownloader()
  }
}

/** 带 token 的 mocks（storage 里预存合法 token） */
function authedMocks(fetchHandler) {
  const m = buildMocks(fetchHandler)
  m['@system.storage']._map['gh_token'] = TOKEN_OK
  m['@system.file']._map['internal://files/gh_token.txt'] = TOKEN_OK
  return m
}

/** view.js 依赖 ./fmt：先加载真实 fmt 模块再注入 */
const FMT = loadModule('src/utils/fmt.js', {})
function loadView() {
  return loadModule('src/utils/view.js', { './fmt': FMT })
}

/* ---------------- GraphQL canned 数据 ---------------- */

const GQL_ISSUE_NODE = { id: 'I1', number: 7, title: '真机测试议题', state: 'OPEN', createdAt: '2026-10-01T00:00:00Z', author: { login: 'alice' }, comments: { totalCount: 2 }, labels: { nodes: [{ name: 'bug', color: 'ff0000' }] } }
const GQL_REPO_NODE = { id: 'R1', nameWithOwner: 'o/repo1', description: 'desc', stargazerCount: 120, forkCount: 5, isFork: false, isPrivate: false, pushedAt: '2026-10-02T00:00:00Z', updatedAt: '2026-10-02T00:00:00Z', primaryLanguage: { name: 'JavaScript' }, owner: { login: 'o' } }
const GQL_RELEASE_NODE = { id: 'RL1', tagName: 'v1.2.0', name: 'v1.2.0 release', description: 'changelog body', isPrerelease: false, publishedAt: '2026-10-03T00:00:00Z', createdAt: '2026-10-03T00:00:00Z', author: { login: 'bob' }, releaseAssets: { totalCount: 2 } }

function gqlResp(data) { return { code: 200, data: { data: data }, headers: {} } }

/* ---------------- 1. GraphQL 列表快车道 ---------------- */

async function t_graphql() {
  await test('getIssues GraphQL 瘦字段 → REST 形状 → view.mapIssue 兼容', async () => {
    const mocks = authedMocks((n, o) => {
      if (o.url === 'https://api.github.com/graphql') return gqlResp({ repository: { issues: { pageInfo: { hasNextPage: true, endCursor: 'CUR1' }, nodes: [GQL_ISSUE_NODE] } } })
      return { code: 200, data: [], headers: {} }
    })
    const api = loadModule('src/utils/api.js', mocks)
    const list = await api.getIssues('o/r', 1, 'open')
    assertEq(list.length, 1, 'one issue')
    assertEq(list[0].number, 7, 'number')
    assertEq(list[0].state, 'open', 'state lowercase')
    assertEq(list[0].user.login, 'alice', 'author')
    assertEq(list[0].comments, 2, 'comments count')
    assertEq(list[0].labels[0].color, 'ff0000', 'label color')
    const { mapIssue } = loadView()
    const vm = mapIssue(list[0])
    assertEq(vm.num, 7, 'view num')
    assertEq(vm.labelsText, 'bug', 'view labelsText')
    assertEq(vm.open, true, 'view open')
  })

  await test('getIssues 游标翻页：page2 复用 page1 的 endCursor', async () => {
    const seen = []
    const mocks = authedMocks((n, o) => {
      if (o.url === 'https://api.github.com/graphql') {
        const body = JSON.parse(o.data)
        seen.push(body.variables.after)
        const cursor = seen.length === 1 ? null : 'CUR1'
        return gqlResp({ repository: { issues: { pageInfo: { hasNextPage: seen.length < 3, endCursor: 'CUR' + (seen.length + 1) }, nodes: [GQL_ISSUE_NODE] } } })
      }
      return { code: 200, data: [], headers: {} }
    })
    const api = loadModule('src/utils/api.js', mocks)
    await api.getIssues('o/r', 1, 'open')
    const p2 = await api.getIssues('o/r', 2, 'open')
    assertEq(seen[0], null, 'page1 after=null')
    assertEq(seen[1], 'CUR2', 'page2 after=page1 endCursor')
    assertEq(p2.length, 1, 'page2 items')
  })

  await test('getIssues 游标断链（冷启直进 page2）→ 回退 REST 且过滤 PR', async () => {
    const mocks = authedMocks((n, o) => {
      if (o.url === 'https://api.github.com/graphql') return { code: 200, data: { data: {} }, headers: {} } // 不应走到
      if (o.url.indexOf('/issues?') > 0) return { code: 200, data: [{ id: 1, number: 1, title: 'REST issue', pull_request: { } }, { id: 2, number: 2, title: 'pure issue' }], headers: {} }
      return { code: 200, data: [], headers: {} }
    })
    const api = loadModule('src/utils/api.js', mocks)
    const list = await api.getIssues('o/r', 2, 'open')
    assertEq(list.length, 1, 'PR filtered, 1 pure issue')
    assertEq(list[0].title, 'pure issue', 'from REST')
    const gqlCalls = mocks['@system.fetch'].calls.filter((c) => c.url === 'https://api.github.com/graphql')
    assertEq(gqlCalls.length, 0, 'no graphql call issued')
  })

  await test('GraphQL 404（repository null）直接抛出，不浪费 REST 请求', async () => {
    let restCalls = 0
    const mocks = authedMocks((n, o) => {
      if (o.url === 'https://api.github.com/graphql') return gqlResp({ repository: null })
      restCalls++
      return { code: 200, data: [], headers: {} }
    })
    const api = loadModule('src/utils/api.js', mocks)
    let caught = null
    try { await api.getIssues('ghost/none', 1, 'open') } catch (e) { caught = e }
    assert(caught && caught.status === 404, 'throws 404, got ' + JSON.stringify(caught))
    assertEq(restCalls, 0, 'no REST fallback')
  })

  await test('游客模式跳过 GraphQL 直接走 REST（无浪费请求）', async () => {
    let gqlCalls = 0
    const mocks = buildMocks((n, o) => {
      if (o.url === 'https://api.github.com/graphql') { gqlCalls++; return gqlResp({}) }
      if (o.url.indexOf('/issues?') > 0) return { code: 200, data: [{ id: 1, number: 1, title: 'guest issue' }], headers: {} }
      return { code: 200, data: [], headers: {} }
    })
    const api = loadModule('src/utils/api.js', mocks)
    const list = await api.getIssues('o/r', 1, 'open')
    assertEq(gqlCalls, 0, 'graphql skipped for guest')
    assertEq(list.length, 1, 'REST served')
  })

  await test('GraphQL 网络失败 → REST 兜底成功', async () => {
    const mocks = authedMocks((n, o) => {
      if (o.url === 'https://api.github.com/graphql') return { __fail: 'net down', code: 0 }
      if (o.url.indexOf('/issues?') > 0) return { code: 200, data: [{ id: 1, number: 1, title: 'fallback issue' }], headers: {} }
      return { code: 200, data: [], headers: {} }
    })
    const api = loadModule('src/utils/api.js', mocks)
    const list = await api.getIssues('o/r', 1, 'open')
    assertEq(list.length, 1, 'REST fallback served')
    assertEq(list[0].title, 'fallback issue', 'fallback title')
  })

  await test('searchRepos 返回 {items,total_count} 契约 + sort:stars 限定符注入', async () => {
    let q = ''
    const mocks = authedMocks((n, o) => {
      if (o.url === 'https://api.github.com/graphql') {
        q = JSON.parse(o.data).variables.q
        return gqlResp({ search: { repositoryCount: 42, pageInfo: { hasNextPage: false, endCursor: 'S1' }, nodes: [GQL_REPO_NODE] } })
      }
      return { code: 200, data: { items: [] }, headers: {} }
    })
    const api = loadModule('src/utils/api.js', mocks)
    const r = await api.searchRepos('vela', 1, 'stars')
    assertEq(r.total_count, 42, 'repositoryCount mapped')
    assertEq(r.items.length, 1, 'items mapped')
    assertEq(r.items[0].full_name, 'o/repo1', 'full_name')
    assertEq(r.items[0].stargazers_count, 120, 'stars mapped')
    assertEq(r.items[0].language, 'JavaScript', 'lang mapped')
    assertEq(q, 'vela sort:stars', 'sort qualifier appended')
    const { mapRepo } = loadView()
    const vm = mapRepo(r.items[0])
    assertEq(vm.full, 'o/repo1', 'view full')
    assertEq(vm.stars, '120', 'view stars')
  })

  await test('getReleases GraphQL → REST 形状（assets 计数 + prerelease）', async () => {
    const mocks = authedMocks((n, o) => {
      if (o.url === 'https://api.github.com/graphql') return gqlResp({ repository: { releases: { pageInfo: { hasNextPage: false, endCursor: 'R1' }, nodes: [GQL_RELEASE_NODE] } } })
      return { code: 200, data: [], headers: {} }
    })
    const api = loadModule('src/utils/api.js', mocks)
    const list = await api.getReleases('o/r', 1)
    assertEq(list.length, 1, 'one release')
    assertEq(list[0].tag_name, 'v1.2.0', 'tag_name')
    assertEq(list[0].prerelease, false, 'prerelease')
    assertEq(list[0].assets.length, 2, 'assets count')
    assertEq(list[0].body, 'changelog body', 'body')
    const { mapRelease } = loadView()
    const vm = mapRelease(list[0])
    assertEq(vm.tag, 'v1.2.0', 'view tag')
    assertEq(vm.assets, 2, 'view assets count')
  })

  await test('getMyRepos/getUserRepos GraphQL 瘦字段；getUserRepos 404 不兜底', async () => {
    const mocks = authedMocks((n, o) => {
      if (o.url !== 'https://api.github.com/graphql') return { code: 200, data: [], headers: {} }
      const body = JSON.parse(o.data)
      if (body.query.indexOf('viewer') > 0) return gqlResp({ viewer: { repositories: { pageInfo: { hasNextPage: false, endCursor: 'M1' }, totalCount: 1, nodes: [GQL_REPO_NODE] } } })
      if (body.variables.login === 'ghost') return gqlResp({ repositoryOwner: null })
      return gqlResp({ repositoryOwner: { repositories: { pageInfo: { hasNextPage: false, endCursor: 'U1' }, totalCount: 1, nodes: [GQL_REPO_NODE] } } })
    })
    const api = loadModule('src/utils/api.js', mocks)
    const mine = await api.getMyRepos(1, 'pushed')
    assertEq(mine.length, 1, 'my repos via viewer')
    assertEq(mine[0].full_name, 'o/repo1', 'my repo full_name')
    const theirs = await api.getUserRepos('someone', 1)
    assertEq(theirs.length, 1, 'user repos via repositoryOwner')
    let caught = null
    try { await api.getUserRepos('ghost', 1) } catch (e) { caught = e }
    assert(caught && caught.status === 404, 'ghost user throws 404')
  })
}

/* ---------------- 2. Device Flow ---------------- */

async function t_deviceflow() {
  await test('deviceFlowStart 解析发码响应（device_code/user_code/interval）', async () => {
    const mocks = buildMocks((n, o) => {
      assertEq(o.url, 'https://github.com/login/device/code', 'start url')
      assertEq(o.method, 'POST', 'start method POST')
      assert(o.header['Content-Type'] === 'application/x-www-form-urlencoded', 'form content type')
      assert(String(o.data).indexOf('client_id=') >= 0, 'client_id in body')
      return { code: 200, data: { device_code: 'DC123', user_code: '5187-6B16', verification_uri: 'https://github.com/login/device', expires_in: 899, interval: 5 }, headers: {} }
    })
    const api = loadModule('src/utils/api.js', mocks)
    const r = await api.deviceFlowStart()
    assertEq(r.deviceCode, 'DC123', 'deviceCode')
    assertEq(r.userCode, '5187-6B16', 'userCode')
    assertEq(r.verifyUri, 'https://github.com/login/device', 'verifyUri')
    assertEq(r.interval, 5, 'interval')
    assertEq(r.expiresIn, 899, 'expiresIn')
  })

  await test('deviceFlowStart 响应为文本形态（代理降级）同样可解析', async () => {
    const mocks = buildMocks((n, o) => ({ code: 200, data: JSON.stringify({ device_code: 'DC9', user_code: 'ABCD-1234' }), headers: {} }))
    const api = loadModule('src/utils/api.js', mocks)
    const r = await api.deviceFlowStart()
    assertEq(r.deviceCode, 'DC9', 'deviceCode from string body')
    assertEq(r.interval, 5, 'default interval')
  })

  await test('deviceFlowStart 网络失败 → 抛 status 0 友好错误', async () => {
    const mocks = buildMocks((n, o) => ({ __fail: 'offline', code: 0 }))
    const api = loadModule('src/utils/api.js', mocks)
    let caught = null
    try { await api.deviceFlowStart() } catch (e) { caught = e }
    assert(caught && caught.status === 0, 'status 0 thrown')
    assert(String(caught.message).indexOf('网络') >= 0, 'friendly message')
  })

  await test('deviceFlowPoll 状态机：ok/pending/slow/expired/denied/netfail', async () => {
    const cases = [
      [{ access_token: 'gho_x', token_type: 'bearer' }, { state: 'ok' }],
      [{ error: 'authorization_pending' }, { state: 'pending' }],
      [{ error: 'slow_down' }, { state: 'slow' }],
      [{ error: 'expired_token' }, { state: 'expired' }],
      [{ error: 'access_denied' }, { state: 'denied' }]
    ]
    for (let i = 0; i < cases.length; i++) {
      const mocks = buildMocks((n, o) => {
        assertEq(o.url, 'https://github.com/login/oauth/access_token', 'poll url case ' + i)
        assert(String(o.data).indexOf('grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Adevice_code') >= 0, 'grant_type encoded case ' + i)
        assert(String(o.data).indexOf('device_code=DC123') >= 0, 'device_code in body case ' + i)
        return { code: 200, data: cases[i][0], headers: {} }
      })
      const api = loadModule('src/utils/api.js', mocks)
      const r = await api.deviceFlowPoll('DC123', 5)
      assertEq(r.state, cases[i][1].state, 'state case ' + i)
      if (cases[i][1].state === 'ok') assertEq(r.token, 'gho_x', 'token case ok')
      if (cases[i][1].state === 'slow') assertEq(r.interval, 10, 'slow interval +5')
    }
    const nf = buildMocks((n, o) => ({ __fail: 'offline', code: 0 }))
    const api2 = loadModule('src/utils/api.js', nf)
    const r2 = await api2.deviceFlowPoll('DC123', 5)
    assertEq(r2.state, 'netfail', 'netfail no-throw')
  })
}

/* ---------------- 3. UTF-8 跨块解码 ---------------- */

async function t_utf8() {
  const { utf8DecodeChunk } = loadModule('src/utils/api.js', buildMocks(() => ({ code: 200, data: {}, headers: {} })))

  function bytesOf(s) {
    const out = []
    const enc = unescape(encodeURIComponent(s))
    for (let i = 0; i < enc.length; i++) out.push(enc.charCodeAt(i))
    return out
  }

  await test('ASCII 跨块解码无损', async () => {
    let text = ''
    let pending = []
    const bs = bytesOf('hello vela watch')
    const half = Math.floor(bs.length / 2)
    let r1 = utf8DecodeChunk(pending, new Uint8Array(bs.slice(0, half)))
    text += r1.text
    let r2 = utf8DecodeChunk(r1.pending, new Uint8Array(bs.slice(half)))
    text += r2.text
    assertEq(text, 'hello vela watch', 'ascii roundtrip')
    assertEq(r2.pending.length, 0, 'no leftover')
  })

  await test('中文多字节被块边界切开 → pending 留存下一块，无损还原', async () => {
    let text = ''
    let pending = []
    const bs = bytesOf('手表GitHub客户端a')
    for (let i = 0; i < bs.length; i += 3) { /* 每 3 字节切一块，必然切碎中文 */
      const r = utf8DecodeChunk(pending, new Uint8Array(bs.slice(i, i + 3)))
      text += r.text
      pending = r.pending
    }
    assertEq(text, '手表GitHub客户端a', 'CJK roundtrip with 3-byte chunks')
  })

  await test('4 字节 emoji 跨块 + 代理对输出正确', async () => {
    let text = ''
    let pending = []
    const bs = bytesOf('a\u{1F600}b') /* a + 😀 + b */
    for (let i = 0; i < bs.length; i += 2) { /* 每 2 字节切碎，emoji 必跨块 */
      const r = utf8DecodeChunk(pending, new Uint8Array(bs.slice(i, i + 2)))
      text += r.text
      pending = r.pending
    }
    assertEq(text, 'a\u{1F600}b', 'emoji roundtrip')
  })

  await test('非法字节按 latin1 输出且不死循环', async () => {
    const r = utf8DecodeChunk([], new Uint8Array([0x61, 0xff, 0x62]))
    assertEq(r.text, 'a\u00ffb', 'illegal byte passthrough')
  })
}

/* ---------------- 4. raw Range 分块（getReadmeText / getFileRaw） ---------------- */

const README_MD = ('# Vela GitHub\n\n中文段落测试，包含**加粗**与代码块。\n\n```js\nconsole.log(1)\n```\n').repeat(300)
const README_BYTES = unescape(encodeURIComponent(README_MD))

function rawChunkHandler(calls, o) {
  if (o.url.indexOf('/git/trees/') > 0) {
    return { code: 200, data: { sha: 't', tree: [{ path: 'src', type: 'tree', sha: 's1' }, { path: 'README.md', type: 'blob', sha: 'b1', size: README_BYTES.length }] }, headers: {} }
  }
  if (o.url.indexOf('raw.githubusercontent.com') > 0) {
    const m = /bytes=(\d+)-(\d+)/.exec(o.header.Range)
    const start = Number(m[1])
    const end = Math.min(Number(m[2]), README_BYTES.length - 1)
    if (start >= README_BYTES.length) return { code: 416, data: '', headers: {} }
    const slice = README_BYTES.slice(start, end + 1)
    const u8 = new Uint8Array(slice.length)
    for (let i = 0; i < slice.length; i++) u8[i] = slice.charCodeAt(i)
    return { code: 206, data: u8, headers: { 'content-length': String(u8.length) } }
  }
  return { code: 404, data: { message: 'NF' }, headers: {} }
}

async function t_rawchunk() {
  await test('getReadmeText 分块重组完整 README（8KB 块 + 末短块）', async () => {
    const mocks = authedMocks(rawChunkHandler)
    const api = loadModule('src/utils/api.js', mocks)
    const r = await api.getReadmeText('o/r')
    assertEq(r.text, README_MD, 'chunked README identical')
    assertEq(r.name, 'README.md', 'readme name from tree')
    const rawCalls = mocks['@system.fetch'].calls.filter((c) => c.url.indexOf('raw.githubusercontent.com') > 0)
    assert(rawCalls.length >= 2, 'multiple chunk requests: ' + rawCalls.length)
    assertEq(rawCalls[0].header.Range, 'bytes=0-12287', 'first chunk range (v1.2.3 12KB 块)')
    assert(rawCalls[0].url.indexOf('https://raw.githubusercontent.com/o/r/HEAD/README.md') === 0, 'raw url base shape')
    assert(rawCalls[0].url.indexOf('?_b=0') > 0, 'chunk url jittered (v1.2.3 ?_b=)')
  })

  await test('平台无 arraybuffer（回调字符串）→ 文本模式重试同样完整', async () => {
    /* 真机 text 模式：平台把每个块按 UTF-8 解码成字符串再回调。
     * ASCII 内容保证块边界不切字符（CJK 跨块由字节模式与解码器单测覆盖） */
    const ASCII_MD = ('# Vela GitHub\n\nParagraph with **bold** and code block.\n\n```js\nconsole.log(1)\n```\n').repeat(300)
    const mocks = authedMocks((n, o) => {
      if (o.url.indexOf('/git/trees/') > 0) return rawChunkHandler(n, o)
      if (o.url.indexOf('raw.githubusercontent.com') > 0) {
        const m = /bytes=(\d+)-(\d+)/.exec(o.header.Range)
        const start = Number(m[1])
        const end = Math.min(Number(m[2]), ASCII_MD.length - 1)
        if (start >= ASCII_MD.length) return { code: 416, data: '', headers: {} }
        const slice = ASCII_MD.slice(start, end + 1)
        return { code: 206, data: slice, headers: { 'content-length': String(slice.length) } }
      }
      return rawChunkHandler(n, o)
    })
    const api = loadModule('src/utils/api.js', mocks)
    const r = await api.getReadmeText('o/r')
    assertEq(r.text, ASCII_MD, 'text-mode README identical')
  })

  await test('Range 被忽略返回 200 全文 → 降级返回首块全文', async () => {
    const mocks = authedMocks((n, o) => {
      if (o.url.indexOf('/git/trees/') > 0) return rawChunkHandler(n, o)
      if (o.url.indexOf('raw.githubusercontent.com') > 0) {
        const u8 = new Uint8Array(README_BYTES.length)
        for (let i = 0; i < README_BYTES.length; i++) u8[i] = README_BYTES.charCodeAt(i)
        return { code: 200, data: u8, headers: { 'content-length': String(u8.length) } }
      }
      return rawChunkHandler(n, o)
    })
    const api = loadModule('src/utils/api.js', mocks)
    const r = await api.getReadmeText('o/r')
    assertEq(r.text, README_MD, '200 full body returned')
  })

  await test('raw 404 / 树里没有 readme → 抛 fallback:true（页面回退 base64 通道）', async () => {
    const mocks1 = authedMocks((n, o) => {
      if (o.url.indexOf('/git/trees/') > 0) return { code: 200, data: { tree: [{ path: 'src', type: 'tree', sha: 's1' }] }, headers: {} }
      return { code: 404, data: { message: 'NF' }, headers: {} }
    })
    const api1 = loadModule('src/utils/api.js', mocks1)
    let c1 = null
    try { await api1.getReadmeText('o/r') } catch (e) { c1 = e }
    assert(c1 && c1.fallback === true, 'no-readme throws fallback')

    const mocks2 = authedMocks((n, o) => {
      if (o.url.indexOf('/git/trees/') > 0) return rawChunkHandler(n, o)
      if (o.url.indexOf('raw.githubusercontent.com') > 0) return { code: 404, data: 'not found', headers: {} }
      return rawChunkHandler(n, o)
    })
    const api2 = loadModule('src/utils/api.js', mocks2)
    let c2 = null
    try { await api2.getReadmeText('o/r') } catch (e) { c2 = e }
    assert(c2 && c2.fallback === true, 'raw 404 throws fallback')
  })

  await test('getFileRaw 分块成功；raw 404 回退 REST raw', async () => {
    const mocks1 = authedMocks(rawChunkHandler)
    const api1 = loadModule('src/utils/api.js', mocks1)
    const text = await api1.getFileRaw('o/r', 'README.md')
    assertEq(text, README_MD, 'chunked file identical')

    const mocks2 = authedMocks((n, o) => {
      if (o.url.indexOf('/git/trees/') > 0) return rawChunkHandler(n, o)
      if (o.url.indexOf('raw.githubusercontent.com') > 0) return { code: 404, data: 'not found', headers: {} }
      if (o.url.indexOf('/contents/README.md') > 0) return { code: 200, data: 'REST raw content', headers: {} }
      return { code: 404, data: { message: 'NF' }, headers: {} }
    })
    const api2 = loadModule('src/utils/api.js', mocks2)
    const t2 = await api2.getFileRaw('o/r', 'README.md')
    assertEq(t2, 'REST raw content', 'REST raw fallback')
  })

  await test('私有仓库场景：raw 404 回退 REST base64 README 仍可用（getReadme 契约不变）', async () => {
    const mocks = authedMocks((n, o) => {
      if (o.url.indexOf('/git/trees/') > 0) return rawChunkHandler(n, o)
      if (o.url.indexOf('raw.githubusercontent.com') > 0) return { code: 404, data: 'not found', headers: {} }
      if (o.url.indexOf('/readme') > 0) return { code: 200, data: { content: Buffer ? Buffer.from('# hello').toString('base64') : '' }, headers: {} }
      return rawChunkHandler(n, o)
    })
    const api = loadModule('src/utils/api.js', mocks)
    const r = await api.getReadme('o/r')
    assert(r && typeof r.content === 'string' && r.content.length > 0, 'getReadme base64 intact')
  })
}

/* ---------------- runner ---------------- */

async function main() {
  await t_graphql()
  await t_deviceflow()
  await t_utf8()
  await t_rawchunk()
  summary('v1.2.0')
}

main()

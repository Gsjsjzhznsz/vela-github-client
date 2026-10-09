/**
 * test_api_v114.js — v1.1.4 双通道持久化 + 下载兜底 行为级测试
 */
const { loadModule, assert, assertEq, test, summary } = require('./test_utils')

const TOKEN = 'ghp_' + 'a1B2c3D4e5F6g7H8i9Jk'.repeat(2) // 44 chars → ghp_ + 40
const TOKEN_OK = 'ghp_' + 'a'.repeat(36)
const GOOD_USER = { login: 'Gsjsjzhznsz', id: 1 }

/* ---------------- mock 工厂 ---------------- */

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
      if (Object.prototype.hasOwnProperty.call(map, uri)) {
        success({ text: map[uri] })
      } else fail(null, 301)
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

/** fetch mock：handler 队列，每轮 shift，末尾 sticky */
function makeFetch(handler) {
  const calls = []
  const m = {
    calls,
    fetch(opts) {
      calls.push(opts)
      Promise.resolve().then(() => {
        try {
          const r = handler(calls.length, opts)
          if (r && r.__fail) opts.fail(r.__fail, r.code)
          else opts.success(r)
        } catch (e) { opts.fail(String(e), 0) }
      })
    }
  }
  return m
}

/** downloader mock：完整成功流程 or 可配置失败 */
function makeDownloader(opts) {
  opts = opts || {}
  const calls = []
  return {
    calls,
    download({ url, header, success, fail }) {
      calls.push({ url, header })
      if (opts.breakDownload) return fail(null, 1000)
      success({ token: 'tk' + calls.length })
    },
    onDownloadComplete({ token, success, fail }) {
      if (opts.breakComplete) return fail(null, 1000)
      success({ uri: 'internal://cache/dl_' + token })
    }
  }
}

function buildMocks(fetchHandler, storageOpts, fileOpts, dlOpts) {
  return {
    '@system.fetch': makeFetch(fetchHandler),
    '@system.storage': makeStorage(storageOpts),
    '@system.file': makeFile(fileOpts),
    '@system.request': makeDownloader(dlOpts)
  }
}

/* ---------------- 1. 双通道持久化 ---------------- */

async function t_persist() {
  await test('saveToken 双通道写 + verifyPersisted 读回均真', async () => {
    const mocks = buildMocks((n, o) => ({ code: 200, data: GOOD_USER, headers: {} }))
    const api = loadModule('src/utils/api.js', mocks)
    await api.saveToken(TOKEN_OK)
    const pv = await api.verifyPersisted()
    assertEq(pv, { storage: true, file: true }, 'verifyPersisted both true')
    assertEq(mocks['@system.storage']._map['gh_token'], TOKEN_OK, 'storage has token')
    assertEq(mocks['@system.file']._map['internal://files/gh_token.txt'], TOKEN_OK, 'file has token')
    const d = api.storageDiag()
    assertEq(d.write, '双通道√', 'diag write=双通道√')
  })

  await test('storage.set 静默失败 → file 兜底存上，loadToken 从 file 恢复', async () => {
    const mocks = buildMocks((n, o) => ({ code: 200, data: GOOD_USER, headers: {} }),
      { breakSet: true })
    const api = loadModule('src/utils/api.js', mocks)
    await api.saveToken(TOKEN_OK)
    const d = api.storageDiag()
    assertEq(d.write, '仅file', 'diag write=仅file')
    assertEq(mocks['@system.file']._map['internal://files/gh_token.txt'], TOKEN_OK, 'file has token')
    // 新 context 模拟：重新 loadModule，共享同一 mock 存储
    const api2 = loadModule('src/utils/api.js', mocks)
    const t = await api2.loadToken(true)
    assertEq(t, TOKEN_OK, 'loadToken restores from file')
    assertEq(api2.storageDiag().src, 'file', 'diag src=file')
  })

  await test('storage 有值优先，不读 file', async () => {
    const mocks = buildMocks(null)
    const api = loadModule('src/utils/api.js', mocks)
    await api.saveToken(TOKEN_OK)
    const api2 = loadModule('src/utils/api.js', mocks)
    await api2.loadToken(true)
    assertEq(api2.storageDiag().src, 'storage', 'src=storage')
  })

  await test('双通道均失败 → 游客态且报错不崩', async () => {
    const mocks = buildMocks(null, { breakSet: true }, { breakWrite: true })
    const api = loadModule('src/utils/api.js', mocks)
    await api.saveToken(TOKEN_OK) // 不抛（内部吞错）
    const d = api.storageDiag()
    assertEq(d.write, '双通道均失败', 'diag write=双通道均失败')
    assertEq(api.hasToken(), true, '会话内仍有 token（内存态）')
  })

  await test('clearToken 两通道一起清', async () => {
    const mocks = buildMocks(null)
    const api = loadModule('src/utils/api.js', mocks)
    await api.saveToken(TOKEN_OK)
    await api.clearToken()
    assertEq(mocks['@system.storage']._map['gh_token'], undefined, 'storage cleared')
    assertEq(mocks['@system.file']._map['internal://files/gh_token.txt'], undefined, 'file cleared')
    const api2 = loadModule('src/utils/api.js', mocks)
    assertEq(await api2.loadToken(true), '', 'reload empty')
  })

  await test('storage.get 返回空串 → file 兜底', async () => {
    const mocks = buildMocks(null)
    const api = loadModule('src/utils/api.js', mocks)
    await api.saveToken(TOKEN_OK)
    mocks['@system.storage']._map['gh_token'] = '' // 模拟 storage 通道数据丢失
    const api2 = loadModule('src/utils/api.js', mocks)
    assertEq(await api2.loadToken(true), TOKEN_OK, 'file fallback read')
    assertEq(api2.storageDiag().src, 'file', 'src=file')
  })
}

/* ---------------- 2. 下载兜底 ---------------- */

async function t_download() {
  await test('fetch JSON 三连截断 → download 通道取回完整 JSON', async () => {
    const good = JSON.stringify([{ id: 1, name: 'v1.1.4' }])
    const mocks = buildMocks((n, o) => {
      if (String(o.url).indexOf('/releases') >= 0) {
        return { code: 200, data: good.slice(0, 10), headers: {} } // 必然截断（JSON 不可解析）
      }
      return { code: 200, data: {}, headers: {} }
    })
    const api = loadModule('src/utils/api.js', mocks)
    let dlUrl = ''
    mocks['@system.request'].download = ({ url, success }) => { dlUrl = url; success({ token: 't1' }) }
    mocks['@system.request'].onDownloadComplete = ({ success }) => success({ uri: 'internal://cache/x' })
    mocks['@system.file'].readText = ({ uri, success }) => success({ text: good })
    const d = await api.getReleases('a/b', 1)
    assertEq(d, JSON.parse(good), 'download fallback returns parsed JSON')
    assert(dlUrl.indexOf('/releases') >= 0, 'download used same url')
  })

  await test('download 失败 → 仍抛 incomplete', async () => {
    const mocks = buildMocks((n, o) => ({ code: 200, data: '{"trunc', headers: {} }))
    const api = loadModule('src/utils/api.js', mocks)
    let err = null
    try { await api.getRepo('a/b') } catch (e) { err = e }
    assert(err && err.incomplete === true, 'incomplete flag set')
  })

  await test('download 返回的 JSON 坏数据 → 抛 incomplete 不渲染残缺', async () => {
    const mocks = buildMocks((n, o) => ({ code: 200, data: '{"trunc', headers: {} }))
    const api = loadModule('src/utils/api.js', mocks)
    mocks['@system.file'].readText = ({ success }) => success({ text: '{"bad' })
    let err = null
    try { await api.getRepo('a/b') } catch (e) { err = e }
    assert(err && err.incomplete === true, 'incomplete when dl text unparseable')
  })

  await test('raw 截断 → download 取回原文按 raw 返回', async () => {
    const rawText = 'console.log("hello")'.repeat(50)
    const mocks = buildMocks((n, o) => {
      if (o.header && o.header.Accept === 'application/vnd.github.raw') {
        return { code: 200, data: rawText.slice(0, 100), headers: { 'content-length': String(rawText.length * 2) } }
      }
      return { code: 200, data: {}, headers: {} }
    })
    const api = loadModule('src/utils/api.js', mocks)
    mocks['@system.file'].readText = ({ success }) => success({ text: rawText })
    const out = await api.getFileRaw('a/b', 'x.js')
    assertEq(out, rawText, 'raw text via download')
  })

  await test('POST 不走 download 兜底（非 GET 直接 incomplete）', async () => {
    const mocks = buildMocks((n, o) => ({ code: 200, data: '{"trunc', headers: {} }))
    const api = loadModule('src/utils/api.js', mocks)
    let dlCalled = false
    mocks['@system.request'].download = () => { dlCalled = true }
    let err = null
    try { await api.addComment('https://api.github.com/x', 'hi') } catch (e) { err = e }
    assert(err && err.incomplete === true, 'incomplete thrown')
    assertEq(dlCalled, false, 'download not attempted for POST')
  })

  await test('请求头带 Authorization 进 download 通道', async () => {
    const mocks = buildMocks((n, o) => ({ code: 200, data: '{"trunc', headers: {} }))
    const api = loadModule('src/utils/api.js', mocks)
    await api.saveToken(TOKEN_OK)
    let seen = null
    mocks['@system.request'].download = ({ url, header, success }) => { seen = header; success({ token: 't' }) }
    try { await api.getRepo('a/b') } catch (e) {}
    assert(seen && seen.Authorization === 'Bearer ' + TOKEN_OK, 'auth header forwarded')
  })
}

/* ---------------- 3. 自适应分页 & 错误路径回归 ---------------- */

async function t_adaptive() {
  await test('per_page=10 截断且 download 败 → 降档 4 成功，lastListPerPage=4', async () => {
    const list4 = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]
    const mocks = buildMocks((n, o) => {
      const m = String(o.url).match(/per_page=(\d+)/)
      const per = m ? Number(m[1]) : 0
      if (per === 10) return { code: 200, data: '[{"id":1,"trunc', headers: {} }
      return { code: 200, data: list4, headers: {} }
    })
    const api = loadModule('src/utils/api.js', mocks)
    const d = await api.getReleases('a/b', 1)
    assertEq(d.length, 4, 'downgraded list returned')
    assertEq(api.lastListPerPage(), 4, 'lastListPerPage=4')
  })

  await test('403 传输层错误 → 直接抛限流，不降档不重试', async () => {
    const mocks = buildMocks((n, o) => ({ __fail: 'upload err, error code: 403' }))
    const api = loadModule('src/utils/api.js', mocks)
    let err = null
    try { await api.getReleases('a/b', 1) } catch (e) { err = e }
    assertEq(err.status, 403, 'status 403')
    assertEq(api.lastListPerPage(), 10, 'no ladder descent')
  })

  await test('404 → 直接抛 404 文案', async () => {
    const mocks = buildMocks((n, o) => ({ code: 404, data: { message: 'Not Found' }, headers: {} }))
    const api = loadModule('src/utils/api.js', mocks)
    let err = null
    try { await api.getRepo('no/such') } catch (e) { err = e }
    assertEq(err.status, 404, 'status 404')
    assertEq(err.message, '内容不存在（404）', 'friendly 404')
  })

  await test('getIssues 过滤 pull_request', async () => {
    const data = [{ id: 1, number: 1 }, { id: 2, number: 2, pull_request: { url: 'x' } }, { id: 3, number: 3 }]
    const mocks = buildMocks((n, o) => ({ code: 200, data, headers: {} }))
    const api = loadModule('src/utils/api.js', mocks)
    const out = await api.getIssues('a/b', 1)
    assertEq(out.length, 2, 'PR filtered')
  })

  await test('GET 200 空体三连 → incomplete（download 亦空）', async () => {
    const mocks = buildMocks((n, o) => ({ code: 200, data: '', headers: {} }))
    const api = loadModule('src/utils/api.js', mocks)
    let err = null
    try { await api.getRepo('a/b') } catch (e) { err = e }
    assert(err && err.incomplete === true, 'empty-body incomplete')
  })

  await test('raw content-length 对照：中文 3 字节估算不误判', async () => {
    const s = '标题内容'.repeat(30) // 120 汉字 = 360 字节
    const mocks = buildMocks((n, o) => ({
      code: 200,
      data: s,
      headers: { 'content-length': '360' }
    }))
    const api = loadModule('src/utils/api.js', mocks)
    const out = await api.getFileRaw('a/b', 'a.txt')
    assertEq(out, s, 'chinese bytes not undercounted')
  })

  await test('raw 真截断（字节数缺口>8）→ incomplete', async () => {
    const s = 'abc'
    const mocks = buildMocks((n, o) => ({
      code: 200,
      data: s,
      headers: { 'content-length': '500' }
    }))
    const api = loadModule('src/utils/api.js', mocks)
    let err = null
    try { await api.getFileRaw('a/b', 'a.txt') } catch (e) { err = e }
    assert(err && err.incomplete === true, 'real truncation detected')
  })
}

/* ---------------- 4. 基础回归 ---------------- */

async function t_basics() {
  await test('tokenFormatHint 五态', async () => {
    const api = loadModule('src/utils/api.js', buildMocks(null))
    assertEq(api.tokenFormatHint(''), '还没有输入内容', 'empty')
    assert(api.tokenFormatHint('ghp_short').indexOf('40 位') >= 0, 'ghp wrong length')
    assert(api.tokenFormatHint('ghp_' + 'a'.repeat(35) + '!').indexOf('非法字符') >= 0, 'ghp bad char')
    assertEq(api.tokenFormatHint('ghp_' + 'a'.repeat(36)), '', 'ghp ok')
    assertEq(api.tokenFormatHint('github_pat_' + 'a'.repeat(84)), '', 'github_pat ok')
    assert(api.tokenFormatHint('xyz_abc').indexOf('ghp_') >= 0, 'unknown prefix')
  })

  await test('validateToken 临时换 token 验证，失败恢复原值且不落盘', async () => {
    const mocks = buildMocks((n, o) => {
      const auth = o.header && o.header.Authorization
      if (auth === 'Bearer ' + TOKEN_OK) return { code: 200, data: GOOD_USER, headers: {} }
      return { code: 401, data: { message: 'Bad credentials' }, headers: {} }
    })
    const api = loadModule('src/utils/api.js', mocks)
    await api.saveToken(TOKEN_OK)
    let err = null
    try { await api.validateToken(TOKEN) } catch (e) { err = e }
    assertEq(err && err.status, 401, 'invalid token 401')
    assertEq(api.currentToken(), TOKEN_OK, 'original token restored')
    const pv = await api.verifyPersisted()
    assertEq(pv, { storage: true, file: true }, 'storage untouched')
  })

  await test('qs 编码', async () => {
    const api = loadModule('src/utils/api.js', buildMocks(null))
    assertEq(api.qs({ a: 1, b: 'x y', c: undefined }), '?a=1&b=x%20y', 'qs encode')
    assertEq(api.qs({}), '', 'qs empty')
  })

  await test('b64 decode UTF-8 中文', async () => {
    const m = loadModule('src/utils/b64.js', {})
    const dec = m.decode || (m.default && m.default.decode)
    // '中文内容' → UTF-8 → base64（无填充输入也要能解，v1.1.1 修复点）
    assertEq(dec('5Lit5paH5YaF5a65'), '中文内容', 'b64 decode utf8')
  })

  await test('request 入口自动 loadToken（匿名请求防护）', async () => {
    let seen = null
    const mocks = buildMocks((n, o) => {
      seen = o.header
      return { code: 200, data: GOOD_USER, headers: {} }
    })
    const api = loadModule('src/utils/api.js', mocks)
    await api.saveToken(TOKEN_OK)
    const api2 = loadModule('src/utils/api.js', mocks) // 新 context，未手动 loadToken
    await api2.getRateLimit()
    assertEq(seen.Authorization, 'Bearer ' + TOKEN_OK, 'auto-loaded token in header')
  })
}

;(async () => {
  console.log('--- 双通道持久化 ---')
  await t_persist()
  console.log('--- 下载兜底 ---')
  await t_download()
  console.log('--- 自适应分页 & 错误路径 ---')
  await t_adaptive()
  console.log('--- 基础回归 ---')
  await t_basics()
  summary()
})()

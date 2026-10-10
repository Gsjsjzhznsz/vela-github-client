/**
 * test_api_v140.js — v1.4.0 截断抢救 + GraphQL 目录/Blob 快车道 + 文件完整性基准
 *                  + AI 2026 模型清单/自动降级/通道自检/目录刷新 + scope models
 * 覆盖：
 *  ① salvageJsonArray（经 lastSalvageInfo 观察）：截断数组恢复前导条目 /
 *    对象体不抢救 / requestGo salvage 门控（opt.salvage）
 *  ② notifSubPage：per=2 截断抢救 → 仅补拉缺失尾条（1 次 per=1）；
 *    列表尾短页（无 salvage）零补拉
 *  ③ getDirList：GraphQL 瘦字段映射（dir/file/byteSize/oid）+ 404 直抛 +
 *    Blob 路径回落（gqlSkip）
 *  ④ ghqlBlob：text/isBinary/byteSize
 *  ⑤ getFileRawEx：api 域下载器优先（dl-api）+ expectedSize 完整性守门
 *    （截断体拒收落下一通道）+ 历史截断缓存作废重拉
 *  ⑥ AI：2026 五模型清单 / aiChat 模型自动降级（403→下一模型）/
 *    aiProbe 端点与文案 / aiModelsRemote 目录抢救解析
 *  ⑦ deviceFlowStart：FULL scope（含 models）→ 被拒回退基础 scope
 *  ⑧ identity 头：request/ghql/notifDl/下载器 header 断言
 */
const fs = require('fs')
const path = require('path')
const { loadModule, assert, assertEq, test, summary } = require('./test_utils')

const _tests = []
function T(name, fn) { _tests.push(test(name, fn)) }

const TOKEN_OK = 'ghp_' + 'a'.repeat(36)

function makeStorage(opts) {
  opts = opts || {}
  const map = {}
  return {
    _map: map,
    get({ key, success }) { success(Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null) },
    set({ key, value, success }) { map[key] = value; success() },
    delete({ key, success }) { delete map[key]; (success || function () {})() }
  }
}

function makeFile(opts) {
  opts = opts || {}
  const map = opts.map || {}
  return {
    _map: map,
    readText({ uri, success, fail }) {
      if (Object.prototype.hasOwnProperty.call(map, uri)) success({ text: map[uri] })
      else fail(null, 301)
    },
    writeText({ uri, text, success }) { map[uri] = text; success() },
    delete({ uri, success }) { delete map[uri]; (success || function () {})() }
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

function authed(contentByUrl, fetchHandler, dlOpts) {
  const f = makeFile()
  const d = makeDownloader(contentByUrl || {}, dlOpts)
  const origComplete = d.onDownloadComplete
  d.onDownloadComplete = function (o) {
    const wrapped = Object.assign({}, o, {
      success: (dd) => {
        const url = d.downloaded[Number(String(o.token).slice(2)) - 1]
        if (contentByUrl && Object.prototype.hasOwnProperty.call(contentByUrl, url)) {
          f._map[dd.uri] = contentByUrl[url]
        }
        o.success(dd)
      }
    })
    origComplete(wrapped)
  }
  const mocks = {
    '@system.fetch': makeFetch(fetchHandler),
    '@system.storage': makeStorage(),
    '@system.file': f,
    '@system.request': d,
    './b64': { decode: (s) => Buffer.from(String(s).replace(/\s/g, ''), 'base64').toString('utf8') }
  }
  mocks['@system.storage']._map['gh_token'] = TOKEN_OK
  mocks['@system.file']._map['internal://files/gh_token.txt'] = TOKEN_OK
  return mocks
}

function apiOf(mocks) { return loadModule('src/utils/api.js', mocks) }
function fetchUrl(o) { return o && o.url ? String(o.url) : '' }
function notifUrl(page, per, all) {
  return 'https://api.github.com/notifications?page=' + page + '&per_page=' + per + (all ? '&all=true' : '')
}

/* ---------------- ① 抢救解析 ---------------- */

T('salvage：requestGo salvage 门控——截断数组恢复前导条目', async () => {
  const item = (i) => ({ id: i, subject: { title: 't' + i } })
  const full = JSON.stringify([item(1), item(2)])
  const cut = full.slice(0, full.length - 6) /* 尾部截断 */
  const mocks = authed({}, () => ({ code: 200, data: cut, headers: {} }))
  const api = apiOf(mocks)
  const r = await api.request('/notifications?page=1&per_page=2', { noDl: true, salvage: true })
  assertEq(r.length, 1, '抢救出前导 1 条')
  assertEq(r[0].id, 1, '内容正确')
  const sv = api.lastSalvageInfo()
  assert(sv && sv.url === 'https://api.github.com/notifications?page=1&per_page=2', 'salvage 信息记录 URL')
  assertEq(sv.got, 1, 'salvage 条数')
})

T('salvage：未开 opt.salvage 不抢救（目录/树走下载器契约）', async () => {
  const mocks = authed({}, () => ({ code: 200, data: '[{"a":1},{"b":2', headers: {} }))
  const api = apiOf(mocks)
  let err = null
  try { await api.request('/repos/o/r/contents/x', { noDl: true }) } catch (e) { err = e }
  assert(err && err.incomplete, '未开抢救 → incomplete 抛出')
  assert(!api.lastSalvageInfo(), '不记 salvage 信息')
})

T('salvage：对象体（树）不抢救', async () => {
  const mocks = authed({}, () => ({ code: 200, data: '{"tree":[{"path":"a"', headers: {} }))
  const api = apiOf(mocks)
  let err = null
  try { await api.request('/x', { noDl: true, salvage: true }) } catch (e) { err = e }
  assert(err && err.incomplete, '对象截断仍 incomplete')
})

/* ---------------- ② 通知管线 ---------------- */

T('notifSubPage：per=1 截断 → 下载器兜底补齐（v1.5.0 主路）', async () => {
  const n1 = { id: 101, subject: { title: 'a' } }
  const n2 = { id: 102, subject: { title: 'b' } }
  const seen = []
  const mocks = authed({
    'https://api.github.com/notifications?page=1&per_page=1&all=true': JSON.stringify([n1])
  }, (i, o) => {
    const u = fetchUrl(o)
    if (u.indexOf('/notifications') < 0) return { code: 200, data: '{}', headers: {} }
    seen.push(u)
    /* 页 1 fetch 截断（单条对象不完整 → 抢救无门）→ notifDl 兜底供全文 */
    if (u.indexOf('per_page=1') >= 0 && u.indexOf('?page=1&') >= 0) {
      return { code: 200, data: JSON.stringify([n1]).slice(0, -6), headers: {} }
    }
    if (u.indexOf('per_page=1') >= 0 && u.indexOf('?page=2&') >= 0) {
      return { code: 200, data: JSON.stringify([n2]), headers: {} }
    }
    return { code: 200, data: '[]', headers: {} }
  })
  const api = apiOf(mocks)
  const list = await api.getNotifications(1, true)
  assertEq(list.length, 2, '页 1 下载器兜底 + 页 2 正常')
  assertEq(list[0].id, 101, '页 1 条目（下载器全文）')
  assertEq(list[1].id, 102, '页 2 条目')
  assertEq(api.lastNotifGaps().length, 0, '双通道兜底后无缺口')
})

T('notifSubPage：快速路径零下载器调用（v1.5.0 per=1 契约）', async () => {
  const n1 = { id: 201, subject: { title: 'only' } }
  const seen = []
  const mocks = authed({}, (i, o) => {
    const u = fetchUrl(o)
    if (u.indexOf('/notifications') < 0) return { code: 200, data: '{}', headers: {} }
    seen.push(u)
    if (u.indexOf('per_page=1') >= 0) return { code: 200, data: JSON.stringify([n1]), headers: {} }
    return { code: 200, data: '[]', headers: {} }
  })
  const api = apiOf(mocks)
  const list = await api.getNotifications(1, true)
  assertEq(list.length, 10, '10 个单页各 1 条')
  assertEq(seen.filter((u) => u.indexOf('per_page=2') >= 0).length, 0, '不再有 per=2 请求')
  assertEq(api.lastNotifGaps().length, 0, '无缺口')
})

T('notifDl：下载器截断体同样抢救（per=1 双条数组）', async () => {
  const n1 = { id: 301, subject: { title: 'x' } }
  const n2 = { id: 302, subject: { title: 'y' } }
  const mocks = authed({
    'https://api.github.com/notifications?page=1&per_page=1&all=true': JSON.stringify([n1])
  }, () => ({ code: 200, data: JSON.stringify([n1, n2]).slice(0, -10), headers: {} }))
  const api = apiOf(mocks)
  const list = await api.getNotifications(1, true)
  assert(list.length >= 1, 'fetch 截断 → 抢救/下载器至少得 1 条')
})

/* ---------------- ③ getDirList ---------------- */

T('getDirList：GraphQL 瘦字段映射 + identity 头', async () => {
  const mocks = authed({}, (i, o) => {
    assertEq(fetchUrl(o), 'https://api.github.com/graphql', 'GraphQL 端点')
    assertEq(o.method, 'POST', 'POST')
    assert(String(o.header['Accept-Encoding']) === 'identity', 'identity 头')
    const body = JSON.parse(o.data)
    assertEq(body.variables.e, 'HEAD:JavaApp/src', 'expression=ref:path')
    return { code: 200, data: JSON.stringify({ data: { repository: { object: {
      __typename: 'Tree', oid: 'tree0',
      entries: [
        { name: 'Main.java', type: 'blob', oid: 'b1', object: { byteSize: 1234 } },
        { name: 'util', type: 'tree', oid: 't9', object: null }
      ]
    } } } }) , headers: {} }
  })
  const api = apiOf(mocks)
  const list = await api.getDirList('o/r', 'JavaApp/src', '')
  assertEq(list.length, 2, '条目数')
  assertEq(list[0].name, 'Main.java')
  assertEq(list[0].type, 'file', 'blob→file')
  assertEq(list[0].size, 1234, 'byteSize→size')
  assertEq(list[0].path, 'JavaApp/src/Main.java', 'path 拼接')
  assertEq(list[1].type, 'dir', 'tree→dir')
  assertEq(list[1].sha, 't9', 'oid→sha（shaStack 依赖）')
})

T('getDirList：路径不存在 404 直抛（含大小写提示）', async () => {
  const mocks = authed({}, () => ({ code: 200, data: JSON.stringify({ data: { repository: { object: null } } }), headers: {} }))
  const api = apiOf(mocks)
  let err = null
  try { await api.getDirList('o/r', 'javaapp/src', '') } catch (e) { err = e }
  assert(err && err.status === 404, '404 状态')
  assert(String(err.message).indexOf('大小写') >= 0, '文案含大小写提示')
})

T('getDirList：Blob 路径 → gqlSkip 回落 contents', async () => {
  const mocks = authed({}, (i, o) => {
    if (fetchUrl(o).indexOf('/graphql') >= 0) {
      return { code: 200, data: JSON.stringify({ data: { repository: { object: { __typename: 'Blob', byteSize: 10, isBinary: false, text: '1234567890' } } } }), headers: {} }
    }
    return { code: 200, data: '[]', headers: {} }
  })
  const api = apiOf(mocks)
  let err = null
  try { await api.getDirList('o/r', 'a.txt', '') } catch (e) { err = e }
  assert(err && err.gqlSkip, 'Blob → gqlSkip（页面回落 REST）')
})

/* ---------------- ④ ghqlBlob ---------------- */

T('ghqlBlob：text/isBinary/byteSize + expression', async () => {
  const mocks = authed({}, (i, o) => {
    const body = JSON.parse(o.data)
    assertEq(body.variables.e, 'main:scripts/patch.py', 'expression')
    return { code: 200, data: JSON.stringify({ data: { repository: { object: {
      __typename: 'Blob', byteSize: 9735, isBinary: false, text: 'PY' + 'x'.repeat(9733)
    } } } }), headers: {} }
  })
  const api = apiOf(mocks)
  const g = await api.ghqlBlob('o/r', 'scripts/patch.py', 'main')
  assertEq(g.byteSize, 9735, 'byteSize')
  assert(g.text.length === 9735, 'text 长度')
  assert(!g.isBinary, '非二进制')
})

/* ---------------- ⑤ getFileRawEx 完整性 ---------------- */

T('getFileRawEx：api 域下载器优先（via=dl-api）', async () => {
  const apiRaw = 'https://api.github.com/repos/o/r/contents/a.txt'
  const raw = 'https://raw.githubusercontent.com/o/r/HEAD/a.txt'
  const body = 'hello-vela'
  const mocks = authed(
    { [apiRaw]: body, [raw]: body },
    () => ({ code: 500, data: '', headers: {} }) /* fetch 全 500：逼走下载器 */
  )
  const api = apiOf(mocks)
  const r = await api.getFileRawEx('o/r', 'a.txt', '', null)
  assertEq(r.via, 'dl-api', 'api 域主通道优先')
  assertEq(r.text, body, '内容正确')
  assertEq(mocks['@system.request'].downloaded[0], apiRaw, '首个下载 URL 为 api 域')
})

T('getFileRawEx：api 域 404 → raw 域兜底', async () => {
  const apiRaw = 'https://api.github.com/repos/o/r/contents/b.txt'
  const raw = 'https://raw.githubusercontent.com/o/r/HEAD/b.txt'
  const mocks = authed(
    { [raw]: 'raw-body' },
    () => ({ code: 500, data: '', headers: {} })
  )
  const api = apiOf(mocks)
  const r = await api.getFileRawEx('o/r', 'b.txt', '', null)
  assertEq(r.via, 'dl', '落 raw 域')
  assertEq(r.text, 'raw-body', '内容正确')
})

T('getFileRawEx：expectedSize 守门——下载器截断体拒收落下一通道', async () => {
  const raw = 'https://raw.githubusercontent.com/o/r/HEAD/c.py'
  const full = 'y'.repeat(9735)
  const mocks = authed(
    { [raw]: full.slice(0, 8000) }, /* 下载器给截断体 */
    (i, o) => {
      if (fetchUrl(o).indexOf('raw.githubusercontent') >= 0) {
        return { code: 206, data: full.slice(0, 12288), headers: { 'content-range': 'bytes 0-8191/9735' } }
      }
      return { code: 500, data: '', headers: {} }
    }
  )
  const api = apiOf(mocks)
  const r = await api.getFileRawEx('o/r', 'c.py', '', null, 9735)
  assertEq(r.text.length, 9735, '最终拿到完整内容（分块通道补齐）')
  assert(r.via === 'chunk' || r.via === 'gql' || r.via === 'rest', '非下载器通道 via=' + r.via)
})

T('getFileRawEx：GraphQL Blob 通道（via=gql）', async () => {
  const body = 'g'.repeat(500)
  const mocks = authed({}, (i, o) => {
    if (fetchUrl(o).indexOf('/graphql') >= 0) {
      return { code: 200, data: JSON.stringify({ data: { repository: { object: {
        __typename: 'Blob', byteSize: 500, isBinary: false, text: body
      } } } }), headers: {} }
    }
    return { code: 500, data: '', headers: {} } /* 其余通道全灭 */
  })
  const api = apiOf(mocks)
  const r = await api.getFileRawEx('o/r', 'd.txt', '', null, 500)
  assertEq(r.via, 'gql', 'Blob 直读通道')
  assertEq(r.text, body, '内容正确')
})

T('getFileRawEx：历史截断缓存作废重拉', async () => {
  const raw = 'https://raw.githubusercontent.com/o/r/HEAD/e.txt'
  const good = 'z'.repeat(9735)
  const mocks = authed(
    { [raw]: good },
    () => ({ code: 500, data: '', headers: {} })
  )
  /* 预埋截断缓存（模拟旧版本写入的 8KB 截断体） */
  const f = mocks['@system.file']
  const api = apiOf(mocks)
  /* fcache 索引在 storage：直接经 fcachePut 语义不可达，用第一次抓取后篡改文件体 */
  const r1 = await api.getFileRawEx('o/r', 'e.txt', '', null, 9735)
  assertEq(r1.via, 'dl', '首次正常（api 域无内容 → raw 域成功）')
  /* 篡改磁盘缓存为截断体（长度 ≠ 9735） */
  const keys = Object.keys(f._map)
  for (let i = 0; i < keys.length; i++) {
    if (f._map[keys[i]] && f._map[keys[i]].length === 9735) f._map[keys[i]] = good.slice(0, 8000)
  }
  const r2 = await api.getFileRawEx('o/r', 'e.txt', '', null, 9735)
  assertEq(r2.text.length, 9735, '截断缓存被识别 → 重新拉取完整体')
  assert(r2.via !== 'cache', '不再命中坏缓存 via=' + r2.via)
})

/* ---------------- ⑥ AI ---------------- */

T('AI：模型清单（v1.7.0 实证 3 模型，全为免费层 200 OK）', async () => {
  const api = apiOf(authed({}, () => ({ code: 200, data: '{}', headers: {} })))
  const ms = api.aiModels()
  assertEq(ms[0], 'gpt-4o-mini', '首模型为 gpt-4o-mini（实证最稳）')
  assertEq(ms.length, 3, '3 个模型（2026-10-10 实弹矩阵：免费层可用仅这三个）')
  assert(ms.indexOf('gpt-4.1') >= 0, '含 gpt-4.1')
  assert(ms.indexOf('gpt-4o') >= 0, '含 gpt-4o')
  assert(ms.every((m) => m.indexOf('/') < 0), 'Copilot API id 无 publisher 前缀')
})

T('AI：aiChat 模型自动降级（gpt-5 系 /responses 空体 → 下一模型，Copilot 通道）', async () => {
  let n = 0
  const models = []
  const mocks = authed({}, (i, o) => {
    const u = fetchUrl(o)
    if (u.indexOf('copilot_internal/v2/token') >= 0) {
      return { code: 200, data: JSON.stringify({ token: 'tid=1;exp=9999999999;sku=cp', endpoints: { api: 'https://api.individual.githubcopilot.com' }, expires_at: Math.floor(Date.now() / 1000) + 1800 }), headers: {} }
    }
    if (u.indexOf('/responses') >= 0) return { code: 200, data: '{}', headers: {} }
    if (u.indexOf('chat/completions') >= 0) {
      n++
      const body = JSON.parse(o.data)
      models.push(body.model)
      if (body.model === 'gpt-4.1') return { code: 400, data: JSON.stringify({ error: { message: 'The requested model is not supported.', code: 'model_not_supported' } }), headers: {} }
      return { code: 200, data: JSON.stringify({ model: body.model, choices: [{ message: { content: 'ok' } }], usage: { total_tokens: 3 } }), headers: {} }
    }
    return { code: 200, data: '{}', headers: {} }
  })
  mocks['@system.storage']._map['gh_copilot_token'] = 'ghu_' + 'c'.repeat(36)
  const api = apiOf(mocks)
  const r = await api.aiChat([{ role: 'user', content: 'hi' }], { model: 'gpt-4.1' })
  assertEq(r.text, 'ok', '回复内容')
  assertEq(r.model, 'gpt-4o', '实际用下一模型（gpt-4.1 → gpt-4o）')
  assertEq(models.length, 2, 'chat 2 次（gpt-4.1 400 → /responses 空体回抛 → 降级 gpt-4o）')
})

T('AI：aiChat 额度错误（429）不降级', async () => {
  let n = 0
  const mocks = authed({}, (i, o) => {
    const u = fetchUrl(o)
    if (u.indexOf('copilot_internal/v2/token') >= 0) {
      return { code: 200, data: JSON.stringify({ token: 'tid=1;exp=9999999999;sku=cp', endpoints: { api: 'https://api.individual.githubcopilot.com' }, expires_at: Math.floor(Date.now() / 1000) + 1800 }), headers: {} }
    }
    if (u.indexOf('chat/completions') >= 0) { n++; return { code: 429, data: '{}', headers: {} } }
    return { code: 200, data: '{}', headers: {} }
  })
  mocks['@system.storage']._map['gh_copilot_token'] = 'ghu_' + 'c'.repeat(36)
  const api = apiOf(mocks)
  let err = null
  try { await api.aiChat([{ role: 'user', content: 'hi' }], { model: 'gpt-5-mini' }) } catch (e) { err = e }
  assert(err && err.status === 429, '429 直抛')
  assertEq(n, 1, '仅 1 次推理请求（429 不换模型）')
})

T('AI：aiProbe（/copilot_internal/user 404 + PAT 未授权 + Models 退役）', async () => {
  const mocks = authed({}, (i, o) => {
    const u = fetchUrl(o)
    if (u === 'https://api.github.com/copilot_internal/user') return { code: 404, data: JSON.stringify({ message: 'Not Found' }), headers: {} }
    return { code: 200, data: '{}', headers: {} }
  })
  const api = apiOf(mocks)
  const p = await api.aiProbe()
  assertEq(p.copilot, '未开通', 'internal/user 404 → 未开通')
  assert(String(p.copilotHint).indexOf('settings/copilot') >= 0, '指引含开通入口')
  assertEq(p.exchange, '未授权', 'PAT 未做 Copilot 授权')
  assert(String(p.copilotHint).indexOf('授权') >= 0, '指引一键授权')
  assert(String(p.models).indexOf('退役') >= 0, 'Models 退役说明（不再发请求）')
  const urls = mocks['@system.fetch'].calls.map(fetchUrl)
  assert(urls.every((u) => u.indexOf('models.github.ai') < 0), 'Models 零请求')
})

T('AI：aiProbe PAT 可查 /copilot_internal/user（free_limited 不再误报）', async () => {
  const mocks = authed({}, (i, o) => {
    const u = fetchUrl(o)
    if (u === 'https://api.github.com/copilot_internal/user') {
      return { code: 200, data: JSON.stringify({ access_type_sku: 'free_limited_copilot', chat_enabled: true, quota_snapshots: { chat: { remaining: 187, entitlement: 200 } } }), headers: {} }
    }
    return { code: 200, data: '{}', headers: {} }
  })
  const api = apiOf(mocks)
  const p = await api.aiProbe()
  assert(String(p.copilot).indexOf('已开通') >= 0, '不再误报未开通：' + p.copilot)
  assert(String(p.copilot).indexOf('Copilot Free') >= 0, '套餐名')
  assertEq(p.quotaChat, '187/200', '会话额度')
})

T('AI：copilotModels 目录拉取 + chat 过滤 + 去重', async () => {
  const catalog = { data: [
    { id: 'gpt-5-mini', capabilities: { type: 'chat' } },
    { id: 'claude-haiku-4.5', capabilities: { type: 'chat' } },
    { id: 'text-embedding-3-small', capabilities: { type: 'embeddings' } },
    { id: 'gpt-5-mini' }
  ] }
  const mocks = authed({}, (i, o) => {
    const u = fetchUrl(o)
    if (u.indexOf('copilot_internal/v2/token') >= 0) {
      return { code: 200, data: JSON.stringify({ token: 'tid=1;exp=9999999999;sku=cp', endpoints: { api: 'https://api.individual.githubcopilot.com' }, expires_at: Math.floor(Date.now() / 1000) + 1800 }), headers: {} }
    }
    if (u.indexOf('/models') >= 0) {
      assertEq(u, 'https://api.individual.githubcopilot.com/models', '按套餐端点拉模型目录')
      assertEq(o.header['X-GitHub-Api-Version'], '2025-04-01', '版本头（v1.6.0 LiteLLM 实证栈）')
      return { code: 200, data: JSON.stringify(catalog), headers: {} }
    }
    return { code: 200, data: '{}', headers: {} }
  })
  mocks['@system.storage']._map['gh_copilot_token'] = 'ghu_' + 'c'.repeat(36)
  const api = apiOf(mocks)
  const ids = await api.copilotModels()
  assertEq(ids.length, 2, '只留 chat 且去重')
  assertEq(ids[0], 'gpt-5-mini', 'id 提取')
})

T('AI：copilotModels 截断响应抢救', async () => {
  const catalog = JSON.stringify([{ id: 'gpt-5-mini' }, { id: 'claude-haiku-4.5' }, { id: 'meta/l' }])
  const mocks = authed({}, (i, o) => {
    const u = fetchUrl(o)
    if (u.indexOf('copilot_internal/v2/token') >= 0) {
      return { code: 200, data: JSON.stringify({ token: 'tid=1;exp=9999999999;sku=cp', endpoints: { api: 'https://api.individual.githubcopilot.com' }, expires_at: Math.floor(Date.now() / 1000) + 1800 }), headers: {} }
    }
    if (u.indexOf('/models') >= 0) return { code: 200, data: catalog.slice(0, -12), headers: {} }
    return { code: 200, data: '{}', headers: {} }
  })
  mocks['@system.storage']._map['gh_copilot_token'] = 'ghu_' + 'c'.repeat(36)
  const api = apiOf(mocks)
  const ids = await api.copilotModels()
  assert(ids.length >= 1, '截断响应经 salvage 抢救：' + ids.join(','))
})

/* ---------------- ⑦ device scope ---------------- */

T('deviceFlowStart：login 收敛基础 scope；copilot 模式 Iv1 client', async () => {
  const scopes = []
  const mocks = authed({}, (i, o) => {
    if (fetchUrl(o) === 'https://github.com/login/device/code') {
      scopes.push(String(o.data))
      return { code: 200, data: JSON.stringify({ device_code: 'dc', user_code: 'ABCD-1234', verification_uri: 'https://github.com/login/device', interval: 5 }), headers: {} }
    }
    return { code: 200, data: '{}', headers: {} }
  })
  const api = apiOf(mocks)
  const d = await api.deviceFlowStart()
  assertEq(d.userCode, 'ABCD-1234', 'user code')
  assertEq(scopes.length, 1, 'v1.5.0：单 scope 一次发起（非法 scope 首试已移除）')
  assert(scopes[0].indexOf('models') < 0 && scopes[0].indexOf('copilot') < 0, 'login scope 不含 models/copilot')
  await api.deviceFlowStart('copilot')
  assert(scopes[1].indexOf('Iv1.b507a08c87ecfe98') >= 0, 'copilot 模式用 GitHub App client')
  assert(scopes[1].indexOf('read%3Auser') >= 0, 'copilot scope read:user')
})

/* ---------------- ⑧ identity 头 ---------------- */

T('identity：REST/GraphQL/通知下载器均带 Accept-Encoding: identity', async () => {
  const seen = { rest: false, gql: false }
  const mocks = authed({}, (i, o) => {
    const u = fetchUrl(o)
    if (u.indexOf('/graphql') >= 0) {
      if (o.header['Accept-Encoding'] === 'identity') seen.gql = true
      return { code: 200, data: JSON.stringify({ data: { repository: { object: null } } }), headers: {} }
    }
    if (u.indexOf('api.github.com') >= 0) {
      if (o.header['Accept-Encoding'] === 'identity') seen.rest = true
      return { code: 200, data: '[]', headers: {} }
    }
    return { code: 200, data: '', headers: {} }
  })
  const api = apiOf(mocks)
  await api.request('/notifications?page=1&per_page=1', { noDl: true })
  await api.getDirList('o/r', '', '').catch(() => {})
  assert(seen.rest, 'REST identity')
  assert(seen.gql, 'GraphQL identity')
})

;(async () => {
  for (const t of _tests) await t
  summary()
})().catch((e) => { console.error(e); process.exit(1) })

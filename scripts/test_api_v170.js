/**
 * test_api_v170.js — v1.7.0 模型目录过滤 + 实证置顶 + 端点图路由 + 截断防毒化
 * 依据 2026-10-10 用户授权实弹全矩阵（cp_probe2_result.json）：
 *  - /models 全量 39.5KB 超手表 8KB 截断阈值 → 设备只见目录头部死模型
 *  - 免费层可用模型仅 gpt-4o-mini / gpt-4.1 / gpt-4o
 *  - state=disabled 与实测一致；supported_endpoints 顶层字段（含 ws:/ 变体）
 * 覆盖：
 *  ① copilotModels：disabled/内部工具/embeddings 剔除 + 实证置顶 + 去重
 *  ② 端点图路由：responses-only 直达零 chat；chat-only 400 不做无谓 /responses 重试
 *  ③ aiModelsSetRemote 三防：无实证模型片段拒替换；有实证 → 置顶 + 上限 12
 *  ④ 截断目录 salvage：残片修复 + 过滤后仍产出可用模型
 */
const { loadModule, assert, assertEq, test, summary } = require('./test_utils')

const _tests = []
function T(name, fn) { _tests.push(test(name, fn)) }

const TOKEN_OK = 'ghp_' + 'a'.repeat(36)
const GHU_OK = 'ghu_' + 'b'.repeat(36)
const COPILOT_EXCH_URL = 'https://api.github.com/copilot_internal/v2/token'
const CP_API = 'https://api.individual.githubcopilot.com'
const CHAT_URL = CP_API + '/chat/completions'
const RESP_URL = CP_API + '/responses'
const MODELS_URL = CP_API + '/models'
const EXCH_RESP = JSON.stringify({
  token: 'tid=abc;exp=999999;sku=copilot_free_limit',
  endpoints: { api: CP_API },
  expires_at: Math.floor(Date.now() / 1000) + 1800
})

function makeStorage() {
  const map = {}
  return {
    _map: map,
    get({ key, success }) { success(Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null) },
    set({ key, value, success }) { map[key] = value; success() },
    delete({ key, success }) { delete map[key]; (success || function () {})() }
  }
}

function makeFile() {
  const map = {}
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

function makeDownloader() {
  let tk = 0
  return {
    download({ success, fail }) { tk++; Promise.resolve().then(() => success({ token: 'tk' + tk })) },
    onDownloadComplete({ token, success, fail }) { Promise.resolve().then(() => fail(null, 1002)) }
  }
}

function authed(fetchHandler, opts) {
  opts = opts || {}
  const mocks = {
    '@system.fetch': makeFetch(fetchHandler),
    '@system.storage': makeStorage(),
    '@system.file': makeFile(),
    '@system.request': makeDownloader(),
    './b64': { decode: (s) => Buffer.from(String(s).replace(/\s/g, ''), 'base64').toString('utf8') }
  }
  mocks['@system.storage']._map['gh_token'] = opts.mainToken || TOKEN_OK
  mocks['@system.file']._map['internal://files/gh_token.txt'] = opts.mainToken || TOKEN_OK
  if (opts.aiToken) {
    mocks['@system.storage']._map['gh_copilot_token'] = opts.aiToken
    mocks['@system.file']._map['internal://files/gh_copilot_token.txt'] = opts.aiToken
  }
  return mocks
}

function apiOf(mocks) { return loadModule('src/utils/api.js', mocks) }
function fetchUrl(o) { return o && o.url ? String(o.url) : '' }

/* ---------------- ① 目录过滤 + 实证置顶 ---------------- */

T('① copilotModels 过滤：disabled/内部工具/embeddings 剔除 + 实证置顶 + 去重', async () => {
  const mocks = authed((i, o) => {
    const u = fetchUrl(o)
    if (u === COPILOT_EXCH_URL) return { code: 200, data: EXCH_RESP, headers: {} }
    if (u === MODELS_URL) {
      return {
        code: 200,
        data: JSON.stringify({ data: [
          { id: 'copilot-search-a', policy: { state: 'enabled' } },
          { id: 'exec-agent-b', policy: { state: 'enabled' } },
          { id: 'trajectory-compaction' },
          { id: 'mai-foo-utility' },
          { id: 'gemini-3.7-flash', policy: { state: 'disabled' } },
          { id: 'gpt-5.4-mini', policy: { state: 'disabled' }, supported_endpoints: ['/responses'] },
          { id: 'text-embedding-3-small', capabilities: { type: 'embeddings' } },
          { id: 'kimi-k3', policy: { state: 'enabled' }, supported_endpoints: ['/chat/completions'] },
          { id: 'gpt-5-mini', policy: { state: 'enabled' }, supported_endpoints: ['/chat/completions', '/responses', 'ws:/responses'] },
          { id: 'gpt-4o-mini' },
          { id: 'gpt-4o' },
          { id: 'gpt-4o-mini' } /* 去重 */
        ] }),
        headers: {}
      }
    }
    return { code: 200, data: '{}', headers: {} }
  }, { aiToken: GHU_OK })
  const api = apiOf(mocks)
  const ids = await api.copilotModels()
  assertEq(ids.join(','), 'gpt-4o-mini,gpt-4o,kimi-k3,gpt-5-mini',
    '过滤后实证模型置顶（目录原序 gpt-4o-mini 排 26+ 位，截断片段见不到）')
})

/* ---------------- ② 端点图路由 ---------------- */

T('② 图标 responses-only → 直达 /responses，零 chat 请求', async () => {
  const mocks = authed((i, o) => {
    const u = fetchUrl(o)
    if (u === COPILOT_EXCH_URL) return { code: 200, data: EXCH_RESP, headers: {} }
    if (u === MODELS_URL) return { code: 200, data: JSON.stringify({ data: [
      { id: 'gpt-4o-mini' },
      { id: 'gpt-5.4-mini-free-auto', supported_endpoints: ['/responses', 'ws:/responses'] }
    ] }), headers: {} }
    if (u === RESP_URL) return { code: 200, data: JSON.stringify({ output_text: 'resp-direct' }), headers: {} }
    return { code: 200, data: '{}', headers: {} }
  }, { aiToken: GHU_OK })
  const api = apiOf(mocks)
  api.aiModelsSetRemote(await api.copilotModels())
  const r = await api.aiChat([{ role: 'user', content: 'hi' }], { model: 'gpt-5.4-mini-free-auto' })
  assertEq(r.text, 'resp-direct', '直达取文')
  assertEq(r.ep, 'responses', 'ep=responses')
  const urls = mocks['@system.fetch'].calls.map(fetchUrl)
  assert(urls.every((u) => u !== CHAT_URL), '零 chat 请求（旧版会先撞一次 400）')
})

T('② 图标 chat-only → 400 不做 /responses 无谓重试，直接降级下一模型', async () => {
  const seq = []
  const mocks = authed((i, o) => {
    const u = fetchUrl(o)
    if (u === COPILOT_EXCH_URL) return { code: 200, data: EXCH_RESP, headers: {} }
    if (u === MODELS_URL) return { code: 200, data: JSON.stringify({ data: [
      { id: 'gpt-4o-mini' }, { id: 'gpt-4.1' },
      { id: 'kimi-k3', supported_endpoints: ['/chat/completions'] }
    ] }), headers: {} }
    if (u === CHAT_URL) {
      const body = JSON.parse(o.data)
      seq.push('chat:' + body.model)
      if (body.model === 'kimi-k3') return { code: 400, data: JSON.stringify({ error: { message: 'The requested model is not supported.', code: 'model_not_supported' } }), headers: {} }
      return { code: 200, data: JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), headers: {} }
    }
    if (u === RESP_URL) { seq.push('resp'); return { code: 200, data: JSON.stringify({ output_text: 'x' }), headers: {} } }
    return { code: 200, data: '{}', headers: {} }
  }, { aiToken: GHU_OK })
  const api = apiOf(mocks)
  api.aiModelsSetRemote(await api.copilotModels())
  const r = await api.aiChat([{ role: 'user', content: 'hi' }], { model: 'kimi-k3' })
  assertEq(r.model, 'gpt-4o-mini', '降级到下一模型')
  assertEq(seq.join(','), 'chat:kimi-k3,chat:gpt-4o-mini', 'kimi 400 后零 /responses 重试直接降级')
})

/* ---------------- ③ aiModelsSetRemote 三防 ---------------- */

T('③ 无实证模型片段（截断目录头部）→ 拒绝替换，保兜底实证表', async () => {
  const api = apiOf(authed(() => ({ code: 200, data: '{}', headers: {} })))
  const before = api.aiModels().slice()
  const ok = api.aiModelsSetRemote(['copilot-search-a', 'kimi-k3', 'gpt-5.6-luna'])
  assert(!ok, '返回 false')
  assertEq(api.aiModels().join(','), before.join(','), '默认表不被死模型毒化')
})

T('③ 有实证模型片段 → 置顶 + 上限 12', async () => {
  const api = apiOf(authed(() => ({ code: 200, data: '{}', headers: {} })))
  const ids = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'a10', 'gpt-4o', 'b1', 'b2']
  const ok = api.aiModelsSetRemote(ids)
  assert(ok, '返回 true')
  const ms = api.aiModels()
  assertEq(ms[0], 'gpt-4o', '实证模型置顶')
  assertEq(ms.length, 12, '上限 12')
})

/* ---------------- ④ 截断目录 salvage ---------------- */

T('④ 目录 JSON 被截断 → salvage 修复 + 过滤后产出可用模型', async () => {
  const mocks = authed((i, o) => {
    const u = fetchUrl(o)
    if (u === COPILOT_EXCH_URL) return { code: 200, data: EXCH_RESP, headers: {} }
    if (u === MODELS_URL) {
      /* 模拟 8KB 截断：残片停在对象中间 */
      return { code: 200, data: '{"data":[{"id":"copilot-search-a"},{"id":"gemini-3.7-flash","policy":{"state":"disabled"}},{"id":"gpt-4o-mi', headers: {} }
    }
    return { code: 200, data: '{}', headers: {} }
  }, { aiToken: GHU_OK })
  const api = apiOf(mocks)
  const ids = await api.copilotModels()
  assert(Array.isArray(ids), '返回数组')
  /* 残片截断在 gpt-4o-mi 名字中间，无法修复出完整 id → 过滤后为空；不给死模型 */
  assertEq(ids.length, 0, '残片无法修复出完整模型 id 时不产出半截 id')
})

;(async () => {
  for (const t of _tests) await t
  summary()
})()

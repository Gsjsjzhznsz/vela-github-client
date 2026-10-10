/**
 * test_api_v160.js — v1.6.0 AI 实证头栈 + /responses 端点 + 交换失败直透 +
 *                    通知限流分级 + 诊断信息
 * 覆盖：
 *  ① 身份头双栈：交换段 GithubCopilot/1.155.0 + vscode/1.85.1（LiteLLM 实证，
 *    无 integration 头）；调用段 GitHubCopilotChat/0.26.7 + vscode/1.95.0 +
 *    copilot-chat/0.26.7 + vscode-chat + conversation-panel + 2025-04-01
 *  ② 交换 403 → exchangeFail 立即透出（零模型降级，仅 1 次 fetch）
 *  ③ gpt-5 系直达 /responses（Docker 文档：新模型对 chat/completions 恒 400）；
 *    output_text 与 output[].content[].text 双路取文
 *  ④ 老模型 chat 400 → 同模型 /responses 回退成功
 *  ⑤ 降级耗尽保留信息量最大的错误（原文 400 优先于「缺内容」噪声）
 *  ⑥ 兜底模型顺序：gpt-4o-mini 先行（/chat/completions 最稳）
 *  ⑦ friendlyMessage 403 分级：认证用户（额度 5000）→ 二级限流文案
 *  ⑧ 通知并发 NOTIF_CONC=2（源码断言，防二级限流回归）
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

/* ---------------- ① 身份头双栈 ---------------- */

T('① 调用段头栈：vscode-chat 组合（LiteLLM 生产实证）', async () => {
  const seen = {}
  const mocks = authed((i, o) => {
    const u = fetchUrl(o)
    if (u === COPILOT_EXCH_URL) return { code: 200, data: EXCH_RESP, headers: {} }
    if (u === CHAT_URL) { seen.chat = o; return { code: 200, data: JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), headers: {} } }
    return { code: 200, data: '{}', headers: {} }
  }, { aiToken: GHU_OK })
  const api = apiOf(mocks)
  await api.aiChat([{ role: 'user', content: 'hi' }], { model: 'gpt-4o-mini' })
  const h = seen.chat.header
  assertEq(h['User-Agent'], 'GitHubCopilotChat/0.26.7', 'chat UA')
  assertEq(h['Editor-Version'], 'vscode/1.95.0', 'chat Editor-Version')
  assertEq(h['Editor-Plugin-Version'], 'copilot-chat/0.26.7', 'chat Editor-Plugin-Version')
  assertEq(h['Copilot-Integration-Id'], 'vscode-chat', 'chat integration')
  assertEq(h['Openai-Intent'], 'conversation-panel', 'chat Openai-Intent')
  assertEq(h['X-GitHub-Api-Version'], '2025-04-01', 'chat API 版本')
})

T('① 交换段头栈：GithubCopilot/1.155.0 组合，无 integration 头', async () => {
  const seen = {}
  const mocks = authed((i, o) => {
    const u = fetchUrl(o)
    if (u === COPILOT_EXCH_URL) { seen.exch = o; return { code: 200, data: EXCH_RESP, headers: {} } }
    if (u === CHAT_URL) return { code: 200, data: JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), headers: {} }
    return { code: 200, data: '{}', headers: {} }
  }, { aiToken: GHU_OK })
  const api = apiOf(mocks)
  await api.aiChat([{ role: 'user', content: 'hi' }], { model: 'gpt-4o-mini' })
  const h = seen.exch.header
  assertEq(h['User-Agent'], 'GithubCopilot/1.155.0', '交换 UA（LiteLLM authenticator）')
  assertEq(h['Editor-Version'], 'vscode/1.85.1', '交换 Editor-Version')
  assertEq(h['Editor-Plugin-Version'], 'copilot/1.155.0', '交换 Editor-Plugin-Version')
  assertEq(h['Authorization'], 'token ' + GHU_OK, '交换 token scheme')
  assert(!('Copilot-Integration-Id' in h), '交换段无 integration 头（LiteLLM 实证栈）')
  assert(!('Openai-Intent' in h), '交换段无 Openai-Intent')
})

/* ---------------- ② 交换失败直透 ---------------- */

T('② 交换 403 → exchangeFail 立即透出，零模型降级零 chat 请求', async () => {
  const mocks = authed((i, o) => {
    const u = fetchUrl(o)
    if (u === COPILOT_EXCH_URL) return { code: 403, data: JSON.stringify({ message: 'token not authorized for this integration' }), headers: {} }
    return { code: 200, data: '{}', headers: {} }
  }, { aiToken: GHU_OK })
  const api = apiOf(mocks)
  let e = null
  try { await api.aiChat([{ role: 'user', content: 'hi' }]) } catch (x) { e = x }
  assert(e && e.exchangeFail, 'exchangeFail 标志')
  assertEq(e.status, 403, '状态 403')
  assert(String(e.message).indexOf('[交换]') === 0, '步骤标签开头：' + (e && e.message))
  assert(String(e.message).indexOf('403') >= 0, '含状态码')
  const urls = mocks['@system.fetch'].calls.map(fetchUrl)
  assertEq(urls.length, 1, '仅 1 次交换请求（HTTP 403 是有效响应不重试；无 chat/模型循环）')
  assert(urls.every((u) => u === COPILOT_EXCH_URL), '全部是交换请求')
})

/* ---------------- ③ /responses 直达与取文 ---------------- */

T('③ gpt-5-mini 直达 /responses（output_text 取文）', async () => {
  const seen = {}
  const mocks = authed((i, o) => {
    const u = fetchUrl(o)
    if (u === COPILOT_EXCH_URL) return { code: 200, data: EXCH_RESP, headers: {} }
    if (u === RESP_URL) {
      seen.resp = o
      return { code: 200, data: JSON.stringify({ output_text: 'resp-ok', usage: { total_tokens: 7 } }), headers: {} }
    }
    return { code: 200, data: '{}', headers: {} }
  }, { aiToken: GHU_OK })
  const api = apiOf(mocks)
  const r = await api.aiChat([{ role: 'user', content: 'hi' }], { model: 'gpt-5-mini' })
  assertEq(r.text, 'resp-ok', 'output_text 取文')
  assertEq(r.ep, 'responses', 'ep=responses')
  assertEq(r.model, 'gpt-5-mini', '模型')
  assertEq(seen.resp.header.Authorization, 'Bearer tid=abc;exp=999999;sku=copilot_free_limit', '会话凭据')
  const body = JSON.parse(seen.resp.data)
  assertEq(body.model, 'gpt-5-mini', '请求体模型')
  assert(Array.isArray(body.input), 'input 为消息数组')
  assertEq(body.max_output_tokens, 700, 'max_output_tokens')
  const urls = mocks['@system.fetch'].calls.map(fetchUrl)
  assert(urls.every((u) => u !== CHAT_URL), '绝不先打 /chat/completions（Docker 文档：恒 400）')
})

T('③ gpt-5-mini /responses 无 output_text → output[].content[].text 拼接', async () => {
  const mocks = authed((i, o) => {
    const u = fetchUrl(o)
    if (u === COPILOT_EXCH_URL) return { code: 200, data: EXCH_RESP, headers: {} }
    if (u === RESP_URL) {
      return { code: 200, data: JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: '拼' }, { type: 'output_text', text: '接-ok' }] }] }), headers: {} }
    }
    return { code: 200, data: '{}', headers: {} }
  }, { aiToken: GHU_OK })
  const api = apiOf(mocks)
  const r = await api.aiChat([{ role: 'user', content: 'hi' }], { model: 'gpt-5-mini' })
  assertEq(r.text, '拼接-ok', 'output[] 取文')
})

/* ---------------- ④ chat 400 → /responses 回退 ---------------- */

T('④ gpt-4o-mini chat 400 → 同模型 /responses 回退成功', async () => {
  const seq = []
  const mocks = authed((i, o) => {
    const u = fetchUrl(o)
    if (u === COPILOT_EXCH_URL) return { code: 200, data: EXCH_RESP, headers: {} }
    if (u === CHAT_URL) { seq.push('chat'); return { code: 400, data: JSON.stringify({ error: { message: 'model does not support chat/completions' } }), headers: {} } }
    if (u === RESP_URL) {
      seq.push('resp')
      const body = JSON.parse(o.data)
      assertEq(body.model, 'gpt-4o-mini', '回退同模型')
      return { code: 200, data: JSON.stringify({ output_text: 'fallback-ok' }), headers: {} }
    }
    return { code: 200, data: '{}', headers: {} }
  }, { aiToken: GHU_OK })
  const api = apiOf(mocks)
  const r = await api.aiChat([{ role: 'user', content: 'hi' }], { model: 'gpt-4o-mini' })
  assertEq(r.text, 'fallback-ok', '回退成功')
  assertEq(r.ep, 'responses', 'ep=responses')
  assertEq(seq.join(','), 'chat,resp', '先 chat 后 responses')
})

/* ---------------- ⑤ 错误保留 ---------------- */

T('⑤ 降级耗尽：保留带原文的信息量最大错误（非「缺内容」噪声）', async () => {
  const mocks = authed((i, o) => {
    const u = fetchUrl(o)
    if (u === COPILOT_EXCH_URL) return { code: 200, data: EXCH_RESP, headers: {} }
    if (u === CHAT_URL) return { code: 400, data: JSON.stringify({ error: { message: 'model_not_supported: xyz-模型被下线' } }), headers: {} }
    return { code: 200, data: '{}', headers: {} }
  }, { aiToken: GHU_OK })
  const api = apiOf(mocks)
  let e = null
  try { await api.aiChat([{ role: 'user', content: 'hi' }]) } catch (x) { e = x }
  assert(e && String(e.message).indexOf('model_not_supported') >= 0, '原文错误存活：' + (e && e.message))
})

/* ---------------- ⑥ 模型顺序 ---------------- */

T('⑥ 兜底清单 gpt-4o-mini 先行（chat 直挂最稳）', async () => {
  const api = apiOf(authed(() => ({ code: 200, data: '{}', headers: {} })))
  const ms = api.aiModels()
  assertEq(ms[0], 'gpt-4o-mini', '首模型 gpt-4o-mini')
  assertEq(ms[1], 'gpt-4.1-mini', '次模型 gpt-4.1-mini')
  assert(ms.indexOf('gpt-5-mini') >= 0, 'gpt-5-mini 保留（/responses 路径）')
  assertEq(ms.length, 6, '6 个')
})

/* ---------------- ⑦ 403 分级文案 ---------------- */

T('⑦ 认证用户 403 → 二级限流文案（非「游客 60 次」误导）', async () => {
  const mocks = authed((i, o) => {
    const u = fetchUrl(o)
    if (u.indexOf('/user') >= 0 && i === 1) return { code: 200, data: JSON.stringify({ login: 'u' }), headers: { 'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': '4990' } }
    return { code: 403, data: JSON.stringify({ message: 'Request was blocked due to unusual activity' }), headers: {} }
  })
  const api = apiOf(mocks)
  await api.request('https://api.github.com/user', { noCache: true, noDl: true }).catch(() => {})
  let e = null
  try { await api.request('https://api.github.com/zen', { noCache: true, noDl: true }) } catch (x) { e = x }
  assert(e && String(e.message).indexOf('限流拦截') >= 0, '二级限流文案：' + (e && e.message))
  assert(e && String(e.message).indexOf('游客每小时 60 次') < 0, '不再出现游客文案')
})

/* ---------------- ⑧ 通知并发源码断言 ---------------- */

T('⑧ NOTIF_CONC=2（二级限流防护）+ 截断报错带诊断', () => {
  const fs = require('fs')
  const path = require('path')
  const src = fs.readFileSync(path.join(__dirname, '..', 'src/utils/api.js'), 'utf8')
  assert(/const NOTIF_CONC = 2/.test(src), '并发常量 = 2')
  assert(/代理长响应受限/.test(src), '截断报错带残片长度诊断')
  assert(/残片 ' \+ lastBody\.length/.test(src.replace(/\n/g, '')), '诊断含 lastBody.length')
})

;(async () => {
  for (const t of _tests) await t
  summary()
})()

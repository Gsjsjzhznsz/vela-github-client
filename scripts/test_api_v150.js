/**
 * test_api_v150.js — v1.5.0 通知 per=1 主路（salvage 记键/不毒化缓存）
 *                  + AI Copilot 单通道重构（Models 退役/Copilot 授权/动态模型/错误透出）
 * 覆盖：
 *  ① salvage 按 URL 记键：两个 URL 先后抢救互不覆盖（v1.4.0 并发竞态回归）；
 *    抢救出的部分数组不写缓存（二次请求重新走网络）
 *  ② 通知管线：逻辑页 = 10 个 per_page=1 单页（URL 断言）；单条截断 →
 *    下载器兜底补齐该页；gap 机制保留
 *  ③ AI：2026 Copilot 兜底模型清单（6 个，无 publisher 前缀）/
 *    PAT 未授权 → needCopilot（且绝不打 models.github.ai）/
 *    ghu_ 会话交换（URL/Authorization: token/身份头断言）→ endpoints.api 直达
 *    chat（X-GitHub-Api-Version 2026-08-01 + CLI 身份头）/
 *    模型自动降级（400 → 下一模型）/ 错误透出（400 文本原文进 message）/
 *    aiProbe PAT 可查 /copilot_internal/user（套餐+额度）/ Models 退役文案 /
 *    copilotModels {data:[...]} 解析
 *  ④ 设备授权双模式：copilot 模式 client=Iv1.b507a08c87ecfe98 scope=read:user；
 *    login 模式沿用原 client + 收敛后基础 scope；poll 按 mode 选 client
 *  ⑤ AI token 独立存储：saveAiTok 双通道落盘；loadAiTok 无独立 token 时
 *    主 token 为 ghu_/gho_ 直接复用（旧用户兼容）
 */
const { loadModule, assert, assertEq, test, summary } = require('./test_utils')

const _tests = []
function T(name, fn) { _tests.push(test(name, fn)) }

const TOKEN_OK = 'ghp_' + 'a'.repeat(36)
const GHU_OK = 'ghu_' + 'b'.repeat(36)

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

/** authed：主 token + 可选 AI token（ghuCopilot）。fetchHandler(i, opts) */
function authed(fetchHandler, opts) {
  opts = opts || {}
  const f = makeFile()
  const d = makeDownloader(opts.dlContent || {}, opts.dlOpts || {})
  const origComplete = d.onDownloadComplete
  d.onDownloadComplete = function (o) {
    const wrapped = Object.assign({}, o, {
      success: (dd) => {
        const url = d.downloaded[Number(String(o.token).slice(2)) - 1]
        if (opts.dlContent && Object.prototype.hasOwnProperty.call(opts.dlContent, url)) {
          f._map[dd.uri] = opts.dlContent[url]
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

/* ---------------- ① salvage 记键 + 不毒化缓存 ---------------- */

T('salvage：按 URL 记键——两个 URL 先后抢救互不覆盖', async () => {
  const partA = '[{"a":1'
  const partB = '[{"b":1'
  const mocks = authed((i, o) => {
    const u = fetchUrl(o)
    if (u.indexOf('salv-a') >= 0) return { code: 200, data: partA, headers: {} }
    if (u.indexOf('salv-b') >= 0) return { code: 200, data: partB, headers: {} }
    return { code: 200, data: '{}', headers: {} }
  })
  const api = apiOf(mocks)
  let eA = null
  let eB = null
  try { await api.request('https://x.test/salv-a', { noCache: true, noDl: true, salvage: true }) } catch (e) { eA = e }
  try { await api.request('https://x.test/salv-b', { noCache: true, noDl: true, salvage: true }) } catch (e) { eB = e }
  /* 两个 URL 都是「[{ 开头但无完整顶层 }」→ 抢救不出条目（last<=0）→ 抛 incomplete。
   * 换成可抢救形态：截断在第二个对象内部，第一个对象完整 */
  const okA = '[{"id":1},{"id":2'
  const okB = '[{"id":"x"},{"id":"y"'
  const mocks2 = authed((i, o) => {
    const u = fetchUrl(o)
    if (u.indexOf('sv-a') >= 0) return { code: 200, data: okA, headers: {} }
    if (u.indexOf('sv-b') >= 0) return { code: 200, data: okB, headers: {} }
    return { code: 200, data: '{}', headers: {} }
  })
  const api2 = apiOf(mocks2)
  const rA = await api2.request('https://x.test/sv-a', { noCache: true, noDl: true, salvage: true })
  const rB = await api2.request('https://x.test/sv-b', { noCache: true, noDl: true, salvage: true })
  assertEq(rA.length, 1, 'A 抢救出 1 条')
  assertEq(rB.length, 1, 'B 抢救出 1 条')
  const infoA = api2.lastSalvageInfo('https://x.test/sv-a')
  const infoB = api2.lastSalvageInfo('https://x.test/sv-b')
  assert(infoA && infoA.url === 'https://x.test/sv-a', 'A 的记录仍在（v1.4.0 单例竞态回归）')
  assert(infoB && infoB.url === 'https://x.test/sv-b', 'B 的记录正确')
  assert(api2.lastSalvageInfo() && api2.lastSalvageInfo().ts >= infoA.ts, '无参返回最近记录')
})

T('salvage：部分数组不写缓存——二次请求重新走网络', async () => {
  const truncated = '[{"n":1},{"n":2'
  let hits = 0
  const mocks = authed((i, o) => {
    if (fetchUrl(o).indexOf('sv-cache') >= 0) { hits++; return { code: 200, data: truncated, headers: {} } }
    return { code: 200, data: '{}', headers: {} }
  })
  const api = apiOf(mocks)
  const u = 'https://x.test/sv-cache'
  const r1 = await api.request(u, { noCache: true, noDl: true, salvage: true })
  assertEq(r1.length, 1, '首次抢救出前导 1 条')
  const hitsAfterFirst = hits
  const r2 = await api.request(u, { noDl: true, salvage: true })
  assert(hits > hitsAfterFirst, '二次请求重新走网络（v1.4.0 会把残片缓存命中）')
  assertEq(r2.length, 1, '二次结果一致')
})

/* ---------------- ② 通知管线 per=1 主路 ---------------- */

T('通知：逻辑页 = 10 个 per_page=1 单页（URL 与顺序断言）', async () => {
  const seen = []
  const mocks = authed((i, o) => {
    const u = fetchUrl(o)
    if (u.indexOf('/notifications?') >= 0) {
      seen.push(u)
      const m = u.match(/page=(\d+)/)
      const pg = m ? Number(m[1]) : 0
      if (pg >= 1 && pg <= 10) return { code: 200, data: JSON.stringify([{ id: pg, unread: true }]), headers: {} }
      return { code: 200, data: '[]', headers: {} }
    }
    return { code: 200, data: '{}', headers: {} }
  })
  const api = apiOf(mocks)
  assertEq(api.notifPageSize(), 10, '逻辑页大小 10')
  const list = await api.getNotifications(1, false, false)
  assertEq(list.length, 10, '10 条通知')
  assertEq(seen.length, 10, '恰好 10 次请求')
  for (let p = 1; p <= 10; p++) {
    const probe = 'https://api.github.com/notifications?page=' + p + '&per_page=1'
    assert(seen.some((u) => u.indexOf(probe) >= 0), '含 per=1 第 ' + p + ' 页')
  }
  assert(seen.every((u) => u.indexOf('per_page=1') > 0), '全部 per_page=1（不再有 per_page=2）')
  assertEq(api.lastNotifGaps().length, 0, '无缺口')
})

T('通知：第 2 页单条截断 → 下载器兜底补齐，整页无缺口', async () => {
  const truncated = '[{"id":2,"unread":true' /* 无闭合 → 抢救不出 → incomplete */
  const good = JSON.stringify([{ id: 2, unread: true }])
  const dlUrl = 'https://api.github.com/notifications?page=2&per_page=1&all=false'
  const mocks = authed((i, o) => {
    const u = fetchUrl(o)
    if (u.indexOf('/notifications?') >= 0) {
      const m = u.match(/page=(\d+)/)
      const pg = m ? Number(m[1]) : 0
      if (pg === 2) return { code: 200, data: truncated, headers: {} }
      if (pg >= 1 && pg <= 10) return { code: 200, data: JSON.stringify([{ id: pg, unread: true }]), headers: {} }
      return { code: 200, data: '[]', headers: {} }
    }
    return { code: 200, data: '{}', headers: {} }
  }, { dlContent: { [dlUrl]: good } })
  const api = apiOf(mocks)
  const list = await api.getNotifications(1, false, false)
  assertEq(list.length, 10, '10 条全部到齐')
  assertEq(api.lastNotifGaps().length, 0, '下载器兜底后无缺口')
  const ids = list.map((x) => x.id)
  assertEq(ids[1], 2, '第 2 条来自下载器兜底')
})

T('通知：单条彻底失败 → gap 记录，其余 9 条照常渲染', async () => {
  const mocks = authed((i, o) => {
    const u = fetchUrl(o)
    if (u.indexOf('/notifications?') >= 0) {
      const m = u.match(/page=(\d+)/)
      const pg = m ? Number(m[1]) : 0
      /* 第 5 页：截断 JSON（parse 双败 + 抢救无门 → incomplete）+ 下载器断供 → gap */
      if (pg === 5) return { code: 200, data: '[{"id":5,"unread":true', headers: {} }
      if (pg >= 1 && pg <= 10) return { code: 200, data: JSON.stringify([{ id: pg, unread: true }]), headers: {} }
      return { code: 200, data: '[]', headers: {} }
    }
    return { code: 200, data: '{}', headers: {} }
  }, { dlOpts: { breakDownload: true, breakComplete: true } })
  const api = apiOf(mocks)
  const list = await api.getNotifications(1, false, false)
  assertEq(list.length, 9, '9 条成功段照常拼接')
  const gaps = api.lastNotifGaps()
  assertEq(gaps.length, 1, '1 个缺口')
  assertEq(gaps[0], 5, '缺口是第 5 页')
})

/* ---------------- ③ AI Copilot 单通道 ---------------- */

const COPILOT_EXCH_URL = 'https://api.github.com/copilot_internal/v2/token'
const CP_API = 'https://api.individual.githubcopilot.com'
const CHAT_URL = CP_API + '/chat/completions'
const RESP_URL_V150 = CP_API + '/responses'
const EXCH_RESP = JSON.stringify({
  token: 'tid=abc;exp=999999;sku=copilot_free_limit',
  endpoints: { api: CP_API },
  expires_at: Math.floor(Date.now() / 1000) + 1800
})
const CHAT_OK = (model) => JSON.stringify({ model: model, choices: [{ message: { content: 'cp ok' } }], usage: { total_tokens: 5 } })

T('AI：2026 Copilot 兜底模型清单（6 个，无 publisher 前缀）', async () => {
  const api = apiOf(authed(() => ({ code: 200, data: '{}', headers: {} })))
  const ms = api.aiModels()
  assertEq(ms[0], 'gpt-4o-mini', '首模型 gpt-4o-mini（v1.6.0：/chat/completions 最稳老模型先行）')
  assertEq(ms.length, 6, '6 个模型')
  assert(ms.indexOf('claude-haiku-4.5') >= 0, '含 Claude Haiku 4.5')
  assert(ms.indexOf('gemini-3-flash') >= 0, '含 Gemini 3 Flash')
  assert(ms.every((m) => m.indexOf('/') < 0), 'Copilot API 模型 id 无 publisher 前缀')
})

T('AI：PAT 未 Copilot 授权 → needCopilot，且绝不打 models.github.ai', async () => {
  const mocks = authed(() => ({ code: 200, data: '{}', headers: {} }))
  const api = apiOf(mocks)
  let e = null
  try { await api.aiChat([{ role: 'user', content: 'hi' }]) } catch (x) { e = x }
  assert(e && e.needCopilot, 'needCopilot 标志')
  assert(String(e.message).indexOf('Copilot') >= 0, '文案指向 Copilot 授权')
  const urls = mocks['@system.fetch'].calls.map(fetchUrl)
  assert(urls.every((u) => u.indexOf('models.github.ai') < 0), '已退役的 models.github.ai 零请求')
})

T('AI：ghu_ 会话交换（URL/token 头/身份头）→ endpoints.api 直达 chat', async () => {
  const seen = {}
  const mocks = authed((i, o) => {
    const u = fetchUrl(o)
    if (u === COPILOT_EXCH_URL) {
      seen.exch = o
      return { code: 200, data: EXCH_RESP, headers: {} }
    }
    if (u === CHAT_URL) {
      seen.chat = o
      return { code: 200, data: CHAT_OK('gpt-4o-mini'), headers: {} }
    }
    return { code: 200, data: '{}', headers: {} }
  }, { mainToken: TOKEN_OK, aiToken: GHU_OK })
  const api = apiOf(mocks)
  const r = await api.aiChat([{ role: 'user', content: 'hi' }], { model: 'gpt-4o-mini' })
  assertEq(r.text, 'cp ok', '回复内容')
  assertEq(r.via, 'copilot', 'via=copilot')
  assertEq(r.model, 'gpt-4o-mini', '模型')
  assert(seen.exch, '发起凭据交换')
  assertEq(seen.exch.header['Authorization'], 'token ' + GHU_OK, '交换用 token scheme + ghu_')
  assertEq(seen.exch.header['Editor-Version'], 'vscode/1.85.1', '交换 Editor-Version（LiteLLM 实证栈）')
  assertEq(seen.exch.header['User-Agent'], 'GithubCopilot/1.155.0', '交换 UA（LiteLLM 实证栈）')
  assert(!('Copilot-Integration-Id' in seen.exch.header), '交换段不再声明 integration（LiteLLM 交换栈无此头）')
  assertEq(seen.chat.header['Authorization'], 'Bearer tid=abc;exp=999999;sku=copilot_free_limit', 'chat 用会话凭据 Bearer')
  assertEq(seen.chat.header['X-GitHub-Api-Version'], '2025-04-01', 'chat 带 2025-04-01 版本头')
  assertEq(seen.chat.header['Copilot-Integration-Id'], 'vscode-chat', 'chat integration=vscode-chat（LiteLLM 实证栈）')
  assertEq(seen.chat.header['User-Agent'], 'GitHubCopilotChat/0.26.7', 'chat UA')
  assertEq(seen.chat.header['Openai-Intent'], 'conversation-panel', 'chat Openai-Intent')
  const body = JSON.parse(seen.chat.data)
  assertEq(body.model, 'gpt-4o-mini', '请求体模型（无 publisher 前缀）')
})

T('AI：主 token 为 ghu_（旧设备授权）→ 直接复用为 AI token', async () => {
  const mocks = authed((i, o) => {
    const u = fetchUrl(o)
    if (u === COPILOT_EXCH_URL) return { code: 200, data: EXCH_RESP, headers: {} }
    if (u === CHAT_URL) return { code: 200, data: CHAT_OK('gpt-5-mini'), headers: {} }
    return { code: 200, data: '{}', headers: {} }
  }, { mainToken: GHU_OK })
  const api = apiOf(mocks)
  assert(!api.hasAiTok(), '初始无独立 AI token')
  const r = await api.aiChat([{ role: 'user', content: 'hi' }])
  assertEq(r.text, 'cp ok', '旧用户 ghu_ 直连可用')
  assert(api.hasAiTok(), '复用后视为已授权')
})

T('AI：模型自动降级（gpt-5 系 /responses 空体 → 下一模型成功）', async () => {
  const asked = []
  const seq = []
  const mocks = authed((i, o) => {
    const u = fetchUrl(o)
    if (u === COPILOT_EXCH_URL) return { code: 200, data: EXCH_RESP, headers: {} }
    if (u === RESP_URL_V150) { seq.push('resp'); return { code: 200, data: '{}', headers: {} } }
    if (u === CHAT_URL) {
      const body = JSON.parse(o.data)
      asked.push(body.model)
      return { code: 200, data: CHAT_OK(body.model), headers: {} }
    }
    return { code: 200, data: '{}', headers: {} }
  }, { aiToken: GHU_OK })
  const api = apiOf(mocks)
  const r = await api.aiChat([{ role: 'user', content: 'hi' }], { model: 'gpt-5-mini' })
  assertEq(r.model, 'claude-haiku-4.5', '降级到下一模型')
  assertEq(asked.length, 1, 'chat 仅 1 次（gpt-5 系直达 /responses，空体降级）')
  assertEq(seq.length, 1, '/responses 被直达 1 次')
})

T('AI：错误透出——400 文本原文进 message（不再笼统报网关异常）', async () => {
  const mocks = authed((i, o) => {
    const u = fetchUrl(o)
    if (u === COPILOT_EXCH_URL) return { code: 200, data: EXCH_RESP, headers: {} }
    if (u === CHAT_URL) return { code: 400, data: 'bad request: model_not_supported', headers: {} }
    return { code: 200, data: '{}', headers: {} }
  }, { aiToken: GHU_OK })
  const api = apiOf(mocks)
  let e = null
  try { await api.aiChat([{ role: 'user', content: 'hi' }]) } catch (x) { e = x }
  assert(e && String(e.message).indexOf('model_not_supported') >= 0, '原文进 message：' + (e && e.message))
})

T('AI：aiProbe——PAT 查 /copilot_internal/user（套餐+额度）+ 交换未授权 + Models 退役', async () => {
  const seen = {}
  const mocks = authed((i, o) => {
    const u = fetchUrl(o)
    if (u === 'https://api.github.com/copilot_internal/user') {
      seen.probe = o
      return {
        code: 200,
        data: JSON.stringify({
          access_type_sku: 'free_limited_copilot',
          chat_enabled: true,
          quota_snapshots: { chat: { remaining: 200, entitlement: 200 } }
        }),
        headers: {}
      }
    }
    return { code: 200, data: '{}', headers: {} }
  })
  const api = apiOf(mocks)
  const p = await api.aiProbe()
  assert(seen.probe, '探测打到 /copilot_internal/user（旧版 /user/copilot 已废）')
  assert(String(p.copilot).indexOf('已开通') >= 0, '不再误报未开通：' + p.copilot)
  assert(String(p.copilot).indexOf('Copilot Free') >= 0, '套餐名')
  assertEq(p.quotaChat, '200/200', '会话额度')
  assertEq(p.exchange, '未授权', 'PAT 未授权')
  assert(String(p.copilotHint).indexOf('授权') >= 0, '指引一键授权')
  assert(String(p.models).indexOf('退役') >= 0, 'Models 退役说明')
})

T('AI：copilotModels 解析 {data:[...]} + capabilities.type=chat 过滤', async () => {
  const mocks = authed((i, o) => {
    const u = fetchUrl(o)
    if (u === COPILOT_EXCH_URL) return { code: 200, data: EXCH_RESP, headers: {} }
    if (u === CP_API + '/models') {
      return {
        code: 200,
        data: JSON.stringify({
          data: [
            { id: 'gpt-5-mini', capabilities: { type: 'chat' } },
            { id: 'text-embedding-3-small', capabilities: { type: 'embeddings' } },
            { id: 'claude-haiku-4.5' },
            { id: 'gpt-5-mini' } /* 去重 */
          ]
        }),
        headers: {}
      }
    }
    return { code: 200, data: '{}', headers: {} }
  }, { aiToken: GHU_OK })
  const api = apiOf(mocks)
  const ids = await api.copilotModels()
  assertEq(ids.length, 2, '只留 chat 模型且去重')
  assertEq(ids[0], 'gpt-5-mini', '首个')
  assertEq(ids[1], 'claude-haiku-4.5', '第二个')
})

/* ---------------- ④ 设备授权双模式 ---------------- */

T('deviceFlow：copilot 模式 client=Iv1.b507a08c87ecfe98 scope=read:user', async () => {
  let form = null
  const mocks = authed(() => ({ code: 200, data: '{}' , headers: {} }))
  /* formPost 走 @system.fetch：拦截 data 字段 */
  mocks['@system.fetch'].fetch = function (opts) {
    form = String(opts.data || '')
    Promise.resolve().then(() => opts.success({ code: 200, data: JSON.stringify({ device_code: 'dc1', user_code: 'AB12-34', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 5 }) }))
  }
  const api = apiOf(mocks)
  const r = await api.deviceFlowStart('copilot')
  assertEq(r.deviceCode, 'dc1', 'device_code 返回')
  assert(form.indexOf('client_id=Iv1.b507a08c87ecfe98') >= 0, 'Copilot CLI GitHub App client')
  assert(form.indexOf('scope=read%3Auser') >= 0, 'scope read:user')
  assert(form.indexOf('copilot') < 0, '不再请求 copilot/models scope（非法 scope 纯耗时）')
})

T('deviceFlow：login 模式沿用原 client + 收敛后基础 scope', async () => {
  let form = null
  const mocks = authed(() => ({ code: 200, data: '{}', headers: {} }))
  mocks['@system.fetch'].fetch = function (opts) {
    form = String(opts.data || '')
    Promise.resolve().then(() => opts.success({ code: 200, data: JSON.stringify({ device_code: 'dc2', user_code: 'CD56-78' }) }))
  }
  const api = apiOf(mocks)
  await api.deviceFlowStart()
  assert(form.indexOf('client_id=178c6fc778ccc68e1d6a') >= 0, '主登录 client 不变')
  assert(form.indexOf('scope=repo%20read%3Auser%20notifications') >= 0, '收敛为基础三 scope')
})

T('deviceFlow：poll 按 mode 选 client', async () => {
  let form = null
  const mocks = authed(() => ({ code: 200, data: '{}', headers: {} }))
  mocks['@system.fetch'].fetch = function (opts) {
    form = String(opts.data || '')
    Promise.resolve().then(() => opts.success({ code: 200, data: JSON.stringify({ error: 'authorization_pending' }) }))
  }
  const api = apiOf(mocks)
  const r = await api.deviceFlowPoll('dcX', 5, 'copilot')
  assertEq(r.state, 'pending', '轮询 pending')
  assert(form.indexOf('client_id=Iv1.b507a08c87ecfe98') >= 0, 'poll 用 Copilot client')
})

/* ---------------- ⑤ AI token 独立存储 ---------------- */

T('AI token：saveAiTok 双通道落盘 + loadAiTok 读回', async () => {
  const mocks = authed(() => ({ code: 200, data: '{}', headers: {} }))
  const api = apiOf(mocks)
  await api.saveAiTok(GHU_OK)
  assert(api.hasAiTok(), '已授权')
  /* 新 context 重载（同 mocks 存储已落盘） */
  const api2 = apiOf(mocks)
  const t = await api2.loadAiTok(true)
  assertEq(t, GHU_OK, '读回一致')
  /* 清除 */
  await api2.saveAiTok('')
  assert(!api2.hasAiTok(), '清除后无 token')
  const api3 = apiOf(mocks)
  const t3 = await api3.loadAiTok(true)
  assertEq(t3, '', '存储中已清除')
})

;(async () => {
  for (const t of _tests) await t
  summary()
})().catch((e) => { console.error(e); process.exit(1) })

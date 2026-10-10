/**
 * test_api_v180.js — v1.8.0 全局桥 + AI 思考过程 + 分仓已读 + 仓库分组
 * 覆盖：
 *  ① gh.js 全局桥：Proxy 转发读写、has 语义（api.js 只随 app.js 打包一次的页面侧通道）
 *  ② markRepoNotificationsRead：PUT /repos/{o}/{r}/notifications URL/method 断言
 *  ③ aiChat /responses 思考抽取：output[] type=reasoning 的 summary/content 文本
 *  ④ aiChat chat/completions 思考抽取：message.reasoning_content / reasoning
 *  ⑤ 非推理模型 thinking 为空串
 *  ⑥ view.js mapNotif.stype + groupNotifsByRepo 保序分组与底层条数统计
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

/* ---------------- ① gh.js 全局桥 ---------------- */

T('① gh.js 桥：Proxy 读转发 + 方法调用透传', async () => {
  const mocks = authed(() => ({ code: 200, data: '{}', headers: {} }))
  const api = apiOf(mocks)
  globalThis.__GH_API_IMPL__ = api.default
  const gh = loadModule('src/utils/gh.js', {})
  assert(gh.default && typeof gh.default === 'object', 'gh 默认导出存在')
  assert(typeof gh.default.getNotifications === 'function', '读转发：方法可访问')
  assert(typeof gh.default.markRepoNotificationsRead === 'function', '新增导出经桥可达')
  assertEq(gh.default.aiModels().length, 3, '调用透传：aiModels() 经桥返回实证 3 模型')
  const r = gh.default.aiModelsSetRemote(['gpt-4o-mini', 'x1'])
  assert(r === true, '桥调用真实实现（写态生效）')
  assertEq(gh.default.aiModels()[0], 'gpt-4o-mini', '置顶生效（经桥可观测）')
})

T('① gh.js 桥：has/set 语义 + impl 缺失不炸', async () => {
  globalThis.__GH_API_IMPL__ = null
  const gh = loadModule('src/utils/gh.js', {})
  assert(('nothing_here' in gh.default) === false, 'impl 缺失时 has 返回 false')
  globalThis.__GH_API_IMPL__ = { foo: 1 }
  assert(('foo' in gh.default) === true, 'impl 就绪后 has 命中')
  gh.default.bar = 7
  assertEq(globalThis.__GH_API_IMPL__.bar, 7, 'set 转发写入 impl')
  assertEq(gh.default.foo, 1, 'get 转发读取 impl')
  globalThis.__GH_API_IMPL__ = null
})

/* ---------------- ② markRepoNotificationsRead ---------------- */

T('② markRepoNotificationsRead：PUT /repos/{o}/{r}/notifications', async () => {
  const seen = []
  const mocks = authed((i, o) => {
    seen.push({ url: fetchUrl(o), method: String(o.method || 'GET').toUpperCase() })
    return { code: 202, data: '{}', headers: {} }
  })
  const api = apiOf(mocks)
  await api.markRepoNotificationsRead('Gsjsjzhznsz/BandQQ')
  assertEq(seen.length, 1, '恰好一次请求')
  assertEq(seen[0].url, 'https://api.github.com/repos/Gsjsjzhznsz/BandQQ/notifications', 'URL 正确')
  assertEq(seen[0].method, 'PUT', 'method PUT')
})

/* ---------------- ③④⑤ aiChat 思考抽取 ---------------- */

T('③ aiChat /responses：reasoning summary+content 抽取为 thinking', async () => {
  const mocks = authed((i, o) => {
    const u = fetchUrl(o)
    if (u === COPILOT_EXCH_URL) return { code: 200, data: EXCH_RESP, headers: {} }
    if (u === MODELS_URL) {
      return { code: 200, data: JSON.stringify({ data: [
        { id: 'gpt-4o-mini', supported_endpoints: ['/responses'] }
      ] }), headers: {} }
    }
    if (u === RESP_URL) {
      return { code: 200, data: JSON.stringify({
        output: [
          { type: 'reasoning', summary: [{ type: 'summary_text', text: '先分析需求' }], content: [{ text: '再看上下文' }] },
          { type: 'message', content: [{ type: 'output_text', text: '最终答案' }] }
        ]
      }), headers: {} }
    }
    return { code: 404, data: '{}', headers: {} }
  }, { aiToken: GHU_OK })
  const api = apiOf(mocks)
  const ids = await api.copilotModels()
  assert(ids.indexOf('gpt-4o-mini') === 0, '目录刷新后实证模型可用')
  const r = await api.aiChat([{ role: 'user', content: 'hi' }], { model: 'gpt-4o-mini' })
  assertEq(r.text, '最终答案', '正文抽取不变')
  assertEq(r.thinking, '先分析需求\n再看上下文', '思考过程 = reasoning summary+content')
  assert(typeof r.ms === 'number' && r.ms >= 0, '耗时 ms 字段')
  assertEq(r.ep, 'responses', '端点标记')
})

T('④ aiChat chat/completions：message.reasoning_content 抽取', async () => {
  const mocks = authed((i, o) => {
    const u = fetchUrl(o)
    if (u === COPILOT_EXCH_URL) return { code: 200, data: EXCH_RESP, headers: {} }
    if (u === CHAT_URL) {
      return { code: 200, data: JSON.stringify({
        choices: [{ message: { role: 'assistant', content: '回答正文', reasoning_content: '推理链文本' } }],
        usage: { total_tokens: 42 }
      }), headers: {} }
    }
    return { code: 404, data: '{}', headers: {} }
  }, { aiToken: GHU_OK })
  const api = apiOf(mocks)
  const r = await api.aiChat([{ role: 'user', content: 'hi' }], { model: 'gpt-4o-mini' })
  assertEq(r.text, '回答正文', '正文不变')
  assertEq(r.thinking, '推理链文本', 'reasoning_content → thinking')
  assertEq(r.ep, 'chat', '端点标记 chat')
  assertEq(r.usage.total_tokens, 42, 'usage 透传')
})

T('④b aiChat chat/completions：message.reasoning（OpenRouter 系）兜底抽取', async () => {
  const mocks = authed((i, o) => {
    const u = fetchUrl(o)
    if (u === COPILOT_EXCH_URL) return { code: 200, data: EXCH_RESP, headers: {} }
    if (u === CHAT_URL) {
      return { code: 200, data: JSON.stringify({
        choices: [{ message: { role: 'assistant', content: '答', reasoning: '兜底推理' } }]
      }), headers: {} }
    }
    return { code: 404, data: '{}', headers: {} }
  }, { aiToken: GHU_OK })
  const api = apiOf(mocks)
  const r = await api.aiChat([{ role: 'user', content: 'hi' }], { model: 'gpt-4.1' })
  assertEq(r.thinking, '兜底推理', 'reasoning 字段兜底')
})

T('⑤ 非推理模型 thinking 为空串（页面不渲染折叠块）', async () => {
  const mocks = authed((i, o) => {
    const u = fetchUrl(o)
    if (u === COPILOT_EXCH_URL) return { code: 200, data: EXCH_RESP, headers: {} }
    if (u === CHAT_URL) {
      return { code: 200, data: JSON.stringify({
        choices: [{ message: { role: 'assistant', content: '普通回答' } }]
      }), headers: {} }
    }
    return { code: 404, data: '{}', headers: {} }
  }, { aiToken: GHU_OK })
  const api = apiOf(mocks)
  const r = await api.aiChat([{ role: 'user', content: 'hi' }], { model: 'gpt-4o' })
  assertEq(r.text, '普通回答', '正文不变')
  assertEq(r.thinking, '', '无 reasoning 字段 → thinking 空串')
})

/* ---------------- ⑥ view.js stype + 分组 ---------------- */

T('⑥ mapNotif.stype 保留原始 subject 类型', async () => {
  const view = loadModule('src/utils/view.js', {})
  const n = view.mapNotif({
    id: 1,
    repository: { full_name: 'o/r' },
    subject: { type: 'CheckSuite', title: 'CI passed' },
    reason: 'ci_activity',
    unread: true,
    updated_at: '2026-10-10T00:00:00Z',
    url: 'https://api.github.com/n/1',
    subject_url_: ''
  })
  assertEq(n.stype, 'CheckSuite', 'stype = 原始 subject.type')
  assert(n.ci === true, 'CI 判定不变')
  const n2 = view.mapNotif({
    id: 2, repository: { full_name: 'o/r2' },
    subject: { type: 'Issue', title: 'bug' }, unread: true
  })
  assertEq(n2.stype, 'Issue', 'Issue stype')
})

T('⑥ groupNotifsByRepo：保序分组 + 底层条数统计', async () => {
  const view = loadModule('src/utils/view.js', {})
  const items = [
    { id: 'a1', repo: 'o/alpha', ci: true, aggN: 5, unreadN: 4, unread: true, stype: 'CheckSuite', threads: [] },
    { id: 'b1', repo: 'o/beta', ci: false, unread: true, stype: 'Issue' },
    { id: 'a2', repo: 'o/alpha', ci: false, unread: false, stype: 'PullRequest' }
  ]
  const g = view.groupNotifsByRepo(items)
  assertEq(g.length, 2, '两个仓库组（首见保序）')
  assertEq(g[0].repo, 'o/alpha', '第一组 alpha')
  assertEq(g[0].count, 6, 'count 按底层条数（aggN 5 + 1）')
  assertEq(g[0].unreadN, 4, 'unreadN 底层条数')
  assertEq(g[0].ciN, 5, 'ciN 聚合条数')
  assertEq(g[0].items.length, 2, '组内卡片数')
  assertEq(g[1].repo, 'o/beta', '第二组 beta')
  assertEq(g[1].count, 1, 'beta count')
  assert(g[0].items[0] === items[0], '组内条目为原对象引用（已读变更直生效）')
})

T('⑥ groupNotifsByRepo：空入参 + 缺 repo 容错', async () => {
  const view = loadModule('src/utils/view.js', {})
  assertEq(view.groupNotifsByRepo([]).length, 0, '空数组 → 空组')
  const g = view.groupNotifsByRepo([{ id: 'x' }])
  assertEq(g.length, 1, '缺 repo 归入未知仓库')
  assertEq(g[0].repo, '未知仓库', '兜底仓库名')
})

;(async () => {
  for (const t of _tests) await t
  summary()
})()

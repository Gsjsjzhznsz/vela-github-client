/**
 * test_device_flow_v203.js — v2.0.3 免打字授权根修回归
 * 用户报告：「免打字界面我没有看到授权码」。
 * 根修：formPost 此前直连裸调 fetch.fetch（绕过 AstroBox 网桥 + 无超时），
 * 砍网手环上 github.com/login/device/code 直连永远不通/挂起 → 授权码永远出不来。
 * 覆盖：
 *  ① 砍网场景：直连 fail + 网桥就绪 → deviceFlowStart 经网桥拿到授权码（userCode 非空）
 *  ② 有网场景：直连成功（无网桥）→ deviceFlowStart 照常拿到授权码
 *  ③ bridge 模式（用户设置强制网桥）→ 全程零直连调用
 *  ④ 网桥返回 200 device_code → deviceFlowPoll ok 路径拿到 token
 *  ⑤ HTTP 4xx → deviceFlowStart 抛「发起登录失败（HTTP xxx）」而不是静默
 *  ⑥ 直连 fail 且无网桥 → deviceFlowStart 报网络错误（不再无限挂起）
 */
const { loadModule, assert, assertEq, test, summary } = require('./test_utils')

const _tests = []
function T(name, fn) { _tests.push(test(name, fn)) }

const DEVICE_CODE_RESP = {
  code: 200,
  data: {
    device_code: 'dc_1234567890abcdef',
    user_code: 'AB12-CD34',
    verification_uri: 'https://github.com/login/device',
    expires_in: 900,
    interval: 5
  },
  headers: {}
}
const TOKEN_OK_RESP = {
  code: 200,
  data: { access_token: 'gho_token_xxx', token_type: 'bearer', scope: 'repo' },
  headers: {}
}

/* ---------------- mocks（与 test_api_v190 同构） ---------------- */

function makeInterconn() {
  const m = { sent: [], inst: null }
  m.mock = {
    instance() {
      const inst = {
        send({ data, success, fail }) { m.sent.push(data); if (success) success() },
        diagnosis({ success }) { success({ status: 0 }) }
      }
      m.inst = inst
      return inst
    }
  }
  m.deliver = (frame) => {
    if (m.inst && typeof m.inst.onmessage === 'function') {
      m.inst.onmessage({ data: JSON.stringify(frame) })
    }
  }
  m.sentOf = (tag) => m.sent.filter((f) => f.tag === 'fetch')
  return m
}

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

function handshake(ic) {
  ic.deliver({ tag: '__hs__', count: 1, caps: { version: 3, chunk: true, maxChunkSize: 4096, encodings: ['text', 'base64', 'hex'], compressions: ['none'], ack: true } })
}

/** 网桥应答（与 test_api_v190 icResp 同形）：tag='fetch' + resp 字段 */
function icResp(ic, frame, body, status) {
  ic.deliver({ tag: 'fetch', id: frame.id, resp: { ok: true, status: status || 200, headers: { 'content-type': 'application/json' }, body: body, raw: false } })
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function load(mocks) {
  return loadModule('src/utils/api.js', {
    '@system.fetch': mocks._fetch,
    '@system.storage': makeStorage(),
    '@system.file': makeFile(),
    '@system.request': { download() {}, onDownloadComplete() {} },
    '@system.interconnect': mocks._ic.mock,
    './b64': { decode: (s) => Buffer.from(String(s).replace(/\s/g, ''), 'base64').toString('utf8') }
  })
}

/* ---------------- 用例 ---------------- */

T('① 砍网：直连 fail + 网桥就绪 → deviceFlowStart 经网桥拿到授权码', async () => {
  const f = makeFetch(() => ({ __fail: 'network', code: 1000 }))
  const ic = makeInterconn()
  const api = load({ _fetch: f, _ic: ic })
  api.bridgeInfo() /* 触发 init（创建 interconnect 实例） */
  handshake(ic) /* 握手在实例创建后才送达 */
  await sleep(5) /* 等握手就绪 */
  const p = api.deviceFlowStart('login')
  await sleep(30)
  const frame = ic.sentOf('fetch').pop()
  assert(!!frame, '砍网走网桥发出 fetch 帧')
  assertEq(frame && frame.options && frame.options.method, 'POST', 'device/code 为 POST')
  icResp(ic, frame, JSON.stringify(DEVICE_CODE_RESP.data))
  const r = await p
  assertEq(r.userCode, 'AB12-CD34', '授权码可见（userCode）')
  assertEq(r.deviceCode, 'dc_1234567890abcdef', 'deviceCode')
  assert(f.calls.length === 0, '直连零调用（砍网不空转）')
})

T('② 有网：直连成功（无网桥）→ 照常拿到授权码', async () => {
  const f = makeFetch(() => DEVICE_CODE_RESP)
  const ic = makeInterconn()
  handshake(ic) /* 就绪但 auto 下直连优先、直连成功即返回 */
  const api = load({ _fetch: f, _ic: ic })
  const r = await api.deviceFlowStart('login')
  assertEq(r.userCode, 'AB12-CD34', '授权码')
  assert(f.calls.length >= 1, '直连发出')
})

T('③ bridge 模式（强制网桥）→ 全程零直连', async () => {
  const f = makeFetch(() => ({ __fail: 'network', code: 1000 }))
  const ic = makeInterconn()
  const api = load({ _fetch: f, _ic: ic })
  api.bridgeSetMode('bridge')
  api.bridgeInfo() /* 触发 init */
  handshake(ic)
  await sleep(5)
  const p = api.deviceFlowStart('copilot')
  await sleep(30)
  const frame = ic.sentOf('fetch').pop()
  assert(!!frame, '强制网桥发出 fetch 帧')
  assert(String(frame.url).indexOf('/login/device/code') > 0, 'Copilot 授权端点')
  icResp(ic, frame, JSON.stringify(DEVICE_CODE_RESP.data))
  const r = await p
  assertEq(r.userCode, 'AB12-CD34', 'Copilot 授权码')
  assert(f.calls.length === 0, '强制网桥下直连零调用')
})

T('④ 网桥 200 → deviceFlowPoll ok 拿到 token', async () => {
  const f = makeFetch(() => ({ __fail: 'network', code: 1000 }))
  const ic = makeInterconn()
  const api = load({ _fetch: f, _ic: ic })
  api.bridgeSetMode('bridge')
  api.bridgeInfo() /* 触发 init */
  handshake(ic)
  await sleep(5)
  const p = api.deviceFlowPoll('dc_x', 5, 'login')
  await sleep(30)
  icResp(ic, ic.sentOf('fetch').pop(), JSON.stringify(TOKEN_OK_RESP.data))
  const r = await p
  assertEq(r.state, 'ok', '轮询结果 ok')
  assertEq(r.token, 'gho_token_xxx', 'token')
})

T('⑤ HTTP 403 → 明确报错（含状态码）而非统一「网络失败」', async () => {
  const f = makeFetch(() => ({ code: 403, data: { message: 'forbidden' }, headers: {} }))
  const ic = makeInterconn()
  const api = load({ _fetch: f, _ic: ic })
  let err = null
  try { await api.deviceFlowStart('login') } catch (e) { err = e }
  assert(err && /发起登录失败（HTTP 403）/.test(err.message), '报错含状态码: ' + (err && err.message))
}, 12000)

T('⑥ 直连 fail 且网桥未就绪 → 快速失败不挂起', async () => {
  const f = makeFetch(() => ({ __fail: 'network', code: 1000 }))
  const ic = makeInterconn() /* 不握手 = 未就绪 */
  const api = load({ _fetch: f, _ic: ic })
  let err = null
  const t0 = Date.now()
  try { await api.deviceFlowStart('login') } catch (e) { err = e }
  assert(err != null, '必须失败落地（不再无限等待）')
  assert(Date.now() - t0 < 5000, '快速失败（<5s，3 次重试内）')
})

;(async () => {
  for (const t of _tests) await t
  summary()
})().catch((e) => { console.error(e); process.exit(1) })

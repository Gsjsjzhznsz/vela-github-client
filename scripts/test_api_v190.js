/**
 * test_api_v190.js — v1.9.0 AstroBox 网桥 FetchBridge + PR/订阅/Issue状态 新功能
 * 覆盖：
 *  A. bridge.js 协议客户端（协议 v4 文档 v3 子集）：
 *     ① 握手 ping-pong + caps 协商（version/chunk/maxChunkSize/ack 取交集）
 *     ② 单消息 text → JSON 对象归一（与 Vela responseType 语义对齐）
 *     ③ 单消息 hex（含四字节 emoji UTF-8 解码）
 *     ④ 单消息 base64（多字节中文）
 *     ⑤ 分片模式 + 累计 ACK（乱序到达、ack=连续前沿 [0,1,3]）
 *     ⑥ v1 兜底（对端无 caps → 不分片不压缩，单消息照常）
 *     ⑦ §5.3 传输错误（ok=false status=0 → reject）
 *     ⑧ 超时 reject
 *     ⑨ 未协商压缩拒绝（安全）
 *     ⑩ 未知 tag 忽略不炸
 *  B. api.js 集成：
 *     ⑪ bridge 模式端到端（getRepoPulls 走网桥，直连零调用）
 *     ⑫ auto 模式网桥就绪 → 网桥优先（sticky）
 *     ⑬ auto 模式网桥未就绪 → 直连成功（sticky 保持 false）
 *     ⑭ auto 模式直连失败 → 网桥兜底成功
 *     ⑮ 模式持久化 + 非法值忽略 + 新导出函数存在
 *     ⑯ patchIssueState（PATCH method + body）
 *     ⑰ setRepoSubscription 三态（DELETE / PUT subscribed / PUT ignored）
 *     ⑱ getRepoPulls URL（state/per_page/page）
 */
const { loadModule, assert, assertEq, test, summary } = require('./test_utils')

const _tests = []
function T(name, fn) { _tests.push(test(name, fn)) }

const hexOf = (s) => Buffer.from(s, 'utf8').toString('hex')
const b64Of = (s) => Buffer.from(s, 'utf8').toString('base64')

/* ---------------- mocks ---------------- */

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
  m.sentOf = (tag) => m.sent.filter((f) => f.tag === tag)
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
    _map: map,
    readText({ uri, success, fail }) {
      if (Object.prototype.hasOwnProperty.call(map, uri)) success({ text: map[uri] })
      else fail(null, 301)
    },
    writeText({ uri, text, success }) { map[uri] = text; success() },
    delete({ uri, success }) { delete map[uri]; (success || function () {})() }
  }
}

function makeDownloader() {
  return {
    download({ success }) { Promise.resolve().then(() => success({ token: 'tk' })) },
    onDownloadComplete({ success, fail }) { Promise.resolve().then(() => fail(null, 1002)) }
  }
}

/* 直连 fetch mock：handler(序号, opts) → 响应对象 / {__fail, code} */
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

function apiMocks(fetchHandler) {
  const f = makeFetch(fetchHandler || (() => ({ code: 200, data: '{}', headers: {} })))
  const ic = makeInterconn()
  const mocks = {
    '@system.fetch': f,
    '@system.storage': makeStorage(),
    '@system.file': makeFile(),
    '@system.request': makeDownloader(),
    '@system.interconnect': ic.mock,
    './b64': { decode: (s) => Buffer.from(String(s).replace(/\s/g, ''), 'base64').toString('utf8') },
    _fetch: f,
    _ic: ic
  }
  return mocks
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/* ================= A. bridge.js 协议单元 ================= */

T('① 网桥握手：ping-pong 计数 + v3 caps 协商', async () => {
  const ic = makeInterconn()
  const b = loadModule('src/utils/bridge.js', { '@system.interconnect': ic.mock })
  assert(b.bridgeSupported() === true, 'interconnect mock 注入后 supported')
  assert(b.bridgeReady() === false, '初始未握手')
  b.bridgeReady()
  /* 标准握手交付（v3 caps）：bridgeFetch 依赖 _hs=true 才立即发帧 */
  ic.deliver({ tag: '__hs__', count: 1, caps: { version: 3, chunk: true, maxChunkSize: 4096, encodings: ['text', 'base64', 'hex'], compressions: ['none'], ack: true } }) /* 触发 init → sendHs(0) */
  const hs0 = ic.sent[0]
  assertEq(hs0 && hs0.tag, '__hs__', '首帧为握手')
  assertEq(hs0 && hs0.count, 0, '握手从 0 起')
  assertEq(hs0 && hs0.caps.version, 3, '本端声明 v3')
  assertEq(hs0 && hs0.caps.chunk, true, '声明分片')
  assertEq(hs0 && hs0.caps.ack, true, '声明 ACK 流控')
  assertEq(hs0 && hs0.caps.maxChunkSize, 4096, '分片 4096')
  ic.deliver({ tag: '__hs__', count: 1, caps: { version: 4, chunk: true, maxChunkSize: 8192, encodings: ['hex', 'base64', 'text'], compressions: ['deflate', 'none'], ack: true } })
  const hs2 = ic.sentOf('__hs__')[1]
  assertEq(hs2 && hs2.count, 2, '回 count+1=2 终止 ping-pong')
  assert(b.bridgeReady() === true, '握手完成 ready')
  const neg = b.bridgeNegotiated()
  assertEq(neg.version, 3, '版本取 min(4,3)=3')
  assertEq(neg.chunked, true, '分片协商成立')
  assertEq(neg.chunkSize, 4096, '分片大小 min(8192,4096)')
  assertEq(neg.ack, true, 'ACK 流控成立')
  assert(Array.isArray(neg.encodings) && neg.encodings.indexOf('hex') >= 0, '编码交集含 hex')
  assert(neg.compressions.indexOf('deflate') < 0, '压缩交集剔除未支持的 deflate')
})

T('② 单消息 text：JSON 文本归一为对象（responseType 语义对齐）', async () => {
  const ic = makeInterconn()
  const b = loadModule('src/utils/bridge.js', { '@system.interconnect': ic.mock })
  b.bridgeReady()
  /* 标准握手交付（v3 caps）：bridgeFetch 依赖 _hs=true 才立即发帧 */
  ic.deliver({ tag: '__hs__', count: 1, caps: { version: 3, chunk: true, maxChunkSize: 4096, encodings: ['text', 'base64', 'hex'], compressions: ['none'], ack: true } })
  const p = b.bridgeFetch({ url: 'https://api.github.com/x' })
  await sleep(10)
  const frame = ic.sentOf('fetch')[0]
  assertEq(frame && frame.url, 'https://api.github.com/x', 'fetch 帧 URL')
  assertEq(frame && frame.options.method, 'GET', '缺省 GET')
  assertEq(frame && frame.options.raw, false, '统一要 UTF-8 文本')
  assertEq(frame && frame.options.followRedirects, true, '跟随重定向')
  ic.deliver({ tag: 'fetch', id: frame.id, resp: { ok: true, status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' }, body: '{"a":1}', raw: false } })
  const r = await p
  assertEq(r.code, 200, 'HTTP 状态透传')
  assertEq(r.data && r.data.a, 1, 'JSON 对象归一')
  assertEq(r.headers['content-type'], 'application/json', 'headers 透传')
})

T('③ 单消息 hex：四字节 emoji UTF-8 解码', async () => {
  const ic = makeInterconn()
  const b = loadModule('src/utils/bridge.js', { '@system.interconnect': ic.mock })
  b.bridgeReady()
  /* 标准握手交付（v3 caps）：bridgeFetch 依赖 _hs=true 才立即发帧 */
  ic.deliver({ tag: '__hs__', count: 1, caps: { version: 3, chunk: true, maxChunkSize: 4096, encodings: ['text', 'base64', 'hex'], compressions: ['none'], ack: true } })
  const p = b.bridgeFetch({ url: 'https://x.cn/e' })
  await sleep(10)
  const frame = ic.sentOf('fetch')[0]
  ic.deliver({ tag: 'fetch', id: frame.id, resp: { ok: true, status: 200, headers: {}, body: hexOf('{"e":"😀中"}'), raw: false, bodyEncoding: 'hex' } })
  const r = await p
  assertEq(r.data && r.data.e, '😀中', 'hex → UTF-8 含代理对')
})

T('④ 单消息 base64：多字节中文解码', async () => {
  const ic = makeInterconn()
  const b = loadModule('src/utils/bridge.js', { '@system.interconnect': ic.mock })
  b.bridgeReady()
  /* 标准握手交付（v3 caps）：bridgeFetch 依赖 _hs=true 才立即发帧 */
  ic.deliver({ tag: '__hs__', count: 1, caps: { version: 3, chunk: true, maxChunkSize: 4096, encodings: ['text', 'base64', 'hex'], compressions: ['none'], ack: true } })
  const p = b.bridgeFetch({ url: 'https://x.cn/b' })
  await sleep(10)
  const frame = ic.sentOf('fetch')[0]
  ic.deliver({ tag: 'fetch', id: frame.id, resp: { ok: true, status: 200, headers: {}, body: b64Of('你好 Vela'), raw: false, bodyEncoding: 'base64' } })
  const r = await p
  assertEq(r.data, '你好 Vela', 'base64 → UTF-8')
})

T('⑤ 分片模式：乱序到达 + 累计 ACK [0,1,3] + 重组', async () => {
  const ic = makeInterconn()
  const b = loadModule('src/utils/bridge.js', { '@system.interconnect': ic.mock })
  b.bridgeReady()
  /* 标准握手交付（v3 caps）：bridgeFetch 依赖 _hs=true 才立即发帧 */
  ic.deliver({ tag: '__hs__', count: 1, caps: { version: 3, chunk: true, maxChunkSize: 4096, encodings: ['text', 'base64', 'hex'], compressions: ['none'], ack: true } })
  const p = b.bridgeFetch({ url: 'https://x.cn/c' })
  await sleep(10)
  const frame = ic.sentOf('fetch')[0]
  ic.deliver({ tag: 'fetch', id: frame.id, resp: { ok: true, status: 200, headers: {}, body: '', raw: false, chunked: true, totalBytes: 9, chunkSize: 3, chunkCount: 3, bodyEncoding: 'hex', ack: true } })
  ic.deliver({ tag: 'fetch-chunk', id: frame.id, seq: 2, total: 3, data: hexOf('ghi') })
  ic.deliver({ tag: 'fetch-chunk', id: frame.id, seq: 0, total: 3, data: hexOf('abc') })
  ic.deliver({ tag: 'fetch-chunk', id: frame.id, seq: 1, total: 3, data: hexOf('def') })
  const r = await p
  assertEq(r.data, 'abcdefghi', '乱序分片重组')
  const acks = ic.sentOf('fetch-ack')
  assertEq(acks.map((a) => a.ack), [0, 1, 3], '累计 ACK=连续前沿')
  assert(acks.every((a) => a.id === frame.id), 'ACK 带 id 关联')
})

T('⑥ v1 兜底：对端无 caps → 不分片，单消息文本照常', async () => {
  const ic = makeInterconn()
  const b = loadModule('src/utils/bridge.js', { '@system.interconnect': ic.mock })
  b.bridgeReady()
  /* 标准握手交付（v3 caps）：bridgeFetch 依赖 _hs=true 才立即发帧 */
  ic.deliver({ tag: '__hs__', count: 1, caps: { version: 3, chunk: true, maxChunkSize: 4096, encodings: ['text', 'base64', 'hex'], compressions: ['none'], ack: true } })
  ic.deliver({ tag: '__hs__', count: 1 }) /* 无 caps → v1 客户端 */
  const neg = b.bridgeNegotiated()
  assertEq(neg.version, 1, '降级 v1')
  assertEq(neg.chunked, false, '不分片')
  const p = b.bridgeFetch({ url: 'https://x.cn/v1' })
  await sleep(10)
  const frame = ic.sentOf('fetch')[0]
  ic.deliver({ tag: 'fetch', id: frame.id, resp: { ok: true, status: 200, headers: {}, body: '"txt"', raw: false } })
  const r = await p
  assertEq(r.data, 'txt', 'v1 文本路径可用')
})

T('⑦ §5.3 传输错误：ok=false status=0 → reject', async () => {
  const ic = makeInterconn()
  const b = loadModule('src/utils/bridge.js', { '@system.interconnect': ic.mock })
  b.bridgeReady()
  /* 标准握手交付（v3 caps）：bridgeFetch 依赖 _hs=true 才立即发帧 */
  ic.deliver({ tag: '__hs__', count: 1, caps: { version: 3, chunk: true, maxChunkSize: 4096, encodings: ['text', 'base64', 'hex'], compressions: ['none'], ack: true } })
  const p = b.bridgeFetch({ url: 'https://x.cn/e' }).catch((e) => e)
  await sleep(10)
  const frame = ic.sentOf('fetch')[0]
  ic.deliver({ tag: 'fetch', id: frame.id, resp: { ok: false, status: 0, statusText: 'dns lookup fail', headers: {}, body: '', raw: false } })
  const err = await p
  assert(err && err.status === 0, 'status 0')
  assert(String(err.message).indexOf('网桥') === 0, '错误文案带网桥前缀：' + (err && err.message))
})

T('⑧ 超时：无响应 → reject 网桥响应超时', async () => {
  const ic = makeInterconn()
  const b = loadModule('src/utils/bridge.js', { '@system.interconnect': ic.mock })
  b.bridgeReady()
  /* 标准握手交付（v3 caps）：bridgeFetch 依赖 _hs=true 才立即发帧 */
  ic.deliver({ tag: '__hs__', count: 1, caps: { version: 3, chunk: true, maxChunkSize: 4096, encodings: ['text', 'base64', 'hex'], compressions: ['none'], ack: true } })
  const r = await b.bridgeFetch({ url: 'https://x.cn/t', timeout: 60 }).catch((e) => e)
  assert(r && r.timeout === true, 'timeout 标记')
  assertEq(r && r.message, '网桥响应超时', '超时文案')
})

T('⑨ 未协商压缩：响应带 deflate → 显式 reject（不静默毒数据）', async () => {
  const ic = makeInterconn()
  const b = loadModule('src/utils/bridge.js', { '@system.interconnect': ic.mock })
  b.bridgeReady()
  /* 标准握手交付（v3 caps）：bridgeFetch 依赖 _hs=true 才立即发帧 */
  ic.deliver({ tag: '__hs__', count: 1, caps: { version: 3, chunk: true, maxChunkSize: 4096, encodings: ['text', 'base64', 'hex'], compressions: ['none'], ack: true } })
  const p = b.bridgeFetch({ url: 'https://x.cn/z' }).catch((e) => e)
  await sleep(10)
  const frame = ic.sentOf('fetch')[0]
  ic.deliver({ tag: 'fetch', id: frame.id, resp: { ok: true, status: 200, headers: {}, body: 'xxxx', raw: false, compression: 'deflate' } })
  const err = await p
  assert(String(err && err.message).indexOf('压缩') >= 0, '压缩报错：' + (err && err.message))
})

T('⑩ 未知 tag（v4 fetch-stream-ack）：忽略不断链', async () => {
  const ic = makeInterconn()
  const b = loadModule('src/utils/bridge.js', { '@system.interconnect': ic.mock })
  b.bridgeReady()
  /* 标准握手交付（v3 caps）：bridgeFetch 依赖 _hs=true 才立即发帧 */
  ic.deliver({ tag: '__hs__', count: 1, caps: { version: 3, chunk: true, maxChunkSize: 4096, encodings: ['text', 'base64', 'hex'], compressions: ['none'], ack: true } })
  const p = b.bridgeFetch({ url: 'https://x.cn/u' })
  await sleep(10)
  const frame = ic.sentOf('fetch')[0]
  ic.deliver({ tag: 'fetch-stream-ack', id: frame.id, ack: 9 })
  ic.deliver({ tag: 'fetch', id: frame.id, resp: { ok: true, status: 200, headers: {}, body: 'ok', raw: false } })
  const r = await p
  assertEq(r.data, 'ok', '未知 tag 忽略后正常完成')
})

/* ================= B. api.js 集成 ================= */

T('⑪ bridge 模式端到端：getRepoPulls 走网桥、直连零调用', async () => {
  const mocks = apiMocks(() => { throw new Error('direct should not be called') })
  const api = loadModule('src/utils/api.js', mocks).default
  api.bridgeSetMode('bridge')
  /* 网桥握手就绪（bridgeFetch 需 _hs） */
  api.bridgeInfo()
  mocks._ic.deliver({ tag: '__hs__', count: 1, caps: { version: 3, chunk: true, maxChunkSize: 4096, encodings: ['text'], compressions: ['none'], ack: true } })
  const p = api.getRepoPulls('o/r', 1, 'open')
  await sleep(20)
  const frame = mocks._ic.sentOf('fetch')[0]
  assert(!!frame, '走网桥发出 fetch 帧')
  assert(String(frame && frame.url).indexOf('/repos/o/r/pulls?state=open&per_page=') >= 0, 'PR 列表 URL：' + (frame && frame.url))
  icResp(mocks._ic, frame, { ok: true, status: 200, headers: {}, body: JSON.stringify([{ id: 1, number: 7, title: 't', user: { login: 'u' }, updated_at: '2026-01-01T00:00:00Z' }]), raw: false })
  const list = await p
  assertEq(list && list.length, 1, 'PR 列表经网桥返回')
  assertEq(list[0].number, 7, 'PR number 透传')
  assertEq(mocks._fetch.calls.length, 0, '直连零调用')
})

function icResp(ic, frame, resp) {
  ic.deliver({ tag: 'fetch', id: frame.id, resp: resp })
}

T('⑫ auto 模式：网桥就绪 → 网桥优先 + sticky', async () => {
  const mocks = apiMocks(() => ({ __fail: 'no net', code: 0 }))
  const api = loadModule('src/utils/api.js', mocks).default
  api.bridgeInfo() /* 触发 init */
  mocks._ic.deliver({ tag: '__hs__', count: 1, caps: { version: 3, chunk: true, maxChunkSize: 4096, encodings: ['text', 'base64'], compressions: ['none'], ack: true } })
  const info = api.bridgeInfo()
  assert(info.ready === true, '网桥就绪')
  const p = api.getRateLimit()
  await sleep(20)
  const frame = mocks._ic.sentOf('fetch')[0]
  assert(!!frame, '网桥优先发帧')
  icResp(mocks._ic, frame, { ok: true, status: 200, headers: {}, body: JSON.stringify({ resources: { core: { remaining: 4900, limit: 5000 } } }), raw: false })
  const r = await p
  assertEq(r && r.resources && r.resources.core.limit, 5000, 'auto 网桥优先返回')
  assert(api.bridgeInfo().sticky === true, 'sticky 置位')
  assertEq(mocks._fetch.calls.length, 0, '直连未被调用')
})

T('⑬ auto 模式：网桥未就绪 → 直连成功、sticky 保持 false', async () => {
  const mocks = apiMocks((n, opts) => ({ code: 200, data: JSON.stringify({ resources: { core: { remaining: 59, limit: 60 } } }), headers: {} }))
  const api = loadModule('src/utils/api.js', mocks).default
  const r = await api.getRateLimit()
  assertEq(r && r.resources && r.resources.core.remaining, 59, '直连成功')
  const info = api.bridgeInfo()
  assert(info.ready === false, '未握手')
  assert(info.sticky === false, 'sticky 未置位')
})

T('⑭ auto 模式：直连失败 → 网桥兜底成功（砍网机型根救路径）', async () => {
  const mocks = apiMocks(() => ({ __fail: 'network unreachable', code: 0 }))
  const api = loadModule('src/utils/api.js', mocks).default
  api.bridgeInfo()
  mocks._ic.deliver({ tag: '__hs__', count: 1, caps: { version: 3, chunk: true, maxChunkSize: 4096, encodings: ['text'], compressions: ['none'], ack: true } })
  const p = api.getRateLimit()
  await sleep(20)
  const frame = mocks._ic.sentOf('fetch')[0]
  assert(!!frame, '直连失败后网桥接手')
  icResp(mocks._ic, frame, { ok: true, status: 200, headers: {}, body: JSON.stringify({ resources: { core: { remaining: 1, limit: 5000 } } }), raw: false })
  const r = await p
  assertEq(r && r.resources && r.resources.core.limit, 5000, '网桥兜底返回')
  assert(api.bridgeInfo().sticky === true, '兜底成功 → sticky')
})

T('⑮ 模式持久化 + 非法值忽略 + 新导出存在', async () => {
  const mocks = apiMocks()
  const api = loadModule('src/utils/api.js', mocks).default
  assertEq(typeof api.bridgeInfo, 'function', 'bridgeInfo 导出')
  assertEq(typeof api.bridgeSetMode, 'function', 'bridgeSetMode 导出')
  assertEq(typeof api.bridgeDetect, 'function', 'bridgeDetect 导出')
  assertEq(typeof api.bridgeDiagnoseHost, 'function', 'bridgeDiagnoseHost 导出')
  assertEq(typeof api.getRepoPulls, 'function', 'getRepoPulls 导出')
  assertEq(typeof api.getRepoSubscription, 'function', 'getRepoSubscription 导出')
  assertEq(typeof api.setRepoSubscription, 'function', 'setRepoSubscription 导出')
  assertEq(typeof api.patchIssueState, 'function', 'patchIssueState 导出')
  api.bridgeSetMode('direct')
  assertEq(mocks['@system.storage']._map['gh_bridge_mode'], 'direct', 'direct 落盘')
  assertEq(api.bridgeInfo().mode, 'direct', '内存态同步')
  api.bridgeSetMode('nonsense')
  assertEq(api.bridgeInfo().mode, 'direct', '非法值被忽略')
  const d = await api.bridgeDiagnoseHost(100)
  assertEq(d && d.status, 0, '诊断透传（mock 恒 0）')
})

T('⑯ patchIssueState：PATCH 方法 + state 请求体', async () => {
  const mocks = apiMocks((n, opts) => ({ code: 200, data: JSON.stringify({ state: 'closed', number: 5 }), headers: {} }))
  const api = loadModule('src/utils/api.js', mocks).default
  const r = await api.patchIssueState('o/r', 5, 'closed')
  const call = mocks._fetch.calls[0]
  assertEq(call.method, 'PATCH', 'PATCH 方法')
  assert(String(call.url).indexOf('/repos/o/r/issues/5') >= 0, 'issue URL')
  assertEq(String(call.data), '{"state":"closed"}', 'state 请求体')
  assertEq(r && r.number, 5, '响应透传')
})

T('⑰ setRepoSubscription 三态：DELETE / PUT subscribed / PUT ignored', async () => {
  const mocks = apiMocks((n, opts) => ({ code: 200, data: '{}', headers: {} }))
  const api = loadModule('src/utils/api.js', mocks).default
  await api.setRepoSubscription('o/r', 'off')
  let c = mocks._fetch.calls[0]
  assertEq(c.method, 'DELETE', 'off → DELETE')
  await api.setRepoSubscription('o/r', 'on')
  c = mocks._fetch.calls[1]
  assertEq(c.method, 'PUT', 'on → PUT')
  assertEq(String(c.data), '{"subscribed":true,"ignored":false}', 'on 请求体')
  await api.setRepoSubscription('o/r', 'ignore')
  c = mocks._fetch.calls[2]
  assertEq(String(c.data), '{"subscribed":false,"ignored":true}', 'ignore 请求体')
})

T('⑱ getRepoPulls URL：state/per_page/page 组合', async () => {
  const mocks = apiMocks((n, opts) => ({ code: 200, data: '[]', headers: {} }))
  const api = loadModule('src/utils/api.js', mocks).default
  await api.getRepoPulls('o/r', 2, 'closed')
  const url = String(mocks._fetch.calls[0].url)
  assert(url.indexOf('/repos/o/r/pulls?state=closed&per_page=') >= 0, 'URL 前缀：' + url)
  assert(url.indexOf('page=2') > 0, 'page=2')
})

/* ---------------- 尾部 ---------------- */
;(async () => { for (const t of _tests) await t; summary() })()

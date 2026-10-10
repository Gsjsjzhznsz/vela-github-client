/**
 * bridge.js — AstroBox NG「网桥 FetchBridge」客户端（协议 v3）
 *
 * 背景：部分小米穿戴机型固件砍掉了应用联网能力（fetch 直接失败）。
 * AstroBox NG（手机端宿主）的 FetchBridge 插件通过 QAIC interconnect 通道
 * 代理 HTTP 请求：手表快应用发 JSON 帧 → 手机插件代发请求 → 分片回传响应。
 * 协议规范：AstralSightStudios/AstroBox-NG-Plugin-MiWear-InterconnectFetch
 *           PROTOCOL.md v4（本客户端按 v3 子集实现，插件永久兼容 v1-v3）。
 *
 * 实现要点（与协议逐条对应）：
 *  - 握手：count 0→2 ping-pong + caps 协商（version/chunk/maxChunkSize/
 *    encodings/compressions/ack/ackWindow）；
 *  - 单消息模式（v1 兼容兜底）：text 直接用，base64/hex 解码 → UTF-8；
 *  - 分片模式（v2/v3）：按 id 重组，累计 ACK 滑动窗口（每片回 ack=连续前沿，
 *    协议 §5.2.1 硬性要求增量回 ACK，防 BLE 通道灌死）；
 *  - 错误响应（§5.3）：ok=false && status=0 → reject（传输层失败）；
 *    其余按 HTTP status 正常 resolve 交给上层语义处理；
 *  - 压缩：仅协商 none（不引入 pako/lz4 解压库，控制体积）；
 *  - 重定向：followRedirects=true（插件侧跟随，跨源自动脱 Authorization）。
 *
 * 传输层：@system.interconnect（Vela 官方「设备通信」接口，连接自动建立）。
 * send 的 data 为对象（引擎序列化为 JSON 文本到对端）；onmessage 收到的
 * data.data 为 JSON 文本 → JSON.parse。固件缺该 feature 时 require 抛错，
 * 本模块静默禁用（supported()=false），上层照走直连，零副作用。
 */

let interconn = null
try {
  /* webpack 静态依赖：固件不支持/未声明 feature 时在模块求值期抛错 → 桥禁用 */
  interconn = require('@system.interconnect')
} catch (e) { interconn = null }

const HS_TAG = '__hs__'
const FETCH_TAG = 'fetch'
const CHUNK_TAG = 'fetch-chunk'
const ACK_TAG = 'fetch-ack'

/* 本端能力声明（协议 §3.3）。v3 = 分片 + 累计 ACK；编码 text 优先
 * （JSON/README 零解码开销），base64 兜底，hex 次之（解码极简）。 */
const LOCAL_CAPS = {
  version: 3,
  chunk: true,
  maxChunkSize: 4096,
  encodings: ['text', 'base64', 'hex'],
  compressions: ['none'],
  ack: true,
  ackWindow: 4
}

const HS_WAIT_MS = 6000      /* bridgeFetch 等待握手上限（AstroBox 刚启动场景） */
const DEF_TIMEOUT = 30000    /* 单请求超时（BLE 链路较慢，比直连 25s 略宽） */

let _connect = null
let _inited = false
let _hs = false              /* 收到过插件握手回包 = 对端存在实证 */
let _neg = { version: 1, chunked: false, chunkSize: 0, ack: false, encodings: [], compressions: [] }
let _id = 0
const _pending = {}
const _hsWaiters = []
const _stat = { sent: 0, ok: 0, err: 0, lastErr: '' }

/* ============================ 初始化与握手 ============================ */

function supported() { return !!interconn }

function init() {
  if (_inited || !interconn) return
  _inited = true
  try {
    _connect = interconn.instance()
    _connect.onmessage = (data) => {
      const text = data && typeof data === 'object'
        ? (data.data !== undefined ? data.data : (data.payloadText || ''))
        : (data || '')
      let msg = null
      try { msg = typeof text === 'string' ? JSON.parse(text) : text } catch (e) { return }
      onMsg(msg)
    }
    _connect.onopen = () => { sendHs(0) }
    _connect.onclose = () => { _hs = false; failAll('手表-手机连接已断开') }
    _connect.onerror = () => { _hs = false }
  } catch (e) { _connect = null }
  sendHs(0)
}

function sendHs(count) {
  if (!_connect) return
  try {
    _connect.send({ data: { tag: HS_TAG, count: count, caps: LOCAL_CAPS } })
  } catch (e) { /* 通道未就绪，onopen 后会重发 */ }
}

function negotiateCaps(peer) {
  if (!peer) return { version: 1, chunked: false, chunkSize: 0, ack: false, encodings: [], compressions: [] }
  const version = Math.min(Number(peer.version) || 1, LOCAL_CAPS.version)
  const chunked = !!peer.chunk && LOCAL_CAPS.chunk && version >= 2
  const peerMax = Number(peer.maxChunkSize) || LOCAL_CAPS.maxChunkSize
  const chunkSize = chunked ? Math.max(256, Math.min(peerMax, LOCAL_CAPS.maxChunkSize)) : 0
  const peerEnc = Array.isArray(peer.encodings) ? peer.encodings : []
  const peerCmp = Array.isArray(peer.compressions) ? peer.compressions : []
  return {
    version: version,
    chunked: chunked,
    chunkSize: chunkSize,
    ack: chunked && !!peer.ack && LOCAL_CAPS.ack,
    encodings: peerEnc.filter(function (x) { return LOCAL_CAPS.encodings.indexOf(x) >= 0 }),
    compressions: peerCmp.filter(function (x) { return LOCAL_CAPS.compressions.indexOf(x) >= 0 })
  }
}

function handleHs(msg) {
  _neg = negotiateCaps(msg && msg.caps)
  _hs = true
  /* 唤醒等握手的调用方 */
  while (_hsWaiters.length) {
    const w = _hsWaiters.shift()
    try { w.resolve(true) } catch (e) {}
  }
  const count = Number(msg && msg.count) || 0
  if (count < 2) sendHs(count + 1)
}

/* ============================ 解码工具 ============================ */

const B64T = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function b64Bytes(s) {
  /* 标准 base64 → 字节（容忍 URL-safe 变体与缺省 padding） */
  const clean = String(s || '').replace(/-/g, '+').replace(/_/g, '/').replace(/[^A-Za-z0-9+/]/g, '')
  const len = clean.length
  const out = new Uint8Array((len / 4 | 0) * 3 + (len % 4 > 1 ? len % 4 - 1 : 0))
  let o = 0
  let buf = 0
  let bits = 0
  for (let i = 0; i < len; i++) {
    const v = B64T.indexOf(clean.charAt(i))
    if (v < 0) continue
    buf = (buf << 6) | v
    bits += 6
    if (bits >= 8) {
      bits -= 8
      out[o++] = (buf >> bits) & 0xff
    }
  }
  return out.subarray(0, o)
}

function hexBytes(s) {
  const str = String(s || '')
  const out = new Uint8Array((str.length / 2) | 0)
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(str.substr(i * 2, 2), 16)
  }
  return out
}

function bytesUtf8(bytes) {
  /* UTF-8 字节 → JS 字符串（含代理对/四字节 emoji） */
  let out = ''
  let i = 0
  const n = bytes.length
  while (i < n) {
    const b = bytes[i]
    let cp = 0
    if (b < 0x80) { cp = b; i += 1 }
    else if (b < 0xe0) { cp = ((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f); i += 2 }
    else if (b < 0xf0) {
      cp = ((b & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f)
      i += 3
    } else {
      cp = ((b & 0x07) << 18) | ((bytes[i + 1] & 0x3f) << 12) | ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f)
      i += 4
    }
    if (cp > 0xffff) {
      cp -= 0x10000
      out += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff))
    } else {
      out += String.fromCharCode(cp)
    }
  }
  return out
}

/* 单消息/分片共用：bodyEncoding → UTF-8 文本；未协商压缩却收到压缩 → 显式报错 */
function respText(resp) {
  const cmp = resp.compression
  if (cmp && cmp !== 'none') {
    throw { message: '网桥响应压缩未支持（' + cmp + '）' }
  }
  const enc = resp.bodyEncoding || (resp.raw ? 'base64' : 'text')
  if (enc === 'text') return String(resp.body || '')
  if (enc === 'base64') return bytesUtf8(b64Bytes(resp.body))
  if (enc === 'hex') return bytesUtf8(hexBytes(resp.body))
  throw { message: '网桥未知编码 ' + enc }
}

/* 与 Vela fetch responseType 语义对齐：json 模式 parse 成功返回对象，
 * 失败回退原文；raw 模式一律字符串（api.js raw 分支依赖字符串） */
function decodeMaybeJson(opts, text) {
  if (opts && opts.raw) return text
  if (opts && opts.rt === 'text') return text
  const s = String(text == null ? '' : text).replace(/^\uFEFF/, '').trim()
  if (!s) return ''
  try { return JSON.parse(s) } catch (e) { return String(text) }
}

/* ============================ 响应处理 ============================ */

function cleanup(slot) {
  if (slot.timer) { clearTimeout(slot.timer); slot.timer = null }
  if (slot.id !== undefined) delete _pending[slot.id]
}

function failAll(reason) {
  for (const id in _pending) {
    const slot = _pending[id]
    slot.err = { status: 0, bridgeDown: true, message: '网桥：' + reason }
    cleanup(slot)
    try { slot.reject(slot.err) } catch (e) {}
    _stat.err++
  }
}

function handleHeader(msg) {
  const slot = _pending[msg.id]
  if (!slot) return
  const resp = msg.resp || {}
  /* §5.3 传输失败：永远单消息 v1 形态（ok=false, status=0）→ 传输层错误 */
  if (resp.ok === false && !Number(resp.status) && !resp.chunked) {
    const reason = resp.statusText || '传输失败'
    _stat.err++
    _stat.lastErr = reason
    cleanup(slot)
    try { slot.reject({ status: 0, bridge: true, message: '网桥：' + reason }) } catch (e) {}
    return
  }
  if (!resp.chunked) {
    /* 单消息模式（v1 兼容兜底 / 小响应） */
    _stat.ok++
    cleanup(slot)
    try {
      slot.resolve({
        code: Number(resp.status) || 0,
        data: decodeMaybeJson(slot.opts, respText(resp)),
        headers: resp.headers || {}
      })
    } catch (e) {
      _stat.err++
      _stat.lastErr = (e && e.message) || '解码失败'
      try { slot.reject(e) } catch (e2) {}
    }
    return
  }
  /* 分片模式：暂存头部，等待 fetch-chunk */
  slot.header = resp
  slot.chunks = new Array(Number(resp.chunkCount) || 0)
  slot.got = 0
  slot.acked = 0
}

function sendAck(id, ack) {
  if (!_connect) return
  try {
    _connect.send({ data: { tag: ACK_TAG, id: id, ack: ack } })
  } catch (e) { /* ACK 丢失由插件 go-back-N 重传兜底 */ }
}

function handleChunk(msg) {
  const slot = _pending[msg.id]
  if (!slot || !slot.header) return
  const seq = msg.seq | 0
  if (!slot.chunks[seq]) {
    const enc = slot.header.bodyEncoding || 'base64'
    slot.chunks[seq] = enc === 'hex' ? hexBytes(msg.data) : b64Bytes(msg.data)
    slot.got++
  } else if (slot.header.ack !== true) {
    return /* 重复分片且无流控：忽略 */
  }
  if (slot.header.ack === true) {
    /* 累计 ACK：ack = 已按序连续收到的分片数（协议 §5.2.1，每片必回） */
    let a = slot.acked
    while (a < slot.chunks.length && slot.chunks[a]) a++
    slot.acked = a
    sendAck(msg.id, a)
  }
  if (slot.got >= (Number(slot.header.chunkCount) || 0)) finishChunks(slot)
}

function finishChunks(slot) {
  const h = slot.header
  const cnt = Number(h.chunkCount) || 0
  const total = Number(h.totalBytes) || 0
  let bytes = total > 0 ? new Uint8Array(total) : null
  let off = 0
  const loose = []
  for (let i = 0; i < cnt; i++) {
    const p = slot.chunks[i]
    if (!p) {
      _stat.err++
      _stat.lastErr = '分片缺失 ' + i
      cleanup(slot)
      try { slot.reject({ status: 0, bridge: true, message: '网桥分片缺失 ' + i }) } catch (e) {}
      return
    }
    if (bytes) { bytes.set(p, off); off += p.length }
    else loose.push(p)
  }
  if (!bytes) {
    let n = 0
    for (let i = 0; i < loose.length; i++) n += loose[i].length
    bytes = new Uint8Array(n)
    off = 0
    for (let i = 0; i < loose.length; i++) { bytes.set(loose[i], off); off += loose[i].length }
  }
  _stat.ok++
  cleanup(slot)
  try {
    slot.resolve({
      code: Number(h.status) || 0,
      data: decodeMaybeJson(slot.opts, bytesUtf8(bytes)),
      headers: h.headers || {}
    })
  } catch (e) {
    _stat.err++
    _stat.lastErr = (e && e.message) || '解码失败'
    try { slot.reject(e) } catch (e2) {}
  }
}

function onMsg(msg) {
  if (!msg || typeof msg !== 'object') return
  const tag = msg.tag
  if (tag === HS_TAG) { handleHs(msg); return }
  if (tag === FETCH_TAG) { handleHeader(msg); return }
  if (tag === CHUNK_TAG) { handleChunk(msg); return }
  /* 未知 tag（v4 fetch-stream 等）：协议要求忽略不报错 */
}

/* ============================ 对外 API ============================ */

/** 等待握手完成（AstroBox/插件刚启动时最多 HS_WAIT_MS） */
function waitHs(ms) {
  if (_hs) return Promise.resolve(true)
  return new Promise((resolve) => {
    const w = { resolve: resolve }
    _hsWaiters.push(w)
    setTimeout(() => {
      const i = _hsWaiters.indexOf(w)
      if (i >= 0) { _hsWaiters.splice(i, 1) }
      resolve(_hs)
    }, ms || HS_WAIT_MS)
    /* 顺带补发一次握手，加速对端发现 */
    sendHs(0)
  })
}

/** 网桥 fetch：opts 与 api.js rawFetch 同形 {url, method, header, data, raw, rt, timeout}
 *  resolve 形态与 Vela fetch 对齐 {code, data, headers} */
export async function bridgeFetch(opts) {
  if (!interconn) throw { status: 0, bridge: true, message: '本机不支持 interconnect 通道' }
  init()
  if (!_connect) throw { status: 0, bridge: true, message: '网桥通道初始化失败' }
  const okHs = await waitHs(HS_WAIT_MS)
  if (!okHs) throw { status: 0, bridge: true, message: '网桥未连接（未发现手机端 FetchBridge）' }

  const id = String(++_id)
  const req = {
    tag: FETCH_TAG,
    id: id,
    url: opts.url,
    options: {
      method: String(opts.method || 'GET').toUpperCase(),
      headers: opts.header || {},
      body: opts.data !== undefined && opts.data !== null ? String(opts.data) : undefined,
      /* 本客户端统一要 UTF-8 文本（api.js 全部消费 JSON/文本）；
       * opts.raw 仅决定上层解析方式，不影响线格式 */
      raw: false,
      followRedirects: true
    }
  }
  const slot = { id: id, opts: opts, resolve: null, reject: null, timer: null }
  _pending[id] = slot
  _stat.sent++
  return new Promise((resolve, reject) => {
    slot.resolve = resolve
    slot.reject = reject
    slot.timer = setTimeout(() => {
      if (_pending[id]) {
        cleanup(slot)
        _stat.err++
        _stat.lastErr = '超时'
        try { reject({ status: 0, bridge: true, timeout: true, message: '网桥响应超时' }) } catch (e) {}
      }
    }, opts.timeout || DEF_TIMEOUT)
    _connect.send({
      data: req,
      success: () => {},
      fail: (d, code) => {
        if (_pending[id]) {
          cleanup(slot)
          _stat.err++
          _stat.lastErr = '发送失败 ' + code
          _hs = code === 1006 ? false : _hs
          try { reject({ status: 0, bridge: true, code: code, message: '网桥发送失败(' + (code || '?') + ')' }) } catch (e) {}
        }
      }
    })
  })
}

export function bridgeSupported() { return supported() }

/** 网桥就绪 = 本机支持 + 插件握手完成（对端存在实证） */
export function bridgeReady() { init(); return supported() && _hs }

export function bridgeNegotiated() { return _neg }

export function bridgeStats() { return { hs: _hs, neg: _neg, stat: _stat } }

/** 主动补发握手（设置页「检测网桥」用） */
export function bridgeKick() { init(); sendHs(0); return bridgeReady() }

/** 手机端宿主连接诊断（0 OK / 204 超时 / 1001 手机 App 未安装） */
export function bridgeDiagnose(timeout) {
  return new Promise((resolve) => {
    if (!interconn) { resolve({ status: -1, message: '本机不支持 interconnect' }); return }
    init()
    if (!_connect) { resolve({ status: -2, message: '通道初始化失败' }); return }
    try {
      _connect.diagnosis({
        timeout: timeout || 8000,
        success: (d) => resolve({ status: Number(d && d.status) }),
        fail: (d, code) => resolve({ status: -3, message: (d && d.data) || ('诊断失败 ' + code) })
      })
    } catch (e) { resolve({ status: -4, message: '诊断异常' }) }
  })
}

export default { bridgeFetch, bridgeSupported, bridgeReady, bridgeNegotiated, bridgeStats, bridgeKick, bridgeDiagnose }

/**
 * api.js — GitHub REST API v3 封装
 * 基于 Vela 官方 @system.fetch，Promise 化 + 统一错误处理 + 限流感知。
 * 网络链路：手表经小米运动健康蓝牙代理或 eSIM 独立联网，对应用层透明。
 */
import fetch from '@system.fetch'
import storage from '@system.storage'
import file from '@system.file'
import downloader from '@system.request'

const API_BASE = 'https://api.github.com'
const TOKEN_KEY = 'gh_token'
const TOKEN_FILE = 'internal://files/gh_token.txt'
const PER_PAGE = 10

/* ---------------- 存储层（Promise 化，v1.1.4 双通道） ----------------
 * 真机（RW5）实测：storage.set 回调 success 后，另页 context 读不到、大退后丢失
 * （v1.1.2 模拟器同路径验证是好的，属固件差异）。参考 TG Wear/BandQQ 等成熟
 * Vela 应用均把关键状态放在手机端，手表端持久化尽量少用——本应用无手机端，
 * 故采用 storage + file 双通道互为备份，读回验证，settings 页诊断可见。 */

function stGet(key) {
  return new Promise((resolve) => {
    try {
      storage.get({
        key,
        success: (d) => resolve(d == null ? '' : d),
        fail: () => resolve('')
      })
    } catch (e) { resolve('') }
  })
}

function stSet(key, value) {
  return new Promise((resolve, reject) => {
    try {
      storage.set({ key, value, success: () => resolve(true), fail: (d, c) => reject({ d, c }) })
    } catch (e) { reject(e) }
  })
}

function stRemove(key) {
  return new Promise((resolve) => {
    try {
      storage.delete({ key, success: resolve, fail: resolve })
    } catch (e) { resolve() }
  })
}

/* file 通道：internal://files 常驻分区，writeText 文件不存在会自建 */
function fileGet(uri) {
  return new Promise((resolve) => {
    try {
      file.readText({
        uri,
        success: (d) => resolve(typeof d === 'string' ? d : ((d && d.text) || '')),
        fail: () => resolve('')
      })
    } catch (e) { resolve('') }
  })
}

function fileSet(uri, text) {
  return new Promise((resolve, reject) => {
    try {
      file.writeText({ uri, text, success: () => resolve(true), fail: (d, c) => reject({ d, c }) })
    } catch (e) { reject(e) }
  })
}

function fileRemove(uri) {
  return new Promise((resolve) => {
    try {
      file.delete({ uri, success: resolve, fail: resolve })
    } catch (e) { resolve() }
  })
}

/* ---------------- Token 管理 ---------------- */

let _token = ''
let _tokenReady = null

/** 读取本地 Token（进程内缓存一次）
 *  v1.1.2：本固件每页 JS context 独立持有本模块副本，saveToken 只能重置当前页的
 *  _tokenReady，其它存活页面的缓存仍指向旧值（实机实证：登录成功后设置页仍显示
 *  游客模式）。force=true 时强制重读存储——需要在 onShow 感知登录态变化的页面
 *  （settings/profile/input）必须传 force。 */
export function loadToken(force) {
  if (force) _tokenReady = null
  if (_tokenReady) return _tokenReady
  _tokenReady = (async () => {
    // 双通道读取：storage 优先，空则 file 兜底（真机 storage 通道不可靠）
    let v = await stGet(TOKEN_KEY)
    let src = 'storage'
    if (!v || typeof v !== 'string' || !v.length) {
      v = await fileGet(TOKEN_FILE)
      src = 'file'
    }
    _token = typeof v === 'string' ? v : (v ? String(v) : '')
    if (!_token) src = ''
    _persistDiag.storage = src === 'storage' ? _token.length : 0
    _persistDiag.file = src === 'file' ? _token.length : 0
    _persistDiag.src = src
    return _token
  })()
  return _tokenReady
}

export function hasToken() {
  return !!_token
}

/** 当前 Token（仅用于打码展示） */
export function currentToken() {
  return _token
}

/* 持久化诊断（settings 页展示 + input 页登录后读回验证） */
let _persistDiag = { storage: 0, file: 0, src: '', write: '' }

export function storageDiag() {
  return { storage: _persistDiag.storage, file: _persistDiag.file, src: _persistDiag.src, write: _persistDiag.write }
}

/** 双通道写入：storage 失败不影响 file 兜底，两通道全失败才判定不落盘。
 *  返回 {storage, file} 两通道是否成功（字符长度记入诊断）。 */
async function persistToken(t) {
  const r = { storage: false, file: false }
  try { await stSet(TOKEN_KEY, t); r.storage = true } catch (e) { r.storage = false }
  try { await fileSet(TOKEN_FILE, t); r.file = true } catch (e) { r.file = false }
  return r
}

async function unpersistToken() {
  try { await stRemove(TOKEN_KEY) } catch (e) {}
  try { await fileRemove(TOKEN_FILE) } catch (e) {}
}

export async function saveToken(token) {
  _token = (token || '').trim()
  let r = { storage: false, file: false }
  if (_token) {
    r = await persistToken(_token)
  } else {
    await unpersistToken()
  }
  // 同步进程内缓存（否则本 context 后续 loadToken 仍返回旧值）；
  // 同时撤销缓存态：确保后续 loadToken(true/false) 都能拿到最新值
  _tokenReady = Promise.resolve(_token)
  _self = null
  clearCache() /* v1.2.1：token 变更全清缓存（不同身份的数据不可复用） */
  _persistDiag.storage = r.storage ? _token.length : 0
  _persistDiag.file = r.file ? _token.length : 0
  _persistDiag.write = _token ? (r.storage && r.file ? '双通道√' : (r.storage ? '仅storage' : (r.file ? '仅file' : '双通道均失败'))) : '已清除'
  return _token
}

export async function clearToken() {
  return saveToken('')
}

/** v1.1.4：读回验证（登录后立即确认两通道是否真的存上了） */
export async function verifyPersisted() {
  const s = await stGet(TOKEN_KEY)
  const f = await fileGet(TOKEN_FILE)
  _persistDiag.storage = typeof s === 'string' ? s.length : 0
  _persistDiag.file = typeof f === 'string' ? f.length : 0
  return { storage: !!s, file: !!f }
}

/**
 * v1.1.3：验证任意 Token（不落盘、不污染既有登录态）。
 * 之前「先 saveToken 再验证、失败 clearToken」的顺序有两个致命伤：
 *  ① 二次输入拼接成脏 token 时 401 → clearToken 把之前存的 GOOD token 也清了 →
 *    用户被锁死在游客模式，重输又手误 → 无限循环（真机实锤）；
 *  ② 验证期间存储里已是脏 token，其它页 context 恰好发请求即携带脏值。
 * 改为：临时替换内存 token 调 /user，finally 恢复原值；验证通过才由调用方 saveToken。
 */
export async function validateToken(token) {
  const t = (token || '').replace(/\s+/g, '')
  if (!t) throw { status: -1, message: 'Token 为空' }
  const prevToken = _token
  const prevReady = _tokenReady
  _token = t
  _tokenReady = Promise.resolve(t)
  _self = null
  try {
    const user = await request('/user', { noCache: true })
    if (!user || !user.login) throw { status: 200, message: '响应异常，未取到用户名' }
    return user
  } finally {
    _token = prevToken
    _tokenReady = prevReady
    _self = null
  }
}

/** Token 格式诊断：返回空串=格式正常，否则给出可读提示（不发请求） */
export function tokenFormatHint(token) {
  const t = (token || '').replace(/\s+/g, '')
  if (!t) return '还没有输入内容'
  if (t.indexOf('ghp_') === 0) {
    if (t.length !== 40) return '当前 ' + t.length + ' 位，标准 ghp_ 令牌为 40 位，请检查大小写/漏字'
    if (!/^[A-Za-z0-9]{36}$/.test(t.slice(4))) return '含非法字符，令牌只含字母数字，请检查'
    return ''
  }
  if (t.indexOf('github_pat_') === 0) {
    if (t.length < 80) return '当前 ' + t.length + ' 位，github_pat_ 令牌约 93 位，请检查漏字'
    return ''
  }
  if (t.indexOf('gho_') === 0 || t.indexOf('ghu_') === 0 || t.indexOf('ghs_') === 0 || t.indexOf('ghr_') === 0) {
    return ''
  }
  return '令牌应以 ghp_ 或 github_pat_ 开头，当前开头：' + t.slice(0, 4)
}

/* ---------------- 限流状态（展示用） ---------------- */

let _rate = { remaining: -1, limit: -1 }

export function rateInfo() {
  return _rate
}

/* ---------------- fetch Promise 封装 ---------------- */

/* v1.2.1：显式超时（25s）——蓝牙代理偶发挂起时不再无限等待页面卡死，
 * 超时按网络失败走重试/报错路径 */
const FETCH_TIMEOUT = 25000

function rawFetch(opts) {
  return new Promise((resolve, reject) => {
    let done = false
    const timer = setTimeout(() => {
      if (!done) { done = true; reject({ timeout: true, message: '响应超时' }) }
    }, opts.timeout || FETCH_TIMEOUT)
    try {
      fetch.fetch({
        url: opts.url,
        method: opts.method || 'GET',
        header: opts.header || {},
        data: opts.data,
        responseType: opts.rt || 'json',
        success: (res) => { if (!done) { done = true; clearTimeout(timer); resolve(res) } },
        fail: (err, code) => { if (!done) { done = true; clearTimeout(timer); reject({ err: err, code: code }) } }
      })
    } catch (e) { if (!done) { done = true; clearTimeout(timer); reject(e) } }
  })
}

/* ================= v1.2.1 内存缓存 + 单飞去重 + ETag 条件请求 =================
 * 手表端传输优化三件套（蓝牙代理慢、配额贵、返回导航重复全量拉取）：
 * ① TTL 缓存：GET JSON 90s、raw 文本 5min，返回导航秒开、重复请求省配额；
 * ② in-flight 去重：同 URL 并发请求合并为一次真实网络往返；
 * ③ ETag 条件请求：缓存过期后带 If-None-Match 复验，304 只回响应头（几十字节），
 *    大幅降低重进页面的传输量；代理不支持时回落 200 全量，无副作用。
 * 写操作/登录校验/限流查询一律 noCache；通知已读操作后清前缀缓存。 */
const CACHE_TTL = 90000
const RAW_TTL = 300000
const MEM_CAP = 40
const _mem = { map: {}, inflight: {} }

function memGet(url, ttl) {
  const c = _mem.map[url]
  if (!c) return null
  if (Date.now() - c.ts > (ttl || CACHE_TTL)) return { fresh: false, data: c.data, etag: c.etag }
  return { fresh: true, data: c.data }
}

function memSet(url, data, etag) {
  const keys = Object.keys(_mem.map)
  if (keys.length >= MEM_CAP) {
    /* 容量保护：淘汰最旧一半（手表内存有限，避免长会话无界增长） */
    keys.sort((a, b) => _mem.map[a].ts - _mem.map[b].ts)
    for (let i = 0; i < Math.ceil(keys.length / 2); i++) delete _mem.map[keys[i]]
  }
  _mem.map[url] = { data: data, etag: etag || '', ts: Date.now() }
}

function memTouch(url) {
  const c = _mem.map[url]
  if (c) c.ts = Date.now()
}

/** 清缓存：无参全清（token 变更时），带前缀则清匹配项（通知已读后） */
export function clearCache(prefix) {
  if (!prefix) { _mem.map = {}; return }
  for (const k in _mem.map) {
    if (k.indexOf(prefix) >= 0) delete _mem.map[k]
  }
}

function pickHeader(headers, name) {
  if (!headers) return ''
  const n = String(name).toLowerCase()
  for (const k in headers) {
    if (String(k).toLowerCase() === n) return headers[k]
  }
  return ''
}

/* ================= v1.2.2 文件磁盘缓存（弦电子书式「一次落盘、随读随取」） =================
 * 参考弦电子书（com.bandbbs.plus.ebook）chapterManager 架构：内容落盘 + 索引 +
 * TTL 内存缓存。本应用文件内容经原生下载器整文件落盘到 fcache 后可反复读——
 * 返回导航秒开、重进零传输、冷启仍有效（内存缓存 _mem 进程死即失）。
 * internal://files/fcache/<hash>.txt + m.json 清单，LRU 容量 6 文件 / 4MB。 */
const FCACHE_DIR = 'internal://files/fcache/'
const FCACHE_MANIFEST = 'internal://files/fcache/m.json'
const FCACHE_MAX_FILES = 6
const FCACHE_MAX_BYTES = 4 * 1024 * 1024

function fhash(s) {
  let h = 5381
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0
  return 'f' + (h >>> 0).toString(36)
}

let _fcacheManifest = null

async function fcacheLoad() {
  if (_fcacheManifest) return _fcacheManifest
  const raw = await fileGet(FCACHE_MANIFEST)
  try {
    const m = JSON.parse(raw || '{}')
    _fcacheManifest = (m && Array.isArray(m.items)) ? m : { items: [] }
  } catch (e) { _fcacheManifest = { items: [] } }
  return _fcacheManifest
}

async function fcacheSave(m) {
  try { await fileSet(FCACHE_MANIFEST, JSON.stringify(m)) } catch (e) { /* 清单写失败仅影响下次冷启 */ }
}

/** 命中返回全文并 LRU 触碰；未命中返回 null（读失败也当未命中，下次重下） */
async function fcacheGet(url) {
  try {
    const m = await fcacheLoad()
    for (let i = 0; i < m.items.length; i++) {
      if (m.items[i].url === url) {
        const txt = await fileGet(FCACHE_DIR + m.items[i].f)
        if (!txt || !txt.length) return null
        m.items[i].ts = Date.now()
        fcacheSave(m)
        return txt
      }
    }
  } catch (e) { /* 存储异常静默，走网络 */ }
  return null
}

/** 写入缓存（头插 + LRU 裁剪）；失败不影响主流程 */
async function fcachePut(url, text) {
  try {
    const m = await fcacheLoad()
    const fname = fhash(url)
    await fileSet(FCACHE_DIR + fname, text)
    const rest = m.items.filter((x) => x.url !== url && x.f !== fname)
    rest.unshift({ url: url, f: fname, bytes: utf8Len(text), ts: Date.now() })
    let bytes = 0
    for (let i = 0; i < rest.length; i++) bytes += rest[i].bytes || 0
    while (rest.length > FCACHE_MAX_FILES || bytes > FCACHE_MAX_BYTES) {
      const victim = rest.pop()
      bytes -= victim.bytes || 0
      try { await fileRemove(FCACHE_DIR + victim.f) } catch (e) {}
    }
    m.items = rest
    await fcacheSave(m)
  } catch (e) { /* 缓存写失败不影响内容返回 */ }
}

/** 按字节上限截断字符串（UTF-8 序列完整，不切多字节字符） */
function utf8SliceBytes(s, maxBytes) {
  let b = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    let w = c < 0x80 ? 1 : (c < 0x800 ? 2 : 3)
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d2 = s.charCodeAt(i + 1)
      if (d2 >= 0xdc00 && d2 <= 0xdfff) w = 4
    }
    if (b + w > maxBytes) return s.slice(0, i)
    b += w
    if (w === 4) i++
  }
  return s
}

/** 有限并发映射（蓝牙代理对瞬时高并发敏感，并发压小 + 完成一个补一个） */
function mapLimit(items, limit, fn) {
  return new Promise((resolve, reject) => {
    const out = new Array(items.length)
    let next = 0
    let done = 0
    let failed = false
    const launch = () => {
      if (failed || next >= items.length) return
      const i = next++
      fn(items[i], i).then((r) => {
        if (failed) return
        out[i] = r
        done++
        if (done >= items.length) resolve(out)
        else launch()
      }).catch((e) => {
        if (failed) return
        failed = true
        reject(e)
      })
    }
    if (!items.length) return resolve(out)
    for (let k = 0; k < Math.min(limit, items.length); k++) launch()
  })
}

/* ---------------- 下载通道兜底（v1.1.4） ----------------
 * fetch 走蓝牙代理流式通道，大响应会被确定性截断（真机阈值 [14.3,42)KB）。
 * @system.request.download 走原生下载器管线（先落盘再回调），与 fetch 不同路；
 * 官方支持明细 REDMI Watch 5 支持。仅作 incomplete 时的兜底：
 * download → onDownloadComplete → file.readText → 解析。 */
function dlDownload(url, header) {
  return new Promise((resolve, reject) => {
    try {
      downloader.download({
        url,
        header,
        success: (d) => resolve(d && d.token),
        fail: (d, c) => reject({ d, c })
      })
    } catch (e) { reject(e) }
  })
}

function dlWait(token) {
  return new Promise((resolve, reject) => {
    try {
      downloader.onDownloadComplete({
        token,
        success: (d) => resolve(d && d.uri),
        fail: (d, c) => reject({ d, c })
      })
    } catch (e) { reject(e) }
  })
}

function dlRead(uri) {
  return new Promise((resolve, reject) => {
    try {
      file.readText({
        uri,
        success: (d) => resolve(typeof d === 'string' ? d : ((d && d.text) || '')),
        fail: (d, c) => reject({ d, c })
      })
    } catch (e) { reject(e) }
  })
}

function withTimeout(p, ms, tag) {
  return Promise.race([
    p,
    new Promise((resolve, reject) => setTimeout(() => reject({ dlTimeout: tag }), ms))
  ])
}

/** 下载通道取回响应正文（GET JSON/raw 均适用）；任何一步失败都抛错。
 *  v1.2.2：超时可调——文件主通道给足 30/45/10s（整文件落盘是慢而稳的管线），
 *  默认 8/15/5s（兜底通道不能拖死 UI，最坏 ~28s 后仍走 incomplete 报错）。 */
async function dlFetchText(url, header, timeouts) {
  const t = timeouts || {}
  const token = await withTimeout(dlDownload(url, header), t.download || 8000, 'download')
  if (!token) throw { dlErr: 'no token' }
  const uri = await withTimeout(dlWait(token), t.complete || 15000, 'complete')
  if (!uri) throw { dlErr: 'no uri' }
  const text = await withTimeout(dlRead(uri), t.read || 5000, 'read')
  // 临时文件清理（官方最佳实践：及时清理避免内存过载），失败不影响主流程
  try { file.delete({ uri }) } catch (e) {}
  return text
}

/** raw 站点错误体嗅探：raw.githubusercontent.com 对 404/403 返回纯文本
 *  「404: Not Found」等（HTTP 层可能是 200 由代理改写，或下载器拿到 200 空壳）。
 *  命中则视为该通道失败，绝不把错误体当文件内容缓存/渲染。 */
function sniffRawErrorBody(text) {
  return /^(\d{3}):[ \r\n]/.test(String(text || '').slice(0, 16))
}

/* ================= v1.2.0 GraphQL 快车道 =================
 * 真机根因：蓝牙代理对长响应确定性截断（阈值 [14.3,42)KB）。REST 列表携带
 * 全量字段（议题带 body、仓库带 license/owner 全家桶），10 条动辄 30-60KB。
 * GraphQL 只取列表页渲染所需瘦字段，单页响应 1-3KB，从源头避开截断。
 * 任何失败（游客无 token / POST 通道异常 / 限流 / 游标断链）一律回退
 * REST 自适应分页（v1.1.3 路径），保证功能不倒退。 */

const GQL_URL = 'https://api.github.com/graphql'

/* 仓库列表瘦字段（repos/search/trending 共用；沙箱实测单页 10 条 < 2KB） */
const GQL_REPO_NODE = 'id nameWithOwner description stargazerCount forkCount isFork isPrivate pushedAt updatedAt primaryLanguage{name} owner{login}'

function gqlHeaders() {
  const h = {
    'User-Agent': 'vela-github-client',
    Accept: 'application/vnd.github+json',
    'Content-Type': 'application/json'
  }
  if (_token) h['Authorization'] = 'Bearer ' + _token
  return h
}

/* res.data 可能是对象（responseType=json）或文本（代理降级），统一归一 */
function jsonMaybe(res) {
  let d = res.data
  if (typeof d === 'string') {
    const s = d.replace(/^\uFEFF/, '').trim()
    if (!s) return null
    try { return JSON.parse(s) } catch (e) { return null }
  }
  return d
}

async function ghql(query, variables) {
  await loadToken()
  if (!_token) throw { status: 0, gqlSkip: true, message: '游客模式，GraphQL 不可用' }
  let res = null
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, attempt === 1 ? 1200 : 2400))
    try {
      res = await rawFetch({
        url: GQL_URL, method: 'POST', header: gqlHeaders(),
        data: JSON.stringify({ query: query, variables: variables || {} })
      })
      break
    } catch (e) { res = null }
  }
  if (!res) throw { status: 0, gqlSkip: true, message: 'GraphQL 网络失败' }
  const status = Number(res.code) || 0
  const d = jsonMaybe(res)
  if (status === 401) throw { status: 401, message: 'Token 无效或已过期，请在「设置」更新' }
  if (status === 403 || status === 429) throw { status: status, gqlSkip: true, message: 'GraphQL 限流，回退 REST' }
  if (status < 200 || status >= 300) throw { status: status, gqlSkip: true, message: 'GraphQL HTTP ' + status }
  if (!d) throw { status: 200, gqlSkip: true, message: 'GraphQL 响应不完整' }
  if (d.errors && d.errors.length && !d.data) throw { status: 200, gqlSkip: true, message: (d.errors[0] && d.errors[0].message) || 'GraphQL 查询错误' }
  return d.data
}

/** 是否回退 REST：网络失败/限流/网关/截断/游标断链 → 回退；
 *  401（token 坏）/404（仓库不存在）/422（参数错）属确定失败，直接抛给页面。 */
function gqlShouldFallback(e) {
  if (!e) return true
  if (e.gqlSkip || e.cursorMiss || e.incomplete) return true
  const st = Number(e.status) || 0
  return st === 0 || st === 200 || st >= 500 || st === 403 || st === 429
}

/* GraphQL 以游标翻页、页面以页码翻页——模块级缓存把两者串起来。
 * 断链（进程重启后直接请求第 2 页）→ undefined → 回退 REST。 */
const _gqlCursors = {}

function cursorFor(key, page) {
  if (page <= 1) return null
  const c = _gqlCursors[key]
  if (!c || !c.cursors || typeof c.cursors[page - 1] !== 'string' || !c.cursors[page - 1]) return undefined
  return c.cursors[page - 1]
}

function cursorSave(key, page, pageInfo) {
  const cur = pageInfo && pageInfo.endCursor ? String(pageInfo.endCursor) : ''
  const c = _gqlCursors[key] || { cursors: [] }
  c.cursors[page] = cur
  _gqlCursors[key] = c
}

/* -------- GraphQL 节点 → REST 形状（复用 view.js 既有 mapper，页面零改动） -------- */

function gqlRepoToRest(n) {
  if (!n) return null
  return {
    id: n.id,
    full_name: n.nameWithOwner,
    owner: { login: (n.owner && n.owner.login) || String(n.nameWithOwner || '').split('/')[0] },
    description: n.description || '',
    stargazers_count: n.stargazerCount || 0,
    forks_count: n.forkCount || 0,
    language: n.primaryLanguage && n.primaryLanguage.name,
    updated_at: n.pushedAt || n.updatedAt || '',
    fork: !!n.isFork,
    private: !!n.isPrivate
  }
}

function gqlIssueToRest(n) {
  if (!n) return null
  return {
    id: n.id,
    number: n.number,
    title: n.title,
    state: String(n.state || '').toLowerCase(),
    created_at: n.createdAt || '',
    user: { login: (n.author && n.author.login) || '' },
    comments: (n.comments && n.comments.totalCount) || 0,
    labels: (n.labels && n.labels.nodes ? n.labels.nodes : []).map((l) => ({ name: l.name, color: l.color || '' }))
  }
}

function gqlReleaseToRest(n) {
  if (!n) return null
  const ac = (n.releaseAssets && n.releaseAssets.totalCount) || 0
  return {
    id: n.id,
    tag_name: n.tagName || '',
    name: n.name || '',
    body: n.description || '',
    prerelease: !!n.isPrerelease,
    published_at: n.publishedAt || '',
    created_at: n.createdAt || '',
    author: { login: (n.author && n.author.login) || '' },
    assets: new Array(ac)
  }
}

function dig(obj, path) {
  let cur = obj
  for (let i = 0; i < path.length; i++) {
    if (!cur || typeof cur !== 'object') return null
    cur = cur[path[i]]
  }
  return cur || null
}

function friendlyMessage(status, ghMessage) {
  if (status === 401) return 'Token 无效或已过期，请在「设置」更新'
  if (status === 403) return 'GitHub 接口限流：游客每小时 60 次，建议在设置中填入 Token（5000 次/小时）'
  if (status === 404) return '内容不存在（404）'
  if (status === 422) return '请求参数错误（422）'
  if (status >= 500) return 'GitHub 服务暂时不可用（' + status + '）'
  return ghMessage || ('请求失败（HTTP ' + status + '）')
}

/**
 * 统一请求：path 以 / 开头（相对 api.github.com），或传完整 URL
 * v1.2.1：外层负责缓存命中 / 单飞去重，内层 requestGo 负责网络与重试
 * @returns Promise<any> 解析后的 JSON 数据
 * @reject {status, message}
 */
export async function request(path, options) {
  // ★ 每页 JS context 独立持有本模块实例（_token 不共享），
  //   页面若未先调 loadToken() 会以匿名身份发请求——匿名限流 60/h 且
  //   实测被无效请求耗尽后全 403。统一在请求入口确保 Token 已加载。
  await loadToken()
  const opt = options || {}
  let url = path.indexOf('https://') === 0 ? path : API_BASE + path
  const header = {
    'User-Agent': 'vela-github-client',
    Accept: opt.raw ? 'application/vnd.github.raw' : 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  }
  if (_token) header['Authorization'] = 'Bearer ' + _token
  if (opt.method && opt.body) header['Content-Type'] = 'application/json'

  const isGet = (opt.method || 'GET') === 'GET'
  if (isGet && !opt.noCache) {
    const hit = memGet(url)
    if (hit && hit.fresh) return hit.data
    if (_mem.inflight[url]) return _mem.inflight[url]
    const p = requestGo(url, header, opt).finally(() => { delete _mem.inflight[url] })
    _mem.inflight[url] = p
    return p
  }
  return requestGo(url, header, opt)
}

async function requestGo(url, header, opt) {
  let res = null
  let data = null
  let lastErr = null
  let lastStatus = 0
  // v1.2.1：ETag 条件请求 —— 缓存过期后复验，304 只回响应头
  const stale = _mem.map[url]
  // 防御性重试（模拟器实测连续请求偶发 fail；真机弱网同样受益）：1.2s / 2.4s 两次退避
  // v1.1.1：JSON 解析失败 / GET 200 空响应体（蓝牙代理对长响应截断/丢弃）同样纳入可重试失败
  // v1.1.3：新增 content-length 对照检测——raw 文本被静默截断时 JSON.parse 不会报错，
  //         页面会渲染残缺内容（比报错更糟）；真机 README 14.3KB 可达，阈值在其之上
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, attempt === 1 ? 1200 : 2400))
    try {
      const sendHeader = stale && stale.etag && (opt.method || 'GET') === 'GET'
        ? Object.assign({}, header, { 'If-None-Match': stale.etag })
        : header
      res = await rawFetch({
        url: url,
        method: opt.method || 'GET',
        header: sendHeader,
        data: opt.body ? JSON.stringify(opt.body) : undefined
      })
    } catch (e) {
      lastErr = e
      res = null
      // Vela fetch_impl 把 HTTP 403/429 也当传输层错误抛出（upload err, error code: 403）：
      // 限流类失败重试无意义，直接给出友好文案（VM 实测：游客 60 次/时耗尽即此形态）
      const es = JSON.stringify(e && e.message !== undefined ? e.message : (e || ''))
      const ec = Number(e && (e.code || e.errorCode || e.status)) || (/403|rate limit/i.test(es) ? 403 : 0)
      if (ec === 403 || ec === 429) {
        throw { status: ec, message: 'GitHub 接口限流：游客每小时 60 次，建议在设置中填入 Token（5000 次/小时）' }
      }
      continue
    }
    lastStatus = Number(res.code) || 0
    let d = res.data
    if (typeof d === 'string') {
      const s = d.replace(/^\uFEFF/, '').trim()
      if (opt.raw) {
        // v1.1.3：raw 文本截断检测（content-length 存在且未压缩时才比对；
        // 字节估算兼容多字节字符，避免中文内容误判）
        const clen = parseInt(pickHeader(res.headers, 'content-length'))
        const enc = pickHeader(res.headers, 'content-encoding')
        if (!isNaN(clen) && clen > 0 && !enc) {
          let bytes = 0
          for (let bi = 0; bi < s.length; bi++) {
            const c = s.charCodeAt(bi)
            bytes += c < 0x80 ? 1 : (c < 0x800 ? 2 : 3)
          }
          if (bytes + 8 < clen) {
            lastErr = { incomplete: true }
            res = null
            continue
          }
        }
        d = s
      } else if (s.length > 0) {
        try {
          d = JSON.parse(s)
        } catch (e) {
          // 截断的 JSON：绝不能把残缺文本当数据返回给页面
          lastErr = { incomplete: true }
          res = null
          continue
        }
      } else {
        d = null
      }
    }
    // v1.2.2：GET 200 空响应体一律重试——raw 文本空体同样命中（蓝牙代理对大文件
    // 偶发回 200 + 空体，v1.2.1 及之前被当「成功空内容」返回，页面报「文件内容为空」）。
    // 守卫 lastStatus===200：304（无 body 属正常，复验命中）绝不能进重试
    if ((opt.method || 'GET') === 'GET' && lastStatus === 200 &&
        (d === null || d === undefined || (opt.raw && typeof d === 'string' && d.length === 0))) {
      // GET 期望 JSON 却拿到空体：蓝牙代理丢长响应的典型表现，重试
      lastErr = { incomplete: true }
      res = null
      continue
    }
    data = d
    break
  }
  if (!res) {
    if (lastErr && lastErr.incomplete) {
      // v1.1.4：incomplete 时先走下载通道兜底（GET 的 JSON/raw；
      // 原生下载器与 fetch 不同路，可能不受蓝牙代理截断影响；
      // v1.2.1：不带 If-None-Match，避免下载器收到 304 空文件）
      if ((opt.method || 'GET') === 'GET' && !opt.noDl) {
        const dh = {}
        for (const hk in header) { if (hk !== 'If-None-Match') dh[hk] = header[hk] }
        try {
          const text = await dlFetchText(url, dh)
          if (text && text.length) {
            const cleaned = String(text).replace(/^\uFEFF/, '').trim()
            if (opt.raw) return cleaned
            const d2 = JSON.parse(cleaned)
            memSet(url, d2, '')
            return d2
          }
        } catch (e2) { /* 下载通道也失败 → 回退缓存/报错 */ }
      }
      // v1.2.1：下载通道也失败 → 若本会话曾成功取回该 URL，回退旧缓存（旧数据好过报错）
      const sc = _mem.map[url]
      if (sc && sc.data !== null && sc.data !== undefined &&
          (!Array.isArray(sc.data) || sc.data.length > 0)) {
        return sc.data
      }
      // v1.1.3：incomplete 标志供自适应分页降档重试（确定性截断靠同参重试无解）
      throw { status: lastStatus, incomplete: true, message: '响应数据不完整（蓝牙代理对长响应有限制），请重试' }
    }
    // v1.2.1：代理把 304/超时当传输层失败且重试耗尽 → 有旧缓存则回退（旧数据好过报错）
    const sc2 = _mem.map[url]
    if (sc2 && sc2.data !== null && sc2.data !== undefined &&
        (!Array.isArray(sc2.data) || sc2.data.length > 0)) {
      return sc2.data
    }
    throw { status: 0, message: '网络连接失败，请检查手表网络（运动健康蓝牙代理 / eSIM）' }
  }

  const status = Number(res.code) || 0
  // v1.2.1：304 Not Modified —— 服务器确认内容未变，直接用缓存（几十字节替代全量）
  if (status === 304) {
    if (stale) {
      memTouch(url)
      return stale.data
    }
    throw { status: 304, message: '内容未变化（304）但本地无缓存' }
  }
  const remaining = parseInt(pickHeader(res.headers, 'x-ratelimit-remaining'))
  if (!isNaN(remaining)) _rate.remaining = remaining
  const limit = parseInt(pickHeader(res.headers, 'x-ratelimit-limit'))
  if (!isNaN(limit)) _rate.limit = limit

  if (status < 200 || status >= 300) {
    const ghMsg = data && data.message ? data.message : ''
    throw { status: status, message: friendlyMessage(status, ghMsg) }
  }
  // v1.2.1：成功响应写入缓存（GET JSON/raw；data 为空不缓存防毒化）
  if ((opt.method || 'GET') === 'GET' && data !== null && data !== undefined) {
    memSet(url, data, pickHeader(res.headers, 'etag'))
  }
  return data
}

/* ---------------- 自适应分页（v1.1.3） ----------------
 * 真机实测：README 14.3KB 完整可达，42KB 发行版列表必截断 —— 蓝牙代理对长响应
 * 存在确定性截断阈值（≥14.3KB，<42KB），同参重试永远失败。唯一解：缩小响应体。
 * 列表端点逐级降 per_page（10→4→1），单条最大响应可控在阈值之下。
 * 最后生效的 per_page 由 lastListPerPage() 供页面做 hasMore 判断。
 */
let _lastListPerPage = PER_PAGE

export function lastListPerPage() {
  return _lastListPerPage
}

const ADAPT_LADDER = [10, 4, 1]

/* v1.2.1：粘性降档（跨页防错位）——列表「数据不完整」的根因修复
 * 旧行为：每页都从 per=10 重新起梯。第 1 页 10 条成功（第 1-10 条），第 2 页 10 条
 * 被截断降到 4（第 11-14 条），第 3 页 10 条又成功（第 21-30 条）→ 第 15-20 条
 * 永久丢失。改为按列表 key 记住已降档档位：同列表后续页沿用该档位绝不回升，
 * 翻页边界稳定不跳条；page<=1（下拉刷新/重新加载）重置回乐观档位。 */
const _adaptPer = {}

async function requestAdaptive(key, build, page) {
  let lastErr = null
  if (!page || page <= 1) delete _adaptPer[key]
  const start = Math.max(0, ADAPT_LADDER.indexOf(_adaptPer[key]))
  for (let i = start; i < ADAPT_LADDER.length; i++) {
    const per = ADAPT_LADDER[i]
    try {
      const d = await request(build(per))
      _adaptPer[key] = per
      _lastListPerPage = per
      return d
    } catch (e) {
      lastErr = e
      // 仅对「确定性截断」降档；网络失败/限流/404 降档无意义，直接抛
      if (!e || !e.incomplete) throw e
    }
  }
  _adaptPer[key] = ADAPT_LADDER[ADAPT_LADDER.length - 1]
  throw lastErr
}

/* ================= v1.2.0 raw Range 分块拉取 =================
 * raw.githubusercontent.com 实证支持 HTTP Range（206 + accept-ranges: bytes），
 * api.github.com git/blobs 实证不支持（Range 被忽略返回 200 全量）。
 * 8KB 一块（低于蓝牙代理 14.3KB 截断阈值），任意大小文件都能完整取回。
 * UTF-8 多字节字符可能被块边界切开：字节模式用跨块状态机解码（pending 字节
 * 留到下一块）；平台不支持 arraybuffer 时退化为文本模式（边界字符损坏概率
 * 极低，且比「整个响应截断」好一个数量级）。 */

const RAW_BASE = 'https://raw.githubusercontent.com'
const RAW_CHUNK = 8192
const RAW_MAX_BLOCKS = 128 /* v1.2.1：8KB × 128 = 1MB 上限（原 512KB） */
const FILE_RAW_CAP = 1024 * 1024 /* v1.2.2：下载器整文件落盘后的字节上限（与页面 MAX_SIZE 对齐） */

function rawFileUrl(fullName, ref, path) {
  const encPath = String(path || '').split('/').map(encodeURIComponent).join('/')
  return RAW_BASE + '/' + fullName + '/' + encodeURIComponent(ref || 'HEAD') + '/' + encPath
}

function utf8Len(s) {
  let b = 0
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d2 = s.charCodeAt(i + 1)
      if (d2 >= 0xdc00 && d2 <= 0xdfff) { b += 4; i++; continue }
    }
    b += c < 0x80 ? 1 : (c < 0x800 ? 2 : 3)
  }
  return b
}

function toU8(d) {
  if (d instanceof Uint8Array) return d
  if (typeof ArrayBuffer !== 'undefined' && d instanceof ArrayBuffer) return new Uint8Array(d)
  if (d && typeof d === 'object' && d.buffer instanceof ArrayBuffer) {
    return new Uint8Array(d.buffer, d.byteOffset || 0, d.byteLength || d.buffer.byteLength)
  }
  return null
}

/** 跨块 UTF-8 解码：prevPending 是上一块留下的不完整序列字节（0-3 个），
 *  与本块字节拼接后逐序列解码，末尾不完整序列留作下一块的 prevPending。 */
export function utf8DecodeChunk(prevPending, u8) {
  const all = []
  for (let i = 0; i < prevPending.length; i++) all.push(prevPending[i])
  for (let i = 0; i < u8.length; i++) all.push(u8[i])
  let text = ''
  let i = 0
  const n = all.length
  while (i < n) {
    const b = all[i]
    let len = 0
    if (b < 0x80) len = 1
    else if ((b & 0xe0) === 0xc0) len = 2
    else if ((b & 0xf0) === 0xe0) len = 3
    else if ((b & 0xf8) === 0xf0) len = 4
    else len = 1 /* 非法首字节按 latin1 输出，避免死循环 */
    if (i + len > n) break /* 序列不完整 → 留到下一块 */
    let cp
    if (len === 1) cp = b
    else if (len === 2) cp = ((b & 0x1f) << 6) | (all[i + 1] & 0x3f)
    else if (len === 3) cp = ((b & 0x0f) << 12) | ((all[i + 1] & 0x3f) << 6) | (all[i + 2] & 0x3f)
    else cp = ((b & 0x07) << 18) | ((all[i + 1] & 0x3f) << 12) | ((all[i + 2] & 0x3f) << 6) | (all[i + 3] & 0x3f)
    if (cp > 0xffff) {
      cp -= 0x10000
      text += String.fromCharCode(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff))
    } else {
      text += String.fromCharCode(cp)
    }
    i += len
  }
  const pending = all.slice(i)
  return { text: text, pending: pending }
}

async function rawRangeOnce(url, start, end, mode) {
  const header = {
    'User-Agent': 'vela-github-client',
    Accept: 'application/octet-stream',
    Range: 'bytes=' + start + '-' + end
  }
  if (_token) header['Authorization'] = 'Bearer ' + _token
  let res = null
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      res = await rawFetch({ url: url, method: 'GET', header: header, rt: mode, timeout: 15000 })
      break
    } catch (e) {
      if (attempt > 0) throw { status: 0, message: '网络连接失败，请检查手表网络' }
    }
  }
  if (!res) throw { status: 0, message: '网络连接失败，请检查手表网络' }
  return { code: Number(res.code) || 0, data: res.data, headers: res.headers }
}

/** 块级重试（v1.2.1）：单块网络抖动/瞬时 5xx 重试一次（800ms 退避），
 *  避免大文件几十块取到 90% 时一块失败全盘报废 */
async function rawRangeRetry(url, start, end, mode) {
  let e0 = null
  for (let i = 0; i < 2; i++) {
    try {
      return await rawRangeOnce(url, start, end, mode)
    } catch (e) {
      e0 = e
      if (i > 0) break
      await new Promise((r) => setTimeout(r, 800))
    }
  }
  throw e0
}

/** 首块二进制嗅探（v1.2.1）：NUL 字节 = 二进制文件，立即报错而非渲染乱码 */
function sniffBinary(u8) {
  const n = Math.min(u8.length, 512)
  for (let i = 0; i < n; i++) {
    if (u8[i] === 0) return true
  }
  return false
}

/** Range 分块取回全文。返回 {text, full, capped}：
 *  full=true 表示服务器不支持 Range（首块即全文，走降级路径）；
 *  capped=true 表示达到 1MB 块数上限仍有后续数据（文件被截断显示）。
 *  v1.2.1：新增 onProgress(loadedBytes, totalBytes) 进度回调（total 取自
 *  首块 Content-Range），结果写入内存缓存（5min TTL，返回导航免重拉）。 */
async function fetchRawChunked(url, onProgress) {
  const hit = _mem.map[url]
  if (hit && hit.data && typeof hit.data.text === 'string' && Date.now() - hit.ts < RAW_TTL) {
    return hit.data
  }
  let mode = 'arraybuffer'
  let out = ''
  let pending = []
  let offset = 0
  let total = 0
  let firstEtag = ''
  let complete = false
  let full = false
  for (let bi = 0; bi < RAW_MAX_BLOCKS; bi++) {
    let r = await rawRangeRetry(url, offset, offset + RAW_CHUNK - 1, mode)
    /* 首块探测：平台不支持 arraybuffer（回调给字符串）→ 全程换文本模式重取本块；
     * v1.2.1：arraybuffer 请求直接抛错（固件不支持）→ 同样换文本模式重试 */
    if (bi === 0 && mode === 'arraybuffer' &&
        ((typeof r.data === 'string' && !(r.data instanceof Uint8Array)) || r.data == null)) {
      mode = 'text'
      r = await rawRangeRetry(url, offset, offset + RAW_CHUNK - 1, mode)
    }
    if (r.code === 416) { complete = true; break } /* 整块对齐时末尾越界 → 已取完 */
    if (r.code === 200) {
      /* Range 被忽略：首块即全文（可能超阈值），只能整体返回（降级）；
       * 但 200 全文同样可能被蓝牙代理截断——content-length 对照检测与
       * request() raw 模式同口径，绝不静默渲染残缺内容 */
      complete = true
      if (offset > 0) break
      if (typeof r.data === 'string') {
        const s = r.data
        if (!s) throw { status: 200, incomplete: true, message: 'raw 全文响应不完整' }
        const clen = parseInt(pickHeader(r.headers, 'content-length'))
        if (!isNaN(clen) && clen > 0 && utf8Len(s) + 8 < clen) {
          throw { status: 200, incomplete: true, message: 'raw 全文响应不完整（疑似截断）' }
        }
        full = true
        const res1 = { text: s, full: true, capped: false }
        memSet(url, res1, pickHeader(r.headers, 'etag'))
        return res1
      }
      const u8full = toU8(r.data)
      if (u8full) {
        if (sniffBinary(u8full)) throw { status: 200, binary: true, message: '二进制文件，暂不支持预览' }
        const dec = utf8DecodeChunk([], u8full)
        full = true
        const res2 = { text: dec.text, full: true, capped: false }
        memSet(url, res2, pickHeader(r.headers, 'etag'))
        return res2
      }
      throw { status: 200, incomplete: true, message: 'raw 全文响应异常' }
    }
    if (r.code !== 206) throw { status: r.code, message: 'raw 拉取失败（HTTP ' + r.code + '）' }
    if (!firstEtag) firstEtag = pickHeader(r.headers, 'etag')
    let got = 0
    if (mode === 'arraybuffer') {
      const u8 = toU8(r.data)
      if (!u8) throw { status: 206, message: '分块响应异常' }
      if (bi === 0 && sniffBinary(u8)) throw { status: 206, binary: true, message: '二进制文件，暂不支持预览' }
      const dec = utf8DecodeChunk(pending, u8)
      out += dec.text
      pending = dec.pending
      got = u8.length
    } else {
      const s = String(r.data == null ? '' : r.data)
      const clen = parseInt(pickHeader(r.headers, 'content-length'))
      got = !isNaN(clen) && clen > 0 ? clen : utf8Len(s)
      out += s
    }
    if (bi === 0 && !total) {
      /* 首块 Content-Range: bytes 0-8191/123456 → 解析总大小供进度显示 */
      const cr = String(pickHeader(r.headers, 'content-range') || '')
      const slash = cr.indexOf('/')
      const t = slash >= 0 ? parseInt(cr.slice(slash + 1)) : NaN
      if (!isNaN(t) && t > 0) total = t
    }
    if (typeof onProgress === 'function') {
      try { onProgress(offset + got, total) } catch (e) { /* 进度回调不影响主流程 */ }
    }
    if (got <= 0 || got < RAW_CHUNK) { complete = true; break } /* 短块 = 末块 */
    offset += got
  }
  if (!complete) {
    /* 块数耗尽仍有后续数据：明确告知截断，绝不冒充完整 */
    const res3 = { text: out, full: false, capped: true }
    memSet(url, res3, firstEtag)
    return res3
  }
  const res4 = { text: out, full: full, capped: false }
  memSet(url, res4, firstEtag)
  return res4
}

const README_RE = /^readme(\.(md|markdown|rst|txt|html|adoc|org|mdown|mkd))?$/i

/** README 全文（v1.2.2：下载器落盘优先 + 磁盘缓存 → Range 分块 → REST base64）。
 *  任何失败抛 {fallback:true}，readme 页回退 REST base64 通道（现行为）。 */
export async function getReadmeText(fullName, ref) {
  await loadToken()
  let name = ''
  try {
    const t = await getTree(fullName, 'HEAD')
    const arr = t && Array.isArray(t.tree) ? t.tree : []
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] && arr[i].type === 'blob' && README_RE.test(arr[i].path || '')) {
        name = arr[i].path
        break
      }
    }
  } catch (e) { /* trees 失败不致命，走下方缺省判断 */ }
  if (!name) throw { fallback: true, message: '未在仓库根目录找到 README' }
  const url = rawFileUrl(fullName, ref || 'HEAD', name)

  /* 磁盘缓存（冷启/重进秒开） */
  const cached = await fcacheGet(url)
  if (cached) return { text: cached, name: name, raw: true }

  /* 原生下载器优先（整文件落盘，绕开蓝牙代理截断） */
  const rawHeader = { 'User-Agent': 'vela-github-client', Accept: 'application/octet-stream' }
  if (_token) rawHeader['Authorization'] = 'Bearer ' + _token
  try {
    const dl = await dlFetchText(url, rawHeader, { download: 30000, complete: 45000, read: 10000 })
    if (typeof dl === 'string' && dl.length && !sniffRawErrorBody(dl) &&
        dl.slice(0, 512).indexOf('\u0000') < 0) {
      await fcachePut(url, dl)
      return { text: dl, name: name, raw: true }
    }
  } catch (e) { /* 下载器不可用 → 分块通道 */ }

  let r
  try {
    r = await fetchRawChunked(url)
  } catch (e) {
    throw { fallback: true, status: e && e.status, message: (e && e.message) || 'README 分块拉取失败' }
  }
  if (!r.text || !r.text.length) throw { fallback: true, message: 'README 内容为空' }
  await fcachePut(url, r.text)
  return { text: r.text, name: name, raw: true }
}

/* ================= v1.2.0 Device Flow 免打字登录 =================
 * 手表显示 8 位用户码，用户在手机/电脑浏览器打开 github.com/login/device
 * 输入该码并授权，手表轮询拿到 OAuth Token——全程无需在手表上打字。
 * client_id 复用 GitHub CLI 的公开 OAuth App（第三方工具通行做法），
 * 仅作 device flow 发起方，Token 由 GitHub 直接发给本机，不经过任何第三方。 */

const DEVICE_CLIENT_ID = '178c6fc778ccc68e1d6a'
const DEVICE_SCOPE = 'repo read:user notifications'
const DEVICE_URL_CODE = 'https://github.com/login/device/code'
const DEVICE_URL_TOKEN = 'https://github.com/login/oauth/access_token'

function formPost(url, params) {
  const parts = []
  for (const k in params) parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]))
  return new Promise((resolve, reject) => {
    try {
      fetch.fetch({
        url: url,
        method: 'POST',
        header: {
          'User-Agent': 'vela-github-client',
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        data: parts.join('&'),
        responseType: 'json',
        success: (res) => resolve(res),
        fail: (err, code) => reject({ err: err, code: code })
      })
    } catch (e) { reject(e) }
  })
}

/** 第一步：发起 Device Flow，返回 {deviceCode,userCode,verifyUri,expiresIn,interval} */
export async function deviceFlowStart() {
  let res = null
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, attempt === 1 ? 1200 : 2400))
    try {
      res = await formPost(DEVICE_URL_CODE, { client_id: DEVICE_CLIENT_ID, scope: DEVICE_SCOPE })
      break
    } catch (e) { res = null }
  }
  if (!res) throw { status: 0, message: '网络连接失败，请检查手表网络' }
  const code = Number(res.code) || 0
  const d = jsonMaybe(res)
  if (code < 200 || code >= 300 || !d || !d.device_code || !d.user_code) {
    throw { status: code, message: '发起登录失败（HTTP ' + code + '），请重试' }
  }
  return {
    deviceCode: String(d.device_code),
    userCode: String(d.user_code),
    verifyUri: String(d.verification_uri || 'https://github.com/login/device'),
    expiresIn: Number(d.expires_in) || 900,
    interval: Number(d.interval) || 5
  }
}

/** 第二步：轮询一次授权状态。永不抛错（轮询失败是常态），状态机返回：
 *  ok{token} / pending / slow{interval} / expired / denied / netfail / error */
export async function deviceFlowPoll(deviceCode, intervalSec) {
  let res
  try {
    res = await formPost(DEVICE_URL_TOKEN, {
      client_id: DEVICE_CLIENT_ID,
      device_code: deviceCode,
      grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
    })
  } catch (e) {
    return { state: 'netfail' }
  }
  const d = jsonMaybe(res)
  if (d && d.access_token) return { state: 'ok', token: String(d.access_token) }
  const err = d && d.error
  if (err === 'authorization_pending') return { state: 'pending' }
  if (err === 'slow_down') return { state: 'slow', interval: (intervalSec || 5) + 5 }
  if (err === 'expired_token') return { state: 'expired' }
  if (err === 'access_denied') return { state: 'denied' }
  return { state: 'error', status: Number(res.code) || 0 }
}

/* ---------------- URL 工具 ---------------- */

export function qs(params) {
  const parts = []
  for (const k in params) {
    if (params[k] === undefined || params[k] === null) continue
    parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]))
  }
  return parts.length ? '?' + parts.join('&') : ''
}

/* ---------------- 会话用户 ---------------- */

let _self = null

/** 当前登录用户（带进程内缓存，v1.2.1：按 token 绑定防换号脏读）；未登录返回 null */
export async function self() {
  if (!_token) return null
  if (_self && _self.__tk === _token) return _self
  try {
    _self = await request('/user')
    if (_self) _self.__tk = _token
  } catch (e) {
    _self = null
    throw e
  }
  return _self
}

/* ---------------- 端点封装 ---------------- */

/** 限流余量查询（不消耗 core 配额；实时数据不走缓存） */
export function getRateLimit() {
  return request('/rate_limit', { noCache: true })
}

/* ================= v1.2.2 通知并行子页（数据不完整根治） =================
 * 量化根因（v1.2.1 后真机仍不完整）：/notifications 单条 ~6KB——嵌入的 repository
 * 对象独占 5.5KB，REST 无法瘦身字段、GraphQL 又没有通知 API（schema 实证 Query
 * 根无 notifications）。per=10 → 60KB 必截断；v1.2.1 自适应降到 per=1 后逐条串行，
 * 一页要 3 次阶梯尝试，列表条数少且龟速，用户感知即「数据不完整」。
 * 方案：逻辑页 = 10 条 = 5 个 per_page=2 子页（各 ~12.6KB，低于 14.3KB 实测下限）
 * 并发 3 并行拉取后按序拼接。子页仍截断 → 降级为两个 per=1（各 ~6.3KB）补齐。
 * 全有或全无：任一子页彻底失败整页抛错（页面有重试），绝不静默缺条造成跳条。 */
const NOTIF_SUB_PER = 2
const NOTIF_SUBS = 5
const NOTIF_CONC = 3

/** 通知逻辑页大小（notifications.ux 的 hasMore 判断依据） */
export function notifPageSize() {
  return NOTIF_SUBS * NOTIF_SUB_PER
}

/** 单个子页：per=2 拉取；确定性截断时降级为两个 per=1 子请求（无缺口拼接） */
async function notifSubPage(sp, all) {
  try {
    return await request('/notifications' + qs({ page: sp, per_page: NOTIF_SUB_PER, all: !!all }))
  } catch (e) {
    if (!e || !e.incomplete) throw e
    /* per=2 的第 sp 页持有第 (2sp-1, 2sp) 条 → 对应 per=1 的这两页 */
    const a = await request('/notifications' + qs({ page: 2 * sp - 1, per_page: 1, all: !!all }))
    const b = await request('/notifications' + qs({ page: 2 * sp, per_page: 1, all: !!all }))
    return [].concat(Array.isArray(a) ? a : [], Array.isArray(b) ? b : [])
  }
}

/** 通知列表（需登录）：并行子页拼接，返回最多 notifPageSize() 条的数组 */
export async function getNotifications(page, all) {
  await loadToken()
  const base = (Math.max(1, page) - 1) * NOTIF_SUBS + 1
  const subs = []
  for (let i = 0; i < NOTIF_SUBS; i++) subs.push(base + i)
  const parts = await mapLimit(subs, NOTIF_CONC, (sp) => notifSubPage(sp, all))
  const out = []
  for (let i = 0; i < parts.length; i++) {
    const arr = parts[i]
    if (Array.isArray(arr)) {
      for (let j = 0; j < arr.length; j++) out.push(arr[j])
    }
  }
  return out
}

/** 全部标记已读 */
export function markAllNotificationsRead() {
  return request('/notifications', { method: 'PUT', body: {} }).then((r) => {
    clearCache('/notifications')
    return r
  })
}

/** 单条标记已读 */
export function markThreadRead(threadUrl) {
  return request(threadUrl, { method: 'PUT', body: {} }).then((r) => {
    clearCache('/notifications')
    return r
  })
}

/** 通知主题详情（Issue/PR/Release 的 API 地址） */
export function getSubject(url) {
  return request(url)
}

const GQL_MYREPOS_Q = 'query($first:Int!,$after:String,$order:RepositoryOrder){viewer{repositories(first:$first,after:$after,affiliations:[OWNER,COLLABORATOR,ORGANIZATION_MEMBER],orderBy:$order){pageInfo{hasNextPage endCursor}totalCount nodes{' + GQL_REPO_NODE + '}}}}'

const GQL_USERREPOS_Q = 'query($login:String!,$first:Int!,$after:String){repositoryOwner(login:$login){repositories(first:$first,after:$after,orderBy:{field:PUSHED_AT,direction:DESC}){pageInfo{hasNextPage endCursor}totalCount nodes{' + GQL_REPO_NODE + '}}}}'

function repoOrderField(sort) {
  if (sort === 'created') return 'CREATED_AT'
  if (sort === 'updated') return 'UPDATED_AT'
  if (sort === 'full_name') return 'NAME'
  return 'PUSHED_AT' /* REST 默认 sort=pushed */
}

function restMyRepos(page, sort) {
  return requestAdaptive('repos-my|' + (sort || 'pushed'), (per) => '/user/repos' + qs({
    page: page, per_page: per,
    sort: sort || 'pushed', type: 'owner',
    affiliation: 'owner,collaborator,organization_member'
  }), page)
}

/** 登录用户仓库（GraphQL 瘦字段，REST 兜底） */
export async function getMyRepos(page, sort) {
  try {
    const key = 'myrepos|' + (sort || 'pushed')
    const cursor = cursorFor(key, page)
    if (cursor === undefined) throw { cursorMiss: true }
    const data = await ghql(GQL_MYREPOS_Q, { first: PER_PAGE, after: cursor, order: { field: repoOrderField(sort), direction: 'DESC' } })
    const conn = dig(data, ['viewer', 'repositories'])
    if (!conn) throw { status: 0, gqlSkip: true, message: 'GraphQL 响应缺 viewer.repositories' }
    cursorSave(key, page, conn.pageInfo)
    _lastListPerPage = PER_PAGE
    return (conn.nodes || []).map(gqlRepoToRest).filter((x) => !!x && !!x.full_name)
  } catch (e) {
    if (gqlShouldFallback(e)) return restMyRepos(page, sort)
    throw e
  }
}

function restUserRepos(login, page) {
  return requestAdaptive('repos-user|' + login,
    (per) => '/users/' + encodeURIComponent(login) + '/repos' + qs({ page: page, per_page: per, sort: 'pushed' }), page)
}

/** 指定用户的公开仓库（GraphQL 瘦字段，REST 兜底） */
export async function getUserRepos(login, page) {
  try {
    const key = 'userrepos|' + login
    const cursor = cursorFor(key, page)
    if (cursor === undefined) throw { cursorMiss: true }
    const data = await ghql(GQL_USERREPOS_Q, { login: login, first: PER_PAGE, after: cursor })
    const conn = dig(data, ['repositoryOwner', 'repositories'])
    if (!conn) throw { status: 404, message: '内容不存在（404）' }
    cursorSave(key, page, conn.pageInfo)
    _lastListPerPage = PER_PAGE
    return (conn.nodes || []).map(gqlRepoToRest).filter((x) => !!x && !!x.full_name)
  } catch (e) {
    if (gqlShouldFallback(e)) return restUserRepos(login, page)
    throw e
  }
}

const GQL_SEARCH_Q = 'query($q:String!,$first:Int!,$after:String){search(query:$q,type:REPOSITORY,first:$first,after:$after){repositoryCount pageInfo{hasNextPage endCursor} nodes{...on Repository{' + GQL_REPO_NODE + '}}}}'

/* GraphQL search 无 sort 参数，用查询限定符实现（沙箱实证 sort:stars 生效） */
function searchSortQ(sort) {
  if (sort === 'stars') return ' sort:stars'
  if (sort === 'forks') return ' sort:forks'
  if (sort === 'updated') return ' sort:updated'
  return '' /* best match */
}

function restSearch(keyword, page, sort) {
  return requestAdaptive('search-rest|' + keyword + '|' + (sort || ''), (per) => '/search/repositories' + qs({
    q: keyword, page: page, per_page: per,
    sort: sort || 'best match', order: 'desc'
  }), page)
}

/** 仓库搜索（GraphQL 瘦字段，REST 兜底；返回 {items,total_count} 契约不变） */
export async function searchRepos(keyword, page, sort) {
  try {
    const key = 'search|' + keyword + '|' + (sort || '')
    const cursor = cursorFor(key, page)
    if (cursor === undefined) throw { cursorMiss: true }
    const data = await ghql(GQL_SEARCH_Q, { q: keyword + searchSortQ(sort), first: PER_PAGE, after: cursor })
    const s = dig(data, ['search'])
    if (!s) throw { status: 0, gqlSkip: true, message: 'GraphQL 响应缺 search' }
    cursorSave(key, page, s.pageInfo)
    _lastListPerPage = PER_PAGE
    return { items: (s.nodes || []).map(gqlRepoToRest).filter((x) => !!x && !!x.full_name), total_count: s.repositoryCount || 0 }
  } catch (e) {
    if (gqlShouldFallback(e)) return restSearch(keyword, page, sort)
    throw e
  }
}

/**
 * 趋势模拟（GitHub 无官方 Trending API）
 * mode: new=本周新星 / rising=季度黑马 / classic=经典名库
 */
function trendingQuery(mode) {
  const DAY = 86400000
  const d = (n) => {
    const t = new Date(Date.now() - n * DAY)
    return t.getFullYear() + '-' + ('0' + (t.getMonth() + 1)).slice(-2) + '-' + ('0' + t.getDate()).slice(-2)
  }
  if (mode === 'new') return 'stars:>50 created:>' + d(7)
  if (mode === 'rising') return 'stars:>2000 created:>' + d(90)
  return 'stars:>50000'
}

function restTrending(mode, page) {
  return requestAdaptive('trend-rest|' + (mode || 'classic'),
    (per) => '/search/repositories' + qs({ q: trendingQuery(mode), page: page, per_page: per, sort: 'stars', order: 'desc' }), page)
}

/** 趋势模拟（GraphQL 瘦字段，REST 兜底；返回 {items,total_count} 契约不变） */
export async function getTrending(mode, page) {
  try {
    const key = 'trending|' + (mode || 'classic')
    const cursor = cursorFor(key, page)
    if (cursor === undefined) throw { cursorMiss: true }
    const data = await ghql(GQL_SEARCH_Q, { q: trendingQuery(mode) + ' sort:stars', first: PER_PAGE, after: cursor })
    const s = dig(data, ['search'])
    if (!s) throw { status: 0, gqlSkip: true, message: 'GraphQL 响应缺 search' }
    cursorSave(key, page, s.pageInfo)
    _lastListPerPage = PER_PAGE
    return { items: (s.nodes || []).map(gqlRepoToRest).filter((x) => !!x && !!x.full_name), total_count: s.repositoryCount || 0 }
  } catch (e) {
    if (gqlShouldFallback(e)) return restTrending(mode, page)
    throw e
  }
}

/** 仓库详情（v1.2.1：GraphQL 瘦字段 ~1KB，替代 REST 全量 10-20KB——
 *  单页详情从源头避开蓝牙代理截断；失败回退 REST） */
const GQL_REPO_Q = 'query($o:String!,$n:String!){repository(owner:$o,name:$n){nameWithOwner description stargazerCount forkCount watchers{totalCount} issues(states:OPEN){totalCount} primaryLanguage{name} licenseInfo{spdxId} pushedAt updatedAt createdAt isPrivate isFork homepageUrl defaultBranchRef{name} owner{login}}}'

export async function getRepo(fullName) {
  const parts = String(fullName || '').split('/')
  if (parts.length === 2 && parts[0] && parts[1]) {
    try {
      const data = await ghql(GQL_REPO_Q, { o: parts[0], n: parts[1] })
      const r = data && data.repository
      if (!r || !r.nameWithOwner) throw { status: 0, gqlSkip: true, message: 'GraphQL 仓库详情为空' }
      return {
        id: r.id || fullName,
        full_name: r.nameWithOwner,
        name: String(r.nameWithOwner).split('/')[1] || parts[1],
        owner: { login: (r.owner && r.owner.login) || parts[0] },
        description: r.description || '',
        stargazers_count: r.stargazerCount || 0,
        forks_count: r.forkCount || 0,
        subscribers_count: (r.watchers && r.watchers.totalCount) || 0,
        open_issues_count: (r.issues && r.issues.totalCount) || 0,
        language: r.primaryLanguage && r.primaryLanguage.name,
        license: r.licenseInfo && r.licenseInfo.spdxId ? { spdx_id: r.licenseInfo.spdxId, name: r.licenseInfo.spdxId } : null,
        pushed_at: r.pushedAt || r.updatedAt || '',
        created_at: r.createdAt || '',
        updated_at: r.updatedAt || '',
        homepage: r.homepageUrl || '',
        default_branch: (r.defaultBranchRef && r.defaultBranchRef.name) || 'HEAD',
        fork: !!r.isFork,
        private: !!r.isPrivate
      }
    } catch (e) {
      if (!gqlShouldFallback(e)) throw e
      /* 游客/限流/网络失败 → 回落 REST */
    }
  }
  return request('/repos/' + fullName)
}

/** README（base64） */
export function getReadme(fullName) {
  return request('/repos/' + fullName + '/readme')
}

/** 目录内容（path 以 '' 为根） */
export function getContents(fullName, path, ref) {
  const p = path ? '/' + path : ''
  return request('/repos/' + fullName + '/contents' + p + qs({ ref: ref || undefined }))
}

/** git 树（v1.1.3）：条目比 contents 接口小 3-4 倍，大目录截断时的回退通道。
 *  sha 传 'HEAD' 取根树，传目录项自带 sha 取子树。 */
export function getTree(fullName, sha) {
  return request('/repos/' + fullName + '/git/trees/' + (sha || 'HEAD'))
}

/** 文件内容拉取（v1.2.2 弦电子书式重写）：
 *  ① 磁盘缓存（fcache，冷启仍有效，重进秒开零传输）；
 *  ② 原生下载器整文件落盘为主通道（绕开 fetch 蓝牙代理截断——真机实证 Range
 *     分块第 2 块起必失败、REST raw 大文件空体/截断，均为死路）；
 *  ③ fetch Range 分块（带逐块进度，下载器不可用时的回退）；
 *  ④ REST contents raw 兜底（私有仓库 raw 404 场景）。
 *  返回 {text, full, capped, bytes, via}；capped=true 表示超 1MB 只取前 1MB。 */
export async function getFileRawEx(fullName, path, ref, onProgress) {
  const url = rawFileUrl(fullName, ref || '', path)
  const prog = (a, b) => { if (typeof onProgress === 'function') { try { onProgress(a, b) } catch (e) {} } }

  /* ① 磁盘缓存命中 */
  const cached = await fcacheGet(url)
  if (cached) {
    const cb = utf8Len(cached)
    prog(cb, cb)
    return { text: cached, full: true, capped: false, bytes: cb, via: 'cache' }
  }

  const rawHeader = { 'User-Agent': 'vela-github-client', Accept: 'application/octet-stream' }
  if (_token) rawHeader['Authorization'] = 'Bearer ' + _token

  /* ② 原生下载器主通道：一次整文件落盘（≤1MB 由页面 rawSize 守卫） */
  try {
    const dl = await dlFetchText(url, rawHeader, { download: 30000, complete: 45000, read: 10000 })
    if (typeof dl === 'string' && dl.length) {
      if (sniffRawErrorBody(dl)) throw { status: 404, message: 'raw 下载器返回错误体，转下一通道' }
      if (dl.slice(0, 512).indexOf('\u0000') >= 0) throw { binary: true, message: '二进制文件，暂不支持预览' }
      let text = dl
      let capped = false
      if (utf8Len(text) > FILE_RAW_CAP) {
        text = utf8SliceBytes(text, FILE_RAW_CAP)
        capped = true
      }
      await fcachePut(url, text)
      const nb = utf8Len(text)
      prog(nb, nb)
      return { text: text, full: true, capped: capped, bytes: nb, via: 'dl' }
    }
  } catch (e) {
    if (e && e.binary) throw e
    /* 下载器不可用（固件不支持/超时/404）→ 落到分块通道 */
  }

  /* ③ fetch Range 分块（逐块进度） */
  try {
    const r = await fetchRawChunked(url, onProgress)
    if (typeof r.text === 'string' && r.text.length) {
      await fcachePut(url, r.text)
      return { text: r.text, full: !!r.full, capped: !!r.capped, bytes: utf8Len(r.text), via: 'chunk' }
    }
  } catch (e) {
    if (e && e.binary) throw e
    /* 落到 REST raw */
  }

  /* ④ REST contents raw 兜底（私有仓库 raw 404 的场景） */
  const p = path ? '/' + path : ''
  const text = await request('/repos/' + fullName + '/contents' + p + qs({ ref: ref || undefined }), { raw: true })
  const t3 = String(text == null ? '' : text)
  if (t3) await fcachePut(url, t3)
  return { text: t3, full: true, capped: false, bytes: utf8Len(t3), via: 'rest' }
}

/** 文件原始文本（保持 v1.2.0 契约：直接返回字符串；readme 页等沿用） */
export async function getFileRaw(fullName, path, ref) {
  const r = await getFileRawEx(fullName, path, ref, null)
  if (typeof r.text === 'string' && r.text.length) return r.text
  throw { message: '文件内容为空' }
}

const GQL_ISSUES_Q = 'query($o:String!,$n:String!,$first:Int!,$after:String,$states:[IssueState!]){repository(owner:$o,name:$n){issues(first:$first,after:$after,states:$states,orderBy:{field:CREATED_AT,direction:DESC}){pageInfo{hasNextPage endCursor} nodes{id number title state createdAt author{login} comments{totalCount} labels(first:4){nodes{name color}}}}}}'

function restIssues(fullName, page, state) {
  return requestAdaptive('issues-rest|' + fullName + '|' + (state || 'open'), (per) => '/repos/' + fullName + '/issues' + qs({
    page: page, per_page: per, state: state || 'open', sort: 'created'
  }), page).then((data) => {
    const list = Array.isArray(data) ? data : []
    const out = []
    for (let i = 0; i < list.length && out.length < PER_PAGE; i++) {
      if (!list[i].pull_request) out.push(list[i])
    }
    return out
  })
}

/** Issue 列表（GraphQL 无 body 瘦字段，天然免截断；issues 连接不含 PR，
 *  无需过滤；REST 兜底保留 PR 过滤逻辑） */
export async function getIssues(fullName, page, state) {
  try {
    const parts = String(fullName || '').split('/')
    const key = 'issues|' + fullName + '|' + (state || 'open')
    const cursor = cursorFor(key, page)
    if (cursor === undefined) throw { cursorMiss: true }
    const v = { o: parts[0], n: parts[1], first: PER_PAGE, after: cursor }
    if (!state || state === 'open') v.states = ['OPEN']
    else if (state === 'closed') v.states = ['CLOSED']
    /* state=all → 不传 states（OPEN+CLOSED 全量） */
    const data = await ghql(GQL_ISSUES_Q, v)
    const conn = dig(data, ['repository', 'issues'])
    if (!conn) throw { status: 404, message: '内容不存在（404）' }
    cursorSave(key, page, conn.pageInfo)
    _lastListPerPage = PER_PAGE
    return (conn.nodes || []).map(gqlIssueToRest).filter((x) => !!x && x.title != null)
  } catch (e) {
    if (gqlShouldFallback(e)) return restIssues(fullName, page, state)
    throw e
  }
}

/** Issue 详情 */
export function getIssue(fullName, number) {
  return request('/repos/' + fullName + '/issues/' + number)
}

/** Issue 评论列表（传 comments_url；评论正文可能很长，同样自适应） */
export function getComments(commentsUrl, page) {
  return requestAdaptive('cmt|' + commentsUrl,
    (per) => commentsUrl + qs({ page: page || 1, per_page: per }), page || 1)
}

/** 发表 Issue 评论（需 Token，传 comments_url） */
export function addComment(commentsUrl, body) {
  return request(commentsUrl, { method: 'POST', body: { body: body } })
}

const GQL_RELEASES_Q = 'query($o:String!,$n:String!,$first:Int!,$after:String){repository(owner:$o,name:$n){releases(first:$first,after:$after,orderBy:{field:CREATED_AT,direction:DESC}){pageInfo{hasNextPage endCursor} nodes{id tagName name description isPrerelease publishedAt createdAt author{login} releaseAssets(first:1){totalCount}}}}}'

/** Release 列表（GraphQL 无 assets 数组/上传 URL 全家桶，体积降 3-5 倍；REST 兜底） */
export async function getReleases(fullName, page) {
  try {
    const parts = String(fullName || '').split('/')
    const key = 'rel|' + fullName
    const cursor = cursorFor(key, page || 1)
    if (cursor === undefined) throw { cursorMiss: true }
    const data = await ghql(GQL_RELEASES_Q, { o: parts[0], n: parts[1], first: PER_PAGE, after: cursor })
    const conn = dig(data, ['repository', 'releases'])
    if (!conn) throw { status: 404, message: '内容不存在（404）' }
    cursorSave(key, page || 1, conn.pageInfo)
    _lastListPerPage = PER_PAGE
    return (conn.nodes || []).map(gqlReleaseToRest).filter((x) => !!x && !!x.tag_name)
  } catch (e) {
    if (gqlShouldFallback(e)) {
      return requestAdaptive('rel-rest|' + fullName,
        (per) => '/repos/' + fullName + '/releases' + qs({ page: page || 1, per_page: per }), page || 1)
    }
    throw e
  }
}

/** 是否已 Star */
export function isStarred(fullName) {
  if (!_token) return Promise.resolve(false)
  return request('/user/starred/' + fullName)
    .then(() => true)
    .catch((e) => {
      if (e && e.status === 404) return false
      throw e
    })
}

/** Star / 取消 Star */
export function setStarred(fullName, on) {
  return request('/user/starred/' + fullName, { method: on ? 'PUT' : 'DELETE', body: on ? {} : undefined })
}

/** 用户主页 */
export function getUser(login) {
  return request('/users/' + encodeURIComponent(login))
}

export default {
  loadToken, hasToken, currentToken, saveToken, clearToken, validateToken, tokenFormatHint, rateInfo,
  request, qs, self, lastListPerPage, storageDiag, verifyPersisted, clearCache,
  getRateLimit, getNotifications, notifPageSize, markAllNotificationsRead, markThreadRead, getSubject,
  getMyRepos, getUserRepos, searchRepos, getTrending,
  getRepo, getReadme, getReadmeText, getContents, getFileRaw, getFileRawEx, getTree,
  getIssues, getIssue, getComments, addComment, getReleases,
  isStarred, setStarred, getUser,
  deviceFlowStart, deviceFlowPoll, utf8DecodeChunk
}

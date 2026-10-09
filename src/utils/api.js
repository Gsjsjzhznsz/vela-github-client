/**
 * api.js — GitHub REST API v3 封装
 * 基于 Vela 官方 @system.fetch，Promise 化 + 统一错误处理 + 限流感知。
 * 网络链路：手表经小米运动健康蓝牙代理或 eSIM 独立联网，对应用层透明。
 */
import fetch from '@system.fetch'
import storage from '@system.storage'

const API_BASE = 'https://api.github.com'
const TOKEN_KEY = 'gh_token'
const PER_PAGE = 10

/* ---------------- 存储层（Promise 化） ---------------- */

function stGet(key) {
  return new Promise((resolve) => {
    storage.get({
      key,
      success: (d) => resolve(d == null ? '' : d),
      fail: () => resolve('')
    })
  })
}

function stSet(key, value) {
  return new Promise((resolve, reject) => {
    storage.set({ key, value, success: resolve, fail: (d, c) => reject({ d, c }) })
  })
}

function stRemove(key) {
  return new Promise((resolve) => {
    storage.delete({ key, success: resolve, fail: resolve })
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
  _tokenReady = stGet(TOKEN_KEY).then((v) => {
    _token = typeof v === 'string' ? v : (v ? String(v) : '')
    return _token
  })
  return _tokenReady
}

export function hasToken() {
  return !!_token
}

/** 当前 Token（仅用于打码展示） */
export function currentToken() {
  return _token
}

export async function saveToken(token) {
  _token = (token || '').trim()
  if (_token) {
    await stSet(TOKEN_KEY, _token)
  } else {
    await stRemove(TOKEN_KEY)
  }
  // 同步进程内缓存（否则本 context 后续 loadToken 仍返回旧值）；
  // 同时撤销缓存态：确保后续 loadToken(true/false) 都能拿到最新值
  _tokenReady = Promise.resolve(_token)
  _self = null
  return _token
}

export async function clearToken() {
  return saveToken('')
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
    const user = await request('/user')
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

function rawFetch(opts) {
  return new Promise((resolve, reject) => {
    fetch.fetch({
      url: opts.url,
      method: opts.method || 'GET',
      header: opts.header || {},
      data: opts.data,
      responseType: 'json',
      success: (res) => resolve(res),
      fail: (err, code) => reject({ err: err, code: code })
    })
  })
}

function pickHeader(headers, name) {
  if (!headers) return ''
  const n = String(name).toLowerCase()
  for (const k in headers) {
    if (String(k).toLowerCase() === n) return headers[k]
  }
  return ''
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

  let res = null
  let data = null
  let lastErr = null
  let lastStatus = 0
  // 防御性重试（模拟器实测连续请求偶发 fail；真机弱网同样受益）：1.2s / 2.4s 两次退避
  // v1.1.1：JSON 解析失败 / GET 200 空响应体（蓝牙代理对长响应截断/丢弃）同样纳入可重试失败
  // v1.1.3：新增 content-length 对照检测——raw 文本被静默截断时 JSON.parse 不会报错，
  //         页面会渲染残缺内容（比报错更糟）；真机 README 14.3KB 可达，阈值在其之上
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, attempt === 1 ? 1200 : 2400))
    try {
      res = await rawFetch({
        url: url,
        method: opt.method || 'GET',
        header: header,
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
    if (!opt.raw && (opt.method || 'GET') === 'GET' && lastStatus === 200 && (d === null || d === undefined)) {
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
      // v1.1.3：incomplete 标志供自适应分页降档重试（确定性截断靠同参重试无解）
      throw { status: lastStatus, incomplete: true, message: '响应数据不完整（蓝牙代理对长响应有限制），请重试' }
    }
    throw { status: 0, message: '网络连接失败，请检查手表网络（运动健康蓝牙代理 / eSIM）' }
  }

  const status = Number(res.code) || 0
  const remaining = parseInt(pickHeader(res.headers, 'x-ratelimit-remaining'))
  if (!isNaN(remaining)) _rate.remaining = remaining
  const limit = parseInt(pickHeader(res.headers, 'x-ratelimit-limit'))
  if (!isNaN(limit)) _rate.limit = limit

  if (status < 200 || status >= 300) {
    const ghMsg = data && data.message ? data.message : ''
    throw { status: status, message: friendlyMessage(status, ghMsg) }
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

async function requestAdaptive(build) {
  let lastErr = null
  for (let i = 0; i < ADAPT_LADDER.length; i++) {
    const per = ADAPT_LADDER[i]
    try {
      const d = await request(build(per))
      _lastListPerPage = per
      return d
    } catch (e) {
      lastErr = e
      // 仅对「确定性截断」降档；网络失败/限流/404 降档无意义，直接抛
      if (!e || !e.incomplete) throw e
    }
  }
  throw lastErr
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

/** 当前登录用户（带进程内缓存）；未登录返回 null */
export async function self() {
  if (!_token) return null
  if (_self) return _self
  try {
    _self = await request('/user')
  } catch (e) {
    _self = null
    throw e
  }
  return _self
}

/* ---------------- 端点封装 ---------------- */

/** 限流余量查询（不消耗 core 配额） */
export function getRateLimit() {
  return request('/rate_limit')
}

/** 通知列表（需登录） */
export function getNotifications(page, all) {
  return requestAdaptive((per) => '/notifications' + qs({ page: page, per_page: per, all: !!all }))
}

/** 全部标记已读 */
export function markAllNotificationsRead() {
  return request('/notifications', { method: 'PUT', body: {} })
}

/** 单条标记已读 */
export function markThreadRead(threadUrl) {
  return request(threadUrl, { method: 'PUT', body: {} })
}

/** 通知主题详情（Issue/PR/Release 的 API 地址） */
export function getSubject(url) {
  return request(url)
}

/** 登录用户仓库 */
export function getMyRepos(page, sort) {
  return requestAdaptive((per) => '/user/repos' + qs({
    page: page, per_page: per,
    sort: sort || 'pushed', type: 'owner',
    affiliation: 'owner,collaborator,organization_member'
  }))
}

/** 指定用户的公开仓库 */
export function getUserRepos(login, page) {
  return requestAdaptive((per) => '/users/' + encodeURIComponent(login) + '/repos' + qs({ page: page, per_page: per, sort: 'pushed' }))
}

/** 仓库搜索 */
export function searchRepos(keyword, page, sort) {
  return requestAdaptive((per) => '/search/repositories' + qs({
    q: keyword, page: page, per_page: per,
    sort: sort || 'best match', order: 'desc'
  }))
}

/**
 * 趋势模拟（GitHub 无官方 Trending API）
 * mode: new=本周新星 / rising=季度黑马 / classic=经典名库
 */
export function getTrending(mode, page) {
  const DAY = 86400000
  const d = (n) => {
    const t = new Date(Date.now() - n * DAY)
    return t.getFullYear() + '-' + ('0' + (t.getMonth() + 1)).slice(-2) + '-' + ('0' + t.getDate()).slice(-2)
  }
  let q
  if (mode === 'new') q = 'stars:>50 created:>' + d(7)
  else if (mode === 'rising') q = 'stars:>2000 created:>' + d(90)
  else q = 'stars:>50000'
  return requestAdaptive((per) => '/search/repositories' + qs({ q: q, page: page, per_page: per, sort: 'stars', order: 'desc' }))
}

/** 仓库详情 */
export function getRepo(fullName) {
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

/** 文件原始文本（建议 < 200KB） */
export function getFileRaw(fullName, path, ref) {
  const p = path ? '/' + path : ''
  return request('/repos/' + fullName + '/contents' + p + qs({ ref: ref || undefined }), { raw: true })
}

/** Issue 列表（自动过滤 PR；自适应 per_page 对抗蓝牙代理截断） */
export async function getIssues(fullName, page, state) {
  const data = await requestAdaptive((per) => '/repos/' + fullName + '/issues' + qs({
    page: page, per_page: per, state: state || 'open', sort: 'created'
  }))
  const list = Array.isArray(data) ? data : []
  const out = []
  for (let i = 0; i < list.length && out.length < PER_PAGE; i++) {
    if (!list[i].pull_request) out.push(list[i])
  }
  return out
}

/** Issue 详情 */
export function getIssue(fullName, number) {
  return request('/repos/' + fullName + '/issues/' + number)
}

/** Issue 评论列表（传 comments_url；评论正文可能很长，同样自适应） */
export function getComments(commentsUrl, page) {
  return requestAdaptive((per) => commentsUrl + qs({ page: page || 1, per_page: per }))
}

/** 发表 Issue 评论（需 Token，传 comments_url） */
export function addComment(commentsUrl, body) {
  return request(commentsUrl, { method: 'POST', body: { body: body } })
}

/** Release 列表（本仓库 5 个发行版就 42KB，是截断重灾区，必走自适应） */
export function getReleases(fullName, page) {
  return requestAdaptive((per) => '/repos/' + fullName + '/releases' + qs({ page: page || 1, per_page: per }))
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
  request, qs, self, lastListPerPage,
  getRateLimit, getNotifications, markAllNotificationsRead, markThreadRead, getSubject,
  getMyRepos, getUserRepos, searchRepos, getTrending,
  getRepo, getReadme, getContents, getFileRaw, getTree,
  getIssues, getIssue, getComments, addComment, getReleases,
  isStarred, setStarred, getUser
}

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

/** 读取本地 Token（进程内缓存一次） */
export function loadToken() {
  if (_tokenReady) return _tokenReady
  _tokenReady = stGet(TOKEN_KEY).then((v) => {
    _token = v || ''
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
  _self = null
  return _token
}

export async function clearToken() {
  return saveToken('')
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
  const opt = options || {}
  const method = opt.method || 'GET'
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
  // v1.0.1：JSON 解析失败 / GET 200 空响应体（蓝牙代理对长响应截断/丢弃）同样纳入可重试失败
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, attempt === 1 ? 1200 : 2400))
    try {
      res = await rawFetch({
        url: url,
        method: method,
        header: header,
        data: opt.body ? JSON.stringify(opt.body) : undefined
      })
    } catch (e) {
      lastErr = e
      res = null
      continue
    }
    lastStatus = Number(res.code) || 0
    let d = res.data
    if (typeof d === 'string') {
      const s = d.replace(/^\uFEFF/, '').trim()
      if (opt.raw) {
        d = s
      } else if (s.length > 0) {
        try {
          d = JSON.parse(s)
        } catch (e) {
          // 截断的 JSON：绝不能把残缺文本当数据返回给页面
          lastErr = { incomplete: true, reason: 'truncated' }
          res = null
          continue
        }
      } else {
        d = null
      }
    }
    if (!opt.raw && method === 'GET' && lastStatus === 200 && (d === null || d === undefined)) {
      // GET 期望 JSON 却拿到空体：蓝牙代理丢长响应的典型表现，重试
      lastErr = { incomplete: true, reason: 'empty' }
      res = null
      continue
    }
    data = d
    break
  }
  if (!res) {
    if (lastErr && lastErr.incomplete) {
      throw { status: lastStatus, message: '响应数据不完整（蓝牙代理对长响应有限制），请重试' }
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
  return request('/notifications' + qs({ page: page, per_page: PER_PAGE, all: !!all }))
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
  return request('/user/repos' + qs({
    page: page, per_page: PER_PAGE,
    sort: sort || 'pushed', type: 'owner',
    affiliation: 'owner,collaborator,organization_member'
  }))
}

/** 指定用户的公开仓库 */
export function getUserRepos(login, page) {
  return request('/users/' + encodeURIComponent(login) + '/repos' + qs({ page: page, per_page: PER_PAGE, sort: 'pushed' }))
}

/** 仓库搜索 */
export function searchRepos(keyword, page, sort) {
  return request('/search/repositories' + qs({
    q: keyword, page: page, per_page: PER_PAGE,
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
  return request('/search/repositories' + qs({ q: q, page: page, per_page: PER_PAGE, sort: 'stars', order: 'desc' }))
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

/** 文件原始文本（建议 < 200KB） */
export function getFileRaw(fullName, path, ref) {
  const p = path ? '/' + path : ''
  return request('/repos/' + fullName + '/contents' + p + qs({ ref: ref || undefined }), { raw: true })
}

/** Issue 列表（自动过滤 PR；per_page 压到 10 降低蓝牙代理长响应截断概率） */
export async function getIssues(fullName, page, state) {
  const data = await request('/repos/' + fullName + '/issues' + qs({
    page: page, per_page: PER_PAGE, state: state || 'open', sort: 'created'
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

/** Issue 评论列表（传 comments_url） */
export function getComments(commentsUrl, page) {
  return request(commentsUrl + qs({ page: page || 1, per_page: PER_PAGE }))
}

/** 发表 Issue 评论（需 Token，传 comments_url） */
export function addComment(commentsUrl, body) {
  return request(commentsUrl, { method: 'POST', body: { body: body } })
}

/** Release 列表 */
export function getReleases(fullName, page) {
  return request('/repos/' + fullName + '/releases' + qs({ page: page || 1, per_page: PER_PAGE }))
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
  loadToken, hasToken, currentToken, saveToken, clearToken, rateInfo,
  request, qs, self,
  getRateLimit, getNotifications, markAllNotificationsRead, markThreadRead, getSubject,
  getMyRepos, getUserRepos, searchRepos, getTrending,
  getRepo, getReadme, getContents, getFileRaw,
  getIssues, getIssue, getComments, addComment, getReleases,
  isStarred, setStarred, getUser
}

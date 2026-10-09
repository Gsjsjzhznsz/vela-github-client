/**
 * view.js — API 数据 → 列表视图模型（瘦字段，控制内存与渲染节点数）
 */
import { compact, relTime, langColor, avatar, truncate } from './fmt'

function safeId(v) {
  return v !== undefined && v !== null ? String(v) : 'x' + Math.floor(Math.random() * 1000000)
}

export function typeIcon(type) {
  if (type === 'Issue') return '/common/icons/issue.png'
  if (type === 'PullRequest') return '/common/icons/pull.png'
  if (type === 'Release') return '/common/icons/book.png'
  if (type === 'Commit') return '/common/icons/code.png'
  return '/common/icons/repo.png'
}

export function mapRepo(r) {
  if (!r || typeof r !== 'object') r = {}
  const owner = r.owner ? r.owner.login : '?'
  const av = avatar(owner)
  return {
    id: safeId(r.id),
    full: r.full_name,
    desc: truncate(r.description || '', 72),
    stars: compact(r.stargazers_count),
    lang: r.language || '',
    langc: langColor(r.language),
    updated: relTime(r.updated_at),
    avn: av.ch,
    avc: av.color
  }
}

export function mapNotif(n) {
  if (!n || typeof n !== 'object') n = {}
  const repoFullName = n.repository ? n.repository.full_name : ''
  const av = avatar(repoFullName.split('/')[0] || '?')
  return {
    id: safeId(n.id),
    icon: typeIcon(n.subject && n.subject.type),
    repo: repoFullName,
    title: truncate(n.subject && n.subject.title, 60),
    unread: !!n.unread,
    time: relTime(n.updated_at),
    url: (n.subject && n.subject.url) || '',
    threadUrl: n.url || '',
    avn: av.ch,
    avc: av.color
  }
}

export function mapIssue(i) {
  if (!i || typeof i !== 'object') i = {}
  const labels = Array.isArray(i.labels) ? i.labels.slice(0, 3) : []
  return {
    id: safeId(i.id),
    num: i.number,
    title: truncate(i.title, 64),
    open: i.state === 'open',
    author: i.user ? i.user.login : '',
    comments: i.comments || 0,
    labelsText: labels.map((l) => truncate(l.name, 10)).join(' · '),
    labelColor: labels[0] && labels[0].color ? '#' + labels[0].color : '#8b949e',
    time: relTime(i.created_at)
  }
}

export function mapRelease(r) {
  if (!r || typeof r !== 'object') r = {}
  const av = avatar(r.author ? r.author.login : '?')
  return {
    id: safeId(r.id),
    tag: r.tag_name || '',
    name: truncate(r.name || r.tag_name || 'Release', 48),
    time: relTime(r.published_at || r.created_at),
    author: r.author ? r.author.login : '',
    pre: !!r.prerelease,
    body: truncate((r.body || '').replace(/\r/g, ''), 400),
    assets: (r.assets || []).length,
    avn: av.ch,
    avc: av.color
  }
}

/**
 * Vela 固件路由参数解析。
 * ⚠️ 模拟器实测（20250716 固件）：页面 onInit(params) 的 params 是 undefined，
 * uri 上的 query string 引擎既不解析也不透传（BandQQ compose.ux 用
 * this.$app.$def.store 兜底取参，同一证据链）。
 * 因此跨页传参统一走「App 级 hook 中转」：
 *   跳转前：this.$app.$def.hook = { full: 'o/r' }
 *   接收页：const p = query(params, this)
 * hook 为本次跳转刚写入的值，优先级最高；params 通道（uri 串/命名键）保留，
 * 以兼容未来真机固件可能的标准传参行为。
 */
export function query(params, vm) {
  const out = {}
  const appDef = vm && vm.$app && vm.$app.$def
  if (appDef && appDef.hook) {
    const h = appDef.hook
    for (const k in h) out[k] = h[k]
  }
  if (!params) return out
  if (params.uri) {
    const q = (params.uri.split('?')[1] || '')
    if (q) {
      q.split('&').forEach((kv) => {
        const i = kv.indexOf('=')
        if (i > 0) out[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1))
      })
    }
  }
  for (const k of ['full', 'n', 'user', 'type', 'initial']) {
    if (params[k] !== undefined && out[k] === undefined) out[k] = params[k]
  }
  return out
}

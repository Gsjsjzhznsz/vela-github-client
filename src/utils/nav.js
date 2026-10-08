/**
 * nav.js — 路由参数双模式解析
 * v1.0.1：部分固件/模拟器镜像 onInit 只回传 params.uri 原始串（query string），
 * 不回传 params 对象；本工具两种形态统一兼容：
 *   router.push({ uri: 'pages/repo', params: { full: 'o/r' } })
 *   router.push({ uri: 'pages/repo?full=o/r' })
 * 用法：const p = navParams(params, ['full', 'n'])  →  { full: 'o/r', n: '12' }
 */
export function navParams(params, keys) {
  let src = params
  if (src && typeof src.uri === 'string' && src.uri.indexOf('?') >= 0) {
    const q = src.uri.slice(src.uri.indexOf('?') + 1)
    const o = {}
    const parts = q.split('&')
    for (let i = 0; i < parts.length; i++) {
      const eq = parts[i].indexOf('=')
      if (eq > 0) {
        const k = decodeURIComponent(parts[i].slice(0, eq))
        o[k] = decodeURIComponent(parts[i].slice(eq + 1))
      }
    }
    src = o
  }
  const out = {}
  const ks = keys || []
  for (let i = 0; i < ks.length; i++) {
    const k = ks[i]
    if (src && src[k] !== undefined && src[k] !== null) out[k] = String(src[k])
  }
  return out
}

/** 生成带 query 的 uri（发送端配套工具） */
export function withQuery(uri, params) {
  const parts = []
  for (const k in params) {
    if (params[k] === undefined || params[k] === null) continue
    parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]))
  }
  return parts.length ? uri + '?' + parts.join('&') : uri
}

export default { navParams: navParams, withQuery: withQuery }

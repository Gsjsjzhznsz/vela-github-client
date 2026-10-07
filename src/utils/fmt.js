/**
 * fmt.js — 展示格式化工具（数字压缩 / 相对时间 / 语言颜色 / 文字头像配色）
 */

/** 1234 → 1.2k；12345 → 12.3k；1234567 → 1.2M */
export function compact(n) {
  const v = Number(n) || 0
  if (v >= 1000000) {
    const m = v / 1000000
    return (Math.round(m * 10) / 10) + 'M'
  }
  if (v >= 1000) {
    const k = v / 1000
    return (Math.round(k * 10) / 10) + 'k'
  }
  return String(v)
}

/** ISO 时间 → 中文相对时间（超 30 天显示 MM-DD，跨年补年份） */
export function relTime(iso) {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (!t && t !== 0) return ''
  const diff = Date.now() - t
  if (diff < 0) diff = 0
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return min + '分钟前'
  const h = Math.floor(min / 60)
  if (h < 24) return h + '小时前'
  const d = Math.floor(h / 24)
  if (d <= 30) return d + '天前'
  const dt = new Date(t)
  const mm = ('0' + (dt.getMonth() + 1)).slice(-2)
  const dd = ('0' + dt.getDate()).slice(-2)
  const now = new Date()
  if (dt.getFullYear() === now.getFullYear()) return mm + '-' + dd
  return dt.getFullYear() + '-' + mm + '-' + dd
}

const LANG_COLORS = {
  JavaScript: '#f1e05a',
  TypeScript: '#3178c6',
  Python: '#3572a5',
  Java: '#b07219',
  Go: '#00add8',
  Rust: '#dea584',
  'C++': '#f34b7d',
  C: '#555555',
  'C#': '#178600',
  Kotlin: '#a97bff',
  Swift: '#f05138',
  Ruby: '#701516',
  PHP: '#4f5d95',
  Shell: '#89e051',
  HTML: '#e34c26',
  CSS: '#563d7c',
  Vue: '#41b883',
  Dart: '#00b4ab',
  Lua: '#000080',
  CMake: '#da3434',
  Objective_C: '#438eff'
}

/** 语言 → GitHub 语言色点 */
export function langColor(lang) {
  if (!lang) return '#30363d'
  if (LANG_COLORS[lang]) return LANG_COLORS[lang]
  // 未收录语言按名称 hash 出稳定颜色
  let h = 0
  for (let i = 0; i < lang.length; i++) h = (h * 31 + lang.charCodeAt(i)) % 360
  return 'hsl(' + h + ',45%,55%)'
}

/** 字符串 → 稳定色调（文字头像背景） */
export function hueOf(str) {
  let h = 0
  const s = String(str || '?')
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360
  return h
}

/** 文字头像：首字母 + 稳定背景色 */
export function avatar(str) {
  const s = String(str || '?')
  return {
    ch: (s.charAt(0) || '?').toUpperCase(),
    color: 'hsl(' + hueOf(s) + ',42%,38%)'
  }
}

/** Token 打码展示：ghp_****abcd */
export function maskToken(t) {
  if (!t) return ''
  if (t.length <= 10) return '****'
  return t.slice(0, 4) + '****' + t.slice(-4)
}

/** 截断超长文本 */
export function truncate(s, n) {
  const str = String(s || '')
  return str.length > n ? str.slice(0, n) + '…' : str
}

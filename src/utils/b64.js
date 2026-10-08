/**
 * b64.js — 纯 JS Base64 解码（UTF-8 安全）
 * Vela 手表 JS 环境没有 atob / TextDecoder，README 内容需自行解码。
 * 参考 RFC 4648；处理 URL-SAFE 变体与换行空白。
 */

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

const LOOKUP = (function () {
  const t = {}
  for (let i = 0; i < CHARS.length; i++) t[CHARS.charAt(i)] = i
  t['-'] = 62 // URL-SAFE
  t['_'] = 63
  return t
})()

function b64ToBytes(input) {
  const clean = String(input).replace(/[\r\n\s]/g, '')
  const len = clean.length
  const out = []
  let i = 0
  while (i < len) {
    const c1 = LOOKUP[clean.charAt(i)] || 0
    const c2 = LOOKUP[clean.charAt(i + 1)] || 0
    const c3 = clean.charAt(i + 2) === '=' ? -1 : (LOOKUP[clean.charAt(i + 2)] || 0)
    const c4 = clean.charAt(i + 3) === '=' ? -1 : (LOOKUP[clean.charAt(i + 3)] || 0)
    const n = (c1 << 18) | (c2 << 12) | ((c3 < 0 ? 0 : c3) << 6) | (c4 < 0 ? 0 : c4)
    out.push((n >> 16) & 0xff)
    if (c3 >= 0) out.push((n >> 8) & 0xff)
    if (c4 >= 0) out.push(n & 0xff)
    i += 4
  }
  return out
}

/** Base64 → UTF-8 字符串（命名导出，供单测与内部使用） */
export function decode(input) {
  const bytes = b64ToBytes(input)
  let out = ''
  let i = 0
  while (i < bytes.length) {
    const b = bytes[i]
    if (b < 0x80) {
      out += String.fromCharCode(b)
      i += 1
    } else if (b >= 0xf0) {
      // 4 字节（emoji 等）→ 转为代理对
      const cp = ((b & 0x07) << 18) | ((bytes[i + 1] & 0x3f) << 12) | ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f)
      const v = cp - 0x10000
      out += String.fromCharCode(0xd800 + (v >> 10), 0xdc00 + (v & 0x3ff))
      i += 4
    } else if (b >= 0xe0) {
      out += String.fromCharCode(((b & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f))
      i += 3
    } else {
      out += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f))
      i += 2
    }
  }
  return out
}

/**
 * 默认导出：readme.ux 以 `import b64 from '../../utils/b64'` 方式默认导入。
 * ⚠️ Vela quickapp 运行时无 Babel interop —— 模块没有 export default 时
 * 默认导入得到 undefined，会报 "Cannot read property 'decode' of undefined"。
 * 新增工具模块时必须同步提供 export default（见 tests 静态一致性检查）。
 */
export default { decode }

/**
 * md.js — 轻量 Markdown → 手表可读文本块
 * 手表 text 组件不渲染 HTML，这里把 GitHub README / Issue 正文
 * 转换为结构化纯文本块数组，配合 <list> 分块渲染。
 *
 * 输出块类型：h=标题 / p=段落 / c=代码 / q=引用 / l=列表项 / r=分隔线
 */

const MAX_BLOCK = 420 // 单块字符上限（超长截断，防止渲染卡顿）

function clip(s, n) {
  const str = String(s || '')
  return str.length > n ? str.slice(0, n) + ' …' : str
}

/** 行内标记清洗：加粗/斜体/行内代码/链接/图片/HTML 标签 */
function inline(s) {
  let t = String(s || '')
  t = t.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1[图]')
  t = t.replace(/\[([^\]]*)\]\(([^)\s]+)[^)]*\)/g, (m, txt, url) => {
    const u = String(url || '').replace(/^https?:\/\//, '')
    if (!txt) return u
    return txt
  })
  t = t.replace(/`([^`]+)`/g, '「$1」')
  t = t.replace(/\*\*([^*]+)\*\*/g, '$1')
  t = t.replace(/__([^_]+)__/g, '$1')
  t = t.replace(/\*([^*]+)\*/g, '$1')
  t = t.replace(/~~([^~]+)~~/g, '$1')
  t = t.replace(/<[^>\s][^>]*>/g, '')
  t = t.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
  return t.replace(/\s+$/, '')
}

/** markdown 全文 → 块数组 */
export function mdToBlocks(md) {
  const lines = String(md || '').split(/\r?\n/)
  const blocks = []
  let inCode = false
  let codeBuf = []
  let paraBuf = []

  const flushPara = () => {
    if (paraBuf.length) {
      const s = clip(inline(paraBuf.join(' ')).replace(/\s+/g, ' ').trim(), MAX_BLOCK)
      if (s) blocks.push({ t: 'p', s: s })
      paraBuf = []
    }
  }
  const flushCode = () => {
    if (codeBuf.length) {
      blocks.push({ t: 'c', s: clip(codeBuf.join('\n'), MAX_BLOCK) })
      codeBuf = []
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const line = raw.replace(/\t/g, '  ')

    // 围栏代码块
    const fence = line.match(/^\s*(```+|~~~+)\s*(\S*)\s*$/)
    if (fence) {
      if (inCode) {
        flushCode()
        inCode = false
      } else {
        flushPara()
        inCode = true
      }
      continue
    }
    if (inCode) {
      codeBuf.push(line)
      continue
    }

    const trimmed = line.trim()

    // 空行 → 结束当前段落
    if (!trimmed) {
      flushPara()
      continue
    }

    // 分隔线（固件 elif 指令不可靠，块渲染统一为单 text 节点 + 动态 class，
    // 故分隔线也给可见字符，由 .b-r 样式渲染为暗色水平线）
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushPara()
      blocks.push({ t: 'r', s: '──────────────' })
      continue
    }

    // ATX 标题
    const h = trimmed.match(/^(#{1,6})\s+(.*)$/)
    if (h) {
      flushPara()
      blocks.push({ t: 'h', s: clip(inline(h[2]), 80) })
      continue
    }

    // 引用
    const bq = trimmed.match(/^>\s?(.*)$/)
    if (bq) {
      flushPara()
      const s = clip(inline(bq[1]), MAX_BLOCK)
      if (s) blocks.push({ t: 'q', s: s })
      continue
    }

    // 表格行 → 线性化
    if (trimmed.charAt(0) === '|' && trimmed.charAt(trimmed.length - 1) === '|') {
      flushPara()
      const cells = trimmed.slice(1, -1).split('|').map((c) => inline(c.trim())).filter((c, idx, arr) => !(arr.length > 1 && /^[-: ]*$/.test(c)))
      if (cells.length) blocks.push({ t: 'p', s: clip(cells.join(' · '), MAX_BLOCK) })
      continue
    }

    // 列表项（含任务列表）
    const li = trimmed.match(/^([-*+]|\d+[.)])\s+(.*)$/)
    if (li) {
      flushPara()
      let body = inline(li[2])
      // ☑(U+2611) 固件字库缺字形渲染为豆腐块，改用 √（模拟器实测 □ 可用、√ 属 CJK 字库常备）
      body = body.replace(/^\[([ xX])\]\s*/, (m, mk) => (mk === ' ' ? '□ ' : '√ '))
      const prefix = /^\d/.test(li[1]) ? li[1].replace(/[.)]$/, '.') + ' ' : '• '
      blocks.push({ t: 'l', s: clip(prefix + body, MAX_BLOCK) })
      continue
    }

    // 普通段落（合并连续行）
    paraBuf.push(trimmed)
  }
  flushCode()
  flushPara()
  for (let i = 0; i < blocks.length; i++) blocks[i].h = estBlockH(blocks[i])
  return blocks
}

/** 块渲染高度估算（px）：本固件对无界换行文本测量坍缩（BandQQ v2.15 同族问题），
 *  每个块必须显式高度（v1.1.2 修复：readme/issue 页 appendMore 此前丢传 h 字段，
 *  模板 height: undefinedpx 导致内容块全部塌陷隐形——「显示全文完」根因）。
 *  与页面 CSS 严格对齐（.b-h fs22/lh30 等）：行数×行高 + 内边距 + 外边距。
 *  字符宽度按保守估算（CJK≈1.0×fs / 其他≈0.58×fs，可用宽度取略小值）保证宁高勿裁。 */
const H_TABLE = {
  h: { fs: 22, lh: 30, pad: 12 },
  p: { fs: 17, lh: 24, pad: 8 },
  c: { fs: 16, lh: 21, pad: 28 },
  q: { fs: 17, lh: 23, pad: 14 },
  l: { fs: 17, lh: 24, pad: 14 },
  r: { fs: 14, lh: 18, pad: 16 },
}
function estBlockH(b) {
  const t = H_TABLE[b.t] || H_TABLE.p
  const s = String(b.s || '')
  if (!s) return t.lh + t.pad
  // 代码块按 \n 强制分行
  const segs = b.t === 'c' ? s.split('\n') : [s]
  const avail = b.t === 'c' ? 350 : 390
  let lines = 0
  for (let si = 0; si < segs.length; si++) {
    let w = 0
    const seg = segs[si]
    for (let i = 0; i < seg.length; i++) {
      const c = seg.charCodeAt(i)
      w += c > 0x2e7f ? t.fs : t.fs * 0.58
    }
    lines += Math.max(1, Math.ceil(w / avail))
  }
  return lines * t.lh + t.pad
}

/** 块数组 → list-item 渲染用的分片（每片 chunkSize 块），懒加载友好 */
export function chunkBlocks(blocks, chunkSize) {
  const out = []
  for (let i = 0; i < blocks.length; i += chunkSize) {
    out.push({ id: out.length, items: blocks.slice(i, i + chunkSize) })
  }
  return out
}

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

    // 分隔线
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
      flushPara()
      blocks.push({ t: 'r', s: '' })
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
      body = body.replace(/^\[([ xX])\]\s*/, (m, mk) => (mk === ' ' ? '□ ' : '☑ '))
      const prefix = /^\d/.test(li[1]) ? li[1].replace(/[.)]$/, '.') + ' ' : '• '
      blocks.push({ t: 'l', s: clip(prefix + body, MAX_BLOCK) })
      continue
    }

    // 普通段落（合并连续行）
    paraBuf.push(trimmed)
  }
  flushCode()
  flushPara()
  return blocks
}

/** 块数组 → list-item 渲染用的分片（每片 chunkSize 块），懒加载友好 */
export function chunkBlocks(blocks, chunkSize) {
  const out = []
  for (let i = 0; i < blocks.length; i += chunkSize) {
    out.push({ id: out.length, items: blocks.slice(i, i + chunkSize) })
  }
  return out
}

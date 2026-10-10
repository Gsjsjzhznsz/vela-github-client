/**
 * hl.js — v1.2.4 多语言语法高亮引擎（手表端专用）
 *
 * 设计约束（弦电子书「限量渲染」同源策略）：
 *  - 零依赖零正则：纯字符扫描，规避低端 JS 引擎上正则回溯风险；
 *  - 按页惰性分词：只在 renderFilePage 渲染当页 18 行时分词（≤160 字/行），
 *    单页耗时毫秒级，翻页零感知；
 *  - 块状态一次预计算：/* *／跨行注释、Markdown 围栏等跨行状态在文件载入时
 *    单遍扫描成布尔表，翻任意页都能拿到正确状态，无需回扫；
 *  - 输出瘦 token {i,s,c}：同色相邻 token 合并、单行 token 数封顶，
 *    每页节点数 ~100，远低于一次全量渲染的 ~3000。
 *
 * token 类别 c：kw 关键字 / str 字符串 / num 数字 / com 注释 / fn 函数调用 /
 * ty 类型与类名 / key JSON·YAML 键与属性 / tag 标签与装饰器 / pun 标点 /
 * pl 普通 / add diff 增行 / del diff 删行
 */

/* 扩展名 → 语言家族（plain 不高亮，直接单 token 输出） */
const EXT_MAP = {
  js: 'clike', mjs: 'clike', cjs: 'clike', ts: 'clike', jsx: 'clike', tsx: 'clike',
  java: 'clike', c: 'clike', h: 'clike', cpp: 'clike', cc: 'clike', cxx: 'clike',
  hpp: 'clike', hh: 'clike', cs: 'clike', go: 'clike', rs: 'clike', kt: 'clike',
  kts: 'clike', swift: 'clike', php: 'clike', scala: 'clike', dart: 'clike',
  m: 'clike', gradle: 'clike',
  py: 'python', pyw: 'python',
  sh: 'shell', bash: 'shell', zsh: 'shell',
  json: 'json', jsonc: 'json',
  css: 'css', scss: 'css', less: 'css',
  html: 'markup', htm: 'markup', xml: 'markup', svg: 'markup', vue: 'markup', wxml: 'markup',
  yml: 'yaml', yaml: 'yaml', toml: 'yaml', ini: 'yaml', conf: 'yaml', properties: 'yaml',
  md: 'md', markdown: 'md',
  diff: 'diff', patch: 'diff',
  sql: 'sql'
}

export function detectLang(name) {
  const base = String(name || '').split('?')[0]
  const parts = base.split('.')
  const ext = (parts[parts.length - 1] || '').toLowerCase()
  if (!ext) return 'plain'
  return EXT_MAP[ext] || 'plain'
}

/* ---- 关键字表（小写；家族内合并高频词，控制在内存预算内） ---- */
const KW_CLIKE = ' abstract as async await base break case catch class const constexpr continue debugger default defer delete do dynamic else enum event export extends extern false final finally fn for foreach from func function get global goto if implements import in inline instanceof interface internal is let lock match mut namespace new null operator out override package params private protected public readonly record ref return sealed set static struct super switch synchronized template this throw throws trait transient true try type typedef typeof union unsafe use using val var virtual void volatile when where while with yield '
const KW_PY = ' and as assert async await break class continue def del elif else except False finally for from global if import in is lambda None nonlocal not or pass raise return True try while with yield '
const BUILTIN_PY = ' abs all any bool bytes callable chr classmethod dict dir divmod enumerate eval exec filter float format frozenset getattr hasattr hash help hex id input int isinstance issubclass iter len list map max min next object oct open ord pow print property range repr reversed round self set setattr slice sorted staticmethod str sum super tuple type vars zip '
const KW_SH = ' alias bg break case cd command continue coproc do done echo elif else esac eval exec exit export false fc fg fi for function getopts hash help history if in jobs kill let local logout popd pushd read readonly return set shift source suspend test then time times trap true type ulimit umask unalias unset until wait while '
const KW_SQL = ' add all alter and any as asc auto_increment between by case check column constraint create cross database default delete desc distinct drop else end exists foreign from full group having if ignore in index inner insert into is join key left like limit not null on or order outer primary procedure references replace right select set table then truncate union unique update values view when where '
const KW_YAML = ' false null true yes no on off '

function isWord(c) {
  return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || (c >= '0' && c <= '9') || c === '_' || c === '$'
}
function isDigit(c) {
  return c >= '0' && c <= '9'
}
function isHex(c) {
  return isDigit(c) || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')
}

/** 查关键字表：表以「 kw1 kw2 」空格包裹形式存储，indexOf 一次命中 */
function inKW(table, w) {
  return table.indexOf(' ' + w + ' ') >= 0
}

const MAX_TOKENS = 24

function pushTok(out, s, c) {
  if (!s) return
  const last = out.length - 1
  if (last >= 0 && out[last].c === c) {
    out[last].s += s
    return
  }
  if (out.length >= MAX_TOKENS) {
    out[last].s += s
    return
  }
  out.push({ i: out.length, s: s, c: c })
}

/* ---- clike：// 与 /* *／注释、' " ` 字符串、数字、关键字/函数/类型 ---- */
function toksClike(s, kw) {
  const out = []
  let i = 0
  let buf = ''
  const flush = () => { if (buf) { pushTok(out, buf, 'pl'); buf = '' } }
  while (i < s.length) {
    const c = s[i]
    if (c === '/' && s[i + 1] === '/') { flush(); pushTok(out, s.slice(i), 'com'); return out }
    if (c === '/' && s[i + 1] === '*') {
      flush()
      const end = s.indexOf('*/', i + 2)
      if (end < 0) { pushTok(out, s.slice(i), 'com'); return out }
      pushTok(out, s.slice(i, end + 2), 'com')
      i = end + 2
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      flush()
      let j = i + 1
      while (j < s.length) {
        if (s[j] === '\\') { j += 2; continue }
        if (s[j] === c) { j++; break }
        j++
      }
      pushTok(out, s.slice(i, j), 'str')
      i = j
      continue
    }
    if (isDigit(c)) {
      flush()
      let j = i + 1
      while (j < s.length && (isHex(s[j]) || s[j] === '.' || s[j] === 'x' || s[j] === 'X' || s[j] === 'b' || s[j] === 'o' || s[j] === 'n' || s[j] === '_')) j++
      pushTok(out, s.slice(i, j), 'num')
      i = j
      continue
    }
    if (isWord(c) && !isDigit(c)) {
      let j = i + 1
      while (j < s.length && isWord(s[j])) j++
      const w = s.slice(i, j)
      let k = j
      while (k < s.length && s[k] === ' ') k++
      let cls = 'pl'
      if (inKW(kw, w.toLowerCase())) cls = 'kw'
      else if (s[k] === '(') cls = 'fn'
      else if (c >= 'A' && c <= 'Z') cls = 'ty'
      else if (w === 'true' || w === 'false' || w === 'null') cls = 'num'
      flush()
      pushTok(out, w, cls)
      i = j
      continue
    }
    buf += c
    i++
  }
  flush()
  return out
}

/* ---- python：# 注释、''/"" 字符串（含 r/f/b 前缀）、关键字/内建、装饰器 ---- */
function toksPython(s) {
  const out = []
  let i = 0
  let buf = ''
  const flush = () => { if (buf) { pushTok(out, buf, 'pl'); buf = '' } }
  while (i < s.length) {
    const c = s[i]
    if (c === '#') { flush(); pushTok(out, s.slice(i), 'com'); return out }
    if (c === '@' && out.length === 0 && buf === '') {
      let j = i + 1
      while (j < s.length && isWord(s[j])) j++
      pushTok(out, s.slice(i, j), 'tag')
      i = j
      continue
    }
    if ((c === 'r' || c === 'f' || c === 'b' || c === 'u') && (s[i + 1] === '"' || s[i + 1] === "'")) {
      flush()
      const q = s[i + 1]
      let j = i + 2
      while (j < s.length) {
        if (s[j] === '\\') { j += 2; continue }
        if (s[j] === q) { j++; break }
        j++
      }
      pushTok(out, s.slice(i, j), 'str')
      i = j
      continue
    }
    if (c === '"' || c === "'") {
      flush()
      let j = i + 1
      while (j < s.length) {
        if (s[j] === '\\') { j += 2; continue }
        if (s[j] === c) { j++; break }
        j++
      }
      pushTok(out, s.slice(i, j), 'str')
      i = j
      continue
    }
    if (isDigit(c)) {
      flush()
      let j = i + 1
      while (j < s.length && (isHex(s[j]) || s[j] === '.' || s[j] === '_' || s[j] === 'x' || s[j] === 'b' || s[j] === 'o')) j++
      pushTok(out, s.slice(i, j), 'num')
      i = j
      continue
    }
    if (isWord(c) && !isDigit(c)) {
      let j = i + 1
      while (j < s.length && isWord(s[j])) j++
      const w = s.slice(i, j)
      let k = j
      while (k < s.length && s[k] === ' ') k++
      let cls = 'pl'
      if (inKW(KW_PY, w)) cls = 'kw'
      else if (inKW(BUILTIN_PY, w)) cls = 'fn'
      else if (s[k] === '(') cls = 'fn'
      flush()
      pushTok(out, w, cls)
      i = j
      continue
    }
    buf += c
    i++
  }
  flush()
  return out
}

/* ---- shell：# 注释、字符串、$ 变量、关键字、首词命令 ---- */
function toksShell(s) {
  const out = []
  let i = 0
  let buf = ''
  let firstWord = true
  const flush = () => { if (buf) { pushTok(out, buf, 'pl'); buf = '' } }
  while (i < s.length) {
    const c = s[i]
    if (c === '#' && (i === 0 || s[i - 1] === ' ' || s[i - 1] === '\t')) { flush(); pushTok(out, s.slice(i), 'com'); return out }
    if (c === '$') {
      flush()
      let j = i + 1
      if (s[j] === '{') { j++; while (j < s.length && s[j] !== '}') j++; if (j < s.length) j++ }
      else { while (j < s.length && isWord(s[j])) j++ }
      pushTok(out, s.slice(i, j), 'num')
      i = j
      continue
    }
    if (c === '"' || c === "'") {
      flush()
      let j = i + 1
      while (j < s.length) {
        if (s[j] === '\\') { j += 2; continue }
        if (s[j] === c) { j++; break }
        j++
      }
      pushTok(out, s.slice(i, j), 'str')
      i = j
      continue
    }
    if (isWord(c) && !isDigit(c)) {
      let j = i + 1
      while (j < s.length && isWord(s[j])) j++
      const w = s.slice(i, j)
      let cls = 'pl'
      if (inKW(KW_SH, w)) cls = 'kw'
      else if (firstWord && i === 0) cls = 'fn'
      flush()
      pushTok(out, w, cls)
      firstWord = false
      i = j
      continue
    }
    if (c === '|' || c === ';' || c === '&') firstWord = false
    buf += c
    i++
  }
  flush()
  return out
}

/* ---- json："key": 高亮键、字符串、数字、true/false/null ---- */
function toksJson(s) {
  const out = []
  let i = 0
  let buf = ''
  const flush = () => { if (buf) { pushTok(out, buf, 'pl'); buf = '' } }
  while (i < s.length) {
    const c = s[i]
    if (c === '"') {
      flush()
      let j = i + 1
      while (j < s.length) {
        if (s[j] === '\\') { j += 2; continue }
        if (s[j] === '"') { j++; break }
        j++
      }
      let k = j
      while (k < s.length && s[k] === ' ') k++
      pushTok(out, s.slice(i, j), s[k] === ':' ? 'key' : 'str')
      i = j
      continue
    }
    if (c === '-' || isDigit(c)) {
      flush()
      let j = i + 1
      while (j < s.length && (isHex(s[j]) || s[j] === '.' || s[j] === 'e' || s[j] === 'E' || s[j] === '+')) j++
      pushTok(out, s.slice(i, j), 'num')
      i = j
      continue
    }
    if (isWord(c)) {
      let j = i + 1
      while (j < s.length && isWord(s[j])) j++
      const w = s.slice(i, j)
      flush()
      pushTok(out, w, (w === 'true' || w === 'false' || w === 'null') ? 'kw' : 'pl')
      i = j
      continue
    }
    buf += c
    i++
  }
  flush()
  return out
}

/* ---- css：注释、@规则、#hex、数字+单位、属性名（word: 形态） ---- */
function toksCss(s) {
  const out = []
  let i = 0
  let buf = ''
  const flush = () => { if (buf) { pushTok(out, buf, 'pl'); buf = '' } }
  while (i < s.length) {
    const c = s[i]
    if (c === '/' && s[i + 1] === '*') {
      flush()
      const end = s.indexOf('*/', i + 2)
      if (end < 0) { pushTok(out, s.slice(i), 'com'); return out }
      pushTok(out, s.slice(i, end + 2), 'com')
      i = end + 2
      continue
    }
    if (c === '@') {
      flush()
      let j = i + 1
      while (j < s.length && isWord(s[j])) j++
      pushTok(out, s.slice(i, j), 'kw')
      i = j
      continue
    }
    if (c === '#' && isHex(s[i + 1])) {
      flush()
      let j = i + 1
      while (j < s.length && isHex(s[j])) j++
      pushTok(out, s.slice(i, j), 'num')
      i = j
      continue
    }
    if (c === '"' || c === "'") {
      flush()
      let j = i + 1
      while (j < s.length) {
        if (s[j] === '\\') { j += 2; continue }
        if (s[j] === c) { j++; break }
        j++
      }
      pushTok(out, s.slice(i, j), 'str')
      i = j
      continue
    }
    if (isDigit(c)) {
      flush()
      let j = i + 1
      while (j < s.length && (isDigit(s[j]) || s[j] === '.' || isWord(s[j]))) j++
      pushTok(out, s.slice(i, j), 'num')
      i = j
      continue
    }
    if (isWord(c) && !isDigit(c)) {
      let j = i + 1
      while (j < s.length && isWord(s[j])) j++
      let k = j
      while (k < s.length && s[k] === ' ') k++
      const w = s.slice(i, j)
      flush()
      pushTok(out, w, s[k] === ':' ? 'key' : 'pl')
      i = j
      continue
    }
    buf += c
    i++
  }
  flush()
  return out
}

/* ---- markup(html/xml)：<!-- -->、<tag>、属性=、字符串（inTag 态防正文误判） ---- */
function toksMarkup(s) {
  const out = []
  let i = 0
  let buf = ''
  let inTag = false
  const flush = () => { if (buf) { pushTok(out, buf, 'pl'); buf = '' } }
  while (i < s.length) {
    const c = s[i]
    if (c === '<' && s[i + 1] === '!' && s[i + 2] === '-' && s[i + 3] === '-') {
      flush()
      const end = s.indexOf('-->', i + 4)
      if (end < 0) { pushTok(out, s.slice(i), 'com'); return out }
      pushTok(out, s.slice(i, end + 3), 'com')
      i = end + 3
      continue
    }
    if (c === '<') {
      flush()
      let j = i + 1
      if (s[j] === '/') j++
      let k = j
      while (k < s.length && (isWord(s[k]) || s[k] === '-' || s[k] === ':')) k++
      pushTok(out, s.slice(i, k), 'tag')
      inTag = s[k] !== '>' && s[k] !== '/'
      i = k
      continue
    }
    if (c === '>') {
      flush()
      buf = '>'
      flush()
      inTag = false
      i++
      continue
    }
    if (c === '"' || c === "'") {
      flush()
      let j = i + 1
      while (j < s.length && s[j] !== c) j++
      if (j < s.length) j++
      pushTok(out, s.slice(i, j), 'str')
      i = j
      continue
    }
    if (inTag && isWord(c) && !isDigit(c) && (buf === '' || buf.slice(-1) === ' ')) {
      let j = i + 1
      while (j < s.length && isWord(s[j])) j++
      let k = j
      while (k < s.length && s[k] === ' ') k++
      if (s[k] === '=') {
        flush()
        pushTok(out, s.slice(i, j), 'key')
        i = j
        continue
      }
    }
    buf += c
    i++
  }
  flush()
  return out
}

/* ---- yaml/toml/ini：# 注释、key: / key= 键、布尔、数字 ---- */
function toksYaml(s) {
  const out = []
  let i = 0
  let buf = ''
  const flush = () => { if (buf) { pushTok(out, buf, 'pl'); buf = '' } }
  while (i < s.length) {
    const c = s[i]
    if (c === '#' && (i === 0 || s[i - 1] === ' ' || s[i - 1] === '\t')) { flush(); pushTok(out, s.slice(i), 'com'); return out }
    if (c === '"' || c === "'") {
      flush()
      let j = i + 1
      while (j < s.length && s[j] !== c) j++
      if (j < s.length) j++
      let k = j
      while (k < s.length && s[k] === ' ') k++
      pushTok(out, s.slice(i, j), s[k] === ':' || s[k] === '=' ? 'key' : 'str')
      i = j
      continue
    }
    if (isWord(c) && !isDigit(c)) {
      let j = i + 1
      while (j < s.length && (isWord(s[j]) || s[j] === '-' || s[j] === '.')) j++
      let k = j
      while (k < s.length && s[k] === ' ') k++
      const w = s.slice(i, j)
      flush()
      if (s[k] === ':' || s[k] === '=') pushTok(out, w, 'key')
      else if (inKW(KW_YAML, w.toLowerCase())) pushTok(out, w, 'kw')
      else pushTok(out, w, 'pl')
      i = j
      continue
    }
    if (isDigit(c)) {
      flush()
      let j = i + 1
      while (j < s.length && (isDigit(s[j]) || s[j] === '.')) j++
      pushTok(out, s.slice(i, j), 'num')
      i = j
      continue
    }
    buf += c
    i++
  }
  flush()
  return out
}

/* ---- markdown：标题、加粗、行内代码、链接、列表标记；围栏行 tag（零正则） ---- */
function mdHeaderLen(t) {
  let n = 0
  while (n < t.length && t[n] === '#') n++
  if (n >= 1 && n <= 6 && (t[n] === ' ' || t[n] === '\t')) return n
  return 0
}
function mdListMarkLen(t) {
  let k = 0
  while (k < t.length && (t[k] === ' ' || t[k] === '\t')) k++
  const c = t[k]
  if ((c === '-' || c === '*' || c === '+') && t[k + 1] === ' ') return k + 2
  if (isDigit(c)) {
    let j = k
    while (j < t.length && isDigit(t[j])) j++
    if ((t[j] === '.' || t[j] === ')') && t[j + 1] === ' ') return j + 2
  }
  return 0
}
function toksMd(s, fence) {
  const out = []
  if (fence) { pushTok(out, s, 'tag'); return out }
  const t = s
  const hd = mdHeaderLen(t)
  if (hd) { pushTok(out, t, 'kw'); return out }
  const lm = mdListMarkLen(t)
  if (lm) {
    pushTok(out, t.slice(0, lm), 'num')
    pushTok(out, t.slice(lm), 'pl')
    return out
  }
  if (t[0] === '>') { pushTok(out, t, 'com'); return out }
  /* 行内元素：`code`、**bold**、[text](url) */
  let i = 0
  let buf = ''
  while (i < t.length) {
    if (t[i] === '`') {
      const end = t.indexOf('`', i + 1)
      const stop = end < 0 ? t.length : end + 1
      if (buf) { pushTok(out, buf, 'pl'); buf = '' }
      pushTok(out, t.slice(i, stop), 'str')
      i = stop
      continue
    }
    if (t[i] === '*' && t[i + 1] === '*') {
      const end = t.indexOf('**', i + 2)
      const stop = end < 0 ? t.length : end + 2
      if (buf) { pushTok(out, buf, 'pl'); buf = '' }
      pushTok(out, t.slice(i, stop), 'ty')
      i = stop
      continue
    }
    if (t[i] === '[') {
      const mid = t.indexOf('](', i + 1)
      if (mid > 0) {
        const end = t.indexOf(')', mid + 2)
        const stop = end < 0 ? t.length : end + 1
        if (buf) { pushTok(out, buf, 'pl'); buf = '' }
        pushTok(out, t.slice(i, stop), 'fn')
        i = stop
        continue
      }
    }
    buf += t[i]
    i++
  }
  if (buf) pushTok(out, buf, 'pl')
  return out
}

/* ---- sql：-- 与 # 注释、字符串、关键字、数字 ---- */
function toksSql(s) {
  const out = []
  let i = 0
  let buf = ''
  const flush = () => { if (buf) { pushTok(out, buf, 'pl'); buf = '' } }
  while (i < s.length) {
    const c = s[i]
    if ((c === '-' && s[i + 1] === '-') || c === '#') { flush(); pushTok(out, s.slice(i), 'com'); return out }
    if (c === '/' && s[i + 1] === '*') {
      flush()
      const end = s.indexOf('*/', i + 2)
      if (end < 0) { pushTok(out, s.slice(i), 'com'); return out }
      pushTok(out, s.slice(i, end + 2), 'com')
      i = end + 2
      continue
    }
    if (c === "'") {
      flush()
      let j = i + 1
      while (j < s.length) {
        if (s[j] === '\\') { j += 2; continue }
        if (s[j] === "'") { j++; break }
        j++
      }
      pushTok(out, s.slice(i, j), 'str')
      i = j
      continue
    }
    if (isDigit(c)) {
      flush()
      let j = i + 1
      while (j < s.length && (isDigit(s[j]) || s[j] === '.')) j++
      pushTok(out, s.slice(i, j), 'num')
      i = j
      continue
    }
    if (isWord(c) && !isDigit(c)) {
      let j = i + 1
      while (j < s.length && isWord(s[j])) j++
      const w = s.slice(i, j)
      flush()
      pushTok(out, w, inKW(KW_SQL, w.toLowerCase()) ? 'kw' : 'pl')
      i = j
      continue
    }
    buf += c
    i++
  }
  flush()
  return out
}

/* ---- diff：+/­- 行、@@ hunk、文件头 ---- */
function toksDiff(s) {
  if (s.indexOf('+++') === 0 || s.indexOf('---') === 0 || s.indexOf('diff ') === 0 || s.indexOf('index ') === 0) {
    return [{ i: 0, s: s, c: 'com' }]
  }
  if (s.indexOf('@@') === 0) return [{ i: 0, s: s, c: 'num' }]
  if (s[0] === '+') return [{ i: 0, s: s, c: 'add' }]
  if (s[0] === '-') return [{ i: 0, s: s, c: 'del' }]
  return [{ i: 0, s: s, c: 'pl' }]
}

/**
 * 跨行块状态预计算：单遍扫描全部行。
 * 返回数组 st[i] = { inb: 第 i 行起始是否在块注释/围栏内, lg: 该行生效语言 }
 * - clike/css/sql：/* *／块注释
 * - md：``` 围栏（围栏内行 lg = 围栏声明的语言，无法识别时 plain）
 */
export function buildBlockState(lines, lang) {
  const st = new Array(lines.length)
  let inBlock = false
  let inFence = false
  let fenceLang = 'plain'
  for (let i = 0; i < lines.length; i++) {
    const row = { inb: false, lg: lang }
    if (lang === 'md') {
      /* 围栏不是注释：inb 恒 false，围栏内行仅切换生效语言（fenceLang） */
      row.lg = inFence ? fenceLang : 'md'
      const t = lines[i].trim()
      if (t.indexOf('```') === 0 || t.indexOf('~~~') === 0) {
        if (!inFence) {
          const info = t.slice(3).trim().split(' ')[0] || ''
          fenceLang = detectLang(info)
          inFence = true
        } else {
          inFence = false
        }
        row.lg = 'md'
      }
    } else if (lang === 'clike' || lang === 'css' || lang === 'sql') {
      row.inb = inBlock
      const s = lines[i]
      for (let j = 0; j < s.length - 1; j++) {
        if (s[j] === '/' && s[j + 1] === '*') { inBlock = true; j++ }
        else if (s[j] === '*' && s[j + 1] === '/') { inBlock = false; j++ }
      }
    }
    st[i] = row
  }
  return st
}

/**
 * 单行分词（供 code.ux 按页调用）：
 * @param {string} line 已按 160 字截断的行文本
 * @param {string} lang detectLang 的结果（或围栏行覆盖语言）
 * @param {boolean} inb 该行起始是否在块注释内（buildBlockState 提供）
 * @returns {Array<{i:number,s:string,c:string}>}
 */
export function tokenizeLine(line, lang, inb) {
  if (lang === 'plain') return [{ i: 0, s: line, c: 'pl' }]
  if (inb && lang !== 'md') return [{ i: 0, s: line, c: 'com' }]
  if (inb && lang === 'md') return [{ i: 0, s: line, c: 'pl' }]
  switch (lang) {
    case 'clike': return toksClike(line, KW_CLIKE)
    case 'python': return toksPython(line)
    case 'shell': return toksShell(line)
    case 'json': return toksJson(line)
    case 'css': return toksCss(line)
    case 'markup': return toksMarkup(line)
    case 'yaml': return toksYaml(line)
    case 'sql': return toksSql(line)
    case 'diff': return toksDiff(line)
    default: return [{ i: 0, s: line, c: 'pl' }]
  }
}

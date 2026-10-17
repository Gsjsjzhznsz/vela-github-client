#!/usr/bin/env node
/**
 * codemod_async_to_promises.js — Band 9 兼容性根修（v2.0.1）
 *
 * 背景：手环9（Vela 3.x 老引擎）实测安装 2.0.0-band 后整机死机。
 * 取证结论（对照手环9真机验证过的 BandQQ / 马来语词典 v0.11 两个基准包）：
 *   - 箭头函数 / const-let / 模板字符串 / Promise.then：基准包大量使用，引擎 OK；
 *   - async/await：两个基准包均为 0（词典包手写 Promise 链 17 处）；
 *     我们 2.0.0-band 包里 app.js 55 处 + 各页若干，为唯一未验证语法。
 *   - aiot-toolkit 2.0.5 对 .ux/.js 均不做转译（babel-loader 无 preset 直通），
 *     因此源码里的 async/await 原样进入 rpk。
 * 方案：源码级 codemod —— 用 babel-plugin-transform-async-to-promises 把
 *   async 函数转成 Promise 链（不用 regenerator，避免体积膨胀），
 *   箭头函数/const-let 等已验证安全语法全部保留，diff 最小化。
 *
 * 用法：node scripts/codemod_async_to_promises.js [--check]
 *   --check  只报告将被转换的位置，不写回
 */
const fs = require('fs')
const path = require('path')
const babel = require('@babel/core')

const ROOT = path.resolve(__dirname, '..')
const SRC = path.join(ROOT, 'src')

function walk(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    const st = fs.statSync(p)
    if (st.isDirectory()) walk(p, out)
    else if (/\.(ux|js)$/.test(name)) out.push(p)
  }
  return out
}

/* 提取 .ux 的 <script> ... </script> 块（含行信息，转完原位回填） */
function splitUx(content) {
  const m = content.match(/<script>([\s\S]*?)<\/script>/)
  if (!m) return null
  return { head: content.slice(0, m.index), body: m[1], tail: content.slice(m.index + m[0].length) }
}

const PLUGIN = ['babel-plugin-transform-async-to-promises', { inlineHelpers: true }]

function transformCode(code, filename) {
  if (!/\basync\b/.test(code)) return null
  const before = code
  const res = babel.transformSync(code, {
    filename,
    babelrc: false,
    configFile: false,
    browserslistConfigFile: false,
    compact: false,
    comments: true,
    plugins: [PLUGIN]
  })
  return res.code === before ? null : res.code
}

const checkOnly = process.argv.includes('--check')
const files = walk(SRC, [])
let changed = 0, spots = 0

for (const f of files) {
  const rel = path.relative(ROOT, f)
  const raw = fs.readFileSync(f, 'utf8')
  if (f.endsWith('.ux')) {
    const parts = splitUx(raw)
    if (!parts) continue
    const out = transformCode(parts.body, rel)
    if (out) {
      spots++
      if (!checkOnly) fs.writeFileSync(f, parts.head + '<script>' + out + '</script>' + parts.tail)
      console.log('[ux ] ' + rel)
      changed++
    }
  } else {
    const out = transformCode(raw, rel)
    if (out) {
      spots++
      if (!checkOnly) fs.writeFileSync(f, out)
      console.log('[js ] ' + rel)
      changed++
    }
  }
}

console.log((checkOnly ? '[check] ' : '[done] ') + 'files: ' + changed + ', total async spots: ' + spots)
if (checkOnly) {
  const left = files.filter(f => {
    const c = fs.readFileSync(f, 'utf8')
    return /(^|[^.\w])async(\s|\()/.\u0074est(c)
  })
  console.log('files still containing async keyword: ' + left.length)
}

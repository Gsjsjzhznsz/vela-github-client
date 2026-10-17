#!/usr/bin/env node
/**
 * verify_dist_syntax.js — rpk 产物语法守卫（Band 9 兼容性）
 * 逐个解析 rpk 解包目录里全部 .js：必须合法 ESM 且不含 async/await 代码。
 * 用法：node scripts/verify_dist_syntax.js <解包目录>
 */
const fs = require('fs')
const path = require('path')
const parser = require('@babel/parser')

const root = process.argv[2]
if (!root || !fs.existsSync(root)) { console.error('用法: verify_dist_syntax.js <dir>'); process.exit(2) }

function walk(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    if (fs.statSync(p).isDirectory()) walk(p, out)
    else if (name.endsWith('.js')) out.push(p)
  }
  return out
}

const files = walk(root, [])
let bad = 0, asyncCode = 0
for (const f of files) {
  const rel = path.relative(root, f)
  const src = fs.readFileSync(f, 'utf8')
  try {
    parser.parse(src, { sourceType: 'module', allowReturnOutsideFunction: true })
  } catch (e) {
    console.log('❌ 解析失败: ' + rel + ' — ' + e.message.split('\n')[0]); bad++; continue
  }
  /* 代码级 async 检测：剥掉字符串与注释再查关键字 */
  const stripped = src
    .replace(/'(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"/g, "''")
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
  if (/\basync\b|\bawait\b/.test(stripped)) { console.log('❌ 含 async/await 代码: ' + rel); asyncCode++ }
}
console.log('[verify] js files: ' + files.length + ', parse fail: ' + bad + ', async-code files: ' + asyncCode)
process.exit(bad + asyncCode > 0 ? 1 : 0)

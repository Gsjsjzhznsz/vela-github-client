#!/usr/bin/env node
/**
 * v1.10.1 页面样式一致性守卫
 * ① 每页模板里出现的字面 class 必须在本页 <style>（或 app.ux 共享样式）中有定义
 * ② settings.ux 必须显式定义 .card-col 且含 flex-direction: column（v1.10.0 状态卡横向串排的根修回归守卫）
 * 用法: node scripts/test_pages_v1101.js
 */
const fs = require('fs'), path = require('path');
const SRC = path.join(__dirname, '..', 'src');

function splitUx(txt) {
  const t = txt.indexOf('<template>'), s = txt.indexOf('<style>');
  return { tpl: txt.slice(t, s), style: txt.slice(s) };
}
function definedClasses(styleCss) {
  const css = styleCss.replace(/\/\*[\s\S]*?\*\//g, ''); // 去注释
  const set = new Set();
  let m; const re = /\.([A-Za-z_][\w-]*)\s*\{/g;
  while ((m = re.exec(css))) set.add(m[1]);
  return set;
}
function templateClasses(tpl) {
  const out = [];
  const re = /\sclass="([^"]*)"/g; let m;
  while ((m = re.exec(tpl))) {
    if (m[1].includes('{{')) continue; // 动态绑定整体跳过，无法静态判定
    for (const tok of m[1].trim().split(/\s+/)) {
      if (tok) out.push(tok);
    }
  }
  return out;
}

let fail = 0;
const appStyle = (() => {
  const p = path.join(SRC, 'app.ux');
  try { return splitUx(fs.readFileSync(p, 'utf8')).style; } catch (e) { return ''; }
})();
const shared = definedClasses(appStyle);

const pages = [];
(function walk(d) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (f.endsWith('.ux')) pages.push(p);
  }
})(SRC);

for (const p of pages) {
  const rel = path.relative(SRC, p);
  const { tpl, style } = splitUx(fs.readFileSync(p, 'utf8'));
  const defs = definedClasses(style);
  const missing = [...new Set(templateClasses(tpl))].filter(c => !defs.has(c) && !shared.has(c));
  if (missing.length) {
    fail++;
    console.log(`FAIL ${rel}: 模板类无样式定义 -> ${missing.join(', ')}`);
  } else {
    console.log(`ok   ${rel}`);
  }
}

// settings.ux card-col 回归守卫
const st = fs.readFileSync(path.join(SRC, 'pages', 'settings', 'settings.ux'), 'utf8');
const sd = definedClasses(splitUx(st).style);
if (!sd.has('card-col')) { fail++; console.log('FAIL settings.ux: 缺 .card-col 定义'); }
else if (!/\.card-col\s*\{[^}]*flex-direction:\s*column/.test(st.replace(/\/\*[\s\S]*?\*\//g, ''))) {
  fail++; console.log('FAIL settings.ux: .card-col 未显式声明 flex-direction: column');
} else {
  console.log('ok   settings.ux: .card-col 显式 column ✓');
}

console.log(fail ? `\n${fail} 项失败` : '\n全部通过');
process.exit(fail ? 1 : 0);

#!/usr/bin/env node
/**
 * v1.10.0 页面回归测试 —— 全页字号深度优化
 * 1) 全页面 font-size ≥ 18px（比 v1.9.0 的 ≥16 更严）
 * 2) 显式 line-height ≥ font-size × 1.25（文字遮掩根修；垂直居中按钮模式豁免）
 * 3) 本轮修复点回归：issue 头像 32 / trending rank 28 / code 行号行高对齐 / 通知页补齐
 * 4) 版本一致性 manifest 1.10.0 / 20
 */
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
let passed = 0, failed = 0;
function t(name, cond) { if (cond) { passed++; } else { failed++; console.log('  FAIL: ' + name); } }
const pages = fs.readdirSync(path.join(ROOT, 'src/pages')).filter(d =>
  fs.existsSync(path.join(ROOT, 'src/pages', d, d + '.ux')));
const styleOf = f => {
  const s = fs.readFileSync(f, 'utf8');
  const m = s.match(/<style>([\s\S]*)<\/style>/);
  return m ? m[1] : '';
};
const blocks = css => {
  const out = [];
  const re = /\.([a-zA-Z0-9_-]+)\s*\{([^}]*)\}/g; let m;
  while ((m = re.exec(css))) out.push({ cls: m[1], body: m[2] });
  return out;
};

// 1) 全页字号 ≥ 18
let small = [];
for (const d of pages) {
  const f = path.join(ROOT, 'src/pages', d, d + '.ux');
  for (const b of blocks(styleOf(f))) {
    const m = b.body.match(/font-size:\s*(\d+)px/);
    if (m && parseInt(m[1]) < 18) small.push(`${d}.${b.cls}=${m[1]}`);
  }
}
t('全页面 font-size ≥ 18px（发现违例: ' + small.join(',') + '）', small.length === 0);

// 2) 行高 ≥ 字号 × 1.25（显式声明行高且非垂直居中模式）
let badLh = [];
for (const d of pages) {
  const f = path.join(ROOT, 'src/pages', d, d + '.ux');
  for (const b of blocks(styleOf(f))) {
    const mf = b.body.match(/font-size:\s*(\d+)px/);
    const ml = b.body.match(/line-height:\s*(\d+)px/);
    if (!mf || !ml) continue;
    const fs = parseInt(mf[1]), lh = parseInt(ml[1]);
    const mh = b.body.match(/(?<![\w-])height:\s*(\d+)px/);
    if (mh && parseInt(mh[1]) === lh) continue; // 垂直居中按钮豁免
    if (lh < fs * 1.25) badLh.push(`${d}.${b.cls}: fs=${fs} lh=${lh}`);
  }
}
t('显式行高 ≥ 字号×1.25（违例: ' + badLh.join(',') + '）', badLh.length === 0);

// 3) 修复点回归
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
t('issue 头像放大 32px 适配 20px 字母', /\.ava \{ width: 32px; height: 32px; border-radius: 16px;/.test(read('src/pages/issue/issue.ux')));
t('trending rank 列宽 28px 适配 22px 数字', /\.rank \{ width: 28px;/.test(read('src/pages/trending/trending.ux')));
t('code 行号/代码/词元行高统一 26', /\.ln \{[^}]*line-height: 26px/.test(read('src/pages/code/code.ux')) &&
  /\.code-line \{[^}]*line-height: 26px/.test(read('src/pages/code/code.ux')));
t('ai 思考块行高 29（fs20）', /\.think-b \{[^}]*line-height: 29px/.test(read('src/pages/ai/ai.ux')));
t('ai 气泡行高 30（fs21）', /\.bub-u \{[^}]*line-height: 30px/.test(read('src/pages/ai/ai.ux')));
t('通知页 gh-muted ≥19', /\.gh-muted \{ font-size: 19px/.test(read('src/pages/notifications/notifications.ux')));
t('通知页 cell-ci ≥18', /\.cell-ci \{ font-size: 18px/.test(read('src/pages/notifications/notifications.ux')));
t('输入页确认按钮垂直居中模式保留（line-height:48px）', /\.done-btn \{[^}]*line-height: 48px/.test(read('src/pages/input/input.ux')));
t('md 正文块行高 30（fs21）', /\.b-p \{ font-size: 21px; line-height: 30px/.test(read('src/pages/issue/issue.ux')));

// 4) 版本一致性
const man = read('src/manifest.json');
t('manifest versionName 1.10.0（兼容分支后缀）', /"versionName": "1\.10\.0(-[a-z]+)?"/.test(man));
t('manifest versionCode 20', man.includes('"versionCode": 20'));
t('settings 版本标签同步', /GitHub for Vela v1\.10\.0(-[a-z]+)?/.test(read('src/pages/settings/settings.ux')));
t('package.json 1.10.0（兼容分支后缀）', /"version": "1\.10\.0(-[a-z]+)?"/.test(read('package.json')));

console.log(`===== ${passed} passed, ${failed} failed =====`);
process.exit(failed ? 1 : 0);

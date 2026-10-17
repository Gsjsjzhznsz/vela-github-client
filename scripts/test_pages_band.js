#!/usr/bin/env node
/**
 * band 分支页面回归测试 —— BDS-192（手环 9/10/11 标准版 192×490 / 212×520 / 224×528）
 * 1) 全页面 font-size ≥ 13px（bandQQ 校准：主 20/次 16/弱 14，微文本 13）
 * 2) 显式 line-height ≥ font-size × 1.25（垂直居中按钮模式豁免）
 * 3) BDS-192 关键回归点（键盘 216 / 页头 56 / 宫格 82 / 气泡 140 / md avail 138·158）
 * 4) 版本一致性 manifest 2.0.1-band / 31 / designWidth 192
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

// 1) 全页字号 ≥ 13
let small = [];
for (const d of pages) {
  const f = path.join(ROOT, 'src/pages', d, d + '.ux');
  for (const b of blocks(styleOf(f))) {
    const m = b.body.match(/font-size:\s*(\d+)px/);
    if (m && parseInt(m[1]) < 13) small.push(`${d}.${b.cls}=${m[1]}`);
  }
}
t('全页面 font-size ≥ 13px（发现违例: ' + small.join(',') + '）', small.length === 0);

// 2) 行高 ≥ 字号 × 1.25
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

// 3) BDS-192 关键回归点
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
t('input kb-dock 216 = KB_H_RECT', /\.kb-dock \{[^}]*height: 216px/.test(read('src/pages/input/input.ux')));
t('input top-bar 56 与全页页头一致', /\.top-bar \{ height: 56px/.test(read('src/pages/input/input.ux')));
t('InputMethod KB_H_RECT=216（28拼音行+44动作行+144字母区）', /var KB_H_RECT = 216;/.test(read('src/components/InputMethod/InputMethod.ux')));
t('InputMethod rect 分支 188 高（44+144）', /screentype==='rect'\}\}" style="width: 100%;height: 188px/.test(read('src/components/InputMethod/InputMethod.ux')));
t('键盘字母键 48×48 fs24', /\.calbtn67 \{[^}]*width:48px;[^}]*height:48px;/.test(read('src/components/InputMethod/InputMethod.ux').replace(/\n\s*/g, '')) && /font-size:24px/.test(read('src/components/InputMethod/InputMethod.ux')));
t('键盘候选条定宽 86（固件 flex:1 不收缩根修）', /width: 86px;height: 44px/.test(read('src/components/InputMethod/InputMethod.ux')));
t('键盘动作键 t9 方图 44×44', /t9\/bigA\.png" style="padding: 4px;margin-left: 3px;width:44px;height:44px/.test(read('src/components/InputMethod/InputMethod.ux')));
t('home 页头 56（BDS-192）', /\.hd \{ height: 56px/.test(read('src/pages/home/home.ux')));
t('home 主文本 20', /\.row1 \{ font-size: 20px/.test(read('src/pages/home/home.ux')));
t('issue 头像 30 适配 17px 字母', /\.ava \{ width: 30px; height: 30px; border-radius: 15px;/.test(read('src/pages/issue/issue.ux')));
t('trending rank 列宽 30', /\.rank \{ width: 30px;/.test(read('src/pages/trending/trending.ux')));
t('code 行号/代码/token 行高统一 22', /\.ln \{[^}]*line-height: 22px/.test(read('src/pages/code/code.ux')) &&
  /\.code-line \{[^}]*line-height: 22px/.test(read('src/pages/code/code.ux')) &&
  /\.tk \{[^}]*line-height: 22px/.test(read('src/pages/code/code.ux')));
t('ai 气泡宽 140（192 屏半幅）', /\.bub-u \{[^}]*width: 140px/.test(read('src/pages/ai/ai.ux')) && /\.bub-a \{[^}]*width: 140px/.test(read('src/pages/ai/ai.ux')));
t('ai 底部输入条 68（触区适配）', /\.inbar \{[^}]*height: 68px/.test(read('src/pages/ai/ai.ux')));
t('device 授权码 30（8 位码 192 宽放得下）', /\.code \{ font-size: 30px/.test(read('src/pages/device/device.ux')));
t('repo 宫格 2 列 82×76', /\.gcell \{ width: 82px; height: 76px/.test(read('src/pages/repo/repo.ux')));
t('md.js H_TABLE 对齐页面块类（p fs17/lh23）', /p: \{ fs: 17, lh: 23/.test(read('src/utils/md.js')));
t('md.js 192 可用宽度（代码 138/正文 158）', /b\.t === 'c' \? 138 : 158/.test(read('src/utils/md.js')));
t('通知页触底阈值 96（单项约 64px）', /this\.flat\.length \* 96 - 300/.test(read('src/pages/notifications/notifications.ux')));
t('通知下拉阈值 56（原 80 同比缩放）', /this\.pullY > 56/.test(read('src/pages/notifications/notifications.ux')));

// 4) 版本与设计宽度
const man = read('src/manifest.json');
t('manifest versionName 2.0.1-band', /"versionName": "2\.0\.1-band"/.test(man));
t('manifest versionCode 30（四分支同步）', /"versionCode": 31/.test(man));
t('manifest designWidth 192（经典手环原生宽）', /"designWidth": 192/.test(man));
t('package.json 2.0.1-band', /"version": "2\.0\.1-band"/.test(read('package.json')));

// 5) 无 336 残留检查
let leak = [];
for (const d of pages) {
  const f = path.join(ROOT, 'src/pages', d, d + '.ux');
  const s = read(path.join('src/pages', d, d + '.ux'));
  if (/\b(96|46)px;/.test(s.match(/<style>[\s\S]*<\/style>/)[0]) && /\.hd \{[^}]*height: 96px/.test(s)) leak.push(d);
}
t('无 336 系页头残留', leak.length === 0);

console.log(`\nband BDS-192 回归: ${passed} 通过, ${failed} 失败`);
process.exit(failed ? 1 : 0);

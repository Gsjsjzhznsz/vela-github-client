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
/* v2.0.3：键盘逐字照搬 BandQQ main 分支（pill-shaped 192 原生布局），断言同步换轨 */
t('input kb-dock 333 = KB_H_PILL（BandQQ main 照搬）', /\.kb-dock \{[^}]*height: 333px/.test(read('src/pages/input/input.ux')));
t('input screentype=pill-shaped', /screentype="pill-shaped"/.test(read('src/pages/input/input.ux')));
t('input top-bar 64 与全页页头一致（R角二轮）', /\.top-bar \{ height: 64px/.test(read('src/pages/input/input.ux')));
t('InputMethod KB_H_PILL=333（28拼音行+305键区，BandQQ main）', /var KB_H_PILL = 333;/.test(read('src/components/InputMethod/InputMethod.ux')));
t('InputMethod pill 分支 305 高', /screentype==='pill-shaped'\}\}" style="width: 100%;height: 305px/.test(read('src/components/InputMethod/InputMethod.ux')));
t('InputMethod 与 BandQQ main 零漂移（除 initlang 增量；参照缺失时跳过）', (() => {
  const norm = x => x
    .replace(/\/\* vgc v1\.1\.3[\s\S]*?\*\//g, '')
    .replace(/,\s*initlang: \{\s*default: "cn",\s*\}/, '')
    .replace(/if \(this\.initlang && [\s\S]*?this\.lang = this\.initlang;\s*\}/, '')
    .replace(/\n[ \t]*(?=\n)/g, '');
  const fsx = require('fs');
  const ref = '/home/z/my-project/work/bandqq-main/band-qq/src/components/InputMethod/InputMethod.ux';
  if (!fsx.existsSync(ref)) { console.log('    [skip] BandQQ 参照不存在（回滚丢失）'); return true; }
  return norm(read('src/components/InputMethod/InputMethod.ux')) === norm(fsx.readFileSync(ref, 'utf8'));
})());
t('键盘 pill 66 键 60×60 fs32（BandQQ 原生）', /\.calbtn66 \{[\s\S]*?width:60px;[\s\S]*?height:60px;/.test(read('src/components/InputMethod/InputMethod.ux').replace(/\n\s*/g, '')));
t('键盘候选条 cvalWaiting 144（BandQQ pill 原生）', /id="cvalWaiting" scroll-x="{{true}}" style="position: absolute;left: 15px;top: 56px;width: 144px/.test(read('src/components/InputMethod/InputMethod.ux')));
t('home 页头 60（BDS-192 R角二轮）', /\.hd \{ height: 60px/.test(read('src/pages/home/home.ux')));
t('home 主文本 20', /\.row1 \{ font-size: 20px/.test(read('src/pages/home/home.ux')));
t('issue 头像 30 适配 17px 字母', /\.ava \{ width: 30px; height: 30px; border-radius: 15px;/.test(read('src/pages/issue/issue.ux')));
t('trending rank 列宽 26', /\.rank \{ width: 26px;/.test(read('src/pages/trending/trending.ux')));
t('code 行号/代码/token 行高统一 22', /\.ln \{[^}]*line-height: 22px/.test(read('src/pages/code/code.ux')) &&
  /\.code-line \{[^}]*line-height: 22px/.test(read('src/pages/code/code.ux')) &&
  /\.tk \{[^}]*line-height: 22px/.test(read('src/pages/code/code.ux')));
t('ai 气泡宽 140（192 屏半幅）', /\.bub-u \{[^}]*width: 140px/.test(read('src/pages/ai/ai.ux')) && /\.bub-a \{[^}]*width: 140px/.test(read('src/pages/ai/ai.ux')));
t('ai 底部输入条 64 胶囊悬浮（R角适配）', /\.inbar \{[^}]*height: 64px[^}]*border-radius: 32px/.test(read('src/pages/ai/ai.ux')));
t('device 授权码 22+内边12（156px 稳落 168px 内容区）', /\.code \{ font-size: 22px/.test(read('src/pages/device/device.ux')) && /\.codebox \{[^}]*padding: 10px 12px/.test(read('src/pages/device/device.ux')));
t('formPost 走 rawFetch 网桥编排（免打字砍网根修）', /return rawFetch\(\{[\s\S]*?method: 'POST'/.test(read('src/utils/api.js')));
t('formPost 显式超时 15s', /const FORM_TIMEOUT = 15000;/.test(read('src/utils/api.js')));
t('R角二轮：子页页头 64 顶垫14 侧垫16（trending/settings/input 同款）', /\.hd \{ height: 64px[^}]*padding: 14px 16px 0/.test(read('src/pages/trending/trending.ux')) && /\.top-bar \{ height: 64px[^}]*padding: 14px 16px 0/.test(read('src/pages/input/input.ux')));
t('R角：pad-end 尾部缓冲 44', /\.pad-end \{ width: 100%; height: 44px/.test(read('src/pages/home/home.ux')));
t('固件根修：ai.ux 无 div 级 show + .ghost（70184c4 漏提交回填防丢）', !/<div[^>]*show=/.test(read('src/pages/ai/ai.ux')) && /\.ghost \{ display: none; \}/.test(read('src/pages/ai/ai.ux')));
t('固件根修：code/notifications ghost 转换点在位', (read('src/pages/code/code.ux').match(/' : 'ghost'/g) || []).length >= 5 && (read('src/pages/notifications/notifications.ux').match(/' : 'ghost'/g) || []).length >= 3);
t('R角二轮：返回钮去负边距（ml 2，notifications 特例 0）', /\.hd-act-wrap \{[^}]*margin-left: 2px/.test(read('src/pages/settings/settings.ux')) && /margin-left: 0px/.test(read('src/pages/notifications/notifications.ux')) && !/margin-left: -6px/.test(read('src/pages/settings/settings.ux')) && !/margin-left: -8px/.test(read('src/pages/about/about.ux')));
t('repo 功能区 BandQQ 式列表行（宫格退役）', /\.mrow \{ flex-direction: row/.test(read('src/pages/repo/repo.ux')));
t('md.js H_TABLE 对齐页面块类（p fs17/lh23）', /p: \{ fs: 17, lh: 23/.test(read('src/utils/md.js')));
t('md.js 192 可用宽度（代码 138/正文 158）', /b\.t === 'c' \? 138 : 158/.test(read('src/utils/md.js')));
t('通知页触底阈值 96（单项约 64px）', /this\.flat\.length \* 96 - 300/.test(read('src/pages/notifications/notifications.ux')));
t('通知下拉阈值 56（原 80 同比缩放）', /this\.pullY > 56/.test(read('src/pages/notifications/notifications.ux')));

// 4) 版本与设计宽度
const man = read('src/manifest.json');
t('manifest versionName 2.1.2-band', /"versionName": "2\.1\.2-band"/.test(man));
t('manifest versionCode 42（四分支同步）', /"versionCode": 42/.test(man));
t('manifest designWidth 192（经典手环原生宽）', /"designWidth": 192/.test(man));
t('package.json 2.1.2-band', /"version": "2\.1\.2-band"/.test(read('package.json')));

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

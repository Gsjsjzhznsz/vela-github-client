/**
 * test_pages_v190.js — v1.9.0 页面静态检查
 * 覆盖：
 *  ① manifest：1.9.0/19 + system.interconnect feature + pages/pulls 路由
 *  ② 通知中心深度优化：全页字号 ≥16px、芯片 flex-wrap、静音体系（MUTE_KEY/
 *     loadMuted/saveMuted/actMute/actRepoRead/gh-muted/actrow）、死代码提示行移除
 *  ③ 关于页：作者一秋 + QQ群 885186458（与 BandQQ 同步）+ 问题反馈卡 + v1.9.0
 *  ④ 设置页：网络通道卡（cycleBridge/detectBridge/syncBridge）+ v1.9.0 + 模板闭合平衡
 *  ⑤ pulls 页：结构完整（tabs/badges/openPull→issue 详情）+ getRepoPulls + 模板闭合
 *  ⑥ repo 页：PR 格 + 订阅三态（goPulls/toggleSub/checkSub）
 *  ⑦ issue 页：关闭/重开（toggleIssueState/patchIssueState/patching）
 *  ⑧ bridge.js：v3 caps/ack/握手/分片 ACK 语义/UTF-8 解码/无第三方解压库
 *  ⑨ api.js：网桥编排（三模式/sticky/持久化键/默认导出齐）
 */
const fs = require('fs')
const path = require('path')
const { assert, assertEq, test, summary } = require('./test_utils')

const ROOT = path.join(__dirname, '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

const _tests = []
function T(name, fn) { _tests.push(test(name, fn)) }

function tagBalance(ux) {
  const tpl = ux.split('<template>')[1].split('</template>')[0]
  let depth = 0
  const re = /<div\b|<\/div>|<scroll\b|<\/scroll>/g
  let m
  while ((m = re.exec(tpl))) {
    if (m[0] === '<div' || m[0] === '<scroll') depth++
    else depth--
    if (depth < 0) return false
  }
  return depth === 0
}

function minFont(ux) {
  let min = 999
  const re = /font-size:\s*(\d+)px/g
  let m
  while ((m = re.exec(ux))) min = Math.min(min, Number(m[1]))
  return min
}

const manifest = JSON.parse(read('src/manifest.json'))

/* ---------------- ① manifest ---------------- */
T('① manifest：interconnect feature + pulls 路由（版本号一致性由 v110 套件守门）', () => {
  assert(/^\d+\.\d+\.\d+(-[a-z]+)?$/.test(manifest.versionName || ''), 'versionName 格式在案（具体值由最新套件断言）')
  assert(manifest.versionCode >= 19, 'versionCode 结构在案（具体值由最新套件断言）')
  const feats = manifest.features.map((f) => f.name)
  assert(feats.indexOf('system.interconnect') >= 0, 'system.interconnect feature')
  assert(manifest.router.pages['pages/pulls'] && manifest.router.pages['pages/pulls'].component === 'pulls', 'pages/pulls 路由')
})

/* ---------------- ② 通知中心 ---------------- */
T('②a 通知中心：全页字号 ≥16px（用户实测 13-14px 不可读）', () => {
  const ux = read('src/pages/notifications/notifications.ux')
  const min = minFont(ux)
  assert(min >= 16, '最小字号 ' + min + 'px < 16px')
})
T('②b 通知中心：芯片 flex-wrap 两行 + 关键控件齐备', () => {
  const ux = read('src/pages/notifications/notifications.ux')
  assert(/\.chips\s*\{[^}]*flex-wrap:\s*wrap/.test(ux), 'chips flex-wrap')
  assert(ux.indexOf('gh-muted') >= 0, '静音徽标样式')
  assert(ux.indexOf('actrow') >= 0 && ux.indexOf('actbtn') >= 0, '组内操作行')
  assert(ux.indexOf('actMute') >= 0 && ux.indexOf('actRepoRead') >= 0, '静音/整仓已读处理器')
  assert(ux.indexOf('cell-meta') >= 0 && ux.indexOf('cell-ci') >= 0, 'CI 徽章')
  assert(tagBalance(ux), '模板闭合平衡')
})
T('②c 通知中心：本地静音持久化 + 分组开合记忆 + 死代码清理', () => {
  const ux = read('src/pages/notifications/notifications.ux')
  assert(ux.indexOf("MUTE_KEY = 'notif_muted_repos'") >= 0, 'MUTE_KEY')
  assert(ux.indexOf('loadMuted') >= 0 && ux.indexOf('saveMuted') >= 0, '静音读写')
  assert(ux.indexOf('isMuted') >= 0, 'isMuted 判定')
  assert(ux.indexOf('_openOverride') >= 0, '开合记忆')
  assert(ux.indexOf('参与项已全部已读') < 0 && ux.indexOf('点「全部」芯片恢复') < 0, '死代码提示行已移除')
  assert(ux.indexOf('已静音') >= 0 && ux.indexOf('静音此仓库') >= 0, '静音文案')
})

/* ---------------- ③ 关于页 ---------------- */
T('③ 关于页：联系方式与 BandQQ 同步（一秋 / QQ群 885186458）', () => {
  const ux = read('src/pages/about/about.ux')
  assert(ux.indexOf('一秋') >= 0, '作者卡：一秋')
  assert(ux.indexOf('QQ群 885186458') >= 0, '联系方式卡：QQ群（与 BandQQ 一致）')
  assert(ux.indexOf('问题反馈（点击复制链接）') >= 0, '旧联系方式卡更名问题反馈')
  assert(ux.indexOf('v1.9.0') >= 0, '版本行 1.9.0')
  assert(ux.indexOf('github.com/Gsjsjzhznsz/vela-github-client') >= 0, '仓库卡保留')
  assert(tagBalance(ux), '模板闭合平衡')
})

/* ---------------- ④ 设置页 ---------------- */
T('④ 设置页：网络通道三态卡 + 检测 + 模板平衡修复', () => {
  const ux = read('src/pages/settings/settings.ux')
  assert(ux.indexOf('网络通道') >= 0, '网络通道卡')
  assert(ux.indexOf('cycleBridge') >= 0, '三态切换')
  assert(ux.indexOf('detectBridge') >= 0 && ux.indexOf('bridgeDiagnoseHost') >= 0, '检测 + 诊断')
  assert(ux.indexOf('syncBridge') >= 0 && ux.indexOf('bridgeModeLabel') >= 0, '状态同步')
  assert(ux.indexOf('v1.9.0') >= 0, '版本 1.9.0')
  assert(ux.indexOf('AstroBox FetchBridge') >= 0, '网桥说明文案')
  assert(tagBalance(ux), '模板闭合平衡（v1.8 遗留多余 </div> 已修）')
})

/* ---------------- ⑤ pulls 页 ---------------- */
T('⑤ pulls 页：列表结构 + Draft/Merged 徽章 + 复用 issue 详情', () => {
  const ux = read('src/pages/pulls/pulls.ux')
  assert(ux.indexOf('api.getRepoPulls') >= 0, 'getRepoPulls 调用')
  assert(ux.indexOf("switchState('open')") >= 0 && ux.indexOf("switchState('closed')") >= 0, '开放/已关闭 tab')
  assert(ux.indexOf('Draft') >= 0 && ux.indexOf('Merged') >= 0, 'Draft/Merged 徽章')
  assert(ux.indexOf("router.push({ uri: 'pages/issue' })") >= 0, '详情复用 issue 页')
  assert(ux.indexOf('pull.png') >= 0, 'PR 图标')
  assert(minFont(ux) >= 16, '字号 ≥16px')
  assert(tagBalance(ux), '模板闭合平衡')
})

/* ---------------- ⑥ repo 页 ---------------- */
T('⑥ repo 页：PR 格 + 订阅三态格', () => {
  const ux = read('src/pages/repo/repo.ux')
  assert(ux.indexOf('goPulls') >= 0 && ux.indexOf('pages/pulls') >= 0, 'PR 格与跳转')
  assert(ux.indexOf('toggleSub') >= 0 && ux.indexOf('checkSub') >= 0, '订阅三态')
  assert(ux.indexOf("'ignore'") >= 0, 'ignore 态（源头降噪）')
  assert(ux.indexOf('bell.png') >= 0, '订阅图标')
  assert(tagBalance(ux), '模板闭合平衡')
})

/* ---------------- ⑦ issue 页 ---------------- */
T('⑦ issue 页：关闭/重开入口', () => {
  const ux = read('src/pages/issue/issue.ux')
  assert(ux.indexOf('toggleIssueState') >= 0, '切换处理器')
  assert(ux.indexOf('api.patchIssueState') >= 0, 'PATCH 调用')
  assert(ux.indexOf('patching') >= 0, '防重入标志')
  assert(ux.indexOf('关闭此 Issue') >= 0 && ux.indexOf('重新打开此 Issue') >= 0, '文案')
})

/* ---------------- ⑧ bridge.js ---------------- */
T('⑧ bridge.js：v3 caps + ACK 窗口 + 纯 JS 解码（零第三方库）', () => {
  const s = read('src/utils/bridge.js')
  assert(s.indexOf("@system.interconnect") >= 0, 'interconnect 传输层')
  assert(s.indexOf('version: 3') >= 0 && s.indexOf('ack: true') >= 0, 'v3 + ACK 声明')
  assert(s.indexOf("'__hs__'") >= 0 && s.indexOf("'fetch-chunk'") >= 0 && s.indexOf("'fetch-ack'") >= 0, '协议 tag')
  assert(s.indexOf('maxChunkSize: 4096') >= 0, '分片 4096')
  assert(s.indexOf('bytesUtf8') >= 0 && s.indexOf('hexBytes') >= 0 && s.indexOf('b64Bytes') >= 0, '解码器齐备')
  assert(s.indexOf('followRedirects: true') >= 0, '跟随重定向')
  assert(/require\('@system\.interconnect'\)/.test(s), 'require 注入（固件缺失时静默禁用）')
  assert(!/\brequire\(['"](pako|lz4js|fflate)/.test(s) && !/from ['"](pako|lz4js|fflate)['"]/.test(s), '不引入解压库（体积约束）')
  assert(s.indexOf("encodings: ['text', 'base64', 'hex']") >= 0, '编码偏好 text 优先')
})

/* ---------------- ⑨ api.js ---------------- */
T('⑨ api.js：网桥编排 + 模式持久化 + 默认导出齐', () => {
  const s = read('src/utils/api.js')
  assert(s.indexOf("from './bridge'") >= 0, 'bridge 导入')
  assert(s.indexOf('BRIDGE_MODE_KEY') >= 0 && s.indexOf('gh_bridge_mode') >= 0, '持久化键')
  assert(s.indexOf('_bridgeSticky') >= 0, 'sticky 切换')
  assert(s.indexOf('function directFetch') >= 0, '直连栈改名保留')
  assert(s.indexOf("mode === 'bridge'") >= 0 && s.indexOf("mode === 'auto'") >= 0, '三模式编排')
  assert(s.indexOf('export function bridgeInfo') >= 0 && s.indexOf('export function bridgeSetMode') >= 0, '管理导出')
  assert(s.indexOf('bridgeInfo, bridgeSetMode, bridgeDetect, bridgeDiagnoseHost,') >= 0, '默认导出注册（gh.js 桥可见）')
  assert(s.indexOf('export function getRepoPulls') >= 0 && s.indexOf('patchIssueState') >= 0 && s.indexOf('setRepoSubscription') >= 0, '新功能 API 导出')
})

/* ---------------- 尾部 ---------------- */
;(async () => { for (const t of _tests) await t; summary() })()

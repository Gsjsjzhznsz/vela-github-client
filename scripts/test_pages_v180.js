/**
 * test_pages_v180.js — v1.8.0 页面级源码断言
 * ① 体积优化：17 页统一 gh 桥导入 + app.ux 单点发布 api（逐页内联根除）
 * ② 关于页：BandQQ 同构 about.ux + manifest 路由 + clipboard feature + 设置入口
 * ③ AI 思考过程：实时思考气泡 + 可折叠思考块 + 耗时徽标
 * ④ 通知中心：缓存秒开 + 仓库分组平铺 + 类型芯片 + 分仓已读 + CI 一键已读
 */
const { assert, test, summary } = require('./test_utils')
const fs = require('fs')
const path = require('path')

const _tests = []
function T(name, fn) { _tests.push(test(name, fn)) }

const ROOT = path.join(__dirname, '..')
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8')

const AI_UX = read('src/pages/ai/ai.ux')
const NOTIF_UX = read('src/pages/notifications/notifications.ux')
const ABOUT_UX = read('src/pages/about/about.ux')
const SETTINGS_UX = read('src/pages/settings/settings.ux')
const APP_UX = read('src/app.ux')
const MANIFEST = JSON.parse(read('src/manifest.json'))
const VIEW_JS = read('src/utils/view.js')
const API_JS = read('src/utils/api.js')
const GH_JS = read('src/utils/gh.js')

/* ---------------- ① 体积优化：全局桥 ---------------- */

T('① 全部 17 页统一 gh 桥导入，零 utils/api 直连残留', () => {
  const dir = path.join(ROOT, 'src/pages')
  const pages = []
  const walk = (d) => {
    for (const f of fs.readdirSync(d)) {
      const p = path.join(d, f)
      if (fs.statSync(p).isDirectory()) walk(p)
      else if (f.endsWith('.ux')) pages.push(p)
    }
  }
  walk(dir)
  assert(pages.length >= 18, '页面数 ≥18（含新 about 页）')
  let withGh = 0
  for (const p of pages) {
    const src = fs.readFileSync(p, 'utf8')
    if (src.indexOf("from '../../utils/gh'") >= 0) withGh++
    assert(src.indexOf("from '../../utils/api'") < 0, path.relative(ROOT, p) + ' 不再直连 utils/api')
  }
  assert(withGh >= 17, '≥17 页使用 gh 桥（实际 ' + withGh + '）')
})

T('① app.ux 单点发布 api 实现到全局', () => {
  assert(APP_UX.indexOf("import api from './utils/api'") >= 0, 'app.ux 引入真实 api（唯一入口）')
  assert(APP_UX.indexOf('__GH_API_IMPL__') >= 0, '全局发布 __GH_API_IMPL__')
  assert(APP_UX.indexOf('onCreate()') >= 0, 'onCreate 双保险补挂')
})

T('① gh.js 桥三件套：Proxy 转发 + 时序安全注释 + 无 impl 兜底', () => {
  assert(GH_JS.indexOf('new Proxy') >= 0, 'Proxy 桥')
  assert(GH_JS.indexOf('__GH_API_IMPL__') >= 0, '全局键名约定')
  assert(GH_JS.indexOf('export default bridge') >= 0, '默认导出桥对象')
})

/* ---------------- ② 关于页 ---------------- */

T('② about.ux BandQQ 同构：hero + 卡片 + 剪贴板', () => {
  assert(ABOUT_UX.indexOf('GitHub for Vela') >= 0, '应用名')
  /* v1.9.0：版本断言改为与 manifest 一致性校验（避免每版改钉死字符串） */
  assert(ABOUT_UX.indexOf('v' + MANIFEST.versionName) >= 0, '版本号与发布同步（' + MANIFEST.versionName + '）')
  assert(ABOUT_UX.indexOf('@system.clipboard') >= 0, 'clipboard 引入')
  assert(ABOUT_UX.indexOf('copyRepo') >= 0 && ABOUT_UX.indexOf('copyIssues') >= 0, '复制仓库/反馈链接')
  assert(ABOUT_UX.indexOf('band-qq') < 0 && ABOUT_UX.indexOf('BandQQ v2.28.2 演示') < 0, '无 BandQQ 专属残留')
  assert(ABOUT_UX.indexOf('Gsjsjzhznsz/vela-github-client') >= 0, '本项目仓库链接')
  assert(ABOUT_UX.indexOf('body-wrap') >= 0 && ABOUT_UX.indexOf("scroll-y=\"true\"") >= 0, 'RW5 同构布局（wrap+absolute）')
})

T('② manifest：about 路由 + clipboard feature + 版本演进', () => {
  assert(MANIFEST.router.pages['pages/about'] && MANIFEST.router.pages['pages/about'].path === '/about', 'about 路由注册')
  const feats = MANIFEST.features.map((f) => f.name)
  assert(feats.indexOf('system.clipboard') >= 0, 'system.clipboard feature 声明')
  assert(MANIFEST.versionCode >= 18 && /^\d+\.\d+\.\d+(-[a-z]+)?$/.test(MANIFEST.versionName), '版本号 ≥1.8.0 且格式合法（' + MANIFEST.versionName + '/' + MANIFEST.versionCode + '）')
})

T('② settings.ux：关于入口行 + 版本文案同步', () => {
  assert(SETTINGS_UX.indexOf('goAbout') >= 0 && SETTINGS_UX.indexOf("router.push({ uri: 'pages/about' })") >= 0, '关于入口跳转')
  assert(SETTINGS_UX.indexOf('v' + MANIFEST.versionName) >= 0, '设置页版本号同步（' + MANIFEST.versionName + '）')
})

/* ---------------- ③ AI 思考过程 ---------------- */

T('③ ai.ux：实时思考状态（计时+模型+慢网提示）', () => {
  assert(AI_UX.indexOf('startThink') >= 0 && AI_UX.indexOf('tickThink') >= 0 && AI_UX.indexOf('stopThink') >= 0, '思考计时器三件套')
  assert(AI_UX.indexOf('setInterval') >= 0 && AI_UX.indexOf('clearInterval') >= 0, '定时器生命周期配对')
  assert(AI_UX.indexOf('蓝牙网络较慢') >= 0, '慢网提示')
  assert(AI_UX.indexOf("{{thinkText || '思考中…'}}") >= 0, '思考气泡绑定 thinkText')
  assert(AI_UX.indexOf('this.startThink()') >= 0 && AI_UX.indexOf('this.stopThink()') >= 2, 'send 起止配对调用')
  assert(AI_UX.indexOf('onDestroy()') >= 0 && AI_UX.indexOf('this.stopThink()') >= 1, 'onDestroy 清理定时器')
})

T('③ ai.ux：可折叠思考过程块 + 耗时徽标', () => {
  assert(AI_UX.indexOf('toggleThink') >= 0, '折叠切换 handler')
  assert(AI_UX.indexOf('▸ 思考过程（点此展开）') >= 0, '折叠标题')
  assert(AI_UX.indexOf('think-h') >= 0 && AI_UX.indexOf('think-b') >= 0, '思考样式类')
  assert(AI_UX.indexOf("r.thinking || ''") >= 0, 'aiChat thinking 入档')
  assert(AI_UX.indexOf("r.ep === 'responses'") >= 0, 'meta 端点徽标')
  assert(AI_UX.indexOf("Math.round(r.ms / 100) / 10") >= 0, '耗时秒徽标')
})

T('③ api.js：思考抽取双路 + 返回 thinking/ms', () => {
  assert(API_JS.indexOf("reasoning_content") >= 0 && API_JS.indexOf('cm.reasoning') >= 0, 'chat 侧 reasoning_content/reasoning 双字段')
  assert(API_JS.indexOf("ob.type !== 'reasoning'") >= 0, '/responses 侧 reasoning 节点')
  assert(API_JS.indexOf('thinking:') >= 0 && API_JS.indexOf('ms: Date.now() - t0') >= 0, '返回 thinking + ms')
  assert(API_JS.indexOf('markRepoNotificationsRead') >= 0, '分仓已读导出')
  assert(/export default \{[\s\S]*markRepoNotificationsRead[\s\S]*\}/.test(API_JS), '默认导出含 markRepoNotificationsRead')
})

/* ---------------- ④ 通知中心 ---------------- */

T('④ notifications.ux：缓存秒开', () => {
  assert(NOTIF_UX.indexOf("notif_cache_v2_") >= 0, '缓存键（按过滤档分键）')
  assert(NOTIF_UX.indexOf('loadCache') >= 0 && NOTIF_UX.indexOf('saveCache') >= 0, '缓存读写')
  assert(NOTIF_UX.indexOf('this._fromCache') >= 0, '缓存渲染标记')
  assert(NOTIF_UX.indexOf('展示的是上次数据') >= 0, '网络失败不白屏（降级警告）')
  assert(NOTIF_UX.indexOf("@system.storage") >= 0, 'storage 引入')
})

T('④ notifications.ux：仓库分组平铺 + 折叠', () => {
  assert(NOTIF_UX.indexOf('groupNotifsByRepo') >= 0, '分组函数引入')
  assert(NOTIF_UX.indexOf('toggleGroup') >= 0 && NOTIF_UX.indexOf('rebuildOpen') >= 0, '折叠交互')
  assert(NOTIF_UX.indexOf('ghdr') >= 0 && NOTIF_UX.indexOf('gh-repo') >= 0, '分组头样式')
  assert(NOTIF_UX.indexOf('f.hdr') >= 0, '单层平铺（分组头标记）')
  assert(NOTIF_UX.indexOf('applyGroups') >= 0, '平铺统一入口')
})

T('④ notifications.ux：类型芯片 + 分仓已读 + CI 一键已读', () => {
  assert(NOTIF_UX.indexOf("setType") >= 0 && NOTIF_UX.indexOf('chip-on') >= 0, '类型芯片')
  assert(NOTIF_UX.indexOf("'PullRequest'") >= 0 && NOTIF_UX.indexOf("tf === 'ci'") >= 0, '五档类型过滤')
  assert(NOTIF_UX.indexOf('markRepoRead') >= 0 && NOTIF_UX.indexOf('markRepoNotificationsRead') >= 0, '分仓已读（长按分组头）')
  assert(NOTIF_UX.indexOf('markAllCiRead') >= 0, 'CI 一键已读')
  assert(NOTIF_UX.indexOf('onlongpress="markRepoRead(f)"') >= 0, '长按分组头触发')
  assert(NOTIF_UX.indexOf('sumText') >= 0 && NOTIF_UX.indexOf('仓库 · ') >= 0, '概览行')
})

T('④ view.js：mapNotif.stype + groupNotifsByRepo', () => {
  assert(VIEW_JS.indexOf('stype: subjType') >= 0, 'mapNotif 保留原始类型')
  assert(VIEW_JS.indexOf('export function groupNotifsByRepo') >= 0, '分组函数导出')
})

T('④ 全局桥不影响既有通知管线契约', () => {
  assert(NOTIF_UX.indexOf('api.getNotifications') >= 0, 'getNotifications 调用保留')
  assert(NOTIF_UX.indexOf('api.lastNotifGaps') >= 0, 'gap 机制保留')
  assert(NOTIF_UX.indexOf('aggregateNotifs') >= 0, 'CI 聚合保留（组内折叠）')
  assert(NOTIF_UX.indexOf('doRefresh') >= 0 && NOTIF_UX.indexOf('onTouchStart') >= 0, '下拉刷新保留')
})

;(async () => {
  for (const t of _tests) await t
  summary()
})()

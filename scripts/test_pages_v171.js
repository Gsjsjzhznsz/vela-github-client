/**
 * test_pages_v171.js — v1.7.1 AI 页体验根修（页面级源码断言）
 * ① openInput params 直传禁绝（本固件 router 不透传 params → 手动输入确认无反应根因）
 * ② 全屏授权门（未授权必须先授权）
 * ③ 全项目输入页调用方 hook 通道一致性
 */
const { assert, assertEq, test, summary } = require('./test_utils')
const fs = require('fs')
const path = require('path')

const _tests = []
function T(name, fn) { _tests.push(test(name, fn)) }

const AI_UX = fs.readFileSync(path.join(__dirname, '..', 'src/pages/ai/ai.ux'), 'utf8')
const INPUT_UX = fs.readFileSync(path.join(__dirname, '..', 'src/pages/input/input.ux'), 'utf8')
const PAGES_DIR = path.join(__dirname, '..', 'src/pages')

T('① openInput 不再 params 直传（hook 通道）', () => {
  assert(AI_UX.indexOf("router.push({ uri: 'pages/input', params:") < 0, 'params 直传已消除')
  assert(AI_UX.indexOf("this.$app.$def.hook = { type: 'ai' }") >= 0, 'hook 通道已建立')
  assert(AI_UX.indexOf("router.push({ uri: 'pages/input' })") >= 0, '裸 uri push')
})

T('② 全屏授权门：未授权必须先授权', () => {
  assert(/<div class="state" show="\{\{needCp\}\}">/.test(AI_UX), '授权门全屏拦截 needCp')
  assert(AI_UX.indexOf('gate-btn') >= 0 && AI_UX.indexOf('goCopilotAuth') >= 0, '一键授权按钮')
  assert(AI_UX.indexOf('cp-cta') < 0, '旧深埋授权卡已移除')
  assert(AI_UX.indexOf('github.com/login/device') >= 0, '授权指引文案')
})

T('② 报错路径弹授权门（needCopilot → needCp=true）', () => {
  const sendCatch = AI_UX.slice(AI_UX.indexOf('async send(text)'), AI_UX.indexOf('typewrite(m, full, idx)'))
  assert(sendCatch.indexOf('this.needCp = true') >= 0, 'send 失败弹门')
})

T('③ 全项目输入页调用方统一 hook 通道', () => {
  const callers = ['pages/search/search.ux', 'pages/settings/settings.ux',
    'pages/profile/profile.ux', 'pages/issue/issue.ux', 'pages/ai/ai.ux']
  for (const c of callers) {
    const src = fs.readFileSync(path.join(PAGES_DIR, c.replace('pages/', '')), 'utf8')
    assert(src.indexOf("hook = { type:") >= 0 || src.indexOf('hook = {}') >= 0, c + ' 使用 hook 通道')
    assert(src.indexOf("router.push({ uri: 'pages/input', params:") < 0, c + ' 无 params 直传')
  }
})

T('③ input.ux 确认契约：inputResult.type = this.mode（ai 页按 type===ai 消费）', () => {
  assert(INPUT_UX.indexOf("app.inputResult = { type: this.mode, text: raw }") >= 0, '回传契约不变')
  assert(INPUT_UX.indexOf("this.mode = p.type || 'search'") >= 0, 'mode 来自 query(p.type)')
})

;(async () => {
  for (const t of _tests) await t
  summary()
})()

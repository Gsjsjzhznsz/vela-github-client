/**
 * gh.js — api 全局单例桥（v1.8.0 体积优化核心）
 *
 * 背景：api.js（~120KB 源码，编译后 ~166KB）此前被 webpack 逐页内联进
 * 17 个页面 bundle（≈2.6MB 重复源码，占 rpk 未压缩体积的一半以上）。
 * v1.8.0 起 api.js 仅由 app.ux 引用一次（随 app.js 分发），并在模块求值时
 * 挂到 globalThis.__GH_API_IMPL__；页面统一 import 本桥，运行期把属性访问
 * 转发到真实实现——调用方代码零改动（api.foo(...) 语义不变）。
 *
 * 时序安全性：页面模块若先于 app.js 求值，Proxy 仍安全（属性访问只发生在
 * 页面生命周期方法内，必然晚于 app onCreate）；无 Proxy 的极旧引擎回退为
 * 求值时直接引用。
 */
const g = typeof globalThis !== 'undefined'
  ? globalThis
  : (typeof window !== 'undefined' ? window : {})

const impl = function () { return g.__GH_API_IMPL__ }

let bridge = null
if (typeof Proxy !== 'undefined') {
  bridge = new Proxy({}, {
    get: function (t, k) { const v = impl(); return v ? v[k] : undefined },
    has: function (t, k) { const v = impl(); return !!v && (k in v) },
    set: function (t, k, val) { const v = impl(); if (v) v[k] = val; return true }
  })
} else {
  bridge = impl() || {}
}

export default bridge

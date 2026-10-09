/**
 * test_utils.js — 通用测试基建（v1.1.4 重建，原版被沙箱重置清除）
 * 功能：ESM→CJS 加载器（依赖注入 @system.* mock）+ 断言助手
 */
const fs = require('fs')
const path = require('path')

/** 全局定时器加速：重试退避/超时 in 测试中全部压缩到 ≤5ms */
const _origST = global.setTimeout
global.setTimeout = (fn, ms, ...a) => _origST(fn, Math.min(ms || 0, 5), ...a)

/**
 * 把 ESM 源码转换为可在 Function 体里执行的 CJS 形态。
 * 策略：剥离 export 关键字（函数声明提升 + const 顺序执行均成立），
 * 收集导出名后在代码末尾统一 __exports.X = X（命名函数表达式不产生
 * 外层绑定，不能就地改赋值形式）。
 */
function transformEsm(src) {
  let code = src
  const names = []
  code = code.replace(/^import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/gm,
    (m, n, p) => `const ${n} = __req('${p}');`)
  code = code.replace(/^import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/gm,
    (m, names2, p) => `const {${names2}} = __req('${p}');`)
  code = code.replace(/^export\s+default\s+/gm, '__exports.default = ')
  code = code.replace(/^export\s+(async\s+)?function\s+(\w+)/gm,
    (m, aw, n) => { names.push(n); return (aw || '') + 'function ' + n })
  code = code.replace(/^export\s+const\s+(\w+)\s*=/gm,
    (m, n) => { names.push(n); return 'const ' + n + ' =' })
  code = code.replace(/^export\s+let\s+(\w+)\s*=/gm,
    (m, n) => { names.push(n); return 'let ' + n + ' =' })
  code += '\n' + names.map((n) => `try { __exports.${n} = ${n} } catch (e) {}`).join('\n')
  return code
}

/** 加载 utils 模块，mocks: { '@system.fetch': {...}, ... } */
function loadModule(relPath, mocks) {
  const abs = path.join(__dirname, '..', relPath)
  const src = fs.readFileSync(abs, 'utf8')
  const code = transformEsm(src)
  const exports = {}
  const req = (name) => {
    if (mocks && Object.prototype.hasOwnProperty.call(mocks, name)) return mocks[name]
    throw new Error('no mock for ' + name)
  }
  const fn = new Function('__req', '__exports', 'console', code)
  fn(req, exports, console)
  return exports
}

/* ---------------- 断言助手 ---------------- */
const results = { pass: 0, fail: 0, fails: [] }

function assert(cond, msg) {
  if (cond) { results.pass++ } else {
    results.fail++
    results.fails.push(msg)
    console.error('  ✗ ' + msg)
  }
}
function assertEq(actual, expected, msg) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) results.pass++
  else {
    results.fail++
    results.fails.push(msg + ' (actual=' + a + ', expected=' + e + ')')
    console.error('  ✗ ' + msg + ' (actual=' + a + ', expected=' + e + ')')
  }
}

async function test(name, fn) {
  try { await fn() } catch (e) {
    results.fail++
    results.fails.push(name + ' threw: ' + (e && e.message))
    console.error('  ✗ ' + name + ' threw: ' + (e && e.stack))
  }
}

function summary() {
  console.log('\n===== ' + results.pass + ' passed, ' + results.fail + ' failed =====')
  if (results.fail) {
    results.fails.forEach((f) => console.error('FAIL: ' + f))
    process.exit(1)
  }
}

module.exports = { loadModule, assert, assertEq, test, summary }

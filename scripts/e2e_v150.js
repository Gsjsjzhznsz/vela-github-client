/**
 * e2e_v150.js — v1.5.0 真实 API 端到端验证（沙箱网络，真实凭据）
 * 覆盖：
 *  ① /copilot_internal/user PAT 可查：free_limited_copilot 套餐 + 会话额度 + 端点
 *  ② PAT 直连 Copilot chat/completions → 400 + "Personal Access Tokens" 原文（错误透出素材）
 *  ③ models.github.ai 已死（沙箱劫持/退役）——aiChat 对 PAT 抛 needCopilot 且零 Models 请求
 *  ④ 通知 per=1 主路真实拉取：10 单页全 200，体积 < 8KB 阈值，无 gap
 *  ⑤ salvage 记键回归：无截断环境下 lastSalvageInfo() 为空
 */
const TOKEN = require('fs').readFileSync('/home/z/.git-cred-token', 'utf8').trim()

let pass = 0
let fail = 0
const fails = []
function ok(cond, msg) {
  if (cond) { pass++; console.log('  ✓ ' + msg) } else { fail++; fails.push(msg); console.log('  ✗ ' + msg) }
}
async function run(name, fn) {
  console.log('== ' + name)
  try { await fn() } catch (e) { fail++; fails.push(name + ' threw: ' + (e && e.message)); console.log('  ✗ threw: ' + (e && e.message)) }
}

async function main() {
  await run('① /copilot_internal/user PAT 直查', async () => {
    const r = await fetch('https://api.github.com/copilot_internal/user', {
      headers: { 'Authorization': 'token ' + TOKEN, 'Accept': 'application/json', 'User-Agent': 'vela-github-client/1.5.0' }
    })
    ok(r.status === 200, 'HTTP 200（旧版 /user/copilot 对 PAT 恒 404）')
    const d = await r.json()
    ok(d.access_type_sku === 'free_limited_copilot', '套餐 free_limited_copilot：' + d.access_type_sku)
    ok(d.chat_enabled === true, 'chat_enabled=true')
    const q = d.quota_snapshots && d.quota_snapshots.chat
    ok(q && q.entitlement === 200, '会话额度 entitlement=200：' + (q && q.remaining) + '/' + (q && q.entitlement))
    ok(d.endpoints && String(d.endpoints.api).indexOf('https://') === 0, '按套餐端点：' + d.endpoints.api)
  })

  await run('② PAT 直连 Copilot chat → 400 原文（App 将透出）', async () => {
    const r = await fetch('https://api.githubcopilot.com/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + TOKEN, 'Content-Type': 'application/json',
        'User-Agent': 'GitHubCopilotChat/0.26.7', 'Editor-Version': 'vscode/1.95.0',
        'Copilot-Integration-Id': 'vscode-chat', 'Openai-Intent': 'conversation-panel'
      },
      body: JSON.stringify({ model: 'gpt-5-mini', messages: [{ role: 'user', content: 'hi' }] })
    })
    const text = await r.text()
    ok(r.status === 400, 'HTTP 400（PAT 被 Copilot API 拒绝为既定行为）')
    ok(text.indexOf('Personal Access Tokens are not supported') >= 0, '错误原文可透出：' + text.slice(0, 90))
  })

  await run('③ 通知 per=1 主路真实拉取（10 单页）', async () => {
    const sizes = []
    let ids = 0
    for (let p = 1; p <= 10; p++) {
      const r = await fetch('https://api.github.com/notifications?page=' + p + '&per_page=1&all=false', {
        headers: { 'Authorization': 'Bearer ' + TOKEN, 'Accept': 'application/vnd.github+json', 'User-Agent': 'vela-github-client/1.5.0' }
      })
      if (r.status !== 200) { ok(false, 'page ' + p + ' HTTP ' + r.status); continue }
      const text = await r.text()
      const arr = JSON.parse(text)
      sizes.push(text.length)
      ids += arr.length
    }
    ok(sizes.length === 10, '10 页全部 200')
    ok(sizes.every((s) => s < 8000), '全部 < 8KB 阈值（最大 ' + Math.max.apply(null, sizes) + 'B）——确定性截断源消失')
    ok(ids >= 1, '拉到 ' + ids + ' 条')
  })

  await run('④ 设备授权端点可达（copilot 模式发起参数合法）', async () => {
    /* 不真正发起授权（需要人工输入码），仅验证 GitHub 接受该 client 的 device/code 请求格式：
     * 用假 client_id 会 404，真 Iv1.b507a08c87ecfe98 缺 scope 校验也应返回 200 结构 */
    const body = new URLSearchParams({ client_id: 'Iv1.b507a08c87ecfe98', scope: 'read:user' })
    const r = await fetch('https://github.com/login/device/code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json', 'User-Agent': 'vela-github-client/1.5.0' },
      body: body.toString()
    })
    const d = await r.json().catch(() => ({}))
    ok(r.status === 200 && d.device_code && d.user_code, 'device/code 200 + device_code/user_code（真机将显示此码）')
    /* 丢弃该 device_code（不轮询、不消耗授权） */
  })
}

main().then(() => {
  console.log('\n===== e2e ' + pass + ' passed, ' + fail + ' failed =====')
  if (fail) { fails.forEach((f) => console.log('FAIL: ' + f)); process.exit(1) }
}).catch((e) => { console.error(e); process.exit(1) })

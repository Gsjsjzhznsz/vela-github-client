#!/usr/bin/env bash
# port_v203.sh — 将 v2.0.3 通用修复（免打字授权 formPost 网桥化+超时+状态归因）移植到其余三分支
# 用法: bash scripts/port_v203.sh <band-pro|main|xiaomi-watch-s>
set -e
BR="$1"
cd /home/z/my-project/vela-github-client
git checkout "$BR" 2>&1 | tail -1

python3 - "$BR" <<'PYEOF'
import sys, re
br = sys.argv[1]
pro_style = br in ('band', 'band-pro')   # codemod 后的 Promise 链风格
main_style = br in ('main', 'xiaomi-watch-s')  # async/await 源码风格

# ---------- api.js: formPost → rawFetch ----------
p = 'src/utils/api.js'
s = open(p, encoding='utf-8').read()

hdr = """/* v2.0.3 根修：设备授权（免打字）此前直连裸调 fetch.fetch —— 两个致命伤：
 *  ① 完全绕过 AstroBox 网桥，砍网设备上 github.com/login/device/code
 *     直连永远不通/挂起 → 免打字界面永远停在「正在生成授权码…」；
 *  ② 无超时，网关半开挂起时 Promise 永不落定。
 * 现在统一走 rawFetch 三模式传输编排（bridge/auto/direct 与主请求同路），
 * 超时 15s（授权端点偶尔慢，比 FETCH_TIMEOUT 稍宽）。 */
const FORM_TIMEOUT = 15000;
"""

if pro_style:
    old = """function formPost(url, params) {
  const parts = [];
  for (const k in params) parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
  return new Promise((resolve, reject) => {
    try {
      fetch.fetch({
        url: url,
        method: 'POST',
        header: {
          'User-Agent': 'vela-github-client',
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        data: parts.join('&'),
        responseType: 'json',
        success: res => resolve(res),
        fail: (err, code) => reject({
          err: err,
          code: code
        })
      });
    } catch (e) {
      reject(e);
    }
  });
}"""
    new = hdr + """function formPost(url, params) {
  const parts = [];
  for (const k in params) parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
  return rawFetch({
    url: url,
    method: 'POST',
    header: {
      'User-Agent': 'vela-github-client',
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    data: parts.join('&'),
    rt: 'json',
    timeout: FORM_TIMEOUT
  });
}"""
else:
    old = """function formPost(url, params) {
  const parts = []
  for (const k in params) parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]))
  return new Promise((resolve, reject) => {
    try {
      fetch.fetch({
        url: url,
        method: 'POST',
        header: {
          'User-Agent': 'vela-github-client',
          Accept: 'application/json',
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        data: parts.join('&'),
        responseType: 'json',
        success: (res) => resolve(res),
        fail: (err, code) => reject({ err: err, code: code })
      })
    } catch (e) { reject(e) }
  })
}"""
    new = hdr + """function formPost(url, params) {
  const parts = []
  for (const k in params) parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]))
  return rawFetch({
    url: url,
    method: 'POST',
    header: {
      'User-Agent': 'vela-github-client',
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    data: parts.join('&'),
    rt: 'json',
    timeout: FORM_TIMEOUT
  })
}"""
assert s.count(old) == 1, br + ': formPost anchor not found'
s = s.replace(old, new)

# ---------- api.js: deviceFlowStart lastStatus 归因 ----------
if pro_style:
    a1 = """    let res = null;
    let attempt = 0;
    const _temp12 = _for(function () {"""
    b1 = """    let res = null;
    let lastStatus = 0; /* v2.0.3：记录最后一次 HTTP 状态，最终报错可归因 */
    let attempt = 0;
    const _temp12 = _for(function () {"""
    assert s.count(a1) == 1, br + ': loop head anchor'
    s = s.replace(a1, b1)

    a2 = """            res = _formPost;
            const dTry = jsonMaybe(res);
            if (res && Number(res.code) >= 200 && Number(res.code) < 300 && dTry && dTry.device_code) {
              _interrupt = true;
              return;
            }
            res = null;
          });"""
    b2 = """            res = _formPost;
            const dTry = jsonMaybe(res);
            if (res && Number(res.code) >= 200 && Number(res.code) < 300 && dTry && dTry.device_code) {
              _interrupt = true;
              return;
            }
            lastStatus = Number(res && res.code) || 0;
            res = null;
          });"""
    assert s.count(a2) == 1, br + ': then-body anchor'
    s = s.replace(a2, b2)

    a3 = """    function _temp13() {
      if (!res) throw {
        status: 0,
        message: '网络连接失败，请检查手环网络'
      };"""
    b3 = """    function _temp13() {
      if (!res) throw lastStatus >= 400 ? {
        status: lastStatus,
        message: '发起登录失败（HTTP ' + lastStatus + '），请重试'
      } : {
        status: 0,
        message: '网络连接失败，请检查手环网络'
      };"""
    assert s.count(a3) == 1, br + ': final throw anchor'
    s = s.replace(a3, b3)
else:
    a1 = """  let res = null
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, attempt === 1 ? 1200 : 2400))
    try {
      res = await formPost(DEVICE_URL_CODE, { client_id: clientId, scope: scope })
      const dTry = jsonMaybe(res)
      if (res && Number(res.code) >= 200 && Number(res.code) < 300 && dTry && dTry.device_code) break
      res = null
    } catch (e) { res = null }
  }
  if (!res) throw { status: 0, message: '网络连接失败，请检查手表网络' }"""
    b1 = """  let res = null
  let lastStatus = 0 /* v2.0.3：记录最后一次 HTTP 状态，最终报错可归因 */
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, attempt === 1 ? 1200 : 2400))
    try {
      res = await formPost(DEVICE_URL_CODE, { client_id: clientId, scope: scope })
      const dTry = jsonMaybe(res)
      if (res && Number(res.code) >= 200 && Number(res.code) < 300 && dTry && dTry.device_code) break
      lastStatus = Number(res && res.code) || 0
      res = null
    } catch (e) { res = null }
  }
  if (!res) throw lastStatus >= 400 ? { status: lastStatus, message: '发起登录失败（HTTP ' + lastStatus + '），请重试' } : { status: 0, message: '网络连接失败，请检查手表网络' }"""
    assert s.count(a1) == 1, br + ': async loop anchor'
    s = s.replace(a1, b1)

open(p, 'w', encoding='utf-8').write(s)
print(br + ': api.js patched')

# ---------- band-pro: device.ux 授权码排版溢出根修 ----------
if br == 'band-pro':
    p = 'src/pages/device/device.ux'
    s = open(p, encoding='utf-8').read()
    # 52px+ls4+内边26 → 总宽 ~369px 超出 336 屏内容区 296px；38px/ls2/内边16 → ~255px 稳落
    a = '.codebox { margin-top: 12px; background-color: #161b22; border-radius: 20px; padding: 16px 26px; }'
    b = '.codebox { margin-top: 12px; background-color: #161b22; border-radius: 20px; padding: 12px 16px; max-width: 280px; } /* v2.0.3：授权码总宽 369→255，稳落 296px 内容区 */'
    assert s.count(a) == 1, 'band-pro codebox anchor'
    s = s.replace(a, b)
    a = '.code { font-size: 52px; color: #3fb950; font-weight: bold; letter-spacing: 4px; }'
    b = '.code { font-size: 38px; color: #3fb950; font-weight: bold; letter-spacing: 2px; lines: 1; text-align: center; }'
    assert s.count(a) == 1, 'band-pro code anchor'
    s = s.replace(a, b)
    open(p, 'w', encoding='utf-8').write(s)
    print('band-pro: device.ux code sizing fixed')

# ---------- 版本号 ----------
ver_map = {'band-pro': ('2.0.2-pro', '2.0.3-pro'), 'main': ('2.0.2', '2.0.3'), 'xiaomi-watch-s': ('2.0.2-s', '2.0.3-s')}
oldv, newv = ver_map[br]
subs = [
    ('src/manifest.json', '"versionName": "%s"' % oldv, '"versionName": "%s"' % newv),
    ('package.json', '"version": "%s"' % oldv, '"version": "%s"' % newv),
]
for f, a, b in subs:
    s = open(f, encoding='utf-8').read()
    assert s.count(a) == 1, (br, f, a)
    s = s.replace(a, b)
    if f == 'src/manifest.json':
        s2 = re.sub(r'("versionCode": )32', r'\g<1>33', s)
        assert s2 != s
        s = s2
    open(f, 'w', encoding='utf-8').write(s)

# about/settings 页版本字样
import glob
for f in glob.glob('src/pages/*/*.ux'):
    s = open(f, encoding='utf-8').read()
    o = s
    s = s.replace('v%s' % oldv, 'v%s' % newv)
    if s != o:
        open(f, 'w', encoding='utf-8').write(s)
print(br + ': version -> ' + newv + '/33')

# 测试断言里的版本号同步
for f in glob.glob('scripts/test_*.js'):
    s = open(f, encoding='utf-8').read()
    o = s
    s = s.replace('2\\.0\\.2-band', '2\\.0\\.3-band').replace('"2.0.2-band"', '"2.0.3-band"')
    s = s.replace('"%s"' % oldv, '"%s"' % newv)
    s = s.replace(re.escape(oldv), newv) if False else s
    s = s.replace(oldv.replace('.', '\\.'), newv)
    s = s.replace('versionCode 32（四分支同步）', 'versionCode 33（四分支同步）')
    s = s.replace('"versionCode": 32', '"versionCode": 33')
    if s != o:
        open(f, 'w', encoding='utf-8').write(s)
        print('  test assertions synced:', f)
PYEOF
echo "=== $BR done ==="

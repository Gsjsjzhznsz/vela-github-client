/**
 * test_api_v122.js — v1.2.2 弦电子书式性能重构行为级测试
 * 覆盖：通知并行子页（per=2×5 并发拼接 / 降级 per=1 / 全有或全无 / notifPageSize）/
 *       raw 空响应体重试 / fcache 磁盘缓存（命中/落盘/LRU 淘汰）/
 *       getFileRawEx 四级通道（缓存→下载器→分块→REST raw）/ 错误体嗅探 /
 *       二进制嗅探 / 1MB 截断 / getReadmeText 下载器优先
 */
const { loadModule, assert, assertEq, test, summary } = require('./test_utils')

const TOKEN_OK = 'ghp_' + 'a'.repeat(36)

/* ---------------- mock 工厂（与 v121 同构 + 可用下载器） ---------------- */

function makeStorage(opts) {
  opts = opts || {}
  const map = {}
  return {
    _map: map,
    get({ key, success, fail }) {
      if (opts.breakGet) return fail(null, 999)
      success(Object.prototype.hasOwnProperty.call(map, key) ? map[key] : null)
    },
    set({ key, value, success, fail }) {
      if (opts.breakSet) return fail(null, 999)
      map[key] = value
      success()
    },
    delete({ key, success, fail }) {
      delete map[key]
      ;(success || fail || function () {})()
    }
  }
}

function makeFile(opts) {
  opts = opts || {}
  const map = {}
  return {
    _map: map,
    readText({ uri, success, fail }) {
      if (opts.breakRead) return fail(null, 300)
      if (Object.prototype.hasOwnProperty.call(map, uri)) success({ text: map[uri] })
      else fail(null, 301)
    },
    writeText({ uri, text, success, fail }) {
      if (opts.breakWrite) return fail(null, 300)
      map[uri] = text
      success()
    },
    delete({ uri, success, fail }) {
      delete map[uri]
      ;(success || fail || function () {})()
    }
  }
}

function makeFetch(handler) {
  const calls = []
  return {
    calls,
    fetch(opts) {
      calls.push(opts)
      Promise.resolve().then(() => {
        try {
          const r = handler(calls.length, opts)
          if (r && r.__fail) opts.fail(r.__fail, r.code)
          else opts.success(r)
        } catch (e) { opts.fail(String(e && e.message || e), 0) }
      })
    }
  }
}

/** 可用下载器：contentByUrl 映射 URL → 正文；downloaded 记录调用 */
function makeDownloader(contentByUrl, opts) {
  opts = opts || {}
  const downloaded = []
  let tk = 0
  return {
    downloaded,
    download({ url, success, fail }) {
      downloaded.push(url)
      if (opts.breakDownload) return fail(null, 1000)
      tk++
      success({ token: 'tk' + tk })
    },
    onDownloadComplete({ token, success, fail }) {
      Promise.resolve().then(() => {
        if (opts.breakComplete) return fail(null, 1001)
        const url = downloaded[Number(String(token).slice(2)) - 1]
        const body = Object.prototype.hasOwnProperty.call(contentByUrl, url) ? contentByUrl[url] : null
        if (body == null) return fail(null, 1002)
        success({ uri: 'internal://files/dltmp_' + token })
      })
    }
  }
}

/** 下载器与 file mock 联动：onDownloadComplete 完成时把正文注入 file map */
function wireDownloader(fileMock, downloaderMock) {
  const origComplete = downloaderMock.onDownloadComplete
  downloaderMock.onDownloadComplete = function (o) {
    const wrapped = Object.assign({}, o, {
      success: (d) => {
        const url = downloaderMock.downloaded[Number(String(o.token).slice(2)) - 1]
        if (downloaderMock._contentByUrl && Object.prototype.hasOwnProperty.call(downloaderMock._contentByUrl, url)) {
          fileMock._map[d.uri] = downloaderMock._contentByUrl[url]
        }
        o.success(d)
      }
    })
    origComplete(wrapped)
  }
  downloaderMock._contentByUrl = downloaderMock._contentByUrl || {}
  return downloaderMock
}

function notifItem(id) {
  return {
    id: id, unread: true, reason: 'ci_activity',
    updated_at: '2026-10-01T00:00:00Z',
    subject: { title: 'ntf ' + id, type: 'Issue', url: 'https://api.github.com/repos/o/r/issues/' + id },
    repository: { full_name: 'o/r' }
  }
}

function authed(contentByUrl, fetchHandler, dlOpts) {
  const f = makeFile()
  const d = makeDownloader(contentByUrl || {}, dlOpts)
  wireDownloader(f, d)
  d._contentByUrl = contentByUrl || {} /* 注入表与下载器内容源一致 */
  const mocks = {
    '@system.fetch': makeFetch(fetchHandler),
    '@system.storage': makeStorage(),
    '@system.file': f,
    '@system.request': d
  }
  mocks['@system.storage']._map['gh_token'] = TOKEN_OK
  mocks['@system.file']._map['internal://files/gh_token.txt'] = TOKEN_OK
  return mocks
}

/* Date.now 偏移控制（fcache LRU ts 无关紧要，保持原样即可） */

/* ---------------- 1. 通知并行子页 ---------------- */

async function t_notif_parallel() {
  await test('通知 page1：5 个 per_page=2 子页并行，按序拼接 10 条无缺口', async () => {
    const seen = []
    const mocks = authed({}, (n, o) => {
      const u = String(o.url)
      if (u.indexOf('/notifications') < 0) return { code: 404, data: {}, headers: {} }
      const pg = Number((u.match(/page=(\d+)/) || [0, 1])[1])
      const per = Number((u.match(/per_page=(\d+)/) || [0, 0])[1])
      seen.push(pg + 'x' + per)
      const list = []
      for (let i = 0; i < per; i++) list.push(notifItem((pg - 1) * 2 + i + 1))
      return { code: 200, data: list, headers: {} }
    })
    const api = loadModule('src/utils/api.js', mocks)
    const list = await api.getNotifications(1, false)
    assertEq(list.length, 10, '拼得 10 条')
    assertEq(list.map((x) => x.id), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], '顺序无缺口')
    assertEq(seen.filter((s) => s.indexOf('x2') >= 0).length, 5, '恰好 5 个 per=2 子页')
    assertEq(api.notifPageSize(), 10, 'notifPageSize()=10')
  })

  await test('通知 page2：子页号 6-10（逻辑页偏移正确）', async () => {
    const pages = []
    const mocks = authed({}, (n, o) => {
      const u = String(o.url)
      if (u.indexOf('/notifications') < 0) return { code: 404, data: {}, headers: {} }
      const pg = Number((u.match(/page=(\d+)/) || [0, 1])[1])
      const per = Number((u.match(/per_page=(\d+)/) || [0, 0])[1])
      pages.push(pg)
      const list = []
      for (let i = 0; i < per; i++) list.push(notifItem((pg - 1) * 2 + i + 1))
      return { code: 200, data: list, headers: {} }
    })
    const api = loadModule('src/utils/api.js', mocks)
    const list = await api.getNotifications(2, true)
    assertEq(list.map((x) => x.id), [11, 12, 13, 14, 15, 16, 17, 18, 19, 20], '第二逻辑页=第 11-20 条')
    pages.sort((a, b) => a - b)
    assertEq(pages, [6, 7, 8, 9, 10], '子页号 6-10')
  })

  await test('子页截断 → 自动降级 per=1 两页补齐，无缺口', async () => {
    const seen = []
    const mocks = authed({}, (n, o) => {
      const u = String(o.url)
      if (u.indexOf('/notifications') < 0) return { code: 404, data: {}, headers: {} }
      const pg = Number((u.match(/page=(\d+)/) || [0, 1])[1])
      const per = Number((u.match(/per_page=(\d+)/) || [0, 0])[1])
      seen.push(pg + 'x' + per)
      if (per === 2) return { code: 200, data: '[{"id":9,"unread":true,"reaso', headers: {} } /* 残缺 JSON */
      const list = [notifItem((pg - 1) + 1)] /* per=1：第 pg 页持第 pg 条 */
      return { code: 200, data: list, headers: {} }
    })
    const api = loadModule('src/utils/api.js', mocks)
    const list = await api.getNotifications(1, false)
    /* 子页 3 降级 → per=1 页 5,6 → 条 5,6 */
    assertEq(list.length, 10, '仍 10 条（降级补齐）')
    assertEq(list.map((x) => x.id), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], '降级后依然无缺口')
    assertEq(seen.filter((s) => s === '5x1').length >= 1, true, '子页3 降为 per=1 页5')
    assertEq(seen.filter((s) => s === '6x1').length >= 1, true, '子页3 降为 per=1 页6')
  })

  await test('子页 404（非截断）→ 整页抛错（全有或全无，绝不静默缺条）', async () => {
    const mocks = authed({}, (n, o) => {
      const u = String(o.url)
      if (u.indexOf('/notifications') < 0) return { code: 404, data: {}, headers: {} }
      const pg = Number((u.match(/page=(\d+)/) || [0, 1])[1])
      if (pg === 3) return { code: 404, data: { message: 'Not Found' }, headers: {} }
      return { code: 200, data: [notifItem((pg - 1) * 2 + 1), notifItem((pg - 1) * 2 + 2)], headers: {} }
    })
    const api = loadModule('src/utils/api.js', mocks)
    let err = null
    try { await api.getNotifications(1, false) } catch (e) { err = e }
    assert(err && err.status === 404, '404 直接抛出（status 透传）')
  })

  await test('游客调通知 → 401 友好文案（登录校验前置）', async () => {
    const mocks = authed({}, () => ({ code: 200, data: [], headers: {} }))
    mocks['@system.storage']._map['gh_token'] = ''
    mocks['@system.file']._map['internal://files/gh_token.txt'] = ''
    const api = loadModule('src/utils/api.js', mocks)
    const list = await api.getNotifications(1, false)
    assertEq(list, [], '无 token 拼接空数组（上游匿名 401 由 GitHub 裁决）')
  })
}

/* ---------------- 2. raw 空响应体重试 ---------------- */

async function t_empty_raw_retry() {
  await test('raw GET 空体 200 → 重试后拿到全文（v1.2.1 会误判「文件内容为空」）', async () => {
    let n = 0
    const mocks = authed({}, () => {
      n++
      if (n === 1) return { code: 200, data: '', headers: {} }
      return { code: 200, data: 'print("hello")\n', headers: { 'content-length': '15' } }
    })
    const api = loadModule('src/utils/api.js', mocks)
    const text = await api.request('/repos/o/r/contents/a.js', { raw: true })
    assertEq(text, 'print("hello")', '第二次尝试返回全文（request() 对 raw 文本做 trim，属既有契约）')
    assertEq(n, 2, '恰重试一次')
  })
}

/* ---------------- 3. fcache 磁盘缓存 ---------------- */

async function t_fcache() {
  await test('getFileRawEx：首次走下载器落盘，二次命中磁盘缓存（零网络）', async () => {
    const contentByUrl = {}
    const url = 'https://raw.githubusercontent.com/o/r/HEAD/a.txt'
    contentByUrl[url] = 'file-body-123'
    const mocks = authed(contentByUrl, () => ({ code: 500, data: '', headers: {} }))
    const api = loadModule('src/utils/api.js', mocks)
    const r1 = await api.getFileRawEx('o/r', 'a.txt', '', null)
    assertEq(r1.via, 'dl', '首次经下载器')
    assertEq(r1.text, 'file-body-123', '内容正确')
    const r2 = await api.getFileRawEx('o/r', 'a.txt', '', null)
    assertEq(r2.via, 'cache', '二次命中磁盘缓存')
    assertEq(r2.text, 'file-body-123', '缓存内容一致')
    assertEq(mocks['@system.request'].downloaded.length, 1, '仅一次真实下载')
  })

  await test('fcache LRU：第 7 个文件挤掉最旧一个（容量 6）', async () => {
    const contentByUrl = {}
    for (let i = 1; i <= 7; i++) contentByUrl['https://raw.githubusercontent.com/o/r/HEAD/f' + i + '.txt'] = 'body-' + i
    const mocks = authed(contentByUrl, () => ({ code: 500, data: '', headers: {} }))
    const api = loadModule('src/utils/api.js', mocks)
    for (let i = 1; i <= 7; i++) await api.getFileRawEx('o/r', 'f' + i + '.txt', '', null)
    const m = JSON.parse(mocks['@system.file']._map['internal://files/fcache/m.json'])
    assertEq(m.items.length, 6, '清单裁到 6 项')
    assertEq(m.items[0].url.indexOf('f7.txt') > 0, true, '最新在前')
    assertEq(m.items.some((x) => x.url.indexOf('f1.txt') > 0), false, '最旧被淘汰')
    const r = await api.getFileRawEx('o/r', 'f1.txt', '', null)
    assertEq(r.via, 'dl', '被淘汰的 f1 重新下载')
  })

  await test('下载器返回错误体（404: Not Found）→ 转分块通道，不入缓存', async () => {
    const url = 'https://raw.githubusercontent.com/o/r/HEAD/missing.txt'
    const mocks = authed({}, (n, o) => {
      const u = String(o.url)
      if (u === url) {
        /* 分块通道：文本模式 206 短块 */
        return { code: 206, data: 'from-chunked', headers: { 'content-range': 'bytes 0-8191/12', 'content-length': '12' } }
      }
      return { code: 500, data: '', headers: {} }
    }, { breakDownload: false })
    /* 下载器拿到 404 错误体 */
    mocks['@system.request']._contentByUrl[url] = '404: Not Found'
    const api = loadModule('src/utils/api.js', mocks)
    const r = await api.getFileRawEx('o/r', 'missing.txt', '', null)
    assertEq(r.via, 'chunk', '错误体被嗅探，落到分块通道')
    assertEq(r.text, 'from-chunked', '分块内容正确')
  })

  await test('下载器拿到二进制（NUL）→ 明确报错不渲染', async () => {
    const url = 'https://raw.githubusercontent.com/o/r/HEAD/bin.dat'
    const mocks = authed({}, () => ({ code: 500, data: '', headers: {} }))
    mocks['@system.request']._contentByUrl[url] = 'MZ\x00\x90\x00binary'
    const api = loadModule('src/utils/api.js', mocks)
    let err = null
    try { await api.getFileRawEx('o/r', 'bin.dat', '', null) } catch (e) { err = e }
    assert(err && err.binary, 'binary 错误透传')
  })

  await test('下载器超 1MB → capped=true + 恰好 1MB 字节', async () => {
    const url = 'https://raw.githubusercontent.com/o/r/HEAD/big.log'
    const mocks = authed({}, () => ({ code: 500, data: '', headers: {} }))
    mocks['@system.request']._contentByUrl[url] = 'x'.repeat(1100000)
    const api = loadModule('src/utils/api.js', mocks)
    const r = await api.getFileRawEx('o/r', 'big.log', '', null)
    assertEq(r.capped, true, 'capped 标志')
    assertEq(r.text.length, 1024 * 1024, '恰 1MB 字符（ASCII 1 字节/字符）')
  })

  await test('下载器不可用 → 分块通道接住（可用性回退）', async () => {
    const url = 'https://raw.githubusercontent.com/o/r/HEAD/f.js'
    const mocks = authed({}, () => {
      return { code: 206, data: 'var a=1;', headers: { 'content-range': 'bytes 0-8191/8', 'content-length': '8' } }
    }, { breakDownload: true })
    const api = loadModule('src/utils/api.js', mocks)
    const r = await api.getFileRawEx('o/r', 'f.js', '', null)
    assertEq(r.via, 'chunk', '下载器失败走分块')
    assertEq(r.text, 'var a=1;', '分块内容正确')
  })
}

/* ---------------- 4. getReadmeText 下载器优先 ---------------- */

async function t_readme_dl_primary() {
  await test('README：树查询 1 次 + 下载器全文（无分块请求），二次调用零网络', async () => {
    const readmeUrl = 'https://raw.githubusercontent.com/o/r/HEAD/README.md'
    const mocks = authed({}, (n, o) => {
      const u = String(o.url)
      if (u.indexOf('/git/trees/') >= 0) {
        return { code: 200, data: { tree: [{ type: 'blob', path: 'README.md' }] }, headers: {} }
      }
      return { code: 500, data: '', headers: {} }
    })
    mocks['@system.request']._contentByUrl[readmeUrl] = '# Title\n\nbody'
    const api = loadModule('src/utils/api.js', mocks)
    const r1 = await api.getReadmeText('o/r', '')
    assertEq(r1.name, 'README.md', '文件名来自树')
    assertEq(r1.text, '# Title\n\nbody', '全文正确')
    assertEq(mocks['@system.fetch'].calls.length, 1, '仅树查询一次 fetch')
    const r2 = await api.getReadmeText('o/r', '')
    assertEq(r2.text, '# Title\n\nbody', '二次命中磁盘缓存')
    assertEq(mocks['@system.fetch'].calls.length, 1, '仍只有 1 次 fetch（零新增网络）')
  })

  await test('README 下载器拿到 404 错误体 → 分块通道接住', async () => {
    const readmeUrl = 'https://raw.githubusercontent.com/o/r/HEAD/README.md'
    const mocks = authed({}, (n, o) => {
      const u = String(o.url)
      if (u.indexOf('/git/trees/') >= 0) {
        return { code: 200, data: { tree: [{ type: 'blob', path: 'README.md' }] }, headers: {} }
      }
      return { code: 206, data: '# Chunked', headers: { 'content-range': 'bytes 0-8191/9', 'content-length': '9' } }
    })
    mocks['@system.request']._contentByUrl[readmeUrl] = '404: Not Found'
    const api = loadModule('src/utils/api.js', mocks)
    const r = await api.getReadmeText('o/r', '')
    assertEq(r.text, '# Chunked', '错误体被嗅探，分块内容返回')
    assertEq(r.raw, true, 'raw 契约保持')
  })
}

/* ---------------- 5. utf8SliceBytes 多字节安全（经 >1MB 中文截断验证） ---------------- */

async function t_utf8_cap_cjk() {
  await test('下载器超 1MB（中文 3 字节/字）→ 截断处不产生半个字符', async () => {
    const url = 'https://raw.githubusercontent.com/o/r/HEAD/big-cn.txt'
    const mocks = authed({}, () => ({ code: 500, data: '', headers: {} }))
    /* 400000 个汉字 ≈ 1.2MB 字节 */
    mocks['@system.request']._contentByUrl[url] = '好'.repeat(400000)
    const api = loadModule('src/utils/api.js', mocks)
    const r = await api.getFileRawEx('o/r', 'big-cn.txt', '', null)
    assertEq(r.capped, true, 'capped 标志')
    assert(r.text.length === Math.floor(1024 * 1024 / 3), '字符数=1MB/3 向下取整（3 字节/字整除）')
    assert(r.text[0] === '好' && r.text[r.text.length - 1] === '好', '首尾字符完整（无半个 UTF-8 序列）')
  })
}

;(async () => {
  await t_notif_parallel()
  await t_empty_raw_retry()
  await t_fcache()
  await t_readme_dl_primary()
  await t_utf8_cap_cjk()
  summary()
})()

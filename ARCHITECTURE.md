# 架构说明 / ARCHITECTURE

## 1. 技术栈

| 层 | 选型 | 说明 |
|----|------|------|
| 运行时 | Xiaomi Vela OS（Apache NuttX） | 小米自研 IoT RTOS，Redmi Watch 5 出厂搭载 |
| 应用框架 | Vela JS 应用（快应用范式） | `.ux` 单文件组件 = template + style + script，MVVM 数据绑定 |
| 工具链 | aiot-toolkit ^2.0.5（官方 CLI） | `aiot build` 产出 .rpk，`aiot release` 产出正式签名包 |
| 数据源 | GitHub REST API v3 | `api.github.com`，HTTPS + Bearer Token |

## 2. 目录结构

```
vela-github-client/
├── manifest.json              # Vela 应用清单（包名/路由/features/designWidth）
├── app.ux                     # 应用入口（轻量，启动零网络请求）
├── config-watch.json          # 手表设备配置（官方约定内容为 {}）
├── components/
│   └── gh-keyboard/gh-keyboard.ux   # 自研 ASCII 键盘（参考 BandQQ InputMethod）
├── utils/
│   ├── api.js                 # GitHub API 封装：fetch Promise 化 / Token / 限流 / 端点
│   ├── view.js                # API 数据 → 视图模型（瘦字段映射）
│   ├── fmt.js                 # 数字压缩 / 相对时间 / 语言色 / 文字头像
│   ├── md.js                  # Markdown → 结构化文本块（README/Issue 正文）
│   └── b64.js                 # 纯 JS Base64 解码（UTF-8 安全，手表无 atob）
├── pages/
│   ├── home/        # 首页：状态卡 + 功能菜单
│   ├── notifications/  # 通知中心（需登录）
│   ├── repos/       # 仓库列表（登录/指定用户双模式）
│   ├── trending/    # 趋势三档榜单（游客可用）
│   ├── search/      # 搜索（内嵌键盘）
│   ├── repo/        # 仓库详情 + 四宫格操作
│   ├── readme/      # README 阅读器（分块懒加载）
│   ├── issues/      # Issue 列表（开放/已关闭）
│   ├── issue/       # Issue/PR 详情 + 评论分页
│   ├── code/        # 代码浏览（目录树 + 文件分行）
│   ├── profile/     # 个人主页（登录/游客）
│   └── settings/    # Token 管理 + 关于
└── common/icons/    # PIL 生成的描边图标（20 个，2× 物理分辨率）
```

## 3. 网络链路

```
┌──────────────┐   蓝牙代理（运动健康 App）        ┌───────────────┐
│  Redmi Watch │  ───────────────────────────►  │  手机 4G/WiFi  │ ─┐
│  (Vela OS)   │   或 eSIM 独立联网              └───────────────┘  │
│              │  ──────────────────────────────────────────────►  ▼
│ system.fetch │        https://api.github.com           GitHub REST API v3
└──────────────┘
```

- 应用层只依赖 `@system.fetch`，底层经运动健康蓝牙代理或 eSIM 对应用透明
- 统一请求头：`User-Agent: vela-github-client`、`Accept: application/vnd.github+json`、`X-GitHub-Api-Version: 2022-11-28`
- 登录态：`Authorization: Bearer <token>`，Token 存于 `system.storage`（仅本机）
- 限流感知：响应头 `x-ratelimit-remaining` 实时解析；403 时给出「建议登录 Token」提示
- 错误归一化：网络失败 / 401 / 403 / 404 / 5xx 映射为中文可读信息

## 4. 关键设计

### 4.1 屏幕适配（designWidth 216）

官方 SKILL 明确 RW5 为 432×514、DPR=2 → 设计宽度取 216，**1 设计 px ≡ 1 dp ≡ 2 物理 px**。
圆屏兼容用 media query：

```css
@media (shape: rect)   { .kb-dock { bottom: auto; top: 105px; } }  /* RW5: 257-152 */
```

键盘 dock 采用 BandQQ v2.18 验证过的**顶部锚定**方案（rect 屏 `top = 257-152 = 105px`），
规避部分固件 `bottom:0` 解析到文档底导致键盘半屏的固件缺陷。

### 4.2 键盘组件（gh-keyboard.ux）

继承 BandQQ InputMethod 三大实战经验：

1. **显式高度链**：根容器/kb-pad 全部定高 152px，全链路无 auto 测量点，规避固件首帧坍缩
2. **if 懒建保活**：首次弹出才建子树（`kbCreated` 锁存），之后 `show` 显隐不重建
3. **事件回传**：`$emit('key'|'del'|'ok')`，宿主页持有文本缓冲（单向数据流）

按键矩阵由 `buildRows(mode, shift)` 生成，`refreshRows()` 原地更新 label 避免整树重建；
按键经 `@system.vibrator` 触发短触感反馈。

### 4.3 下拉刷新（无官方 refresh 组件的替代）

Vela 容器组件无 `refresh`，自行组合三个原语：

- `list` 的 `onscroll` 追踪 `scrollY`（判定是否在顶部）
- `ontouchstart/move/end` 计算下拉位移 → 绑定指示条高度（`height: {{pullY}}px`）
- `pullY > 40` 松手触发刷新；页头 ⟳ 按钮作为永久兜底入口

### 4.4 分页与虚拟化

- 所有列表 = `list` + `list-item`（显式 `type` + `tid`），节点按类型复用
- `onscrollbottom` 触底加载下一页（每页 10 条，`hasMore = page ≥ 10 条`）
- GitHub issues 接口返回含 PR → 取 `per_page=20` 客户端过滤后截取 10 条
- README / Issue 正文 / 源码：先转结构块，再按 40 块（源码 40 行）分片懒加载

### 4.5 内存纪律（官方规范落地）

- 非响应式大对象挂 `this._xxx`（如 `_allBlocks` / `_lines`），页面 `onDestroy` 置 null
- 列表增量更新用 `push` 原地修改；刷新场景才整体重赋值
- 无定时器使用；ViewModel 中不存放 UI 无关数据
- 无网络图片：头像为首字母 + `hsl(hue) 色相哈希`（字符串稳定散列）

### 4.6 Markdown 管线（md.js）

```
原文 ─► 行扫描（围栏代码/标题/引用/列表/表格/分隔线）─► 行内清洗
（图片→[图]、链接→纯文字、行内代码→「」、加粗斜体剥离、HTML 标签剔除、实体反转义）
─► 块数组 {t: h|p|c|q|l|r, s} ─► chunkBlocks(40) ─► list-item 渲染
```

单块 420 字符截断，防止极端行拖垮渲染线程。

## 5. GitHub API 端点清单

| 端点 | 用途 | 认证 |
|------|------|------|
| GET /rate_limit | 余量展示 | 否 |
| GET /notifications | 通知列表 | 是 |
| PUT /notifications · PUT /notifications/threads/{id} | 全部/单条已读 | 是 |
| GET /user · /users/{login} | 会话/指定用户 | 混合 |
| GET /user/repos · /users/{login}/repos | 仓库列表 | 混合 |
| GET /search/repositories | 搜索 / 趋势模拟 | 否 |
| GET /repos/{full} · /readme | 详情 / README | 否 |
| GET /repos/{full}/contents[/{path}] | 目录与文件 | 否 |
| GET /repos/{full}/issues[/comments] | Issues 与评论 | 否 |
| PUT/DELETE /user/starred/{full} | Star 开关 | 是 |

## 6. 数据流示例（打开一条通知）

```
通知列表点击
  → markThreadRead(threadUrl)（火后不理）
  → item.unread=false 原地更新角标
  → subject.type 是 Issue/PullRequest？
      ├─ 是 → 解析 subject.url 尾部 number → router.push(issue 页, {full, n})
      └─ 否 → router.push(repo 页, {full: repository.full_name})
issue 页 onShow → getIssue → mdToBlocks(body) → 评论分页 getComments(comments_url)
```

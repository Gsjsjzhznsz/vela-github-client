# GitHub for Vela ⌚

运行在 **小米 Vela OS** 手表上的 GitHub 客户端，优先适配 **Redmi Watch 5**（432×514 方屏），兼容圆屏机型。数据经 **小米运动健康** 蓝牙代理或 **eSIM** 独立联网直连 GitHub REST API。

> 基于 Vela 官方 JS 应用框架（aiot-toolkit）开发，遵循官方组件 / API 白名单与性能规范。

## ✨ 功能

| 模块 | 说明 |
|------|------|
| 🔔 通知中心 | 未读列表、未读数角标、单条已读直达、**长按标记已读**、一键全部已读、未读/全部切换 |
| 📦 仓库 | 我的仓库（按最近 push 排序）、指定用户公开仓库、Star 数 / 语言 / 更新时间 |
| 📖 README | Base64 解码 + 轻量 Markdown 转换，分块懒加载阅读 |
| 🐛 Issues | 开放/已关闭切换、标签展示、正文与评论流式阅读（支持 PR 会话）、**T9 拼音键盘发评论** |
| 🚢 Releases | 版本列表、预发布标记、附件数、发布说明预览 |
| 🔍 搜索 | 关键词搜仓库（支持拼音输入中文关键词），显示结果总数 |
| 📈 趋势 | 新星（周）/ 黑马（季）/ 经典 三档榜单（GitHub 无官方 Trending API，用 stars 排序模拟） |
| 🌲 代码浏览 | 目录树逐级进入、源码等宽分行查看、二进制与大文件守卫 |
| 👤 个人主页 | 登录自动加载 / 游客输入用户名查询，仓库/粉丝/关注统计 |
| ⭐ Star | 仓库页一键 Star / 取消 Star |
| 🔑 双模式 | Personal Access Token 登录 或 游客模式（匿名限流 60 次/小时） |

## 📱 适配设备

| 设备 | 屏幕 | 适配状态 |
|------|------|----------|
| Redmi Watch 5 | 432×514 方形 | ✅ 主力适配（designWidth 432，1 设计 px = 1 物理 px，BandQQ redmiwatch 分支同策略） |
| Xiaomi Watch S 系列 | 466×466 圆形 | ⚠️ 兼容（圆屏安全边距待真机微调） |
| 其他 Vela OS 手表/手环 | — | 理论兼容，欢迎反馈 |

## 🚀 构建与安装

### 1. 环境准备

- Node.js ≥ 16（含 npm）
- 官方工具链随仓库自带：`npm install` 即装 `aiot-toolkit`（小米官方 Vela JS 应用 CLI）
- 手机安装最新版「小米运动健康」并连接手表（为手表提供网络代理）

### 2. 克隆并构建

```bash
git clone https://github.com/Gsjsjzhznsz/vela-github-client.git
cd vela-github-client
npm install
npm run build        # 等价于 npx aiot build
```

构建成功后在 `dist/` 生成 debug 签名安装包：

```
dist/io.github.gsjsjzhznsz.github.debug.1.0.0.rpk
```

### 3. 安装到手表（三种途径，任选）

**途径 A：AIoT-IDE 真机调试（官方推荐）**

1. 下载 AIoT-IDE：https://iot.mi.com/vela/quickapp/zh/guide/start/use-ide.html
2. 「打开项目」选择本仓库根目录，按开发向导安装依赖
3. 手表通过运动健康保持连接，IDE 顶部「真机调试」选择你的设备运行
4. 详细步骤见官方文档《真机调试》：https://iot.mi.com/vela/quickapp/zh/tools/debug/real-machine.html

**途径 B：官方模拟器（QEMU 镜像，无真机先验证）**

```bash
npx aiot initEmulatorEnv        # 下载 QEMU + vela-miwear-watch-5.0 官方镜像（约 700MB）
npx aiot createVVD              # 创建虚拟设备（选 vela-miwear-watch-5.0 镜像）
npx aiot start                  # 启动模拟器并安装运行本应用
```

> 命令行 createVVD 交互存在校验 bug 时，可在 AIoT-IDE 设备管理器中创建；
> 更新安装请先 `adb shell pm uninstall <包名>` 再 install —— **覆盖安装不会刷新页面代码（jsc 字节码缓存）**，
> 也不更新 manifest（entry 变更需卸载重装）。

**途径 C：直接安装 debug rpk**

使用 AIoT-IDE 的「安装 rpk」入口，或按官方真机调试文档的安装通道，把 `dist/*.rpk` 推送到手表。

### 4. 登录（v1.2.0 起支持免打字）

**方式一：免打字登录（Device Flow，推荐）**

1. 手表打开本应用 → 设置 → 「免打字登录（推荐）」
2. 手表屏幕显示一个 8 位代码（如 `5187-6B16`，15 分钟有效）
3. 用手机/电脑浏览器打开 `github.com/login/device`，输入该代码并点授权
4. 手表自动轮询拿到 Token，验证后**双通道保存**（storage + 文件），全程无需在手表上打字
5. Token 由 GitHub 直接下发给手表，不经过任何第三方服务器

**方式二：手动输入 Token**

1. 电脑打开 `github.com` → Settings → Developer settings → Personal access tokens → **Tokens (classic)**
2. Generate new token (classic)，勾选 `repo`、`notifications` 权限
3. 手表 → 设置 → 「手动输入 Token」，用内置键盘输入一次（支持实时格式校验、失败保留原登录态）
4. Token 经 `/user` 接口验证后保存到**手表本地存储**，不上传任何第三方服务器

> 游客模式可不登录直接使用搜索/趋势/公开仓库（GitHub 匿名限流 60 次/小时）。
> 升级安装（覆盖安装）不会丢失登录态；卸载重装后用「免打字登录」30 秒即可恢复。

## 🗂 使用指南

- **首页**：账户状态 + API 余量 + 七大功能入口
- **通知**：三态过滤（未读 / 全部 / 仅参与）——「仅参与」服务端过滤 99% CI 噪音；点按进入对应 Issue/PR/仓库并自动标记已读；**长按不打开仅标记已读**；右上 ✓ 一键全部已读
- **列表页**：下拉刷新 + 滚到底自动加载下一页（每页 10 条）
- **仓库页**：README / Issues / Releases / 代码 / Actions / 问 AI / Star 六宫格操作
- **Copilot 专区**：AI 对话（Copilot 通道，VS Code 同款免费模型）+ 八个快捷指令（含通道自检/刷新模型列表）+ 会话历史持久化 + 上下文注入（代码页/仓库页「问 AI」）+ 模型切换；PAT 用户点引导卡一键 Copilot 设备授权（免打字，与主登录分离）
- **键盘**：集成 [Vela_input_method](https://github.com/NEORUAA/Vela_input_method) 组件（MIT）——T9 拼音/英文九键（搜索、写评论）+ QWERTY 全键（Token/用户名），顶部操作条提供 搜索/保存/发送/收起
- **评论**：Issue 详情页 →「写评论」→ T9 拼音键盘输入中文/英文 → 发送（需登录）

## ⚡ 性能设计

- 纯文字头像（首字母 + 稳定色相哈希），全程零网络图片
- `scroll` 组件（`scroll-y`）+ 触底自动分页，每页 10 条瘦字段
- README/源码分块渲染（40 块/片），非响应式大对象挂 `this._` 前缀，页面销毁即释放
- 键盘组件懒建保活：首次弹出才建子树，之后 `hide` 切换只走显隐（InputMethod 原生优化）
- 网络请求带 1.2s/2.4s 两级退避重试（弱网/蓝牙代理下更稳）+ 25s 显式超时（代理挂起不再卡死页面）
- 应用启动零网络请求，onShow 智能去重
- v1.3.0：目录列表分页（24 条/页，深目录不再一次性渲染数百节点——OOM 死机根治）+ 会话目录缓存（返回上级零网络秒开）

### v1.5.0 通知 per=1 主路根治 + AI Copilot 单通道重构（Models 退役应对）

两条最新反馈的终极根治（「通知中心依旧显示响应数据不完整」「AI 依旧使用不了，我在 VS Code 都能正常使用免费模型」）：

- **通知 per=1 主路（确定性截断源消失）**：真机量化实锤——per=2 子页 ~12KB **恒超**蓝牙代理 8KB 截断阈值，v1.2.2-v1.4.0 的「5×per=2 子页」方案每次都触发截断→抢救→尾条补拉链路，任何一环抖动即缺条。v1.5.0 改为 **10×per=1 单页**（单页 ~5.6KB，e2e 实测最大 5556B，稳在 8KB 阈值内）并发 3 拉取——截断从「日常路径」变「罕见兜底」，请求总数与旧真机实际开销持平
- **salvage 竞态根治（v1.4.0 缺条放大的真凶）**：抢救记录原为模块级单例，通知子页并发 3 时 A/B 相继截断抢救后记录互相覆盖，B 的 URL 顶掉 A → A 误判「非截断」跳过尾条补拉 → **静默丢一半条目**（沙箱无截断故旧 e2e 测不出）。现按 URL 记键（容量 12 的最近表），并发互不覆盖
- **抢救残片不再毒化缓存**：v1.4.0 把抢救出的部分数组 `memSet` 进缓存——TTL 内重进页面命中残片且 salvage 记录已过期，缺条「封印」。现部分数据只经返回值即时补拉，缓存只存完整响应
- **AI 终极根因：GitHub Models 已退役**：官方文档实证 **2026-07-30 models.github.ai 全面停止服务**（playground/catalog/inference API 全下线）——v1.3.0-v1.4.0 的 Models 通道（无论怎么修）都打在死服务上，这就是「AI 依旧使用不了」的答案
- **AI Copilot 单通道重构（VS Code 同款链路）**：实测矩阵——PAT 直连 Copilot API → 400 "Personal Access Tokens are not supported"；OAuth App 的 gho_ → 会话交换端点拒绝（**只收 GitHub App 的 ghu_**）；`/copilot_internal/user` 探测 **PAT 可查**（旧版 `/user/copilot` 对 PAT 恒 404，把已开通 Copilot Free 的账号误报「未开通」并给出错误指引——实为 v1.4.0 最大误诊）。新链路：**Copilot 设备授权（GitHub Copilot CLI 官方 GitHub App `Iv1.b507a08c87ecfe98`）→ ghu_ → `copilot_internal/v2/token` 换 30min 会话凭据 → `endpoints.api`（按套餐定制域名）/chat/completions**（2026-08-01 版本头 + CLI 身份头，交换与调用身份一致）
- **AI token 独立存储**：Copilot 授权与主登录分离（`gh_copilot_token` 双通道落盘）——主 token 保持 PAT 全权限不受影响；旧设备授权用户（ghu_/gho_ 主 token）自动复用直连，零迁移
- **AI 授权一键化**：AI 页检测「PAT + 未授权」即显示紫色引导卡「检测到 Copilot Free · 点此一键授权」——设备码 8 位免打字，与 VS Code 体验对齐；通道自检改为 `/copilot_internal/user` 套餐+额度实测（如「已开通（Copilot Free · 聊天可用 · 会话额度 200/200）」）+ 凭据交换实测 + Models 退役说明
- **模型列表动态化**：`GET /models` 实时目录（{data:[...]} / 裸数组双解析 + chat 类型过滤 + 去重），免费模型轮换不再依赖硬编码；兜底清单更新为 2026-10 Copilot Free 主力（gpt-5-mini / claude-haiku-4.5 / gemini-3-flash / gpt-4.1-mini / gpt-4o-mini / grok-code-fast-1）
- **AI 错误全文透出**：非 2xx 一律提取 `error.message` 或响应原文前 120 字进报错文案（如 400 "model_not_supported"、429 "quota exceeded"）——不再笼统报「网关返回非标准体」，用户可自诊断
- **设备授权 scope 收敛**：主登录回落 `repo read:user notifications`（copilot/models 不是合法 OAuth scope，旧版 FULL 首试恒被拒纯耗请求）；Copilot 授权独立 `read:user`

### v1.4.0 截断抢救 + GraphQL 目录/正文快车道 + 文件完整性守门 + AI 2026 重构

真机四项反馈的根治（「通知中心依旧数据不完整」「深层文件夹/指定 .py 文件报不存在」「账号没一个 AI 能用」「AI 模型是好久之前的免费模型」）：

- **真机数据实锤（诊断驱动）**：实测单条通知 JSON 5931B（内嵌完整 repository 对象 ~4.5KB，REST 无法瘦身）；MC 启动器 `scripts/` 目录 contents 列表 **279KB**（60+ 条目 × 全量字段）；用户指定 `scripts/patch_angle_surface_freeze.py` **实际存在**（9735B，contents JSON 形态 14.5KB 恰在截断阈值边缘）——「文件不存在」实为截断/通道全灭后的误报，而非 404
- **Accept-Encoding: identity（截断阈值抬升尝试）**：真机实测截断只出现在 api.github.com 的分块/压缩流（6.3KB 通知偶断），而 content-length 明确的 identity 流（README 14.3KB、下载器整文件）远超 8KB 可达——REST/GraphQL/下载器全部请求显式带 `identity` 头，让 JSON 响应与下载器同形态；代理尊重则阈值直接抬到 14KB+
- **截断 JSON 抢救解析（salvage）**：蓝牙代理截断长数组时尾部半截、JSON.parse 整体失败原版全弃——现深扫最后一个顶层完整 `}` 恢复前导完整条目；通知管线按已得条数**只补拉缺失尾条**（per=2 截断得 1 条 → 仅 1 次 per=1 补齐，不再整段作废重拉）；下载器截断体同样抢救；列表尾短页零浪费（以 salvage 命中记录门控）
- **GraphQL 目录快车道（getDirList）**：REST 目录列表单条目 300-500B，GraphQL 只取渲染所需瘦字段单条目 ~70B——同目录响应缩 4-7 倍，中型目录（≤100 条）在截断阈值内直达；`scripts` 60 条目实测一次拉全。失败（游客/限流/网络/路径是文件）回落 REST 阶梯（contents → trees → 下载器整树），功能不倒退
- **GraphQL Blob 正文直读（ghqlBlob）**：新增文件通道——`object(expression:"ref:path"){text}` 返回 UTF-8 原文，无 base64 膨胀无元数据噪声（响应 ≈ 文件字节 + 300B），≤11KB 小文件配 identity 头在阈值内；实测 `patch_angle_surface_freeze.py` 9735B 完整取回（e2e）
- **文件完整性守门（expectedSize）**：目录项自带字节数传入文件管线作基准——六通道取回正文与基准不符即判截断/污染，不缓存、直接落下一通道；历史截断缓存（旧版「8KB 后内容为空」毒化产物）命中即作废重拉。「静默截断渲染半截文件」类故障的终极守门员
- **下载器双域**：文件原生下载通道 api.github.com raw 主域优先（代理可达性已被全部 JSON 请求实证），raw.githubusercontent.com 副域兜底——单域 404/不可达不再全灭
- **AI 2026 重构**：①模型清单更新——Copilot Free 当前主力 **GPT-5 mini / Claude Haiku 4** 领衔共 5 模型（老模型殿后）；②**模型自动降级**——请求模型 400/403/404（无权限类）自动切下一模型（额度/网络错误不降级），单模型失效不再全军覆没；③**通道自检**——Copilot 订阅状态（404=未开通，附 github.com/settings/copilot 开通指引）+ Models 微推理实测（403=Token 缺 models 权限，附 scope 编辑指引），AI 页「通道自检」快捷指令一键诊断；④**远程模型目录刷新**——models.github.ai/catalog/models 拉取真实现可用模型（identity + 抢救解析双保险），成功整表替换循环列表；⑤设备授权 scope 追加 `models`（发起端被拒自动回退基础 scope，不破坏登录）
- **404 文案增强**：统一附「GitHub 路径区分大小写」提示（实测 `javaapp` ≠ `JavaApp`，网页 URL 大小写不敏感而 API 严格区分——用户路径混淆的直接解药）
- **测试与验证**：新增 66 项（抢救解析/salvage 门控补拉/GraphQL 目录映射与 404/Blob 直读/expectedSize 守门/坏缓存作废/AI 降级与自检/scope 回退/identity 断言），历史套件断言同步；e2e 真实 API：MC 启动器根树+`JavaApp/src`+`scripts` 大目录 GraphQL 直达、小写路径 404 实证、目标 .py 文件 9735B 完整取回、通知 participating 无 gap、aiProbe 双通道真实诊断（seat 404=未开通）；全量 **473 绿**

### v1.3.0 通知详情三通道 + 深目录死机根治 + Copilot 专区

真机反馈四项的响应（「通知依旧响应数据不完整」「代码区访问深一点的文件夹响应数据不完整或者死机重启」「添加 Copilot 专区，功能尽量多」「性能问题太严重」）：

- **点开通知 → 详情不完整的根治（getIssue 三级通道）**：定位到用户反复反馈的「响应数据不完整」高频真实场景——详情 JSON 内嵌 body 全文，长正文 Issue/PR 30-100KB 必被蓝牙代理截断，重试无解。现三级链路：① REST fetch（短正文 <14.3KB 截断下限内最稳）；② 截断 → request 内置原生下载器兜底 + 显式下载器重试（15/40/10s，与 fetch 不同路，文件管线实证可靠）；③ 下载器失败 → **GraphQL `issueOrPullRequest` 瘦字段逃生**（响应 ~1KB 必达，标题/作者/标签/评论数照常渲染，正文显式提示「过长已省略」并附网页链接）
- **深目录「数据不完整/死机重启」双根治**：①「数据不完整」——深/巨型目录（如 node_modules 单层数百条目）contents 与 git trees 的 fetch 响应 30-120KB 必截断，新增 `getTreeEx`：fetch 截断后原生下载器整树一次到齐；②「死机重启」——目录列表一次性渲染数百条目曾致渲染树爆炸 OOM，现弦电子书式分页（24 条/页 + 翻页器，与文件页同构），节点数恒定
- **新功能：Copilot 专区**（`pages/ai`）：AI 对话双通道——设备授权 token（ghu_，scope 已追加 copilot）优先 **Copilot Chat**（`copilot_internal/v2/token` 换 ~30min 临时凭据 → `api.githubcopilot.com`），失败自动降级 **GitHub Models**（`models.github.ai`，PAT 开箱即用、无需 Copilot 订阅）；六个快捷指令（总结仓库/解释代码/写 commit/找 Bug/写 README/生成 Issue 回复）；会话历史 storage 持久化（40 条）；打字机分帧渲染（14 字/帧，渲染压力可控）；通道/token 用量徽标；网关返回非 JSON 体（健康检查类）明确报错不静默
- **上下文注入「问 AI」**：代码页文件/目录底部新增「问 AI 关于本文件/本目录」——自动注入文件前 120 行片段或目录清单（≤3.6KB）；仓库页新增「问 AI」格（注入仓库简介）；AI 页顶部显示通道与模型（点击循环切换 gpt-4o-mini / gpt-4.1-mini / grok-3-mini）
- **通知「仅参与」三态过滤**：右上角循环 未读 → 全部 → 仅参与——`participating=true` 服务端直接过滤 CI 噪音（实测用户 200+ 条未读中 99% 为 `ci_activity`），列表从百页级缩到 1-2 页，「拉不全」体感随噪音消失
- **通知下载器超时放宽**：per=1 兑底 6/12/4s → 10/22/8s——真机蓝牙代理启动下载即需数秒，旧超时把「能到的响应」误判为死，gap 警告频发
- **测试与验证**：新增 50 项（issue 三通道/树下载器/participating/双通道 AI/网关劫持错误路径）；e2e 真实 API：BandQQ issue 正文完整（rest 通道）、vela-github-client 根树+src 子树、participating 过滤生效、沙箱网关劫持被正确识别报错；全量 407 绿

### v1.2.4 CI 默认分支根修 + 通知弹性阶梯 + 多语言代码高亮

真机三项反馈的根治与一项新功能（「显示我无ci」「通知依旧响应数据不完整」「多语言代码高亮显示器」）：

- **CI「无 CI」根修**：无分支参数时旧版拼 `refs/heads/HEAD` —— 沙箱实测 GitHub 返回 `ref: null`（HEAD 不是合法 qualifiedName），CI 历史页从通知聚合卡/仓库页进入（均不传分支）必然报「分支不存在」。现拆两条查询：无分支走 `defaultBranchRef{target}` 直达默认分支头提交（零额外请求），显式分支保留 `ref(qualifiedName)` 原路径；BandQQ 实测 checkRuns（如「rpk 四分支打包 SUCCESS」）正常渲染
- **通知弹性阶梯（响应数据不完整再根治）**：真机实测 `per=1` 单条 ~6.3KB 响应仍偶发被蓝牙代理截断——v1.2.3 的「1 次快速终止」把可恢复故障变成硬错误。现改为：①歧义截断（JSON 解析失败/空体）给 1 次重试再判死（content-length 实证截断仍 1 次终止）；②`per=1` 之上叠加**原生下载器兜底**（收紧超时 6/12/4s，与 fetch 不同路）；③失败段不再整页报错——低并发重试一轮后仍失败的段记入 gap，**成功段照常渲染**，列表尾部黄色警告行「有 N 段未载入 · 点此重试」定向恢复（404 等硬错误仍整页抛出，绝不静默缺条）
- **通知计数对齐 GitHub**：标题未读数从「卡片数」改为「底层通知条数」（聚合卡按条数累计），与 GitHub 网页徽标一致；列表脚注显示「已载 N 条」，聚合折叠不再造成「数据不完整」体感
- **新功能：多语言代码高亮**（`utils/hl.js`，零依赖零正则引擎）：JS/TS、Java、C/C++、C#、Go、Rust、Kotlin、Swift、PHP、Python、Shell、JSON、CSS、HTML/XML、YAML/TOML、SQL、Markdown、Diff 共 18+ 语言家族；GitHub Dark 色板（关键字红/字符串蓝/数字天蓝/注释灰/函数紫/类型橙/键名绿）；弦电子书式限量渲染——跨行块注释/围栏状态载入时一次预计算，翻页时仅对当页 18 行分词（毫秒级），单行 token 封顶 24 个、拼接无损
- **仓库 CI（GitHub Actions）**：新增 `.github/workflows/build-release.yml`——tag 推送（`v*`）自动 `npm ci → aiot build` 构建 rpk（debug 签名与本地一致）+ 打 src 源码包，双附件自动附到 GitHub Release（workflow_dispatch 支持手动触发）

### v1.2.3 通知 CI 聚合 + 文件五级通道 + CI 历史页（真机实测驱动）

真机实测用户数据后的三大根治（通知 200+ 未读中 99% 为 CheckSuite CI 通知；文件分块第 2 块起必失败）：

- **通知 CI 聚合卡（数据不完整体感根治）**：实测未读 200+ 条中 99% 为 `ci_activity`（CheckSuite）——连续同仓库 CI 通知折叠成一张聚合卡（「N 条 CI 通知（未读 M）」，弦电子书式列表收敛），Issue/PR/Release 通知原样浮出；聚合卡点开直达 CI 历史页，长按批量标记该段全部已读（并发 3 PUT，失败静默计数）；翻页跨页同仓库 CI 自动并卡
- **通知子页 noDl（拉取提速）**：并行子页截断时不再挂起下载器兜底（真机最坏 28s）直接降级 `per=1`，整页最坏 <30s；确定性截断（JSON 解析失败 / content-length 缺口）不再做同参重试（每处省 ~4.8s），200 空体仍保留重试
- **分块 URL 扰动（第 2 块起必失败根治）**：真机蓝牙代理对**同一 URL 的连续请求**存在缓存/去重拦截——每块 URL 追加无害扰动参数 `?_b=<offset>`（服务器忽略未知 query），逐块视为不同请求放行；块大小 8192→12288（仍低于 14.3KB 阈值，块数少 33%）
- **文件五级通道 + 永不空手而归**：磁盘缓存 → 原生下载器（超时 30/45/10→45/75/15s，真机蓝牙代理实测仅数 KB/s）→ URL 扰动分块 → REST raw（**空体/错误体不再静默返回「内容为空」，续走下一通道**）→ **contents JSON base64 终备通道**（≤9.5KB 文件整响应 <14.3KB 可靠到达）；五通道全失败给逐通道诊断文案
- **raw 请求强制 text responseType**：修复 JSON 文件（package.json 等）被引擎 parse 成对象、String() 化为 `[object Object]` 毒化 fcache 的隐藏 bug（e2e 实测）
- **空串缓存防毒化**：raw 空体响应 `data=''` 不再写入内存缓存（旧版会毒化同 URL 的后续不同形态请求）
- **新功能：CI 历史页（Actions）**：commit × checkRuns 列表——GraphQL `Commit.history + statusCheckRollup` 瘦字段（每条 ~370B，10 条 ~3KB 一页安全到达；REST `/actions/runs` 单条实测 17.7KB 恒超蓝牙截断阈值，彻底弃用）；状态点（绿通过/红失败/黄进行中）+ 点条目内联展开 checkRuns（零二次请求）+ 触底加载 + 游客「需登录」提示；入口：通知 CI 聚合卡 / 仓库页 Actions 卡片
- **真机 API 端到端验证**：真实 token 全链路验证——通知聚合（10 条→3 卡）、CI 历史（4075 commits 分页）、文件五通道（package.json 经扰动分块 437B 完整取回）

### v1.2.2 弦电子书式性能重构（通知完整性 + 大文件 + 落盘缓存）

参考同平台成熟电子书应用弦电子书（com.bandbbs.plus.ebook）的分段加载/落盘索引架构：

- **通知并行子页（数据不完整根治）**：量化实证 `/notifications` 单条 ~6KB（嵌入 repository 对象占 5.5KB，REST 无法瘦身，GraphQL 又无通知 API）——逻辑页改为 5 个 `per_page=2` 子页（各 ~12.6KB，低于蓝牙代理截断下限）并发 3 拉取后按序拼接；子页仍截断自动降级为两个 `per=1`（~6.3KB）补齐；任一子页彻底失败整页报错重试，绝不静默缺条造成跳条
- **大文件四级通道（8KB 即空的根治）**：真机实证 Range 分块第 2 块起必失败、REST raw 大文件回空体/截断均为死路——改为「磁盘缓存 → 原生下载器整文件落盘（绕开 fetch 蓝牙代理通道）→ Range 分块 → REST raw」四级链路；raw 站点错误体（`404: Not Found`）啄探不入缓存；GET 200 空响应体一律重试（旧版误判「文件内容为空」）
- **文件磁盘缓存（弦电子书「一次落盘、随读随取」）**：文件内容落盘 `internal://files/fcache/`（LRU 6 文件/4MB），返回导航/冷启重进秒开零传输
- **分页渲染（弦电子书每页限量）**：源码文件从 3000 行一次性入列改为每页 18 行 + 上一页/下一页/页码指示翻页器，模板节点从 ~3000 降到 ~20，低端机滚动不再卡顿；翻页后 `scroll-top` 复位到页首

### v1.2.1 传输优化（全面优化数据传输）

- **内存 TTL 缓存**：GET JSON 90s / raw 文本 5min，返回导航秒开、重复请求省配额；容量上限 40 条自动淘汰最旧
- **ETag 条件请求**：缓存过期后带 `If-None-Match` 复验，304 只回响应头（几十字节替代全量）；代理不支持时无副作用回落 200
- **单飞去重**：同 URL 并发请求合并为一次真实网络往返
- **粘性自适应分页**：同列表翻页期间档位一旦降档绝不回升，修复跨页翻页跳条丢数据（通知/议题/发行版「数据不完整」根因）
- **仓库详情 GraphQL 瘦身**：单页 10-20KB → ~1KB
- **旧缓存兜底**：截断/断网且有历史缓存时回退旧数据（旧数据好过报错）
- **大文件上限 200KB → 1MB**：raw Range 分块引擎同步升级（128 块×8KB），新增块级重试（单块失败不再全盘报废）、首块二进制啄探（NUL 字节报错不渲染乱码）、Content-Range 进度显示、截断明确脚标

### v1.2.0 数据链路（对抗蓝牙代理长响应截断）

真机实测蓝牙代理对长响应存在确定性截断阈值（[14.3, 42)KB），v1.2.0 从三个层面根治：

- **GraphQL 快车道**：议题/发行版/仓库/搜索/趋势五类列表改走 GraphQL，只取渲染所需瘦字段，单页响应从 30-60KB 降到 1-3KB，从源头避开截断；GraphQL 失败自动回退 REST 自适应分页（10→4→1），功能不倒退
- **raw Range 分块**：README 与源码文件经 `raw.githubusercontent.com` 按 8KB 分块拉取（HTTP 206，实证支持），任意大小完整可达；UTF-8 跨块字节用状态机解码，块边界不产生乱码
- **Device Flow 免打字登录**：OAuth Device Flow（复用 GitHub CLI 公开 client_id），手表只显示 8 位码，授权在手机/电脑完成

## 🔧 固件兼容性备忘（RW5 实测，20250716 镜像）

以下坑均在官方 QEMU 模拟器实机复现并修复，源码内有注释标记：

| 坑 | 现象 | 规避 |
|----|------|------|
| `router.push` uri 带前导斜杠 | `route info error!`，所有页面跳转失效 | uri 用 manifest pages key（`pages/xxx`，无斜杠） |
| `for` 默认 `$item` / 带括号 `(i, it) in list` 形态 | 循环子树静默不渲染 | 用 `{{it in list}}` 具名形式 |
| for 数据在事件回调内首次赋值 | for 不渲染（onInit 同步赋值则正常） | 列表数据在 `onInit` 同步初始化 |
| 自定义组件子树 | ~~`js_dom_create_component` 正常但 UI 全灭~~ **已推翻**：问题出在自研组件自身；换用 Vela_input_method 组件后正常渲染 | 组件化可行，优先用成熟组件 |
| `if` false→true 动态创建子树 | 容器背景在、内容全灭 | 交互元素改 `show` 显隐预渲染 |
| 覆盖安装不刷新代码 | 改了代码行为依旧 | 先 `pm uninstall` 再 install |
| `pm install` 卡 "rpk install ongoing" | 解压到 staging 不落地、packages.list 不更新 | 删 `/data/app/rpk_install_*` + 重启 + 单次 install |
| launcher 启动卡内核探测/声卡 | `Can't get kernel version` / `PCI bus not available for hda` | 必须 `-vela` 模式启动（见 scripts/boot_vela.sh） |
| designWidth 216 在 432 宽屏上整体放大 2 倍 | 字巨大、一屏内容极少（BandQQ 同款问题） | designWidth 对齐物理宽 432 + 样式值 ×k 密度系数（BandQQ branch-release.js 同方案） |
| text 节点无显式 height 时布局高度 ≈ font-size | CJK 字形更高 → 兄弟节点叠印/裁切（VM 结构对照实验实证，5 种容器形态仅"显式高度"正确） | 堆叠文本全部显式 height + `lines:1`；多行内容用块高度估算（md.js estBlockH） |
| scroll 直接 `position:absolute` 或裸 `flex:1` | 滚动内容宽度塌陷（~175px） | 成熟模式：`body-wrap{flex:1}` + `scroll{absolute 铺满}` |
| `$watch` 属性监听不触发 | 键盘 hide 切换后高度不更新 → 键盘不渲染 | BandQQ compose 模式：组件 `hide` 恒 false，显隐交给宿主 dock 的 `show` |
| Vela fetch 把 HTTP 403/429 当传输层错误抛出 | 限流被误报为"网络连接失败"且无谓重试 | 错误对象识别 403/429 → 限流文案 + 快速失败 |
| `@system.storage` 真机（RW5）set 回调 success 但另页 context 读不到、进程重启后丢失（模拟器同路径正常） | token 登录后设置页仍游客模式，大退即丢 | storage + `@system.file` 双通道写、读回验证、settings 页持久化诊断行；参考 TG Wear/BandQQ 均把关键状态放手机端的取舍 |

## ⚠️ 已知限制

- PR 仅显示会话正文与评论，不含 code review diffs；发 Issue 待后续版本
- 代码查看上限 3000 行 / 1MB（分页渲染每页 18 行；超过 1MB 拒绝打开，1MB 内经下载器/分块完整可达，超行数/超大小显示明确截断脚标），二进制文件不支持
- 圆屏机型的安全边距为估算值，欢迎真机反馈
- settings 状态卡文字在模拟器 swiftshader 下偶发不渲染（功能不受影响，待真机确认）
- 模拟器 slirp 网络下 `/repos/{full}` 详情与 `/repos/{full}/readme` 请求易挂起（/search、/issues 正常）；真机蓝牙代理/eSIM 栈不同，待真机验证，应用层已加两级退避重试；README 渲染管线已用真实 GitHub 数据在 Node 端全链路验证（91 块正确解析、无乱码）
- Token 含大小写/数字/下划线混合，QWERTY 键盘需借助 `123` 符号盘与大小写切换输入（长串输入稍繁琐）；建议电脑生成后对照逐键输入，仅需一次
- 本固件 `onInit(params)` 不下发起跳参数（引擎级实测 argc:0），页面间传参走应用级 hook 中转（见 `src/utils/view.js`）；`router.push` 的 uri 不可携带 `?query`（会使 `router.back()` 静默失效）

## 📄 许可证

[AGPL-3.0-or-later](./LICENSE) © 2026 Gsjsjzhznsz (yiqiu4178)

## 🧭 参考项目与生态（Vela 手表开发者可复用）

开发过程中调研的同平台开源项目，按对本项目的参考价值排序：

| 项目 | 平台 | 对本项目的启发 |
|------|------|----------------|
| [hrk666666/tgwear-quickapp](https://github.com/hrk666666/tgwear-quickapp)（TG Wear） | 小米 Vela 穿戴设备 | **同平台最成熟的直连型客户端**。网络架构关键决定：全部 Telegram 流量经手机端桥（`@system.interconnect`）转发而非手表直连，规避手表端网络栈限制；手表端 `@system.storage` 仅存轻量 settings，会话主体放手机端。本项目的键盘组件、双通道持久化设计均参考其取舍 |
| [弦电子书](https://github.com/Lejiya/com.bandbbs.plus.ebook.setting)（com.bandbbs.plus.ebook） | 小米手环/手表（米坛社区） | **大文本阅读的性能标杆**：内容分章落盘 + 多级索引 + TTL 内存缓存 + 每页限量渲染 + 分段加载/段落防分割（其「性能设置」面板）。v1.2.2 的文件磁盘缓存与分页渲染直接参考此架构 |
| [cciccicu/JSLab](https://github.com/cciccicu/JSLab) | 小米 Vela 手环 | 手环端 JS 运行时 + 创作链路，其 manifest features 声明与工程结构可对照 |
| [SarmonFish/VelaChat-Backend](https://github.com/SarmonFish/VelaChat-Backend)（VelaChat） | 小米/Redmi 手表 | 微信消息同步：FastAPI HTTP 后端 + 手表端，同样采用「重活放服务器/手机、手表只做展示」的架构 |
| [mu-zi-lee/Halo-Signal](https://github.com/mu-zi-lee/Halo-Signal) | 小米手环 9 Pro | 手表 RPK + 手机 APK + 电脑服务三端协作范式 |
| [BandOTP](https://github.com/topics/vela)（腕码） | 小米手表 | TOTP 验证码查看器，配套安卓端接收配置 |
| [米坛社区 BandBBS](https://www.bandbbs.cn/) | 米环/米表全系 | 中文最大的小米穿戴快应用社区，固件兼容性坑的第一手情报源 |

**平台结论**（本项目实测 + 上述项目交叉印证）：小米 Vela 穿戴设备上成熟应用的通行架构是「重网络/重状态放手机端或服务端，手表端最小化」；本应用因 GitHub API 公开可直连而采用纯手表架构，直连可用但有响应体长度限制（蓝牙代理截断），已用自适应分页 + 下载通道兜底对抗。若需在 Vela 上构建更重的客户端，优先评估 `@system.interconnect` 手机桥方案。

## 🙏 致谢

- [NEORUAA/Vela_input_method](https://github.com/NEORUAA/Vela_input_method)（MIT）—— T9 拼音/QWERTY 键盘组件，RW5 布局适配补丁见 `src/components/InputMethod/README.md`
- [BandQQ](https://github.com/Gsjsjzhznsz/BandQQ) 的 InputMethod 键盘架构与 RW5 固件兼容经验（`{{it in list}}` 具名循环、wrap+absolute 铺满布局）
- [Xiaomi Vela JS 应用官方文档](https://iot.mi.com/vela/quickapp)与 aiot-toolkit

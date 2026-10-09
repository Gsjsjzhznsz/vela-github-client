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

- **首页**：账户状态 + API 余量 + 六大功能入口
- **通知**：点按进入对应 Issue/PR/仓库并自动标记已读；**长按不打开仅标记已读**；右上 ✓ 一键全部已读
- **列表页**：下拉刷新 + 滚到底自动加载下一页（每页 10 条）
- **仓库页**：README / Issues / Releases / 代码 / Star 五宫格操作
- **键盘**：集成 [Vela_input_method](https://github.com/NEORUAA/Vela_input_method) 组件（MIT）——T9 拼音/英文九键（搜索、写评论）+ QWERTY 全键（Token/用户名），顶部操作条提供 搜索/保存/发送/收起
- **评论**：Issue 详情页 →「写评论」→ T9 拼音键盘输入中文/英文 → 发送（需登录）

## ⚡ 性能设计

- 纯文字头像（首字母 + 稳定色相哈希），全程零网络图片
- `scroll` 组件（`scroll-y`）+ 触底自动分页，每页 10 条瘦字段
- README/源码分块渲染（40 块/片），非响应式大对象挂 `this._` 前缀，页面销毁即释放
- 键盘组件懒建保活：首次弹出才建子树，之后 `hide` 切换只走显隐（InputMethod 原生优化）
- 网络请求带 1.2s/2.4s 两级退避重试（弱网/蓝牙代理下更稳）
- 应用启动零网络请求，onShow 智能去重

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
- 代码查看上限 3000 行 / 200KB，二进制文件不支持
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

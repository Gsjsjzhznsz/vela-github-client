# GitHub for Vela ⌚

运行在 **小米 Vela OS** 手表上的 GitHub 客户端，优先适配 **Redmi Watch 5**（432×514 方屏），兼容圆屏机型。数据经 **小米运动健康** 蓝牙代理或 **eSIM** 独立联网直连 GitHub REST API。

> 基于 Vela 官方 JS 应用框架（aiot-toolkit）开发，遵循官方组件 / API 白名单与性能规范。

## ✨ 功能

| 模块 | 说明 |
|------|------|
| 🔔 通知中心 | 未读列表、未读数角标、单条已读直达、一键全部已读、未读/全部切换 |
| 📦 仓库 | 我的仓库（按最近 push 排序）、指定用户公开仓库、Star 数 / 语言 / 更新时间 |
| 📖 README | Base64 解码 + 轻量 Markdown 转换，分块懒加载阅读 |
| 🐛 Issues | 开放/已关闭切换、标签展示、正文与评论流式阅读（支持 PR 会话） |
| 🔍 搜索 | 关键词搜仓库，显示结果总数 |
| 📈 趋势 | 新星（周）/ 黑马（季）/ 经典 三档榜单（GitHub 无官方 Trending API，用 stars 排序模拟） |
| 🌲 代码浏览 | 目录树逐级进入、源码等宽分行查看、二进制与大文件守卫 |
| 👤 个人主页 | 登录自动加载 / 游客输入用户名查询，仓库/粉丝/关注统计 |
| ⭐ Star | 仓库页一键 Star / 取消 Star |
| 🔑 双模式 | Personal Access Token 登录 或 游客模式（匿名限流 60 次/小时） |

## 📱 适配设备

| 设备 | 屏幕 | 适配状态 |
|------|------|----------|
| Redmi Watch 5 | 432×514 方形 | ✅ 主力适配（designWidth 216，1 设计 px = 1 dp） |
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

### 4. 配置 GitHub Token（可选但强烈建议）

1. 电脑打开 `github.com` → Settings → Developer settings → Personal access tokens → **Tokens (classic)**
2. Generate new token (classic)，勾选 `repo`、`notifications` 权限
3. 手表打开本应用 → 设置 → 「输入 Personal Access Token」，用内置键盘输入一次
4. Token 经 `/user` 接口验证后保存到**手表本地存储**，不上传任何第三方服务器

> 游客模式可不登录直接使用搜索/趋势/公开仓库（GitHub 匿名限流 60 次/小时）。

## 🗂 使用指南

- **首页**：账户状态 + API 余量 + 六大功能入口
- **通知**：点按进入对应 Issue/PR/仓库并自动标记已读；右上 ✓ 一键全部已读
- **列表页**：下拉刷新 + 滚到底自动加载下一页（每页 10 条）
- **仓库页**：README / Issues / 代码 / Star 四宫格操作
- **键盘**：输入框点击弹出内置键盘，`↑` 切大写，`123` 切符号，`完成` 收起

## ⚡ 性能设计

- 纯文字头像（首字母 + 稳定色相哈希），全程零网络图片
- `scroll` 组件（`scroll-y`）+ 触底自动分页，每页 10 条瘦字段
- README/源码分块渲染（40 块/片），非响应式大对象挂 `this._` 前缀，页面销毁即释放
- 键盘为页面内联模板（数据由 `utils/kb.js` 构建），`onInit` 一次性建行 + `show` 显隐保活
- 应用启动零网络请求，onShow 智能去重

## 🔧 固件兼容性备忘（RW5 实测，20250716 镜像）

以下坑均在官方 QEMU 模拟器实机复现并修复，源码内有注释标记：

| 坑 | 现象 | 规避 |
|----|------|------|
| `router.push` uri 带前导斜杠 | `route info error!`，所有页面跳转失效 | uri 用 manifest pages key（`pages/xxx`，无斜杠） |
| `for` 默认 `$item` / 带括号 `(i, it) in list` 形态 | 循环子树静默不渲染 | 用 `{{it in list}}` 具名形式 |
| for 数据在事件回调内首次赋值 | for 不渲染（onInit 同步赋值则正常） | 列表数据在 `onInit` 同步初始化 |
| 自定义组件子树 | `js_dom_create_component` 正常但 UI 全灭 | 关键 UI 内联到页面 |
| `if` false→true 动态创建子树 | 容器背景在、内容全灭 | 交互元素改 `show` 显隐预渲染 |
| 覆盖安装不刷新代码 | 改了代码行为依旧 | 先 `pm uninstall` 再 install |

## ⚠️ 已知限制

- 只读为主：写操作仅支持 Star 与通知已读（发 Issue/评论等待后续版本）
- PR 仅显示会话正文与评论，不含 code review diffs
- 代码查看上限 3000 行 / 200KB，二进制文件不支持
- 圆屏机型的安全边距为估算值，欢迎真机反馈
- settings 状态卡文字在模拟器 swiftshader 下偶发不渲染（功能不受影响，待真机确认）

## 📄 许可证

[AGPL-3.0-or-later](./LICENSE) © 2026 Gsjsjzhznsz (yiqiu4178)

## 🙏 致谢

- [BandQQ](https://github.com/Gsjsjzhznsz/BandQQ) 的 InputMethod 键盘架构与 RW5 固件兼容经验（`{{it in list}}` 具名循环、wrap+absolute 铺满布局）
- [Xiaomi Vela JS 应用官方文档](https://iot.mi.com/vela/quickapp)与 aiot-toolkit

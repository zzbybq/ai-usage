# AI Usage

本地 AI 编码工具的 token / 成本看板。直接读取 Claude Code 和 Codex CLI 在本机产生的 JSONL 会话文件，按天 / 模型 / 来源聚合，**所有数据不出本机**。

技术栈：Next.js 16 · React 19 · Tailwind 4 · Recharts · lucide-react。

## 环境要求

- Node.js **20.10+**（Next 16 要求）
- 本机已经在用 Claude Code 或 Codex CLI（看板靠它们写在磁盘上的 JSONL 文件工作；没用过就没数据）
- Windows / macOS / Linux 任意均可，路径全部用 `os.homedir()` 解析

## 数据来源

| 工具 | 路径 | 解析逻辑 |
|---|---|---|
| Claude Code | `~/.claude/projects/**/*.jsonl` | `type=assistant` 行的 `message.usage`，按 `message.id` 去重 |
| Codex CLI | `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` | `event_msg.payload=token_count`，对累计值取差量；session 内 `rate_limits` 仅作为额度降级快照 |
| Hermes | `~/.hermes/state.db`（Windows 兼容 `%LOCALAPPDATA%/Hermes/state.db`） | 会话累计 token 首次建立基线，后续通过持久化快照按本地日期记录增量 |

价格表硬编码在 `src/lib/pricing.ts`，匹配不到时按模型名 fallback（含 `opus/sonnet/haiku/gpt-5/codex`）。

Hermes 的差量状态默认写入 `~/.ai-usage/hermes-usage-state.json`，可用 `HERMES_USAGE_STATE_FILE` 覆盖。启用快照前已经发生的跨天用量无法精确回溯，首次观测仍沿用会话结束时间、缺失时使用开始时间作为历史基线；此后的增量会进入实际观测日。

## 启动

首次拿到项目源码后，先装依赖：

```bash
npm install
```

### 开发模式（带热更新）

```bash
npm run dev
```

默认监听 **http://localhost:3002**。若端口被占，可在 `package.json` 里改 `-p <端口>`。

### 生产模式（推荐长期跑）

```bash
npm run build
npm run start
```

也跑在 3002。生产模式启动快、内存占用低，关掉终端窗口它就停。

### Windows 后台常驻 + 开机自启（推荐 PM2）

本机就是用 **PM2** 托管 `ai-usage` 进程跑 `next start -p 3002`，配 `pm2-windows-startup`
实现登录自启。完整的运行架构、自启原理和运维命令见
**[docs/deployment.md](docs/deployment.md)**。

常用命令速查：

```bash
npm run build                          # 改代码后必须重新构建
npx pm2 restart ai-usage --update-env  # 重启使其生效
npx pm2 save                           # 固化进程列表，保证开机自启恢复最新状态
npx pm2 status                         # 查看状态
```

> 想临时手动拉起、不走 PM2，可用根目录 `start-hidden.vbs`（无窗口启动）+ `stop-server.cmd`（停掉 3002）。两种方式二选一，别同时跑。

### macOS / Linux 后台常驻（可选）

```bash
nohup npm run start > server.log 2>&1 &
echo $! > .server.pid
```

停掉：`kill $(cat .server.pid)`

## 桌面悬浮球（Tauri）

除了浏览器看板，本项目还能打包成 Windows 桌面悬浮球 **AI Usage.exe**：屏幕角落一个常驻玻璃球，鼠标悬停展开卡片，托盘图标可开完整看板。它是一层 **Tauri 2 外壳**，代码在 `src-tauri/` 和 `tauri-ui/`：

| 文件 | 角色 | 说明 |
|---|---|---|
| `src-tauri/src/lib.rs` | Rust 主进程 | 建悬浮窗 / 托盘 / 生命周期；4 个 command：`get_geometry`（光标+窗口+工作区几何）、`set_bounds`（改窗口位置尺寸）、`open_history`（开浏览器看板）、`fetch_usage`（std TcpStream 直连 3002 的轻量 `/api/widget` 接口） |
| `tauri-ui/index.html` | 渲染 UI | 玻璃球 + canvas 正弦水波 / hover 展开卡片 / 贴边隐藏三态，透明置顶无边框窗；4 主题（Ocean/Aurora/Sunset/Lagoon） |
| `src-tauri/tauri.conf.json` | Tauri 配置 | 112×112 无边框透明置顶窗口；Windows 输出 NSIS，macOS 可输出 app/dmg |

### 外壳 ↔ 3002 服务的关系（关键）

悬浮球**不是**把页面塞进 webview 直接渲染，而是在本机跑一个**真实的 Next.js 服务**（3002 端口）。正式安装包会携带固定版本 Node.js 和精简后的 Next standalone，由 Tauri 自动托管：

```
AI Usage.exe (Tauri 主进程 lib.rs)
   ├─ 启动 / 监督内置 Node + Next standalone（127.0.0.1:3002）
   │  fetch_usage command: std TcpStream GET http://127.0.0.1:3002/api/widget
   │  连接失败时短退避重试 3 次，并保留 connect/read/http/json 错误类别
   ├─ 悬浮窗 tauri-ui/index.html   —— 每 15s 调 fetch_usage 刷新今日用量与额度状态
   └─ 托盘「Open Full Dashboard」→ 浏览器打开 http://localhost:3002（同一个服务）
```

要点：

- **安装版不再需要 PM2、系统 Node 或手动执行 `npm start`**。Tauri 启动时先识别已有 AI Usage 服务；没有服务时启动内置 runtime，异常退出或连续健康检查失败时自动重启。
- 应用默认注册开机自启，并使用 single-instance 防止重复启动。用户从托盘选择 `Quit` 后，Tauri 会关闭自己托管的 Node 服务；应用退出期间网页和定时调度也不会运行。
- 源码开发仍可用 `npm run dev` / `npm start` 单独启动 3002；`widget:dev` 会复用这个外部服务，不强制生成桌面 runtime。
- 悬浮窗和浏览器看板**共用同一个 3002 服务和同一份数据**，只是两个前端而已。
- 单次刷新失败时继续显示最后一次成功数据并显示琥珀色状态点；连续失败 3 次后才切换为红色离线状态，错误详情会保存在 WebView `localStorage` 中。
- 展开面板用 `Today / Limits` 分离用量和剩余额度；工具用量按用户选择逐行渲染，列表过长时在卡片内滚动。
- Codex 额度优先通过本机 `codex app-server` 的 `account/rateLimits/read` 实时获取，并按接口返回的实际 `windowDurationMins` 展示窗口；当前没有 5 小时窗口就不显示，后续恢复时会自动增加。实时读取失败时才降级到 session 中最后一次观察值并标记 stale。
- 额度采集与 token 用量采集是独立能力；目前只有 Codex 提供可靠额度信号，其他已选工具继续正常统计用量但不会虚构剩余百分比。非标准 Codex 安装可用 `AI_USAGE_CODEX_BIN` 指向原生 `codex` 可执行文件。

### 构建与启动

```bash
npm install          # 首次需装 @tauri-apps/cli（已在 devDependencies 声明）
npm run build        # 仅构建独立部署使用的 .next
npm start            # 仅源码/PM2 部署时手动启动 3002
npm run widget:build # 自动构建 .next-desktop、打包 Node runtime，再生成一体化安装包
npm run widget:dev   # 本地调试外壳（需 3002 服务已起）
```

Windows x64 产物位于 `src-tauri/target/release/bundle/nsis/`。macOS 需要在 Mac 上安装 Node、Rust 和 Xcode Command Line Tools 后执行同一构建命令，按机器架构下载对应 Node runtime，并输出 `.app/.dmg`；对外分发仍需 Apple Developer 签名和公证。

> ⚠️ 性能注意：悬浮窗是**透明 + 置顶 + 无边框**窗口。水波 canvas 动画在球态以 ~30fps 跑、展开卡片时停。hover 状态机以 200ms 轮询光标几何（`get_geometry`），已从早期 100ms 降下来减半 IPC 开销——改壳时别再往高频轮询或常驻 `infinite` 动画里加东西。

## 功能

- **顶部 4 张卡片**：今日 tokens / 今日 cost / 区间总 tokens（带 sparkline）/ 区间总 cost（带 sparkline）
- **来源拆分条**：Claude vs Codex 今日占比
- **Codex Rate Limits**：5h 窗口 + 周窗口进度条 + reset 倒计时
- **日柱状图**：按 Claude / Codex 堆叠，可在 Tokens / Cost 之间切换，可切 7d / 30d / 90d
- **Top 模型表**：Top 10 模型 + 来源 chip + 占比条
- **每 15s 自动刷新**

## 扩展新的 AI 工具

加 Cursor / Gemini / 其它：

1. 在 `src/lib/sources/` 新建 `<name>.ts`，导出 `read<Name>Usage(sinceDate: string): Promise<UsageEvent[]>`
2. 在 `src/lib/types.ts` 的 `SourceId` 联合类型里加 `"<name>"`，并在 `SOURCES` 数组加颜色和标签
3. 在 `src/lib/aggregate.ts` 的 `Promise.allSettled` 列表加上新的读取函数，并在结果合并时 push 进 `events`

UI 自动按 `event.source` 着色和分组，无需改动。

## 项目结构

```
src-tauri/                      # Tauri 桌面外壳（悬浮球）
├─ src/lib.rs                 # Rust 主进程：窗口/托盘/fetch_usage 直连 3002
├─ tauri.conf.json            # Tauri 配置（无边框透明置顶窗口，nsis bundle）
└─ icons/                     # 应用图标
tauri-ui/
└─ index.html                 # 悬浮球 UI（玻璃球水波/展开卡片/贴边三态，4 主题）

src/
├─ app/
│  ├─ api/
│  │  └─ usage/route.ts       # GET /api/usage?days=N
│  ├─ _components/            # KPI 卡 / 图表 / 表格 / Header 等
│  ├─ globals.css             # 设计令牌 + 卡片样式
│  ├─ layout.tsx
│  └─ page.tsx                # 主仪表盘
└─ lib/
   ├─ sources/
   │  ├─ claude.ts            # Claude Code JSONL 解析
   │  └─ codex.ts             # Codex JSONL 解析
   ├─ pricing.ts              # 模型价格表
   ├─ aggregate.ts            # 跨来源聚合
   ├─ types.ts                # 公共类型
   └─ format.ts               # K/M/B / $ / 相对时间格式化
```

## 常见问题

**端口被占 / 想换端口**
改 `package.json` 里 `dev` 和 `start` 脚本的 `-p <端口>`。

**启动报 "Another next dev server is already running"**
旧的 `.next/dev` 锁残留。在项目根目录执行：
```bash
# Windows PowerShell
Remove-Item -Recurse -Force .next

# macOS / Linux
rm -rf .next
```
然后重试。

**Codex 成本仅供参考**
Codex 走 ChatGPT Plus / Pro 订阅是按月固定费，看板里的 `$` 是按 GPT-5 公开 API 价计算的"折算"值，用来横向对比 token 体量，并非实际账单。

**第三方代理模型价格不准**
`z-ai/glm-5.1`、`moonshotai/kimi-k2.5` 这类目前 fallback 到 Sonnet 价。需要精确可在 `src/lib/pricing.ts` 里加。

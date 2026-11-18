# 架构与方案选择

基于 Hermes Agent **v0.23.2**（stable，commit `ae2a81c`）的源码与随版本文档（`website/docs/`）核实。

## 1. 四个组件的真实职责（不要按名字猜）

| 组件 | 启动方式 | 职责 | 是否适合作为手机端 |
|---|---|---|---|
| **Gateway** | `hermes gateway run` / 系统服务 | 唯一的 Agent 执行者：会话所有权、任务队列、工具批准、事件流、消息平台、cron。CLI、TUI、Desktop、Webapp 都连它。 | 是执行核心，不是界面 |
| **Webapp** | `webapp.enabled: true`，由 Gateway 在 `webapp.port`（默认 9120）提供 | 把 Desktop 工作台放进浏览器：会话、聊天、附件、批准、产物、定时任务、设置、文件、终端。有窄屏/触控/软键盘适配与简体中文。远程访问需要登录（Dashboard 登录提供方）。 | ✅ **本方案采用** |
| **Web Dashboard** | `hermes dashboard`（默认 9119） | 管理面板（状态、配置、密钥、会话、日志、cron、技能、MCP），其“Chat”页是把 TUI 塞进伪终端。 | ✗ 管理用途，手机上体验差 |
| **API Server** | `API_SERVER_ENABLED=true`（默认 8642） | OpenAI 兼容接口（`/v1/chat/completions`、`/v1/responses`、`/v1/runs` 等），用服务级 `API_SERVER_KEY` 认证，供第三方前端调用。 | ✗ 浏览器会拿到服务级密钥；也不是 Desktop/CLI 共享的会话通道 |

结论：按“优先官方 Webapp → 再考虑独立前端 → 最后才写适配层”的顺序，**方案 A（官方 Webapp）已满足主要目标**。本仓库只补 PWA、安全区、退出清理与远程入口，没有新增后端服务。

## 2. 同步与可靠性：官方机制如何覆盖需求

| 需求 | v0.23.2 的官方机制 | 验证 |
|---|---|---|
| 单一权威实例 | Gateway 拥有执行权；“客户端不拥有运行中的 Agent”，同一 profile 的已验证操作者可接入 CLI/TUI/Desktop 会话（`docs/user-guide/sessions.md`） | S04、S05 |
| 跨端看到新消息 | Gateway 事件流推送给所有打开该会话的客户端 | S04（A 无需刷新即看到 B 的回复与改名） |
| 重连先取权威状态再补事件 | `session.resume`/`session.activate` 返回快照，`session.events.since` 按游标补齐 | S06、S06b |
| 浏览器关闭任务继续 | 客户端断开只是“detach”；`dashboard.ws_orphan_activity_stale_s`（默认 600s）内仍有产出的轮次继续跑完 | S06 |
| 防重复执行 | 每次 `prompt.submit` 带 `submission_id`（UUID），Gateway 返回 admission 回执；Webapp 在重连后用同一 ID 核对，不换新 ID 重发 | S07（连按、回执丢失、离线） |
| 不确定是否执行 | 回执丢失 → 显示“本轮失败/重试”，由用户决定；网关崩溃中断的轮次标为 unknown，“排队—已暂停”，需用户丢弃或继续；`prompt.resolve_unknown` 用于核对 | S07、S12 |
| 可覆盖操作的冲突 | 重命名/归档/置顶走 `PATCH /api/sessions/{id}`，必须带 `request_id` + `expected_revision`；过期版本 → 409 `revision_conflict`；同一 `request_id` 重试返回原回执 | S04 |
| 同会话并发 | 会话忙时新消息进入 Gateway 的 FIFO 队列（与 CLI/Desktop 同一队列） | S12 截图中的队列面板 |
| 工具批准 | `approval.request` 绑定 `prompt_id`；任一端处理后其他端卡片失效 | S09 |
| 取消 | 停止按钮发出真实中断，Gateway 中止上游模型流；不撤销已发生的文件写入 | S08 |
| profile 一致 | 消息接口返回 `profile`；Webapp 状态栏显示当前 profile | S04 |

本仓库**没有**另建消息、任务、同步或记忆存储，也不直接读写 `state.db`。

## 3. 本仓库新增的部分

### 3.1 `deploy/desktop-plugin/mobile-pwa/plugin.js`

官方 Desktop 插件（ESM，`register(ctx)`），Webapp 从主机的 `~/.hermes/desktop-plugins/` 加载。只在 `data-hermes-desktop-host="browser"` 时生效：

1. 注入 `<link rel="manifest" href="/pwa/manifest.webmanifest">` 与 iOS/Android 主屏幕元信息，把透明背景的官方图标换成不透明版本（iOS 会把透明区渲染成黑色）。官方 CSP 已允许 `manifest-src 'self'`。
2. 触控设备上追加 `viewport-fit=cover`，用 `env(safe-area-inset-*)` 给 `#root` 留出安全区；输入框获得焦点（软键盘弹出）时去掉底部留白。
3. 包装页面内 `fetch`：检测到 `POST /auth/logout` 成功后，用白名单只保留主题/布局等纯界面偏好，清除 localStorage/sessionStorage 中的草稿（`hermes:composer-drafts:*`）、待确认提交（`pendingSubmissions`）、队列、最近会话/路由、未读计数等；通过 `BroadcastChannel` 通知同设备其他标签页一起清除，并在页面卸载时再清一次，防止应用把内存中的草稿写回。

插件不发额外请求、不读会话内容；`ctx.onDispose` 时全部还原。

### 3.2 `/pwa/` 静态文件

`manifest.webmanifest`（`display: standalone`、`start_url: /`、中文名）与 180/192/512/maskable 图标。浏览器拉取 manifest 不带 Cookie，所以它必须在登录门之外：由 Tailscale Serve 直接从 `~/.hermes/mobile-pwa/` 提供，不经过 Gateway，内容不含任何私密信息。

### 3.3 远程入口：Tailscale Serve

```
tailscale serve --bg --https=443 http://127.0.0.1:9120
tailscale serve --bg --https=443 --set-path /pwa ~/.hermes/mobile-pwa
```

- 只在 tailnet 内可达，证书由 Tailscale 签发（真 HTTPS，Secure Cookie、剪贴板、通知等安全上下文功能可用）。
- Serve 与 Gateway 在同一台机器上，经 loopback 转发，Gateway 默认信任 loopback 的 `X-Forwarded-*`，无需 `trusted_proxies`。
- 支持 WebSocket，不缓冲流式输出；长任务不依赖浏览器连接存活（断开只是 detach）。
- `webapp.public_url` 设为该 HTTPS 地址后：Gateway 强制登录、只接受该主机名、登录回调基于它构建。

### 3.4 公网暴露

用户名/密码提供方官方定位为“可信网络或 VPN”。若必须走公网域名：在同机运行 HTTPS 反代/隧道，`webapp.public_url` 指向公网地址，并改用官方 **Nous 账号登录**（`hermes dashboard register` 或 Desktop 的 Settings → Web Access）或 **自建 OIDC**（`dashboard.oauth.provider: self-hosted`）。不要直接在路由器上转发 9120 端口，也不要用 Tailscale Funnel 配合用户名/密码登录。

## 4. 明确不做的事

- 不升级、不重装、不修改 Hermes 源码与内部数据库。
- 不让多个 Hermes 实例写同一数据库，不用网盘同步 `state.db`。
- 不把 Service Worker 当后台执行环境，不依赖 iOS 后台保持 WebSocket。
- 不暴露 API Server 或 Dashboard 到公网，不在浏览器中保存服务级密钥。

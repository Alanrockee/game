# Hermes 移动端：官方 Webapp + 跨端同步

让你在 iPhone / Android / iPad / 任意电脑浏览器上，使用**同一台电脑上的同一个 Hermes Agent**：同一份会话、同一个任务队列、同一套模型 / 工具 / Skills / 记忆。手机锁屏、断网、关掉网页都不影响已经提交的任务，重新打开就能看到真实进度和结果。

> 这里的 Hermes 指 Nous Research 的 [Hermes Agent](https://github.com/NousResearch/hermes-agent)。本仓库在 **Hermes v0.23.2（commit `ae2a81c`）** 上实现与验证。

---

## 一句话方案

**直接用 Hermes 官方 Webapp**（由 Hermes Gateway 提供的浏览器工作台），只补它缺的三件事：

| 需要 | 官方已有 | 本仓库补充 |
|---|---|---|
| 手机能用的聊天界面、会话列表、停止、附件、工具批准 | ✅ Webapp 自带窄屏布局、触控、软键盘视口处理、简体中文 | — |
| 跨端同步、断线续跑、防重复执行、版本冲突检测 | ✅ Gateway 统一执行，`submission_id` 幂等，事件重放，revision 乐观并发 | — |
| 登录 | ✅ 官方用户名/密码登录（HttpOnly + Secure Cookie、限流、退出即撤销） | 一键生成哈希与签名密钥 |
| 离开家/校园网后用手机流量访问 | 官方支持“反向代理/隧道 + `webapp.public_url`” | **Tailscale Serve**（仅 tailnet 内可达的 HTTPS） |
| 添加到主屏幕以独立 App 打开 | ❌ 没有 Web App Manifest | **mobile-pwa 插件** + manifest/图标 |
| iPhone 底部手势条 / 刘海安全区 | ❌ | **mobile-pwa 插件**（键盘弹出时自动去掉留白） |
| 退出登录后清除本机草稿等私密状态 | ❌ 草稿、待确认提交记录会留在 localStorage | **mobile-pwa 插件**（多标签页一起清除） |

不改 Hermes 源码，不另建数据库、记忆或任务执行器。插件走官方 Desktop 插件机制（`~/.hermes/desktop-plugins/`），删掉即恢复原状。

```
 手机/平板/电脑浏览器 ──HTTPS(仅 tailnet)──► Tailscale Serve（Hermes 主机上）
                                              ├─ /      → 127.0.0.1:9120  Hermes Gateway（Webapp + 登录门 + 实时事件）
                                              └─ /pwa/  → ~/.hermes/mobile-pwa（manifest、图标，非私密）
 Hermes 主机：Gateway ── 唯一执行者 ── state.db（会话/消息）、工作区文件、附件、模型与工具配置
 CLI / TUI / Hermes Desktop 也连同一个 Gateway → 同一会话、同一队列
```

各组件职责与取舍见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)；逐项验证结果见 [docs/VERIFICATION.md](docs/VERIFICATION.md)。

---

## 你需要准备

1. **Hermes 主机**：已安装 Hermes Agent ≥ v0.23.2（Linux / macOS / WSL2；原生 Windows 见文末），模型和工具已经能在 CLI 里正常用。
2. **Tailscale**（免费个人版即可），电脑和手机都安装并登录**同一个账号**。在 [管理后台 → DNS](https://login.tailscale.com/admin/dns) 打开 **MagicDNS** 和 **HTTPS Certificates**。
3. 电脑保持**开机、联网、不睡眠**（见下文“让电脑保持在线”）。

> **macOS 提示**：Tailscale 的 App Store 版和“系统扩展”版出于沙盒限制，不能用 `tailscale serve` 直接提供本地目录（Tailscale 源码中的明确限制），因此 `/pwa/` 的 manifest 和图标无法提供。脚本会提示，插件也会自动跳过 manifest：网页照常可用，iPhone 仍可从主屏幕以独立窗口打开（依靠插件注入的 iOS 元信息），Android 只能创建普通快捷方式。需要完整 PWA 时，可改用 Tailscale 的开源 `tailscaled` 版本（见 Tailscale 文档“macOS variants”）。

> 不想用 Tailscale？任何你自己运行在**同一台机器**上的 HTTPS 反向代理/隧道都可以（`--public-url`）。但用户名/密码登录官方只建议用于可信网络或 VPN；如果要暴露到公网，请改用 Hermes 官方的 Nous 账号登录或自建 OIDC（见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#公网暴露)）。**不要**用 Tailscale Funnel 把它公开到互联网。

## 安装（在 Hermes 主机上执行）

```bash
git clone <本仓库地址> hermes-mobile && cd hermes-mobile
bash deploy/setup-webapp.sh
```

脚本会依次：检查版本与网关运行方式 → `hermes backup --quick` 并另存 `config.yaml`/`.env` → 让你设置登录用户名和密码（不回显，只保存 scrypt 哈希）→ 配置 `webapp.*` → 界面切换简体中文 → 安装插件与 PWA 文件 → 配置 Tailscale Serve → 构建 Webapp → 重启网关 → 自检。可重复执行。

常用选项：

| 选项 | 作用 |
|---|---|
| `--user NAME` | 登录用户名（默认 `me`） |
| `--port 9120` | Webapp 本机端口 |
| `--public-url https://...` | 不用 Tailscale，使用你自己的 HTTPS 入口 |
| `--install-service` | 网关目前是手动/Desktop 启动时，改为系统服务（开机/登录自启） |
| `--no-zh` | 不修改界面语言 |
| `--block-terminal` | 在 Tailscale 入口屏蔽 Webapp 的“主机终端”（见安全说明） |

**网关正在跑任务时**，官方会拒绝重启，脚本会提示你稍后执行 `hermes gateway restart`，不会打断任务。

## 手机上使用

访问地址：**`https://<电脑名>.<tailnet名>.ts.net`**（脚本结束时会打印；也可在 Tailscale App 的设备列表里看到）。手机需打开 Tailscale 并保持连接；用 Wi-Fi 或蜂窝流量都可以。

首次打开会进入登录页，输入用户名和密码即可。登录有效期 12 小时，期间自动续期，最长 30 天。

**添加到主屏幕**
- **iPhone / iPad（Safari）**：打开地址并登录 → 分享按钮 → “添加到主屏幕” → 确认名称“Hermes”。之后从主屏幕图标打开是独立窗口。主屏幕 App 与 Safari 不共享登录，第一次从图标打开需要再登录一次。
- **Android（Chrome）**：打开地址并登录 → 右上角菜单 → “添加到主屏幕”/“安装应用”。

**常用操作**
- 新建会话：右上角 `＋`；切换会话：顶部会话名下拉，或左上角侧栏按钮。
- 附件：输入框左侧 `＋` → “文件…” / “图片…”（手机上可直接拍照）。单个文件上限 16 MiB。
- 停止任务：回复进行中时输入框右侧的 ■。显示“停止”后以后端确认为准。
- 工具需要批准时，消息里会出现命令卡片：“拒绝 / 始终允许… / 运行”。电脑和手机都能看到同一张卡片，任一端处理后另一端随之失效。
- 退出登录：设置（齿轮）→ 顶部“主模型 ⌄”切换栏 → 下滑选“网关” → “退出登录”。退出会撤销服务器端登录，并清除本机草稿等私密状态。
- 立即让所有设备下线：在电脑上 `bash deploy/hermes-mobile.sh signout-all`。

**状态怎么看**
- 底部状态栏“后端 就绪”= 已连接；断网时显示红色“Backend offline”，输入框提示“Reconnecting to Hermes…”，发送按钮不可用，草稿保留，**恢复连接后不会自动发送**。
- 发送时连接断了、无法确认是否送达：显示“本轮失败 + 重试”，内容放回输入框，由你决定是否重发，不会静默重复执行。
- 网关崩溃/重启时正在跑的那一轮：显示在“排队 — 已暂停 / 重启期间该轮次已丢失”，可“丢弃”或手动继续，**不会自动重跑**。

## 电脑上已有的会话

- CLI（`hermes chat`）、TUI、Hermes Desktop、Webapp 都由同一个 Gateway 执行：在电脑上开始的会话，手机打开即可继续；手机上的新消息，电脑上 `hermes chat --resume <会话ID>` 也能看到并接着聊（已实测，见验证报告 S05）。
- **升级到“网关拥有会话”之前写下的旧会话**在 Webapp 里只读。在电脑上执行一次 `hermes sessions adopt`（其他 profile 用 `hermes -p <名称> sessions adopt`），或在 CLI/Desktop 里打开一次即可接续。由独立 WebUI 进程写下的会话、旧的 cron/子代理记录保持只读，这是官方规则，本方案不绕过。

## 日常管理

```bash
bash deploy/hermes-mobile.sh status      # 网关、Webapp、Tailscale Serve、登录门、PWA 一起检查
bash deploy/hermes-mobile.sh restart     # = hermes gateway restart（有任务运行时会拒绝）
bash deploy/hermes-mobile.sh start|stop
bash deploy/hermes-mobile.sh logs        # 跟随网关日志（也可 logs agent / logs errors）
bash deploy/hermes-mobile.sh backup      # 官方快照：config、state.db、.env、auth、cron
bash deploy/hermes-mobile.sh update      # 先快照，再 hermes update（会自动重建 Webapp）
bash deploy/hermes-mobile.sh rollback    # 恢复 setup 前的 config.yaml/.env，移除插件与 Serve 配置
bash deploy/hermes-mobile.sh signout-all # 所有浏览器立即退出登录
```

**更新与回退**：`update` 走官方 `hermes update`（官方默认会先备份）。如果新版本 Webapp 有问题，先 `rollback` 关掉手机入口，再按官方文档回退 Hermes 版本；你的会话数据在 `state.db` 中不受本仓库影响。本仓库只依赖官方配置键和插件接口，升级后重新运行一次 `setup-webapp.sh` 即可。

## 数据、附件与备份位置（Hermes 主机）

| 内容 | 位置 |
|---|---|
| 会话、消息历史（权威数据） | `~/.hermes/state.db`（不要用网盘同步正在使用的数据库） |
| 手机上传的附件 | 会话工作目录下的 `.hermes/attachments/`（默认工作目录是主目录 → `~/.hermes/attachments/`），文件名形如 `web-<随机>-原名` |
| Hermes 生成的文件 | 任务写到哪里就在哪里（工作区内），手机端通过官方下载接口获取 |
| 登录凭证（哈希、签名密钥） | `~/.hermes/.env`（权限 600） |
| Webapp / 语言配置 | `~/.hermes/config.yaml` 的 `webapp:`、`display:` |
| 插件与 PWA 文件 | `~/.hermes/desktop-plugins/mobile-pwa/`、`~/.hermes/mobile-pwa/` |
| 本方案的配置备份 | `~/.hermes/backups/mobile-webapp-<时间>/` |

**保留与清理**：会话默认永久保留（`sessions.auto_prune` 默认关闭；开启后按 `sessions.retention_days`，默认 90 天）。v0.23.2 文档中没有附件自动清理策略，附件会一直保留在 `.hermes/attachments/`，需要时手动删除。手机本机只保存界面偏好，以及未发送的草稿和待确认提交记录；退出登录时由插件清除。插件不注册 Service Worker，不缓存任何接口数据或附件。

## 让电脑保持在线

手机能用的前提是 Hermes 主机开着、联网、网关在跑。本仓库**不会修改你的系统电源设置**，请按需自行选择：
- 装了 Hermes Desktop：设置 → 高级 → **Keep computer awake**（官方功能；“While working”只在任务运行时防睡眠）。
- macOS：系统设置 → 电池/能源 → 接电源时防止自动睡眠；或临时 `caffeinate -s`。合盖仍会睡眠。
- Linux：`hermes gateway install` 安装为 systemd 用户服务，并按需开启 linger，退出登录也能运行。
- 主机睡眠、断电时手机会显示“Backend offline”。已提交但被中断的任务恢复后显示“已暂停/已丢失”，不会自动重跑。

## 安全说明（务必读）

- **登录 Webapp 的人 = 这台电脑上运行 Hermes 的那个系统用户。** 官方 Webapp 带主机文件浏览器和主机终端，能执行命令、读写该用户的文件。这是官方设计，不是本仓库引入的。保护它的是：只在 tailnet 内可达 + 强密码 + 登录门。
- 已实测：未登录无法读取会话、文件、配置，无法建立实时连接；`.env`、正在使用的 `state.db`、路径穿越、符号链接指向凭证均被拒绝；模型输出里的脚本、事件属性、`javascript:` 链接不会执行；上传的 HTML 只以附件下载。
- 可选加固：`--block-terminal` 在 Tailscale 入口屏蔽 `/api/host-terminal`，手机网页打不开主机终端，电脑本地不受影响。注意：Agent 本身仍可在批准规则下执行命令。
- 模型 API Key、服务凭证只在主机 `~/.hermes/.env`。浏览器只持有 HttpOnly 登录 Cookie；本仓库不含任何真实密钥。
- 用户名/密码登录只适合 tailnet/VPN。要公网访问，请改用官方 Nous 账号登录或 OIDC。

## 原生 Windows

`setup-webapp.sh` 需要 bash（WSL2 可直接用）。原生 Windows 上手动执行等价步骤：

```powershell
hermes config set webapp.enabled true
hermes config set webapp.host 127.0.0.1
hermes config set webapp.port 9120
hermes config set webapp.public_url https://<电脑名>.<tailnet>.ts.net
hermes config set display.language zh
# 在 %LOCALAPPDATA%\hermes\.env 写入 HERMES_DASHBOARD_BASIC_AUTH_USERNAME / _PASSWORD_HASH / _SECRET（见 deploy/env.example）
# 复制 deploy\desktop-plugin\mobile-pwa\plugin.js 到 <Hermes 主目录>\desktop-plugins\mobile-pwa\plugin.js
# 复制 deploy\pwa\* 到 <Hermes 主目录>\mobile-pwa\
tailscale serve --bg --https=443 http://127.0.0.1:9120
tailscale serve --bg --https=443 --set-path /pwa <Hermes 主目录>\mobile-pwa
hermes webapp --build-only
hermes gateway restart
```

## 测试

验收测试驱动**真实的 Hermes Webapp**（浏览器 UI），并用官方 REST 接口与模型调用日志做服务端核对。见 [tests/README.md](tests/README.md)。

## 已知限制

详见 [docs/VERIFICATION.md](docs/VERIFICATION.md#未验证与当前不支持)，要点：
- 本仓库的开发环境无法访问你的电脑，也无法访问任何模型服务商。全部自动化验证都在云端容器里的真实 Hermes v0.23.2 上完成，模型是脚本化的 OpenAI 兼容桩。**真实模型、你的电脑、Tailscale、真机（iOS/Android）和蜂窝网络均未验证**，需按 [最短人工验证步骤](docs/VERIFICATION.md#最短人工验证步骤) 确认。
- 部分官方界面文字仍是英文（登录页、输入框占位语；断网时界面会暂时回退英文），属于官方翻译覆盖范围。
- 任务完成通知、语音输入沿用官方实现，未做真机验证，不作承诺。

# 验收测试

`tests/e2e/run.cjs` 用 Playwright 驱动**真实的 Hermes Webapp**（浏览器里的官方界面），并用官方 REST 接口（`/api/sessions/...`、`/api/fs/...`）在服务端核对结果。不 mock Hermes。

两种运行方式：

| 方式 | 模型 | 运行哪些场景 | 用途 |
|---|---|---|---|
| A. 机制验证 | `tests/model-stub/stub_llm.py`（脚本化 OpenAI 兼容桩） | S01–S14 | 确定性地验证同步、断线、取消、批准、防重复、重启等机制；可精确统计“同一消息到达模型几次” |
| B. 真实模型冒烟 | 你在 Hermes 里配置的真实模型 | R01–R02 + 不依赖桩的 S11/S13/S14 | 在你自己的主机上确认真实链路 |

结果写入 `tests/e2e/results/results.md`、`results.json` 与 `screens/*.png`。

## 安装

```bash
cd tests/e2e
npm ci                      # 安装锁定版本的 playwright
npx playwright install chromium   # 已有 Chromium 时可跳过
```

## B. 在你自己的主机/任意电脑上跑真实模型冒烟

```bash
cd tests/e2e
umask 077; printf '%s' '你的Webapp密码' > /tmp/hermes-pw && unset HISTFILE   # 或用编辑器写入，避免进入 shell 历史
HERMES_E2E_BASE_URL=https://<电脑名>.<tailnet>.ts.net \
HERMES_E2E_USER=me \
HERMES_E2E_PASSWORD_FILE=/tmp/hermes-pw \
HERMES_E2E_WORKDIR=/tmp/hermes-e2e \
node run.cjs ; rm -f /tmp/hermes-pw
```

R02 会让 Agent 在 Hermes 主机的 `HERMES_E2E_WORKDIR` 下写一个小文件（低风险）。S14 会故意连续输错密码触发限流，之后约 1 分钟内该 IP 登录会被拒绝。

## A. 机制验证（本仓库验证时的做法）

需要一个**测试用** Hermes（不要拿日常使用的实例跑，S09 会把批准模式设成 manual、S12 会杀掉网关进程）：

```bash
# 1) 模型桩
python3 tests/model-stub/stub_llm.py --port 18080 --log /tmp/stub.jsonl &
hermes config set model.provider custom
hermes config set model.base_url http://127.0.0.1:18080/v1
hermes config set model.default stub-model
hermes config set approvals.mode manual          # 仅测试实例
# 2) 按 README 配置 Webapp（public_url 指向下面的测试入口）后启动网关
# 3) 测试用 HTTPS 入口（模拟 Tailscale Serve；可通过信号断开全部 WebSocket）
node tests/fixtures/https-front.mjs --cert cert.pem --key key.pem --listen 8443 \
     --upstream 127.0.0.1:9120 --pwa deploy/pwa --pid-file /tmp/front.pid --drop-ws /tmp/block-ws > /tmp/front.log &
# 4) 运行
cd tests/e2e
HERMES_E2E_BASE_URL=https://hermes.test:8443 HERMES_E2E_INSECURE_TLS=1 \
HERMES_E2E_USER=me HERMES_E2E_PASSWORD_FILE=/path/to/pw \
HERMES_E2E_STUB_LOG=/tmp/stub.jsonl \
HERMES_E2E_FRONT_PID=/tmp/front.pid HERMES_E2E_FRONT_LOG=/tmp/front.log HERMES_E2E_FRONT_BLOCK=/tmp/block-ws \
HERMES_E2E_LOCAL=1 HERMES_BIN=$(command -v hermes) \
HERMES_E2E_RESTART_CMD="HERMES_BIN=$(command -v hermes) ../fixtures/crash-restart-gateway.sh" \
node run.cjs
```

`HERMES_E2E_ONLY=S04,S06` 只跑指定场景。`HERMES_E2E_SECRET_PROBES`（逗号分隔）可提供若干服务端密钥片段，S11 会确认它们没有出现在页面 HTML 中。

## 模型桩指令

写在用户消息里：`[slow N]` 慢速流式输出 N 秒；`[write 路径] 内容` 调用 write_file；`[read 路径]`；`[readattached]` 读取消息里的附件；`[sh 命令]` 调用 terminal（走 Hermes 批准规则）；`[recall]` 复述本会话之前的用户消息；`[markdown]` 长内容渲染样例；`[xss]` 恶意渲染样例。桩把每次请求记录到 JSONL，测试据此判断“是否重复执行”“上游流是否被中止”。

## 场景清单

| ID | 内容 |
|---|---|
| S01 | 360/390/430/平板/桌面尺寸；长正文、超长代码行、宽表格、长链接不撑破页面；输入框可见且 16px；模拟键盘；复制按钮；向上阅读不强拉；深色模式 |
| S02 | 中文输入法组合中、Safari 式组合结束后的 Enter 不发送 |
| S03 | 真实工具调用写文件，并经 REST 核对 |
| S04 | 电脑 A ↔ 手机 B 同步、上下文连续、无重复、profile、重命名版本冲突与幂等 |
| S05 | 接续 CLI 会话（双向） |
| S06 / S06b | 关闭页面后任务继续；实时连接中途断开后自动恢复 |
| S07 | 连按发送、回执丢失、离线草稿与恢复 |
| S08 | 停止任务真正中止上游 |
| S09 | 工具批准两端同步、拒绝/批准生效 |
| S10 | 手机上传 → Hermes 实际读取 → 另一端下载 |
| S11 | 未登录拒绝、Cookie 属性、凭证与越界文件、恶意渲染、退出登录撤销与本机清理 |
| S12 | 网关崩溃重启：历史保留、中断轮次不自动重跑 |
| S13 | PWA manifest、可安装性、安全区、无 Service Worker |
| S14 | 登录限流 |
| R01 / R02 | 真实模型对话与工具调用 |

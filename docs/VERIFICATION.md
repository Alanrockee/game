# 验证报告

## 验证环境（务必先看）

| 项目 | 实际情况 |
|---|---|
| Hermes | 官方安装脚本安装的 **v0.23.2 stable（commit `ae2a81c`）**，运行在 Anthropic 云端开发容器（Ubuntu 24.04）中，**不是你的电脑** |
| 你的 Hermes 主机 | 本次会话没有接入你的电脑（Remote Control 未连接），因此**没有检查、也没有修改你电脑上的 Hermes** |
| 模型 | 容器网络无法访问任何模型服务商（OpenRouter、Nous、OpenAI 等均被网络策略拒绝），因此用 `tests/model-stub/stub_llm.py` 作为 OpenAI 兼容模型。**Hermes 本身（Gateway、Webapp、会话库、工具执行、批准、事件流）全部真实运行**，只有“模型说什么”是脚本化的 |
| HTTPS 入口 | 容器内无法登录 Tailscale，改用 `tests/fixtures/https-front.mjs`（本机 TLS 终止 + 反向代理 + `/pwa/` 静态目录）。已对照 Tailscale 源码确认二者行为一致：保留原始 Host，补 `X-Forwarded-Host/Proto/For`，WebSocket 透传，挂载路径前缀剥离 |
| 浏览器 | Playwright 1.63 + Chromium 157，移动端为**设备模拟**（视口、触控、isMobile），不是真机 Safari / Chrome |

因此本报告中的“已验证”= **在真实 Hermes v0.23.2 + 模拟模型 + 模拟 HTTPS 入口 + 浏览器模拟设备上自动化验证通过**。真实模型、你的主机、Tailscale、真机、蜂窝网络列为“未验证”，并在文末给出最短人工验证步骤。

## 测试结果

（由 `tests/e2e/run.cjs` 生成，原始输出见 `docs/e2e-results/results.md` 与截图 `docs/e2e-results/screens/`。）

RESULTS_PLACEHOLDER

## 未验证与当前不支持

UNVERIFIED_PLACEHOLDER

## 最短人工验证步骤

在 Hermes 主机运行完 `bash deploy/setup-webapp.sh` 之后（约 10 分钟）：

1. **入口**：手机关掉 Wi-Fi、只用蜂窝流量，打开 Tailscale App 确认已连接，Safari/Chrome 打开脚本打印的 `https://<电脑名>.<tailnet>.ts.net`。地址栏应显示锁形图标，并跳到登录页。
2. **真实对话**：登录后发“用一句话介绍你自己”。应流式出现回复；底部状态栏为“后端 就绪”，显示的模型是你电脑上配置的模型。
3. **工具**：发“在 /tmp 下创建 hermes-mobile-check.txt，内容是 ok，然后告诉我完成了”。在电脑上执行 `cat /tmp/hermes-mobile-check.txt`，应输出 `ok`。若出现批准卡片，在手机上点“运行”。
4. **跨端同步**：电脑浏览器打开同一地址，或在 Desktop 中打开同一会话，在电脑上发一句话，手机上应在几秒内出现；反过来也一样。
5. **锁屏续跑**：手机发“写一篇 800 字的短文”，回复开始后立即锁屏 1 分钟，再解锁回到页面。回复应已完整，且只出现一份。
6. **停止**：再发一个长任务，点 ■。按钮消失后，电脑上该会话也应显示已停止。
7. **附件**：手机“＋ → 图片…”拍一张照片发送，并问“图片里有什么”。能否识别取决于你配置的模型是否支持视觉。再“＋ → 文件…”传一个 .txt，问“文件里写了什么”。
8. **主屏幕**：iPhone Safari → 分享 → 添加到主屏幕；从图标打开应为无地址栏的独立窗口，登录一次后可用；底部输入框不应被手势条遮挡。
9. **退出**：设置 → 顶部“主模型 ⌄” → 网关 → 退出登录。随后在电脑上用另一个浏览器打开同一地址，应要求重新登录（同一浏览器的其他标签页也会回到登录页）。

也可以在任意电脑上运行真实模型冒烟测试：见 [tests/README.md](../tests/README.md) 的“B”。

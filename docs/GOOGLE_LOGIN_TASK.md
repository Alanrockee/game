# 交给电脑上的 Claude：开启 Google 登录（复制整段发给它）

```text
请在这台 Windows 电脑上把已部署的「Hermes 手机网页」改成 Google 账号登录。

1. 在部署用的仓库里 git pull（GitHub 仓库 Alanrockee/game，分支 claude/hermes-mobile-webapp-sync-oh2jsn），先读 docs\GOOGLE_LOGIN.md。
2. 用 hermes config get webapp.public_url 读出手机访问地址；问我用来登录的 Gmail 地址（只问邮箱）。
3. 用 Start-Process 帮我打开 https://console.cloud.google.com/ ，一步一步告诉我点哪里：新建项目 Hermes Mobile → OAuth 同意屏幕（外部）→ 发布应用（In production）→ 创建「Web 应用」客户端，重定向 URI 填「手机访问地址/auth/callback」（把完整地址发给我复制）→ 创建后立即下载 JSON 到「下载」文件夹。如果 Google 不接受 ts.net 地址，记下提示，保持现在的密码登录不变并告诉我。
4. 确认 %USERPROFILE%\Downloads\client_secret_*.json 已存在（不要打印文件内容），然后在仓库根目录运行：
   powershell -ExecutionPolicy Bypass -File .\deploy\setup-webapp.ps1 -Yes -GoogleEmail <我的Gmail>
   网关若由 Hermes Desktop/手动启动，在没有任务运行时执行 hermes gateway restart（被拒绝就等任务结束再试，不要强杀进程）。
5. 自检：<地址>/api/status 的 auth_providers 为 ["google"]；未登录访问 <地址>/api/sessions 为 401；让我在电脑浏览器打开地址，确认自动跳 Google、选我的 Gmail 后能进入（若提示「尚未验证此应用」点「高级 → 继续」）。
6. 成功后问我是否删除「下载」里的 client_secret JSON（里面有密钥）。
规则：不要读出/打印 Client Secret、.env 或任何密钥；不要升级 Hermes、不要改 Hermes 源码或 state.db；不要用 Tailscale Funnel；不要打断正在运行的任务。脚本报错就读脚本修复（保持 UTF-8 BOM + CRLF，兼容 PowerShell 5.1），修好后提交推送到同一分支（被拒先 fetch+merge，不要强推）。
出问题回退：把 %LOCALAPPDATA%\hermes\backups\mobile-webapp-<最新时间>\.env 复制回 %LOCALAPPDATA%\hermes\.env，执行 hermes plugins disable dashboard-auth-google 和 hermes gateway restart。
完成后给我一份不含密钥的报告：auth_providers、401 自检、电脑浏览器 Google 登录结果、报错原文与处理方式。
```

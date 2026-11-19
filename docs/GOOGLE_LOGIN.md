# 用 Google 账号登录 Hermes 手机网页

做完后：手机打开网页会**自动跳到 Google**，选你的账号就进去了，不用记密码；之后会自动续期，一般不用再登录。只有你指定的 Gmail 能登录，别人的 Google 账号会被拒绝。

需要你**用自己的 Google 账号**在 Google Cloud 网页上点几步（约 10 分钟，免费）。这一部分任何 AI 都无法代替你完成。

> 先完成基本部署（`setup-webapp.ps1` 或 `setup-webapp.sh`），拿到手机访问地址，例如 `https://my-pc.tail1234.ts.net`。下面把它叫做「你的地址」。

## 第 1 步：新建项目

1. 电脑浏览器打开 <https://console.cloud.google.com/>，用你的 Gmail 登录（第一次会让你同意服务条款）。
2. 点页面顶部的项目选择框 → **新建项目**，名称填 `Hermes Mobile` → **创建**。创建好后确认顶部已切换到这个项目。

## 第 2 步：配置登录页面（OAuth 同意屏幕）

1. 左上角菜单 ☰ → **API 和服务** → **OAuth 同意屏幕**（新版界面叫 **Google Auth Platform**），点 **开始 / Get started**。
2. 应用名称填 `Hermes Mobile`，用户支持邮箱选你的 Gmail → 下一步。
3. 受众群体（Audience）选 **外部（External）** → 下一步。
4. 联系邮箱填你的 Gmail → 勾选同意政策 → **创建**。
5. 进入 **受众群体（Audience）** 页面，点 **发布应用（Publish app）** → 确认，状态变为 **正式版 / In production**。
   - 为什么要发布：保持“测试”状态时，Google 发的长期登录凭证 **7 天就失效**，你每周都得重新登录一次。
   - 发布是安全的：本方案的 Google 登录插件只放行你指定的 Gmail；而且只用到“基本资料和邮箱”这类基础权限，Google 不要求审核。
   - 如果更想保守：不发布，在同一页的 **测试用户** 里添加你自己的 Gmail，代价是每 7 天登录一次。

## 第 3 步：创建登录客户端，下载 JSON

1. 进入 **客户端（Clients）**（旧版界面：**凭据** → **创建凭据** → **OAuth 客户端 ID**）→ **创建客户端**。
2. 应用类型选 **Web 应用（Web application）**。注意不要选“桌面应用”。
3. 名称随意，例如 `Hermes 手机`。
4. **已获授权的重定向 URI（Authorized redirect URIs）** → 添加 URI，填：
   ```
   你的地址/auth/callback
   ```
   例如 `https://my-pc.tail1234.ts.net/auth/callback`。必须完全一致：https、末尾没有多余的 `/`。
5. 点 **创建**。在弹出的窗口里**立刻点“下载 JSON”**。新版 Google 只在创建时显示完整密钥，关掉弹窗后就看不到了；如果错过了，删除这个客户端重新创建即可。文件会保存到“下载”文件夹，名字像 `client_secret_xxxx.apps.googleusercontent.com.json`。

## 第 4 步：让部署脚本启用 Google 登录

**Windows**（在部署文件夹里打开 PowerShell）：
```powershell
powershell -ExecutionPolicy Bypass -File .\deploy\setup-webapp.ps1 -GoogleEmail 你的Gmail地址
```
脚本会自动找到“下载”文件夹里最新的 `client_secret_*.json`。也可以用 `-GoogleClientJson 文件路径` 指定。

**macOS / Linux**：
```bash
bash deploy/setup-webapp.sh --google-client-json ~/Downloads/client_secret_xxx.json --google-email 你的Gmail地址
```

脚本会：
- 检查 JSON 是“Web 应用”类型，且回调地址填对了。不对会用中文告诉你缺什么。
- 把客户端 ID 和密钥写进本机 Hermes 的 `.env`（只在你电脑上）。
- 安装并启用 `dashboard-auth-google` 插件。
- **默认关闭用户名密码登录**，这样打开网页会直接跳 Google。需要两种方式都保留时加 `-KeepPassword` / `--keep-password`。

最后按脚本提示重启网关（`hermes gateway restart`，或在 Hermes Desktop 里重启后端）。导入完成后，可以删除“下载”里的那个 JSON 文件（里面有密钥）。

## 第 5 步：手机登录

手机打开 Tailscale（保持连接）→ 浏览器打开你的地址 → 自动跳到 Google → 选你的 Gmail →（第一次）点“允许/继续” → 进入 Hermes。

- 若 Google 显示“Google 尚未验证此应用”：这是你自己创建的应用，点 **高级 → 继续前往 Hermes Mobile**。
- 用别的 Google 账号登录会看到 `this Google account is not allowed to sign in`，属于正常的拒绝。

## 常见问题

| 现象 | 处理 |
|---|---|
| Google 提示 `redirect_uri_mismatch` | 第 3 步的重定向 URI 和“你的地址/auth/callback”不完全一致。改正后保存，等 1～5 分钟再试 |
| Google 不接受你填的重定向 URI 地址 | 本方案没能用真实 Google 验证 `*.ts.net` 地址能否被接受。遇到这种情况把提示文字发给我；临时可以重新运行部署脚本（不带 Google 参数）恢复用户名密码登录 |
| 想换回用户名密码 | 重新运行部署脚本，不加 Google 参数；或把备份 `…\hermes\backups\mobile-webapp-<时间>\.env` 复制回去后重启网关 |
| 换了 Gmail | 用新的 `-GoogleEmail` 重新运行一次脚本 |
| 想立即让所有设备下线 | `hermes webapp --sign-out`；彻底撤销可在 Google 账号的“第三方应用”里移除 Hermes Mobile |

## 验证情况（如实说明）

- 已用一个行为接近 Google 的模拟身份提供方，在真实 Hermes v0.23.2 上验证了：
  - 自动跳转登录、ID Token 签名校验、客户端密钥认证与 PKCE；
  - 1 分钟短期令牌到期后，页面不刷新也能继续对话（refresh token 静默续期）；
  - 非白名单账号被拒绝（400，无会话）；
  - 脚本对“桌面应用”类型 JSON、缺少回调地址给出正确提示；
  - 邮箱大小写不敏感。
- **未验证**：与真实 Google 的交互、Google 是否接受 `ts.net` 回调地址、PowerShell 版脚本在真实 Windows 上的运行。

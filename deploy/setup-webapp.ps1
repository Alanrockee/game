<#
Hermes 移动端 Webapp 一键配置 —— Windows 原生版（Windows PowerShell 5.1 / PowerShell 7 均可）
与 deploy/setup-webapp.sh 做同样的事：
  检查 → 备份 → 设置登录账号（只保存 scrypt 哈希）→ 配置官方 Webapp → 中文界面
  → 安装 mobile-pwa 插件与 PWA 文件 → Tailscale Serve（仅 tailnet 内 HTTPS）→ 构建 → 重启网关 → 自检

用法（在解压/克隆后的文件夹里打开 PowerShell）：
  powershell -ExecutionPolicy Bypass -File .\deploy\setup-webapp.ps1
可选参数：-User me  -Port 9120  -PublicUrl https://...  -NoZh  -InstallService  -BlockTerminal
全自动（供 AI 助手无人值守执行）：-Yes -GeneratePassword
  -Yes              不再提问：沿用已有登录账号；版本过低时直接停止
  -GeneratePassword 生成随机强密码，只写入桌面的「Hermes手机登录信息.txt」，不在屏幕上显示
Google 账号登录（见 docs/GOOGLE_LOGIN.md）：-GoogleEmail 你的Gmail  [-GoogleClientJson 路径]  [-KeepPassword]
  不给 -GoogleClientJson 时，自动使用「下载」文件夹里最新的 client_secret_*.json
（-ExecutionPolicy Bypass 只对这一次运行生效，不修改系统设置）
#>
param(
  [string]$User = '',
  [int]$Port = 9120,
  [string]$PublicUrl = '',
  [switch]$NoZh,
  [switch]$InstallService,
  [switch]$BlockTerminal,
  [switch]$Yes,
  [switch]$GeneratePassword,
  [string]$GoogleEmail = '',
  [string]$GoogleClientJson = '',
  [switch]$KeepPassword
)
# 注意：Windows PowerShell 5.1 在 'Stop' 模式下会把外部程序写到 stderr 的普通警告当成致命错误，
# 所以全局保持 Continue，外部命令用 $LASTEXITCODE 判断，关键文件操作单独加 -ErrorAction Stop。
$ErrorActionPreference = 'Continue'
$Here = Split-Path -Parent $MyInvocation.MyCommand.Path

function Say($m)  { Write-Host ''; Write-Host "▶ $m" -ForegroundColor Cyan }
function Ok($m)   { Write-Host "  ✓ $m" -ForegroundColor Green }
function Warn($m) { Write-Host "  ! $m" -ForegroundColor Yellow }
function Die($m)  { Write-Host "  ✗ $m" -ForegroundColor Red; exit 1 }
function Confirm-Yes($q) { if ($Yes) { return $true }; $a = Read-Host "  $q [y/N]"; return ($a -match '^(y|yes)$') }
function Run-Hermes { & $script:HermesExe @args 2>&1 | Out-String }

# ---------------------------------------------------------------- 1. 检查
Say '检查 Hermes'
$cmd = Get-Command hermes -ErrorAction SilentlyContinue
if (-not $cmd) { Die '找不到 hermes 命令。请先按官方文档在 Windows 上安装 Hermes Agent（如果你装在 WSL 里，请在 WSL 终端里运行 deploy/setup-webapp.sh）。' }
$script:HermesExe = $cmd.Source
$verOut = Run-Hermes --version
if ($verOut -notmatch 'Hermes Agent v(\d+)\.(\d+)\.(\d+)') { Die "无法识别 Hermes 版本：$verOut" }
$Version = "$($Matches[1]).$($Matches[2]).$($Matches[3])"
if ([int]$Matches[1] -eq 0 -and [int]$Matches[2] -lt 23) {
  Warn "本方案在 v0.23.2 上验证；v$Version 的 Webapp 可能缺少远程登录/会话共享能力。本脚本不会替你升级。"
  if ($Yes) { Die '版本低于 0.23，无人值守模式下停止。请先确认是否升级 Hermes。' }
  if (-not (Confirm-Yes '仍然继续？')) { exit 1 }
}
Ok "Hermes v$Version（$($script:HermesExe)）"
$HermesHome = if ($env:HERMES_HOME) { $env:HERMES_HOME } else { Join-Path $env:LOCALAPPDATA 'hermes' }
if (-not (Test-Path (Join-Path $HermesHome 'config.yaml'))) { Die "在 $HermesHome 没找到 config.yaml。若 Hermes 装在别处，请先设置环境变量 HERMES_HOME。" }
Ok "Hermes 主目录：$HermesHome"
Write-Host '  当前 profile：'; (Run-Hermes profile list) -split "`n" | ForEach-Object { Write-Host "    $_" }
$gw = Run-Hermes gateway status
if ($gw -match 'Running manually') { $GwMode = 'manual' } elseif ($gw -match 'not running') { $GwMode = 'stopped' } else { $GwMode = 'service' }
Ok "网关运行方式：$GwMode"

# ---------------------------------------------------------------- 2. 备份
Say '备份当前配置'
$Bk = Join-Path $HermesHome ('backups\mobile-webapp-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Force -Path $Bk -ErrorAction Stop | Out-Null
foreach ($f in 'config.yaml', '.env') { $p = Join-Path $HermesHome $f; if (Test-Path $p) { Copy-Item $p (Join-Path $Bk $f) } }
Set-Content -Path (Join-Path $HermesHome 'backups\mobile-webapp-latest') -Value $Bk -Encoding UTF8
Ok "config.yaml / .env 副本：$Bk"
& $script:HermesExe backup --quick -o (Join-Path $Bk 'hermes-quick-backup.zip') *> $null
if ($LASTEXITCODE -eq 0) { Ok '官方快照 hermes-quick-backup.zip 已生成' } else { Warn 'hermes backup --quick 未成功（不影响继续，上面的文件副本可用于回退）' }

# ---------------------------------------------------------------- 3. 访问地址（Tailscale）
$UseTailscale = -not $PublicUrl
if ($UseTailscale) {
  Say '检测 Tailscale'
  $ts = Get-Command tailscale -ErrorAction SilentlyContinue
  $TsExe = if ($ts) { $ts.Source } elseif (Test-Path 'C:\Program Files\Tailscale\tailscale.exe') { 'C:\Program Files\Tailscale\tailscale.exe' } else { $null }
  if (-not $TsExe) { Die '没有找到 Tailscale。请先安装 Tailscale（tailscale.com/download）并用浏览器登录，然后重新运行本脚本。' }
  try { $DnsName = ((& $TsExe status --json | Out-String | ConvertFrom-Json).Self.DNSName).TrimEnd('.') } catch { $DnsName = '' }
  if (-not $DnsName) { Die 'Tailscale 还没登录，或没有开启 MagicDNS。请在 Tailscale 里登录，并在 login.tailscale.com/admin/dns 打开 MagicDNS 和 HTTPS Certificates。' }
  $PublicUrl = "https://$DnsName"
  Ok "tailnet 地址：$PublicUrl"
}
$PublicUrl = $PublicUrl.TrimEnd('/')

# ---------------------------------------------------------------- 4. 登录账号
Say '设置手机登录账号（Hermes 官方用户名/密码登录）'
$EnvFile = Join-Path $HermesHome '.env'
$utf8 = New-Object System.Text.UTF8Encoding $false
$lines = New-Object System.Collections.Generic.List[string]
if (Test-Path $EnvFile) { foreach ($l in [IO.File]::ReadAllLines($EnvFile)) { $lines.Add($l) } }
function Env-Get($k) { $hit = $lines | Where-Object { $_ -like "$k=*" } | Select-Object -Last 1; if ($hit) { return $hit.Substring($k.Length + 1) } else { return '' } }
function Env-Unset($k) { for ($i = $lines.Count - 1; $i -ge 0; $i--) { if ($lines[$i] -like "$k=*") { $lines.RemoveAt($i) } } }
function Env-Set($k, $v) { for ($i = $lines.Count - 1; $i -ge 0; $i--) { if ($lines[$i] -like "$k=*") { $lines.RemoveAt($i) } }; $lines.Add("$k=$v") }

$GoogleMode = [bool]$GoogleEmail
if (-not $GoogleMode -or $KeepPassword) {
if (Env-Get 'HERMES_DASHBOARD_BASIC_AUTH_PASSWORD') { Warn '.env 里有明文 HERMES_DASHBOARD_BASIC_AUTH_PASSWORD，它会覆盖哈希；建议删除该行。' }
$reuse = $false
$existing = Env-Get 'HERMES_DASHBOARD_BASIC_AUTH_USERNAME'
if ($existing -and (Env-Get 'HERMES_DASHBOARD_BASIC_AUTH_PASSWORD_HASH') -and -not $GeneratePassword) {
  if (Confirm-Yes "检测到已有登录账号「$existing」，是否沿用（不修改密码）？") { $reuse = $true; $User = $existing }
}
if (-not $reuse) {
  if (-not $User -and $Yes) { $User = 'me' }
  if (-not $User) { $User = Read-Host '  登录用户名（直接回车用 me）'; if (-not $User) { $User = 'me' } }
  if ($GeneratePassword) {
    $alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
    $rb = New-Object byte[] 20; (New-Object System.Security.Cryptography.RNGCryptoServiceProvider).GetBytes($rb)
    $p1 = -join ($rb | ForEach-Object { $alphabet[$_ % $alphabet.Length] })
    $InfoFile = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Hermes手机登录信息.txt'
    $info = @('Hermes 手机网页登录信息（请妥善保管，不要发给任何人或 AI）', '', "地址：$PublicUrl", "用户名：$User", "密码：$p1", '', '手机需先打开 Tailscale 并登录同一个账号。')
    [IO.File]::WriteAllLines($InfoFile, $info, (New-Object System.Text.UTF8Encoding $true))
    Ok "已生成随机密码，写入桌面文件：$InfoFile（屏幕上不显示）"
  } elseif ($Yes) {
    Die '无人值守模式（-Yes）下需要同时加 -GeneratePassword，或先手动运行一次设置密码。'
  } else {
  while ($true) {
    $s1 = Read-Host '  设置登录密码（至少 12 位，输入时不显示）' -AsSecureString
    $s2 = Read-Host '  再输入一次' -AsSecureString
    $b1 = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s1); $b2 = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s2)
    try { $p1 = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b1); $p2 = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b2) }
    finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b1); [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b2) }
    if ($p1 -ne $p2) { Warn '两次输入不一致'; continue }
    if ($p1.Length -lt 12) { Warn '密码太短'; continue }
    break
  }
  }
  # 找一个 Python：优先 Hermes 自带的，其次系统的 py / python（跳过应用商店占位程序）
  $py = Get-ChildItem -Path (Join-Path $HermesHome 'tools') -Filter python.exe -Recurse -Depth 3 -ErrorAction SilentlyContinue |
        Where-Object { $_.FullName -match '\\python-[^\\]+\\(bin\\)?python\.exe$' } | Select-Object -First 1 -ExpandProperty FullName
  if (-not $py) { $c = Get-Command py, python -ErrorAction SilentlyContinue | Where-Object { $_.Source -notmatch 'WindowsApps' } | Select-Object -First 1; if ($c) { $py = $c.Source } }
  if (-not $py) { Die '找不到可用的 Python 来计算密码哈希（Hermes 自带的 Python 也没找到）。' }
  # 与官方 plugins.dashboard_auth.basic.hash_password 相同的格式：scrypt$n$r$p$salt_b64$dk_b64
  # 注意：Windows PowerShell 5.1 向外部程序传参时不转义内部双引号，所以这段 Python 只用单引号（在 PS 单引号字符串里写作 ''）
  $code = 'import sys,os,hashlib,base64; pw=base64.b64decode(sys.stdin.read().strip()); s=os.urandom(16); dk=hashlib.scrypt(pw,salt=s,n=16384,r=8,p=1,dklen=64,maxmem=0); print(''scrypt$16384$8$1$%s$%s''%(base64.b64encode(s).decode(),base64.b64encode(dk).decode()))'
  $pwB64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($p1))
  $p1 = $null; $p2 = $null
  $Hash = ($pwB64 | & $py -I -c $code | Out-String).Trim()
  $pwB64 = $null
  if ($Hash -notlike 'scrypt$*') { Die '计算密码哈希失败。' }
  Ok '已生成密码哈希（密码本身不保存）'
  Env-Set 'HERMES_DASHBOARD_BASIC_AUTH_USERNAME' $User
  Env-Set 'HERMES_DASHBOARD_BASIC_AUTH_PASSWORD_HASH' $Hash
  $Hash = $null
}
if (-not (Env-Get 'HERMES_DASHBOARD_BASIC_AUTH_SECRET')) {
  $bytes = New-Object byte[] 32; (New-Object System.Security.Cryptography.RNGCryptoServiceProvider).GetBytes($bytes)
  Env-Set 'HERMES_DASHBOARD_BASIC_AUTH_SECRET' ([Convert]::ToBase64String($bytes).TrimEnd('=').Replace('+', '-').Replace('/', '_'))
  Ok '已生成会话签名密钥（网关重启后不必重新登录）'
}
}

if ($GoogleMode) {
  Say "配置 Google 账号登录（只允许 $GoogleEmail）"
  if ($GoogleEmail -notmatch '@') { Die '请用 -GoogleEmail 指定允许登录的 Google 邮箱' }
  if (-not $GoogleClientJson) {
    $dl = Join-Path $env:USERPROFILE 'Downloads'
    $GoogleClientJson = Get-ChildItem -Path $dl -Filter 'client_secret_*.json' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName
    if (-not $GoogleClientJson) { Die "在「下载」文件夹（$dl）里没找到 client_secret_*.json。请先在 Google Cloud 下载 OAuth 客户端 JSON，或用 -GoogleClientJson 指定路径。" }
    Ok "使用 Google 客户端文件：$GoogleClientJson"
  }
  if (-not (Test-Path $GoogleClientJson)) { Die "找不到 Google 客户端 JSON 文件：$GoogleClientJson" }
  try { $gj = [IO.File]::ReadAllText($GoogleClientJson) | ConvertFrom-Json } catch { Die "无法读取 JSON：$($_.Exception.Message)" }
  if (-not $gj.web) { Die '这不是「Web 应用」类型的 OAuth 客户端（例如选成了「桌面应用」）。请在 Google Cloud 里新建一个「Web 应用」类型的客户端。' }
  $callback = "$PublicUrl/auth/callback"
  if (@($gj.web.redirect_uris) -notcontains $callback) { Die "客户端缺少回调地址。请在 Google Cloud 该客户端的「已获授权的重定向 URI」里添加：$callback ，保存后重新下载 JSON。" }
  if (-not $gj.web.client_id -or -not $gj.web.client_secret) { Die 'JSON 中缺少 client_id 或 client_secret' }
  Env-Set 'HERMES_DASHBOARD_GOOGLE_CLIENT_ID' $gj.web.client_id
  Env-Set 'HERMES_DASHBOARD_GOOGLE_CLIENT_SECRET' $gj.web.client_secret
  Env-Set 'HERMES_DASHBOARD_GOOGLE_ALLOWED_EMAILS' $GoogleEmail.ToLower()
  $gj = $null
  Ok '已读取 Google 客户端 ID 与密钥（密钥只写入本机 .env）'
  if (-not $KeepPassword) {
    foreach ($k in 'HERMES_DASHBOARD_BASIC_AUTH_USERNAME', 'HERMES_DASHBOARD_BASIC_AUTH_PASSWORD_HASH', 'HERMES_DASHBOARD_BASIC_AUTH_PASSWORD') { Env-Unset $k }
    Ok "已关闭用户名密码登录（备份在 $Bk\.env），打开网页会直接跳转 Google"
  }
}
try { [IO.File]::WriteAllLines($EnvFile, $lines, $utf8) } catch { Die "写入 $EnvFile 失败：$($_.Exception.Message)" }
Ok "凭证只写入 $EnvFile"
if ($GoogleMode) {
  $gp = Join-Path $HermesHome 'plugins\dashboard-auth-google'
  New-Item -ItemType Directory -Force -Path $gp -ErrorAction Stop | Out-Null
  Copy-Item (Join-Path $Here 'hermes-plugin\dashboard-auth-google\*') $gp -Force -ErrorAction Stop
  & $script:HermesExe plugins enable dashboard-auth-google | Out-Null
  if ($LASTEXITCODE -eq 0) { Ok '已安装并启用 Google 登录插件' } else { Die '启用 Google 登录插件失败，请把上面的输出发给我。' }
  Warn "Google 客户端 JSON 里有密钥，导入完成后可以删除：$GoogleClientJson"
}

# ---------------------------------------------------------------- 5. Webapp 配置
Say '配置官方 Webapp'
& $script:HermesExe config set webapp.enabled true | Out-Null
& $script:HermesExe config set webapp.host 127.0.0.1 | Out-Null
& $script:HermesExe config set webapp.port $Port | Out-Null
& $script:HermesExe config set webapp.public_url $PublicUrl | Out-Null
if ($LASTEXITCODE -ne 0) { Die 'hermes config set 失败，请把上面的输出发给我。' }
Ok "webapp: enabled / 127.0.0.1:$Port / public_url=$PublicUrl"
if (-not $NoZh) { & $script:HermesExe config set display.language zh | Out-Null; Ok '界面语言：简体中文' }

# ---------------------------------------------------------------- 6. 插件与 PWA 文件
Say '安装 mobile-pwa 插件与 PWA 文件'
$PluginDir = Join-Path $HermesHome 'desktop-plugins\mobile-pwa'
$PwaDir = Join-Path $HermesHome 'mobile-pwa'
New-Item -ItemType Directory -Force -Path $PluginDir, $PwaDir -ErrorAction Stop | Out-Null
Copy-Item (Join-Path $Here 'desktop-plugin\mobile-pwa\plugin.js') $PluginDir -Force -ErrorAction Stop
Copy-Item (Join-Path $Here 'pwa\*') $PwaDir -Force -ErrorAction Stop
Ok "插件：$PluginDir"
Ok "PWA 文件：$PwaDir"

# ---------------------------------------------------------------- 7. Tailscale Serve
if ($UseTailscale) {
  Say '配置 Tailscale Serve（只在你自己的 tailnet 内可访问，不是公网）'
  & $TsExe serve --bg --https=443 "http://127.0.0.1:$Port" | Out-Null
  if ($LASTEXITCODE -ne 0) { Die 'tailscale serve 失败。请右键「以管理员身份运行」 PowerShell 后重试，或检查是否已在管理后台开启 HTTPS Certificates。' }
  Ok "https://$DnsName/ → http://127.0.0.1:$Port"
  & $TsExe serve --bg --https=443 --set-path /pwa $PwaDir *> $null
  if ($LASTEXITCODE -eq 0) { Ok "https://$DnsName/pwa/ → $PwaDir" } else { Warn 'Tailscale 未能提供 PWA 文件目录；网页照常可用，只是添加到主屏幕后可能不是独立窗口。' }
  if ($BlockTerminal) {
    & $TsExe serve --bg --https=443 --set-path /api/host-terminal 'text:disabled' *> $null
    if ($LASTEXITCODE -eq 0) { Ok '已在入口屏蔽主机终端' } else { Warn '未能屏蔽主机终端' }
  }
}

# ---------------------------------------------------------------- 8. 构建与重启
Say '构建 Webapp（第一次可能要几分钟）'
& $script:HermesExe webapp --build-only
if ($LASTEXITCODE -ne 0) { Die 'Webapp 构建失败，请把上面的输出发给我。' }
Ok 'Webapp 已构建'

Say '让网关读取新配置'
switch ($GwMode) {
  'service' { & $script:HermesExe gateway restart; if ($LASTEXITCODE -eq 0) { Ok '网关已重启' } else { Warn '网关暂时拒绝重启（通常是有任务正在运行）。任务结束后执行：hermes gateway restart' } }
  'stopped' { & $script:HermesExe gateway install --if-missing --start-now --start-on-login; if ($LASTEXITCODE -eq 0) { Ok '已安装并启动网关（登录后自动运行）' } else { Warn '网关服务安装失败，可先手动运行：hermes gateway run' } }
  'manual'  {
    if ($InstallService) { & $script:HermesExe gateway install --start-now --start-on-login }
    else {
      Warn '网关当前由 Hermes Desktop 或手动启动。请在 Desktop 里重启后端，或在没有任务运行时执行：hermes gateway restart'
      Warn '想让它开机/登录后自动运行、关掉 Desktop 也能用：重新运行本脚本并加 -InstallService'
    }
  }
}

# ---------------------------------------------------------------- 9. 自检
Say '自检'
Start-Sleep -Seconds 3
function Get-Code($u) { try { (Invoke-WebRequest -Uri $u -UseBasicParsing -MaximumRedirection 0 -TimeoutSec 15).StatusCode } catch { if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 } } }
$c = Get-Code "$PublicUrl/api/sessions"
if ($c -eq 401) { Ok "未登录访问会话 → 401（登录保护生效）" } else { Warn "未登录访问返回 $c（期望 401；如果网关还没重启属正常）" }
$c = Get-Code "$PublicUrl/pwa/manifest.json"
if ($c -eq 200) { Ok 'PWA 文件可访问' } else { Warn "PWA 文件返回 $c" }

Write-Host ''
Write-Host '完成！手机访问地址（手机需打开 Tailscale 并登录同一个账号）：' -ForegroundColor Green
Write-Host ''
Write-Host "    $PublicUrl" -ForegroundColor Green
Write-Host ''
if ($GoogleMode) { Write-Host "登录方式：Google 账号（只允许 $GoogleEmail）" } else { Write-Host "登录用户名：$User" }
if ($InfoFile) { Write-Host "登录密码在桌面文件：$InfoFile" -ForegroundColor Green }
Write-Host "回退：把 $Bk 里的 config.yaml 和 .env 复制回 $HermesHome，然后 hermes gateway restart"

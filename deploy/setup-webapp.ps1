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
function Run-Hermes { & $script:HermesExe @args 2>&1 | ForEach-Object { $_.ToString() } | Out-String }

# ---------------------------------------------------------------- 1. 检查
Say '检查 Hermes'
$cmd = Get-Command hermes -ErrorAction SilentlyContinue
if (-not $cmd) { Die '找不到 hermes 命令。请先按官方文档在 Windows 上安装 Hermes Agent（如果你装在 WSL 里，请在 WSL 终端里运行 deploy/setup-webapp.sh）。' }
$script:HermesExe = $cmd.Source
$verOut = Run-Hermes --version
if ($verOut -notmatch 'Hermes Agent v(\d+)\.(\d+)\.(\d+)') { Die "无法识别 Hermes 版本：$verOut" }
$Version = "$($Matches[1]).$($Matches[2]).$($Matches[3])"
if ([version]$Version -lt [version]'0.23.2') {
  Warn "本方案需要 v0.23.2 或更新；v$Version 的 Webapp 可能缺少远程登录/会话共享能力。本脚本不会替你升级。"
  if ($Yes) { Die '版本低于 0.23.2，无人值守模式下停止。请先确认是否升级 Hermes。' }
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

# ---------------------------------------------------------------- 2. 访问地址（Tailscale）
$UseTailscale = -not $PublicUrl
if ($UseTailscale) {
  Say '检测 Tailscale'
  $ts = Get-Command tailscale -ErrorAction SilentlyContinue
  $TsExe = if ($ts) { $ts.Source } elseif (Test-Path 'C:\Program Files\Tailscale\tailscale.exe') { 'C:\Program Files\Tailscale\tailscale.exe' } else { $null }
  if (-not $TsExe) { Die '没有找到 Tailscale。请先安装 Tailscale（tailscale.com/download）并用浏览器登录，然后重新运行本脚本。' }
  try { $TsStatus = & $TsExe status --json | Out-String | ConvertFrom-Json -ErrorAction Stop }
  catch { Die '无法读取 Tailscale 状态，请确认 Tailscale 正在运行。' }
  $DnsName = ([string]$TsStatus.Self.DNSName).TrimEnd('.')
  if ($TsStatus.BackendState -ne 'Running' -or -not $DnsName) { Die '请先在 Tailscale 中登录并连接。' }
  if (-not $TsStatus.CurrentTailnet.MagicDNSEnabled -or $TsStatus.CertDomains -notcontains $DnsName) {
    Die '请在 https://login.tailscale.com/admin/dns 开启 MagicDNS 和 HTTPS Certificates，启用后重试。'
  }
  $PublicUrl = "https://$DnsName"
  Ok "tailnet 地址：$PublicUrl"
}
$PublicUrl = $PublicUrl.TrimEnd('/')

# ---------------------------------------------------------------- 3. 备份
Say '备份当前配置'
$Bk = Join-Path $HermesHome ('backups\mobile-webapp-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Force -Path $Bk -ErrorAction Stop | Out-Null
foreach ($f in 'config.yaml', '.env') {
  $p = Join-Path $HermesHome $f
  if (Test-Path -LiteralPath $p) {
    Copy-Item -LiteralPath $p -Destination (Join-Path $Bk $f) -ErrorAction Stop
  }
}
Set-Content -LiteralPath (Join-Path $HermesHome 'backups\mobile-webapp-latest') -Value $Bk -Encoding UTF8 -ErrorAction Stop
Ok "config.yaml / .env 副本：$Bk"
# 官方 --quick 写入 state-snapshots，忽略 --output，不会生成 ZIP。
$snapshotOutput = Run-Hermes backup --quick
if ($LASTEXITCODE -eq 0 -and $snapshotOutput -match '(?m)^State snapshot created: ([\w.-]+)') {
  Ok "官方状态快照已生成：$($Matches[1])"
} else { Warn 'hermes backup --quick 未确认生成状态快照（上面的文件副本可用于回退）' }

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
$InfoFile = $null
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
  # 直接向子进程的标准输入写 UTF-8 字节，避免 PowerShell 5.1 管道和 Python 文本解码改变字节。
  # 密码只通过标准输入传入，不出现在进程参数、环境变量或诊断输出中。
  $code = 'import sys,os,hashlib,base64; pw=sys.stdin.buffer.read(); s=os.urandom(16); dk=hashlib.scrypt(pw,salt=s,n=16384,r=8,p=1,dklen=64,maxmem=0); print(''scrypt$16384$8$1$%s$%s''%(base64.b64encode(s).decode(),base64.b64encode(dk).decode()))'
  $startInfo = New-Object System.Diagnostics.ProcessStartInfo
  $startInfo.FileName = $py
  $startInfo.Arguments = '-I -c "' + $code + '"'
  $startInfo.UseShellExecute = $false
  $startInfo.RedirectStandardInput = $true
  $startInfo.RedirectStandardOutput = $true
  $startInfo.CreateNoWindow = $true
  $passwordBytes = [Text.Encoding]::UTF8.GetBytes($p1)
  $hashProcess = $null
  try {
    $hashProcess = [Diagnostics.Process]::Start($startInfo)
    $inputStream = $hashProcess.StandardInput.BaseStream
    $inputStream.Write($passwordBytes, 0, $passwordBytes.Length)
    $inputStream.Close()
    $Hash = $hashProcess.StandardOutput.ReadToEnd().Trim()
    $hashProcess.WaitForExit()
    if ($hashProcess.ExitCode -ne 0 -or $Hash -notlike 'scrypt$*') { Die '计算密码哈希失败。' }
  } catch { Die '无法通过 Python 计算密码哈希。' }
  finally {
    [Array]::Clear($passwordBytes, 0, $passwordBytes.Length)
    if ($hashProcess) { $hashProcess.Dispose() }
  }
  Ok '已生成密码哈希'
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
Ok "凭证只写入 $EnvFile（密码只保存哈希）"
if ($InfoFile) {
  $info = @('Hermes 手机网页登录信息（请妥善保管，不要发给任何人或 AI）', '', "地址：$PublicUrl", "用户名：$User", "密码：$p1", '', '手机需先打开 Tailscale 并登录同一个账号。')
  try { [IO.File]::WriteAllLines($InfoFile, $info, (New-Object System.Text.UTF8Encoding $true)) }
  catch { Die "无法写入桌面登录信息：$InfoFile" }
  finally { $info = $null }
  Ok "已写入桌面登录信息：$InfoFile（密码不显示）"
}
$p1 = $null; $p2 = $null
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
function Set-TailnetServe([string[]]$ServeArgs) {
  $serveOutput = & $TsExe @ServeArgs 2>&1 | ForEach-Object { $_.ToString() } | Out-String
  if ($LASTEXITCODE -eq 0) { return $true }
  if ($serveOutput -notmatch 'must be a Windows local admin') {
    Warn ($serveOutput.Trim() -replace 'https://(?:login|console)\.tailscale\.com/\S+', 'https://login.tailscale.com/admin/dns')
    return $false
  }
  Warn 'Tailscale 发布本地目录需要管理员权限，请在 Windows 用户账户控制弹窗中点「是」。'
  # Start-Process 需要显式保留路径周围的引号，以支持包含空格的 Hermes 主目录。
  $quotedArgs = ($ServeArgs | ForEach-Object { '"' + $_ + '"' }) -join ' '
  try {
    $serveProcess = Start-Process -FilePath $TsExe -ArgumentList $quotedArgs -Verb RunAs -WindowStyle Hidden -PassThru -Wait -ErrorAction Stop
    if ($serveProcess.ExitCode -eq 0) { return $true }
    Warn "管理员 Tailscale Serve 退出代码：$($serveProcess.ExitCode)"
  } catch { Warn '未能以管理员权限运行 Tailscale Serve。' }
  return $false
}

if ($UseTailscale) {
  Say '配置 Tailscale Serve（仅限私人 tailnet）'
  $serveArgs = @('serve', '--bg', '--https=443')
  if (-not (Set-TailnetServe ($serveArgs + "http://127.0.0.1:$Port"))) { Die 'tailscale serve 根路径配置失败。' }
  Ok "https://$DnsName/ → http://127.0.0.1:$Port"
  if (Set-TailnetServe ($serveArgs + @('--set-path', '/pwa', $PwaDir))) { Ok "https://$DnsName/pwa/ → $PwaDir" }
  else { Warn 'Tailscale 未能提供 PWA 文件目录，网页仍可通过根路径访问。' }
  if ($BlockTerminal) {
    if (Set-TailnetServe ($serveArgs + @('--set-path', '/api/host-terminal', 'text:disabled'))) { Ok '已在入口屏蔽主机终端' }
    else { Warn '未能屏蔽主机终端' }
  }
}

# ---------------------------------------------------------------- 8. 构建与重启
Say '构建 Webapp（第一次可能要几分钟）'
& $script:HermesExe webapp --build-only
if ($LASTEXITCODE -ne 0) { Die 'Webapp 构建失败，请把上面的输出发给我。' }
Ok 'Webapp 已构建'

Say '让网关读取新配置'
$GwPending = $false
switch ($GwMode) {
  'service' { & $script:HermesExe gateway restart; if ($LASTEXITCODE -eq 0) { Ok '网关已重启' } else { $GwPending = $true; Warn '网关暂时拒绝重启（通常是有任务正在运行）。任务结束后执行：hermes gateway restart' } }
  'stopped' { & $script:HermesExe gateway install --if-missing --start-now --start-on-login; if ($LASTEXITCODE -eq 0) { Ok '已安装并启动网关（登录后自动运行）' } else { Warn '网关服务安装失败，可先手动运行：hermes gateway run' } }
  'manual'  {
    if ($InstallService) {
      & $script:HermesExe gateway install --start-now --start-on-login
      if ($LASTEXITCODE -eq 0) { Ok '已安装网关服务（登录后自动运行）' } else { $GwPending = $true; Warn '网关服务安装失败；可在没有任务运行时执行：hermes gateway restart' }
    }
    else {
      $GwPending = $true
      Warn '网关当前由 Hermes Desktop 或手动启动。请在 Desktop 里重启后端，或在没有任务运行时执行：hermes gateway restart'
      Warn '想让它开机/登录后自动运行、关掉 Desktop 也能用：重新运行本脚本并加 -InstallService'
    }
  }
}

# ---------------------------------------------------------------- 9. 自检
Say '自检'
# Windows PowerShell 5.1（.NET Framework）默认可能没启用 TLS 1.2，而 Tailscale Serve 只接受 TLS 1.2+，
# 不加这一行时 HTTPS 自检会一直得到 0。只影响本次 PowerShell 进程。
try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch { }
function Get-Code($u) {
  try { [int](Invoke-WebRequest -Uri $u -UseBasicParsing -MaximumRedirection 0 -TimeoutSec 10 -ErrorAction Stop).StatusCode }
  catch { if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 } }
}
$sessionCode = 0
$manifestCode = 0
# 首次访问可能需要等待网关就绪和 Tailscale 签发 HTTPS 证书。
for ($attempt = 0; $attempt -lt 6; $attempt++) {
  if ($sessionCode -ne 401) { $sessionCode = Get-Code "$PublicUrl/api/sessions" }
  if ($manifestCode -ne 200) { $manifestCode = Get-Code "$PublicUrl/pwa/manifest.json" }
  if ($sessionCode -eq 401 -and $manifestCode -eq 200) { break }
  if ($attempt -lt 5) { Start-Sleep -Seconds 3 }
}
if ($sessionCode -eq 401) { Ok '未登录访问会话 → 401（登录保护生效）' } else { Warn "未登录访问返回 $sessionCode，期望 401。" }
if ($manifestCode -eq 200) { Ok 'PWA 文件可访问 → 200' } else { Warn "PWA 文件返回 $manifestCode，期望 200。" }
if ($sessionCode -ne 401 -or ($UseTailscale -and $manifestCode -ne 200)) {
  if ($GwPending) { Warn '网关还没重启，新配置尚未生效，所以自检暂未通过。重启网关后重新运行本脚本即可复查。' }
  else { Die '自检未通过，请先检查网关与 HTTPS 路由状态。' }
}

Write-Host ''
if ($GwPending) { Write-Host '配置已写入，但网关需要重启后才生效（见上方黄色提示）。' -ForegroundColor Yellow }
Write-Host '完成！手机访问地址（手机需打开 Tailscale 并登录同一个账号）：' -ForegroundColor Green
Write-Host ''
Write-Host "    $PublicUrl" -ForegroundColor Green
Write-Host ''
if ($GoogleMode) { Write-Host "登录方式：Google 账号（只允许 $GoogleEmail）" } else { Write-Host "登录用户名：$User" }
if ($InfoFile) { Write-Host "登录密码在桌面文件：$InfoFile" -ForegroundColor Green }
Write-Host "回退：把 $Bk 里的 config.yaml 和 .env 复制回 $HermesHome，然后 hermes gateway restart"
if ($GwPending) { exit 2 }

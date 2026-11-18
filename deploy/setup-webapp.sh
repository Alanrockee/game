#!/usr/bin/env bash
# Hermes 移动端 Webapp 一键配置（在运行 Hermes 的那台电脑上执行）。
#
# 做的事情（全部可重复执行，执行前先备份）：
#   1. 检查 Hermes 版本、当前 profile、网关运行方式
#   2. hermes backup --quick，并另存 config.yaml / .env 副本供回退
#   3. 配置官方 Webapp：webapp.enabled / host=127.0.0.1 / port / public_url
#   4. 配置官方用户名密码登录（只存 scrypt 哈希与签名密钥，密码不落盘、不回显）
#   5. 界面语言设为简体中文（--no-zh 跳过）
#   6. 安装 mobile-pwa 桌面插件 + PWA 静态文件（manifest、图标）
#   7. 用 Tailscale Serve 在 tailnet 内提供 HTTPS：/ → 127.0.0.1:端口，/pwa → 静态目录
#   8. 构建 Webapp、按网关的运行方式重启/安装服务，并做基本自检
#
# 用法：
#   bash deploy/setup-webapp.sh                 # 交互式，推荐
#   bash deploy/setup-webapp.sh --public-url https://myhost.example.com   # 不用 Tailscale，自备 HTTPS 入口
#   选项：--user NAME  --port 9120  --no-zh  --no-tailscale  --install-service  --block-terminal  --yes
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HERMES_BIN="${HERMES_BIN:-$(command -v hermes || true)}"
HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
PORT=9120
WEB_USER=""
PUBLIC_URL=""
USE_TAILSCALE=1
SET_ZH=1
INSTALL_SERVICE=0
BLOCK_TERMINAL=0
ASSUME_YES=0

while [ $# -gt 0 ]; do
  case "$1" in
    --port) PORT="$2"; shift 2 ;;
    --user) WEB_USER="$2"; shift 2 ;;
    --public-url) PUBLIC_URL="${2%/}"; USE_TAILSCALE=0; shift 2 ;;
    --no-tailscale) USE_TAILSCALE=0; shift ;;
    --no-zh) SET_ZH=0; shift ;;
    --install-service) INSTALL_SERVICE=1; shift ;;
    --block-terminal) BLOCK_TERMINAL=1; shift ;;
    --yes|-y) ASSUME_YES=1; shift ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "未知参数：$1" >&2; exit 2 ;;
  esac
done

say()  { printf '\n\033[1m▶ %s\033[0m\n' "$*"; }
ok()   { printf '  ✓ %s\n' "$*"; }
warn() { printf '  ! %s\n' "$*" >&2; }
die()  { printf '  ✗ %s\n' "$*" >&2; exit 1; }
confirm() {
  [ "$ASSUME_YES" = 1 ] && return 0
  printf '  %s [y/N] ' "$1"; read -r ans; case "$ans" in y|Y|yes|YES) return 0 ;; *) return 1 ;; esac
}

# ---------------------------------------------------------------- 1. 环境检查
say "检查 Hermes"
[ -n "$HERMES_BIN" ] || die "找不到 hermes 命令。请先按官方文档安装 Hermes Agent。"
VERSION_OUT="$("$HERMES_BIN" --version 2>/dev/null || true)"
VERSION="$(printf '%s' "$VERSION_OUT" | sed -n 's/.*Hermes Agent v\([0-9][0-9.]*\).*/\1/p' | head -1)"
INSTALL_DIR="$(printf '%s' "$VERSION_OUT" | sed -n 's/.*Install directory: *//p' | head -1)"
[ -n "$VERSION" ] || die "无法识别 Hermes 版本：$VERSION_OUT"
ok "Hermes v$VERSION（$HERMES_BIN）"
major="${VERSION%%.*}"; rest="${VERSION#*.}"; minor="${rest%%.*}"
if [ "$major" -eq 0 ] && [ "$minor" -lt 23 ]; then
  warn "本方案在 v0.23.2 上验证。v$VERSION 的 Webapp 可能缺少远程登录/会话共享能力；建议先阅读官方升级说明再决定是否升级（本脚本不会替你升级）。"
  confirm "仍然继续？" || exit 1
fi
[ -d "$HERMES_HOME" ] || die "找不到 Hermes 主目录 $HERMES_HOME（可用 HERMES_HOME=... 指定）"
ok "Hermes 主目录：$HERMES_HOME"
echo "  当前 profile："; "$HERMES_BIN" profile list 2>/dev/null | sed 's/^/    /' || true
GW_STATUS="$("$HERMES_BIN" gateway status 2>&1 || true)"
if printf '%s' "$GW_STATUS" | grep -q 'Running manually'; then GW_MODE=manual
elif printf '%s' "$GW_STATUS" | grep -qi 'not running'; then GW_MODE=stopped
else GW_MODE=service; fi
ok "网关运行方式：$GW_MODE"

# ---------------------------------------------------------------- 2. 备份
say "备份当前配置"
TS="$(date +%Y%m%d-%H%M%S)"
BK="$HERMES_HOME/backups/mobile-webapp-$TS"
mkdir -p "$BK"; chmod 700 "$BK"
cp -p "$HERMES_HOME/config.yaml" "$BK/config.yaml" 2>/dev/null || true
cp -p "$HERMES_HOME/.env" "$BK/.env" 2>/dev/null || true
echo "$BK" > "$HERMES_HOME/backups/mobile-webapp-latest"
ok "config.yaml / .env 副本：$BK"
if "$HERMES_BIN" backup --quick -o "$BK/hermes-quick-backup.zip" >/dev/null 2>&1; then ok "官方快照：$BK/hermes-quick-backup.zip"
else warn "hermes backup --quick 未成功（不影响继续，上面的文件副本仍可用于回退）"; fi

# ---------------------------------------------------------------- 3. 访问地址
if [ "$USE_TAILSCALE" = 1 ]; then
  say "检测 Tailscale"
  TS_BIN="$(command -v tailscale || true)"
  [ -z "$TS_BIN" ] && [ -x /Applications/Tailscale.app/Contents/MacOS/Tailscale ] && TS_BIN=/Applications/Tailscale.app/Contents/MacOS/Tailscale
  [ -n "$TS_BIN" ] || die "未找到 tailscale 命令。请先安装 Tailscale 并登录（见 README），或改用 --public-url 指定你自己的 HTTPS 入口。"
  DNS_NAME="$("$TS_BIN" status --json 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))' 2>/dev/null || true)"
  [ -n "$DNS_NAME" ] || die "Tailscale 未登录或没有 MagicDNS 名称。请先运行 tailscale up，并在管理后台开启 MagicDNS 与 HTTPS 证书。"
  PUBLIC_URL="https://$DNS_NAME"
  ok "tailnet 地址：$PUBLIC_URL"
fi
[ -n "$PUBLIC_URL" ] || die "没有可用的 HTTPS 地址：请使用 Tailscale，或传入 --public-url https://..."
case "$PUBLIC_URL" in https://*) ;; *) warn "public_url 不是 https，浏览器会关闭剪贴板/麦克风/通知等能力，且凭证在网络上不加密。"; confirm "仍然继续？" || exit 1 ;; esac

# ---------------------------------------------------------------- 4. 登录凭证
say "配置 Webapp 登录（官方 username/password 提供方）"
ENV_FILE="$HERMES_HOME/.env"
touch "$ENV_FILE"; chmod 600 "$ENV_FILE"
env_get() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- || true; }
env_set() {
  local key="$1" val="$2" tmp
  tmp="$(mktemp "$ENV_FILE.XXXXXX")"
  grep -v -E "^$key=" "$ENV_FILE" > "$tmp" || true
  printf '%s=%s\n' "$key" "$val" >> "$tmp"
  chmod 600 "$tmp"; mv "$tmp" "$ENV_FILE"
}
if [ -n "$(env_get HERMES_DASHBOARD_BASIC_AUTH_PASSWORD)" ]; then
  warn ".env 里有明文 HERMES_DASHBOARD_BASIC_AUTH_PASSWORD，它会覆盖哈希；建议删除该行，只保留 PASSWORD_HASH。"
fi
EXISTING_USER="$(env_get HERMES_DASHBOARD_BASIC_AUTH_USERNAME)"
REUSE=0
if [ -n "$EXISTING_USER" ] && [ -n "$(env_get HERMES_DASHBOARD_BASIC_AUTH_PASSWORD_HASH)" ]; then
  if confirm "检测到已有登录账号“$EXISTING_USER”，是否沿用（不修改密码）？"; then REUSE=1; WEB_USER="$EXISTING_USER"; fi
fi
if [ "$REUSE" = 0 ]; then
  if [ -z "$WEB_USER" ]; then printf '  登录用户名 [me]: '; read -r WEB_USER; WEB_USER="${WEB_USER:-me}"; fi
  while :; do
    printf '  设置登录密码（至少 12 位，输入不回显）: '; read -r -s PW1; echo
    printf '  再输入一次: '; read -r -s PW2; echo
    [ "$PW1" = "$PW2" ] || { warn "两次输入不一致"; continue; }
    [ "${#PW1}" -ge 12 ] || { warn "密码太短"; continue; }
    break
  done
  HASH=""
  if [ -n "$INSTALL_DIR" ] && [ -x "$INSTALL_DIR/scripts/run-in-hermes-env" ]; then
    HASH="$(printf '%s' "$PW1" | (cd "$INSTALL_DIR" && ./scripts/run-in-hermes-env python -c 'import sys; from plugins.dashboard_auth.basic import hash_password; print(hash_password(sys.stdin.read()))' 2>/dev/null) | tail -1 || true)"
  fi
  case "$HASH" in scrypt\$*) ok "已用 Hermes 官方 hash_password 生成哈希" ;; *)
    # 与官方实现相同的格式：scrypt$n$r$p$salt_b64$dk_b64（官方校验从字符串读取参数）
    HASH="$(printf '%s' "$PW1" | python3 -c 'import sys,os,hashlib,base64; pw=sys.stdin.read().encode(); s=os.urandom(16); dk=hashlib.scrypt(pw,salt=s,n=16384,r=8,p=1,dklen=64,maxmem=0); print("scrypt$16384$8$1$%s$%s"%(base64.b64encode(s).decode(),base64.b64encode(dk).decode()))')"
    ok "已用 Python 标准库 scrypt 生成哈希（与官方格式一致）" ;;
  esac
  unset PW1 PW2
  env_set HERMES_DASHBOARD_BASIC_AUTH_USERNAME "$WEB_USER"
  env_set HERMES_DASHBOARD_BASIC_AUTH_PASSWORD_HASH "$HASH"
  unset HASH
fi
if [ -z "$(env_get HERMES_DASHBOARD_BASIC_AUTH_SECRET)" ]; then
  env_set HERMES_DASHBOARD_BASIC_AUTH_SECRET "$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
  ok "已生成会话签名密钥（重启后不必重新登录）"
fi
ok "凭证只写入 $ENV_FILE（权限 600），未写入本仓库或浏览器"

# ---------------------------------------------------------------- 5. Webapp 配置
say "配置官方 Webapp"
"$HERMES_BIN" config set webapp.enabled true >/dev/null
"$HERMES_BIN" config set webapp.host 127.0.0.1 >/dev/null
"$HERMES_BIN" config set webapp.port "$PORT" >/dev/null
"$HERMES_BIN" config set webapp.public_url "$PUBLIC_URL" >/dev/null
ok "webapp: enabled / 127.0.0.1:$PORT / public_url=$PUBLIC_URL"
if [ "$SET_ZH" = 1 ]; then "$HERMES_BIN" config set display.language zh >/dev/null && ok "界面语言：简体中文（display.language=zh）"; fi

# ---------------------------------------------------------------- 6. 插件与 PWA 文件
say "安装 mobile-pwa 插件与 PWA 静态文件"
mkdir -p "$HERMES_HOME/desktop-plugins/mobile-pwa" "$HERMES_HOME/mobile-pwa"
cp "$HERE/desktop-plugin/mobile-pwa/plugin.js" "$HERMES_HOME/desktop-plugins/mobile-pwa/plugin.js"
cp "$HERE"/pwa/* "$HERMES_HOME/mobile-pwa/"
chmod 755 "$HERMES_HOME/mobile-pwa"; chmod 644 "$HERMES_HOME"/mobile-pwa/*
ok "插件：$HERMES_HOME/desktop-plugins/mobile-pwa/plugin.js"
ok "PWA 文件：$HERMES_HOME/mobile-pwa/"

# ---------------------------------------------------------------- 7. Tailscale Serve
if [ "$USE_TAILSCALE" = 1 ]; then
  say "配置 Tailscale Serve（仅 tailnet 内可访问，不是 Funnel 公网）"
  "$TS_BIN" serve --bg --https=443 "http://127.0.0.1:$PORT" >/dev/null && ok "https://$DNS_NAME/ → http://127.0.0.1:$PORT"
  if "$TS_BIN" serve --bg --https=443 --set-path /pwa "$HERMES_HOME/mobile-pwa" >/dev/null 2>&1; then ok "https://$DNS_NAME/pwa/ → $HERMES_HOME/mobile-pwa"
  else warn "Tailscale 无法直接提供本地目录（例如 macOS App Store 版）。网页仍可用，只是“添加到主屏幕”不会以独立 App 打开。见 README 的替代方案。"; fi
  if [ "$BLOCK_TERMINAL" = 1 ]; then
    if "$TS_BIN" serve --bg --https=443 --set-path /api/host-terminal 'text:disabled' >/dev/null 2>&1; then ok "已在入口屏蔽 /api/host-terminal（远程网页不能打开主机终端）"
    else warn "未能屏蔽 /api/host-terminal（该 Tailscale 版本不支持 text: 目标）"; fi
  fi
  "$TS_BIN" serve status 2>/dev/null | sed 's/^/    /' || true
fi

# ---------------------------------------------------------------- 8. 构建与重启
say "构建 Webapp（首次可能需要几分钟）"
"$HERMES_BIN" webapp --build-only && ok "Webapp 已构建"

say "让网关读取新配置"
case "$GW_MODE" in
  service)
    if "$HERMES_BIN" gateway restart; then ok "网关服务已重启"
    else warn "网关拒绝重启（通常是有任务正在运行）。任务结束后执行：hermes gateway restart"; fi ;;
  stopped)
    "$HERMES_BIN" gateway install --if-missing --start-now --start-on-login && ok "已安装并启动网关服务（开机/登录自动运行）" ;;
  manual)
    if [ "$INSTALL_SERVICE" = 1 ]; then
      "$HERMES_BIN" gateway install --start-now --start-on-login && ok "已安装网关服务"
    else
      warn "网关当前是手动/由 Hermes Desktop 启动的。请在 Desktop 中重启后端，或在没有任务运行时执行：hermes gateway restart"
      warn "如需开机自启、关闭 Desktop 后仍能远程使用：重新运行本脚本并加 --install-service"
    fi ;;
esac

# ---------------------------------------------------------------- 9. 自检
say "自检"
sleep 3
"$HERMES_BIN" webapp --status 2>&1 | sed 's/^/    /' || true
if command -v curl >/dev/null; then
  code="$(curl -s -o /dev/null -w '%{http_code}' "$PUBLIC_URL/api/sessions" || true)"
  [ "$code" = 401 ] && ok "未登录访问 $PUBLIC_URL/api/sessions → 401（登录门生效）" || warn "未登录访问返回 $code（期望 401；若网关尚未重启属正常）"
  code="$(curl -s -o /dev/null -w '%{http_code}' "$PUBLIC_URL/pwa/manifest.webmanifest" || true)"
  [ "$code" = 200 ] && ok "PWA manifest 可访问" || warn "PWA manifest 返回 $code"
fi

if [ "$USE_TAILSCALE" = 1 ]; then REACH="需手机安装 Tailscale 并登录同一个 tailnet"; else REACH="需手机能访问你提供的 HTTPS 入口"; fi
cat <<EOF

完成。手机访问地址（$REACH）：

    $PUBLIC_URL

登录用户名：$WEB_USER
回退：bash $HERE/hermes-mobile.sh rollback
状态：bash $HERE/hermes-mobile.sh status
EOF

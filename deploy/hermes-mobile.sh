#!/usr/bin/env bash
# Hermes 移动端 Webapp 日常管理。所有操作都调用 Hermes / Tailscale 官方命令，不直接改数据库。
#
#   bash deploy/hermes-mobile.sh status     # 网关、Webapp、Tailscale Serve、登录门、PWA 自检
#   bash deploy/hermes-mobile.sh start|stop|restart
#   bash deploy/hermes-mobile.sh logs [gateway|agent|errors]   # 跟随日志
#   bash deploy/hermes-mobile.sh backup     # 官方快照（config、state.db、.env、auth、cron）
#   bash deploy/hermes-mobile.sh update     # 先快照，再 hermes update（会自动重建 Webapp）
#   bash deploy/hermes-mobile.sh rollback   # 恢复 setup 之前的 config.yaml / .env，移除插件与 Serve 路径
#   bash deploy/hermes-mobile.sh signout-all  # 让所有浏览器立即退出登录
set -euo pipefail
HERMES_BIN="${HERMES_BIN:-$(command -v hermes || true)}"
HERMES_HOME="${HERMES_HOME:-$HOME/.hermes}"
TS_BIN="$(command -v tailscale || true)"
[ -z "$TS_BIN" ] && [ -x /Applications/Tailscale.app/Contents/MacOS/Tailscale ] && TS_BIN=/Applications/Tailscale.app/Contents/MacOS/Tailscale
[ -n "$HERMES_BIN" ] || { echo "找不到 hermes 命令" >&2; exit 1; }

public_url() { "$HERMES_BIN" config get webapp.public_url 2>/dev/null | tail -1 | tr -d "'\" " ; }

case "${1:-status}" in
  status)
    echo "== 网关";  "$HERMES_BIN" gateway status 2>&1 | sed 's/^/  /' | head -12
    echo "== Webapp"; "$HERMES_BIN" webapp --status 2>&1 | sed 's/^/  /' | head -12
    if [ -n "$TS_BIN" ]; then echo "== Tailscale Serve"; "$TS_BIN" serve status 2>&1 | sed 's/^/  /'; fi
    url="$(public_url)"
    if [ -n "$url" ] && command -v curl >/dev/null; then
      echo "== 入口自检：$url"
      printf '  未登录读取会话 → %s（期望 401）\n' "$(curl -s -o /dev/null -w '%{http_code}' "$url/api/sessions" || echo 失败)"
      printf '  PWA manifest   → %s（期望 200）\n' "$(curl -s -o /dev/null -w '%{http_code}' "$url/pwa/manifest.webmanifest" || echo 失败)"
    fi ;;
  start)   "$HERMES_BIN" gateway start ;;
  stop)    echo "停止后手机将无法访问，正在运行的任务也会中断。"; "$HERMES_BIN" gateway stop ;;
  restart) "$HERMES_BIN" gateway restart ;;  # 官方：有任务运行时会拒绝重启
  logs)    "$HERMES_BIN" logs "${2:-gateway}" -f ;;
  backup)  "$HERMES_BIN" backup --quick ;;
  update)
    "$HERMES_BIN" backup --quick
    echo "开始官方升级（hermes update）；如需回到旧版本，见 README“更新与回退”。"
    "$HERMES_BIN" update ;;
  signout-all) "$HERMES_BIN" webapp --sign-out ;;
  rollback)
    latest="$(cat "$HERMES_HOME/backups/mobile-webapp-latest" 2>/dev/null || true)"
    [ -n "$latest" ] && [ -d "$latest" ] || { echo "没有找到 setup 备份（$HERMES_HOME/backups/mobile-webapp-*）" >&2; exit 1; }
    echo "将恢复：$latest/config.yaml 与 .env，移除 mobile-pwa 插件，并关闭 Tailscale Serve 上的 Webapp 路径。"
    printf '确认？[y/N] '; read -r ans; case "$ans" in y|Y) ;; *) exit 1 ;; esac
    [ -f "$latest/config.yaml" ] && cp -p "$latest/config.yaml" "$HERMES_HOME/config.yaml"
    [ -f "$latest/.env" ] && cp -p "$latest/.env" "$HERMES_HOME/.env"
    rm -rf "$HERMES_HOME/desktop-plugins/mobile-pwa"
    if [ -n "$TS_BIN" ]; then
      "$TS_BIN" serve --https=443 --set-path /pwa off 2>/dev/null || true
      "$TS_BIN" serve --https=443 --set-path /api/host-terminal off 2>/dev/null || true
      "$TS_BIN" serve --https=443 off 2>/dev/null || true
    fi
    "$HERMES_BIN" gateway restart || echo "网关暂未重启（可能有任务在运行），稍后执行 hermes gateway restart"
    echo "已回退。" ;;
  *) sed -n '2,12p' "$0"; exit 2 ;;
esac

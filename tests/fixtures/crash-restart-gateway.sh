#!/usr/bin/env bash
# 测试夹具：模拟 Hermes 网关进程崩溃（SIGKILL，不给它任何收尾机会），再以前台模式重新拉起。
# 仅用于测试机；生产环境请用 `hermes gateway restart`（systemd/launchd 服务）。
set -euo pipefail
HERMES_BIN="${HERMES_BIN:-hermes}"
LOG="${GATEWAY_LOG:-/tmp/hermes-gateway.log}"
PORT="${WEBAPP_PORT:-9120}"
pids=$(pgrep -f 'hermes_cli.main.*gateway run' || true)
[ -n "$pids" ] && kill -9 $pids && echo "killed gateway: $pids"
sleep 2
nohup "$HERMES_BIN" gateway run >>"$LOG" 2>&1 &
for _ in $(seq 1 90); do
  code=$(curl -s -o /dev/null -w '%{http_code}' --noproxy '*' "http://127.0.0.1:${PORT}/api/status" || true)
  [ "$code" = "200" ] && echo "gateway back (webapp :${PORT})" && exit 0
  sleep 1
done
echo "gateway did not come back" >&2
exit 1

#!/bin/sh
# 在美西 VPS（38.189.61.57）上一次性把 PWA 前置装好。
# 前置：dsh.easymana.online → 38.189.61.57 的 A 记录已生效（dig 能查到）。
set -eu

DOMAIN=dsh.easymana.online
ROOT=/srv/dsh-mobile

echo "==> 1/4 检查 DNS"
got=$(getent hosts "$DOMAIN" | awk '{print $1}' | head -1 || true)
echo "    $DOMAIN → ${got:-查不到}"
if [ "${got:-}" != "38.189.61.57" ]; then
  echo "    DNS 还没指过来，先别继续（Caddy 会签证书失败，反复重试会被 LE 限流）"
  exit 1
fi

echo "==> 2/4 装 Caddy"
if ! command -v caddy >/dev/null 2>&1; then
  apt-get update -qq
  apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https curl gnupg >/dev/null
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq
  apt-get install -y -qq caddy >/dev/null
fi
caddy version

echo "==> 3/4 放端口 + 装配置"
ufw allow 80/tcp   >/dev/null 2>&1 || true
ufw allow 8443/tcp >/dev/null 2>&1 || true
mkdir -p "$ROOT"
if [ -f /etc/caddy/Caddyfile ] && [ ! -f /etc/caddy/Caddyfile.bak-dsh ]; then
  cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.bak-dsh
  echo "    已备份原 Caddyfile → /etc/caddy/Caddyfile.bak-dsh"
fi
install -m 0644 /tmp/Caddyfile.us /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile 2>&1 | tail -2

echo "==> 4/4 起服务"
systemctl enable --now caddy >/dev/null 2>&1 || true
systemctl restart caddy
sleep 2
systemctl is-active caddy
echo
echo "验证（DOMAIN 解析与证书签下来之前会失败，属正常，等 30 秒重试）："
echo "  curl -s https://$DOMAIN:8443/api/mobile/v1/health"
echo "  curl -s -o /dev/null -w '%{http_code}\\n' https://$DOMAIN:8443/"

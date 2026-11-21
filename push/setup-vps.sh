#!/usr/bin/env bash
# 涓€娆℃€у垵濮嬪寲 dsh-push锛氱敓鎴?VAPID 瀵嗛挜銆乪nv銆乻ystemd 鍗曞厓骞跺惎鍔?set -euo pipefail

cd /opt/dsh-push

if [ ! -f /etc/dsh-push.env ]; then
  KEYS=$(npx --yes web-push generate-vapid-keys --json)
  PUB=$(printf '%s' "$KEYS" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).publicKey))")
  PRIV=$(printf '%s' "$KEYS" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).privateKey))")
  SECRET=$(head -c 24 /dev/urandom | base64 | tr -d '=+/')
  {
    echo "VAPID_PUBLIC=$PUB"
    echo "VAPID_PRIVATE=$PRIV"
    echo "VAPID_SUBJECT=mailto:admin@easymana.online"
    echo "PUSH_SECRET=$SECRET"
    echo "PORT=18789"
    echo "DATA_FILE=/opt/dsh-push/data/subs.json"
  } > /etc/dsh-push.env
  chmod 600 /etc/dsh-push.env
  echo "env written"
else
  echo "env exists"
fi

cat > /etc/systemd/system/dsh-push.service <<'UNIT'
[Unit]
Description=DSH Push (Web Push sender for the mobile PWA)
After=network.target

[Service]
Type=simple
EnvironmentFile=/etc/dsh-push.env
ExecStart=/usr/bin/node /opt/dsh-push/server.mjs
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable dsh-push >/dev/null 2>&1 || true
systemctl restart dsh-push
sleep 1
echo "active: $(systemctl is-active dsh-push)"
curl -s http://127.0.0.1:18789/push/healthz || true
echo

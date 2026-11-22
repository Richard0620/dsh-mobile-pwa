#!/usr/bin/env bash
# Deploy the Web Push service from the repo clone.
# Secrets are NOT in the repo: they live in /etc/dsh-push.env on the server.
set -euo pipefail

REPO=/srv/dsh-mobile-src
DST=/opt/dsh-push
REF="${1:-origin/main}"

if [ "$REF" != "origin/main" ]; then
  echo "refusing deploy: only origin/main is allowed (got $REF)" >&2
  exit 2
fi

cd "$REPO"
git fetch --all --tags --prune --quiet
git checkout --force --detach "$REF" --quiet

mkdir -p "$DST"
cp push/server.mjs push/package.json "$DST"/

# deps are idempotent; skip heavy work when unchanged
( cd "$DST" && npm install --omit=dev --no-audit --no-fund --silent >/dev/null 2>&1 || npm install --omit=dev --no-audit --no-fund )

if [ -f "$REPO/deploy/systemd/dsh-push.service" ]; then
  cp "$REPO/deploy/systemd/dsh-push.service" /etc/systemd/system/dsh-push.service
  systemctl daemon-reload
fi

systemctl enable dsh-push >/dev/null 2>&1 || true
systemctl restart dsh-push
sleep 1
echo -n "dsh-push: "
systemctl is-active dsh-push
echo -n "healthz: "
curl -s http://127.0.0.1:18789/push/healthz || true
echo
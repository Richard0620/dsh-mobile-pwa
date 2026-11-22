#!/usr/bin/env bash
# DSH Mobile PWA - deploy from GitHub to /srv/dsh-mobile
#
#   ./deploy.sh            deploy origin/main (the only allowed ref)
#
# Target dir always equals exactly the runtime files of one commit.
set -euo pipefail

REPO=/srv/dsh-mobile-src
TARGET=/srv/dsh-mobile
STAGE=/tmp/dsh-mobile-stage
REF="${1:-origin/main}"

if [ "$REF" != "origin/main" ]; then
  echo "refusing deploy: only origin/main is allowed (got $REF)" >&2
  echo "feature branches must be tested via /preview/ and merged to main first" >&2
  exit 2
fi

cd "$REPO"

git fetch --all --tags --prune --quiet

# self-install: keep the /opt copies in sync with the repo version.
# Use cp-to-temp + mv (NOT cp over the running file): bash reads a script
# incrementally, truncating/replacing it in place can corrupt the current run.
if [ -f "$REPO/deploy/deploy-remote.sh" ]; then
  cp "$REPO/deploy/deploy-remote.sh" /opt/.dsh-mobile-deploy.sh.new
  chmod +x /opt/.dsh-mobile-deploy.sh.new
  mv -f /opt/.dsh-mobile-deploy.sh.new /opt/dsh-mobile-deploy.sh
fi
if [ -f "$REPO/deploy/deploy-push.sh" ]; then
  cp "$REPO/deploy/deploy-push.sh" /opt/.dsh-push-deploy.sh.new
  chmod +x /opt/.dsh-push-deploy.sh.new
  mv -f /opt/.dsh-push-deploy.sh.new /opt/dsh-push-deploy.sh
fi

if ! git rev-parse --verify --quiet "$REF" >/dev/null; then
  echo "unknown ref: $REF" >&2
  exit 1
fi

git checkout --force --detach "$REF" --quiet

COMMIT=$(git rev-parse --short HEAD)
APP=$(grep -o "const APP_VERSION = '[^']*'" index.html | head -1 | sed "s/.*'\([^']*\)'.*/\1/")
SW=$(grep -o "dsh-mobile-v[0-9]*" sw.js | head -1)

rm -rf "$STAGE"
mkdir -p "$STAGE"

cp index.html sw.js manifest.webmanifest "$STAGE"/
cp icon-192.png icon-512.png icon-maskable-512.png apple-touch-icon.png icon-dsh.ico "$STAGE"/

rsync -a --delete "$STAGE"/ "$TARGET"/

{
  echo "app=$APP"
  echo "sw=$SW"
  echo "commit=$COMMIT"
  echo "ref=$REF"
  echo "deployed_at=$(date -Is)"
  echo "source=github"
} > "$TARGET/VERSION"

echo "deployed app=$APP sw=$SW commit=$COMMIT ref=$REF"

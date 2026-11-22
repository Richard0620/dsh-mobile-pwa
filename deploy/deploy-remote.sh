#!/usr/bin/env bash
# DSH Mobile PWA - deploy from GitHub to /srv/dsh-mobile
#
#   ./deploy.sh            deploy origin/main
#   ./deploy.sh v123       deploy a tag
#   ./deploy.sh <commit>   deploy a commit
#
# Target dir always equals exactly the runtime files of one commit.
set -euo pipefail

REPO=/srv/dsh-mobile-src
TARGET=/srv/dsh-mobile
STAGE=/tmp/dsh-mobile-stage
REF="${1:-origin/main}"

cd "$REPO"

git fetch --all --tags --prune --quiet

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

#!/usr/bin/env bash
# Deploy the museum to a server over ssh.
#
#   scripts/deploy.sh            build, push assets, publish a release
#   scripts/deploy.sh --site     publish only the site (skip the data sync)
#   scripts/deploy.sh --assets   sync only the data directory
#   DRY_RUN=1 scripts/deploy.sh  print every remote command instead of running it
#
# The server side is a plain static tree under the deploy user's home:
#
#   data/originals/   archive of record, written once, never deleted here
#   data/derived/     the served rungs (public/assets), rebuildable, mirrored
#   site/releases/<stamp>-<commit>/   one directory per deploy
#   site/current -> releases/...      swapped atomically; serve this
#
# The web server maps / to site/current and /assets/ to data/derived
# (see deploy/musee.nginx.conf). Vite's own bundle lives under /app/, so the two
# never collide. Set DEPLOY_HOST to the ssh alias (default "musee"), whose
# ssh config entry supplies user, host and key; it must land in the home
# directory that holds data/ and site/.
set -euo pipefail

HOST=${DEPLOY_HOST:-musee}
KEEP=${DEPLOY_KEEP:-5}
MODE=all
case "${1:-}" in
  --site) MODE=site ;;
  --assets) MODE=assets ;;
  "") ;;
  *) echo "usage: $0 [--site|--assets]" >&2; exit 2 ;;
esac

cd "$(dirname "$0")/.."

run() {
  if [[ -n "${DRY_RUN:-}" ]]; then printf '+'; printf ' %q' "$@"; echo; else "$@"; fi
}
remote() {
  run ssh "$HOST" "$@"
}

RSYNC=(rsync -az --stats)
# macOS ships openrsync, which lacks --info; GNU rsync (brew install rsync) gets a progress bar.
if [[ $(rsync --version 2>/dev/null) == "rsync  version 3"* ]]; then RSYNC+=(--info=progress2); fi

if [[ $MODE != site ]]; then
  echo "== data: originals (add only) and derived (mirror)"
  remote mkdir -p data/originals data/derived
  run "${RSYNC[@]}" --ignore-existing data/originals/ "$HOST:data/originals/"
  run "${RSYNC[@]}" --delete public/assets/ "$HOST:data/derived/"
fi

if [[ $MODE != assets ]]; then
  echo "== build"
  run npm run build
  if [[ -z "${DRY_RUN:-}" && ! -f dist/index.html ]]; then echo "no dist/index.html after build" >&2; exit 1; fi

  stamp=$(date -u +%Y%m%dT%H%M%SZ)
  commit=$(git rev-parse --short HEAD 2>/dev/null || echo nogit)
  release="$stamp-$commit"
  echo "== site: release $release"
  remote mkdir -p "site/releases/$release"
  # The collection rungs are served from data/derived, so leave dist/assets out.
  run "${RSYNC[@]}" --exclude '/assets/' dist/ "$HOST:site/releases/$release/"
  # Swap the symlink in one rename so no request ever sees a half-copied tree.
  remote "ln -sfn releases/$release site/current.new && mv -T site/current.new site/current"
  # Keep the last few releases for a quick rollback: ln -sfn releases/<old> site/current
  remote "cd site/releases && ls -1d */ | sort | head -n -$KEEP | xargs -r rm -rf"
  echo "== live: $release"
fi

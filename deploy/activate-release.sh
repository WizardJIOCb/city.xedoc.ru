#!/usr/bin/env bash
set -euo pipefail
release_id="${1:?Provide a full Git commit SHA}"
[[ "$release_id" =~ ^[0-9a-f]{40}$ ]] || { echo 'Invalid release ID' >&2; exit 1; }
site_root=/var/www/city.xedoc.ru
archive="$site_root/incoming/$release_id.tar.gz"
release_dir="$site_root/releases/$release_id"
mkdir -p "$site_root/releases"
exec 9>"$site_root/deploy.lock"
flock -n 9 || { echo 'Another deployment is active' >&2; exit 1; }
test -f "$archive"
# The uploaded archive contains the contents of dist, never repository files.
if tar -tzf "$archive" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then
  echo 'Unsafe archive path' >&2; exit 1
fi
if [[ ! -d "$release_dir" ]]; then
  staging=$(mktemp -d "$site_root/releases/.staging-$release_id-XXXXXX")
  tar --no-same-owner -xzf "$archive" -C "$staging"
  test -f "$staging/index.html"
  test -d "$staging/assets"
  grep -Fq "$release_id" "$staging/version.json"
  chmod -R a+rX "$staging"
  mv "$staging" "$release_dir"
fi
test -f "$release_dir/index.html"
grep -Fq "$release_id" "$release_dir/version.json"
previous=$(readlink "$site_root/current" || true)
has_geo_service() { systemctl cat crush-city-geo.service >/dev/null 2>&1; }
restart_geo() {
  if [[ -f "$site_root/current/.server/geo-server.mjs" ]]; then
    systemctl restart crush-city-geo.service
  elif has_geo_service; then
    systemctl stop crush-city-geo.service
  fi
}
if [[ -e "$site_root/current" && ! -L "$site_root/current" ]]; then
  echo 'Refusing to replace a non-symlink current directory' >&2; exit 1
fi
rollback() {
  if [[ -n "$previous" ]]; then
    ln -sfn "$previous" "$site_root/rollback-link"
    mv -Tf "$site_root/rollback-link" "$site_root/current"
    restart_geo || true
    echo "Rolled back to $previous" >&2
  else
    unlink "$site_root/current"
  fi
}
ln -sfn "$release_dir" "$site_root/next-link"
mv -Tf "$site_root/next-link" "$site_root/current"
trap rollback ERR
restart_geo
if [[ -f "$release_dir/.server/geo-server.mjs" ]]; then
  curl --fail --silent --show-error --retry 8 --retry-connrefused --retry-delay 1 --max-time 5 \
    http://127.0.0.1:5190/api/geo/health | grep -Fq '"ok":true'
  curl --fail --silent --show-error --max-time 10 --resolve city.xedoc.ru:443:127.0.0.1 \
    https://city.xedoc.ru/api/geo/health | grep -Fq '"ok":true'
fi
curl --fail --silent --show-error --location --max-time 20 \
  --resolve city.xedoc.ru:80:127.0.0.1 --resolve city.xedoc.ru:443:127.0.0.1 \
  http://city.xedoc.ru/version.json | grep -Fq "$release_id"
curl --fail --silent --show-error --location --max-time 20 \
  --resolve city.xedoc.ru:80:127.0.0.1 --resolve city.xedoc.ru:443:127.0.0.1 \
  http://city.xedoc.ru/ | grep -Fq 'CRUSH CITY'
trap - ERR
printf 'Activated %s\n' "$release_id"

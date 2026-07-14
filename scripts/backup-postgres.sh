#!/usr/bin/env bash

set -Eeuo pipefail
umask 077

APP_DIR="${APP_DIR:-/opt/goofish-infrast-v1}"
BACKUP_S3_REMOTE="${BACKUP_S3_REMOTE:?BACKUP_S3_REMOTE is required}"
BACKUP_AGE_RECIPIENT="${BACKUP_AGE_RECIPIENT:?BACKUP_AGE_RECIPIENT is required}"
BACKUP_HEALTHCHECK_URL="${BACKUP_HEALTHCHECK_URL:?BACKUP_HEALTHCHECK_URL is required}"
BACKUP_DATABASE_URL="${BACKUP_DATABASE_URL:-${DATABASE_URL:-}}"
BACKUP_TMPDIR="${BACKUP_TMPDIR:-/run/goofish-backup}"
BACKUP_CONFIG_PATHS="${BACKUP_CONFIG_PATHS:-/etc/goofish-infrast-v1/backend.env:/etc/goofish-infrast-v1/backup.env:/etc/systemd/system/goofish-infrast-v1.service:/etc/systemd/system/goofish-backup.service:/etc/nginx/sites-enabled/maatool.conf}"

fail() {
  printf '[backup] ERROR: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "required command not found: $1"
}

[[ -n "$BACKUP_DATABASE_URL" ]] || fail "BACKUP_DATABASE_URL or DATABASE_URL is required"

for command in age curl findmnt pg_dump pg_restore rclone tar; do
  require_command "$command"
done

install -d -m 0700 "$BACKUP_TMPDIR"
[[ "$(findmnt -no FSTYPE -T "$BACKUP_TMPDIR")" == "tmpfs" ]] || fail "BACKUP_TMPDIR must be on tmpfs: $BACKUP_TMPDIR"

workdir="$(mktemp -d "$BACKUP_TMPDIR/postgres.XXXXXX")"
trap 'rm -rf "$workdir"' EXIT

timestamp="$(date -u +%Y-%m-%dT%H%M%SZ)"
month="$(date -u +%Y-%m)"
daily_name="${timestamp}.dump.age"
dump_path="$workdir/database.dump"
encrypted_dump_path="$workdir/$daily_name"
config_tar="$workdir/runtime-config.tar"
encrypted_config_path="$workdir/${timestamp}.config.tar.age"
remote_root="${BACKUP_S3_REMOTE%/}"

printf '[backup] creating PostgreSQL dump at %s\n' "$timestamp"
pg_dump --format=custom --no-owner --no-privileges --file "$dump_path" "$BACKUP_DATABASE_URL"
pg_restore --list "$dump_path" >/dev/null

age --recipient "$BACKUP_AGE_RECIPIENT" --output "$encrypted_dump_path" "$dump_path"
rm -f "$dump_path"

IFS=':' read -r -a config_paths <<< "$BACKUP_CONFIG_PATHS"
for path in "${config_paths[@]}"; do
  [[ -n "$path" ]] || continue
  [[ -r "$path" ]] || fail "required runtime configuration is not readable: $path"
done

git_sha="unknown"
if [[ -d "$APP_DIR/.git" ]]; then
  git_sha="$(git -C "$APP_DIR" rev-parse HEAD 2>/dev/null || printf unknown)"
fi
printf 'created_at=%s\ngit_sha=%s\n' "$timestamp" "$git_sha" > "$workdir/manifest.txt"
tar --create --file "$config_tar" --files-from /dev/null
for path in "${config_paths[@]}"; do
  [[ -n "$path" ]] || continue
  tar --append --file "$config_tar" --directory=/ "${path#/}"
done
tar --append --file "$config_tar" --directory="$workdir" manifest.txt
age --recipient "$BACKUP_AGE_RECIPIENT" --output "$encrypted_config_path" "$config_tar"
rm -f "$config_tar"

rclone copyto "$encrypted_dump_path" "$remote_root/daily/$daily_name"
rclone copyto "$encrypted_config_path" "$remote_root/daily/${timestamp}.config.tar.age"

if [[ "$(date -u +%d)" == "01" ]]; then
  rclone copyto "$encrypted_dump_path" "$remote_root/monthly/${month}.dump.age"
  rclone copyto "$encrypted_config_path" "$remote_root/monthly/${month}.config.tar.age"
fi

for remote_object in "$remote_root/daily/$daily_name" "$remote_root/daily/${timestamp}.config.tar.age"; do
  rclone size --json "$remote_object" | grep -Eq '"bytes"[[:space:]]*:[[:space:]]*[1-9][0-9]*' \
    || fail "remote object verification failed: $remote_object"
done

prune_prefix() {
  local prefix="$1" keep="$2" object
  while IFS= read -r object; do
    [[ -n "$object" ]] || continue
    rclone deletefile "$remote_root/$prefix/$object"
  done < <(rclone lsf --files-only "$remote_root/$prefix" | sort -r | tail -n +"$((keep + 1))")
}

prune_prefix daily 70
prune_prefix monthly 24

curl --fail --silent --show-error --retry 3 --max-time 30 "$BACKUP_HEALTHCHECK_URL" >/dev/null
printf '[backup] completed successfully at %s\n' "$timestamp"

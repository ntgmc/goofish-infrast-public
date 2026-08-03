#!/usr/bin/env bash

set -Eeuo pipefail
umask 077

APP_DIR="${APP_DIR:-/opt/goofish-infrast-v1}"
BACKUP_S3_REMOTE="${BACKUP_S3_REMOTE:?BACKUP_S3_REMOTE is required}"
BACKUP_AGE_RECIPIENT="${BACKUP_AGE_RECIPIENT:?BACKUP_AGE_RECIPIENT is required}"
BACKUP_HEALTHCHECK_URL="${BACKUP_HEALTHCHECK_URL:?BACKUP_HEALTHCHECK_URL is required}"
BACKUP_ENVIRONMENT="${BACKUP_ENVIRONMENT:?BACKUP_ENVIRONMENT is required}"
BACKUP_MANIFEST_SIGNING_KEY="${BACKUP_MANIFEST_SIGNING_KEY:?BACKUP_MANIFEST_SIGNING_KEY is required}"
BACKUP_EXPECTED_DATABASE_FINGERPRINT="${BACKUP_EXPECTED_DATABASE_FINGERPRINT:?BACKUP_EXPECTED_DATABASE_FINGERPRINT is required}"
BACKUP_DATABASE_URL="${BACKUP_DATABASE_URL:-${DATABASE_URL:-}}"
BACKUP_TMPDIR="${BACKUP_TMPDIR:-/run/goofish-backup}"
BACKUP_CONFIG_PATHS="${BACKUP_CONFIG_PATHS:-/etc/goofish-infrast-v1/backend.env:/etc/goofish-infrast-v1/backup.env:/etc/systemd/system/goofish-infrast-v1.service:/etc/systemd/system/goofish-backup.service:/etc/nginx/sites-enabled/maatool.conf}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

fail() {
  printf '[backup] ERROR: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "required command not found: $1"
}

[[ -n "$BACKUP_DATABASE_URL" ]] || fail "BACKUP_DATABASE_URL or DATABASE_URL is required"
[[ -r "$BACKUP_MANIFEST_SIGNING_KEY" ]] || fail "BACKUP_MANIFEST_SIGNING_KEY is not readable"
export BACKUP_DATABASE_URL

for command in age curl findmnt node pg_dump pg_restore psql rclone sha256sum ssh-keygen stat tar; do
  require_command "$command"
done

install -d -m 0700 "$BACKUP_TMPDIR"
[[ "$(findmnt -no FSTYPE -T "$BACKUP_TMPDIR")" == "tmpfs" ]] || fail "BACKUP_TMPDIR must be on tmpfs: $BACKUP_TMPDIR"

workdir="$(mktemp -d "$BACKUP_TMPDIR/postgres.XXXXXX")"
trap 'rm -rf "$workdir"' EXIT

timestamp="$(date -u +%Y-%m-%dT%H%M%SZ)"
month="$(date -u +%Y-%m)"
dump_path="$workdir/database.dump"
encrypted_dump_path="$workdir/${timestamp}.dump.age"
config_tar="$workdir/runtime-config.tar"
encrypted_config_path="$workdir/${timestamp}.config.tar.age"
remote_root="${BACKUP_S3_REMOTE%/}"
export PGSERVICEFILE="$workdir/pg_service.conf"
database_fingerprint="$(node "$SCRIPT_DIR/write-pg-service.mjs" \
  --url-env BACKUP_DATABASE_URL --output "$PGSERVICEFILE" --metadata "$workdir/database.json" --service goofish_backup)"
if [[ "$database_fingerprint" != "$BACKUP_EXPECTED_DATABASE_FINGERPRINT" ]]; then
  fail "database fingerprint does not match BACKUP_EXPECTED_DATABASE_FINGERPRINT"
fi
database_schema_version="$(node "$SCRIPT_DIR/backup-manifest.mjs" contract --field database_schema_version)"
schema_identity="$(psql --no-psqlrc --tuples-only --no-align --dbname=service=goofish_backup \
  --command="select status || ':' || checksum from goofish_schema_migrations where version = '$database_schema_version'")"
schema_identity="${schema_identity//[[:space:]]/}"
[[ "$schema_identity" =~ ^completed:[0-9a-f]{64}$ ]] || fail "database schema ledger is not completed for $database_schema_version"

printf '[backup] creating PostgreSQL dump at %s\n' "$timestamp"
pg_dump --format=custom --no-owner --no-privileges --file "$dump_path" --dbname=service=goofish_backup
pg_restore --list "$dump_path" >/dev/null

age --recipient "$BACKUP_AGE_RECIPIENT" --output "$encrypted_dump_path" "$dump_path"
rm -f "$dump_path"

IFS=':' read -r -a config_paths <<< "$BACKUP_CONFIG_PATHS"
for path in "${config_paths[@]}"; do
  [[ -n "$path" ]] || continue
  [[ -r "$path" ]] || fail "required runtime configuration is not readable: $path"
done

git_sha="${BACKUP_GIT_SHA:-}"
if [[ -z "$git_sha" && -d "$APP_DIR/.git" ]]; then
  git_sha="$(git -C "$APP_DIR" rev-parse HEAD 2>/dev/null || printf unknown)"
fi
[[ "$git_sha" =~ ^[0-9a-f]{40}$ ]] || fail "BACKUP_GIT_SHA or APP_DIR Git HEAD must provide a full commit SHA"
printf 'created_at=%s\ngit_sha=%s\ndatabase_fingerprint=%s\n' "$timestamp" "$git_sha" "$database_fingerprint" > "$workdir/backup-metadata.txt"
tar --create --file "$config_tar" --files-from /dev/null
for path in "${config_paths[@]}"; do
  [[ -n "$path" ]] || continue
  tar --append --file "$config_tar" --directory=/ "${path#/}"
done
tar --append --file "$config_tar" --directory="$workdir" backup-metadata.txt
age --recipient "$BACKUP_AGE_RECIPIENT" --output "$encrypted_config_path" "$config_tar"
rm -f "$config_tar"

dump_sha256="$(sha256sum "$encrypted_dump_path" | awk '{print $1}')"
config_sha256="$(sha256sum "$encrypted_config_path" | awk '{print $1}')"
dump_size="$(stat -c %s "$encrypted_dump_path")"
config_size="$(stat -c %s "$encrypted_config_path")"

publish_set() {
  local prefix="$1" set_id="$2"
  local database_object="$prefix/${set_id}.dump.age"
  local config_object="$prefix/${set_id}.config.tar.age"
  local manifest_path="$workdir/${prefix}-${set_id}.manifest.json"
  local manifest_object="$prefix/${set_id}.manifest.json"

  node "$SCRIPT_DIR/backup-manifest.mjs" create \
    --output "$manifest_path" --backup-id "$set_id" --environment "$BACKUP_ENVIRONMENT" \
    --git-sha "$git_sha" --database-fingerprint "$database_fingerprint" \
    --database-object "$database_object" --database-sha256 "$dump_sha256" --database-size "$dump_size" \
    --config-object "$config_object" --config-sha256 "$config_sha256" --config-size "$config_size"
  ssh-keygen -Y sign -q -f "$BACKUP_MANIFEST_SIGNING_KEY" -n goofish-backup "$manifest_path"

  rclone copyto "$encrypted_dump_path" "$remote_root/$database_object"
  rclone copyto "$encrypted_config_path" "$remote_root/$config_object"
  rclone copyto "$manifest_path" "$remote_root/$manifest_object"
  rclone copyto "$manifest_path.sig" "$remote_root/$manifest_object.sig"
  verify_remote_object "$encrypted_dump_path" "$remote_root/$database_object"
  verify_remote_object "$encrypted_config_path" "$remote_root/$config_object"
  verify_remote_object "$manifest_path" "$remote_root/$manifest_object"
  verify_remote_object "$manifest_path.sig" "$remote_root/$manifest_object.sig"
}

verify_remote_object() {
  local local_path="$1" remote_object="$2" local_hash remote_hash local_size remote_size
  local_hash="$(sha256sum "$local_path" | awk '{print tolower($1)}')"
  remote_hash="$(rclone hashsum SHA-256 "$remote_object" | awk 'NR == 1 {print tolower($1)}')"
  [[ "$remote_hash" == "$local_hash" ]] || fail "remote SHA-256 verification failed: $remote_object"
  local_size="$(stat -c %s "$local_path")"
  remote_size="$(rclone size --json "$remote_object" | node -e "let value=''; process.stdin.setEncoding('utf8'); process.stdin.on('data', chunk => value += chunk); process.stdin.on('end', () => process.stdout.write(String(JSON.parse(value).bytes)))")"
  [[ "$remote_size" == "$local_size" ]] || fail "remote size verification failed: $remote_object"
}

prune_sets() {
  local prefix="$1" keep="$2" manifest_name backup_id suffix
  while IFS= read -r manifest_name; do
    [[ -n "$manifest_name" ]] || continue
    backup_id="${manifest_name%.manifest.json}"
    [[ "$backup_id" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{6}Z$ ]] || fail "refusing to prune an invalid backup set name"
    for suffix in dump.age config.tar.age manifest.json manifest.json.sig; do
      rclone deletefile "$remote_root/$prefix/$backup_id.$suffix"
    done
  done < <(rclone lsf --files-only "$remote_root/$prefix" | grep -E '\.manifest\.json$' | sort -r | tail -n +"$((keep + 1))")
}

publish_set daily "$timestamp"
if [[ "$(date -u +%d)" == "01" ]]; then publish_set monthly "$timestamp"; fi

prune_sets daily 35
prune_sets monthly 12

curl --fail --silent --show-error --retry 3 --max-time 30 "$BACKUP_HEALTHCHECK_URL" >/dev/null
printf '[backup] completed successfully at %s\n' "$timestamp"

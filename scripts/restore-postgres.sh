#!/usr/bin/env bash

set -Eeuo pipefail
umask 077

usage() {
  cat <<'EOF'
Usage: restore-postgres.sh --manifest-object OBJECT --environment NAME \
  --expected-target-fingerprint SHA256 --change-id ID --confirm-empty-target

Restores one signed backup set into a new, empty database only. In-place clean
or production replacement is intentionally unsupported; validate the new
database and switch traffic through the reviewed deployment procedure.
EOF
}

manifest_object=''
environment=''
expected_target_fingerprint=''
change_id=''
confirmed=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --manifest-object) manifest_object="${2:?missing manifest object}"; shift 2 ;;
    --environment) environment="${2:?missing environment}"; shift 2 ;;
    --expected-target-fingerprint) expected_target_fingerprint="${2:?missing target fingerprint}"; shift 2 ;;
    --change-id) change_id="${2:?missing change id}"; shift 2 ;;
    --confirm-empty-target) confirmed=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done

[[ "$confirmed" == true ]] || { usage >&2; exit 2; }
[[ "$manifest_object" =~ ^(daily|monthly)/[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{6}Z\.manifest\.json$ ]] || { printf 'invalid manifest object\n' >&2; exit 2; }
[[ "$environment" =~ ^[a-z][a-z0-9_-]{1,31}$ ]] || { printf 'invalid environment\n' >&2; exit 2; }
[[ "$expected_target_fingerprint" =~ ^[0-9a-f]{64}$ ]] || { printf 'invalid expected target fingerprint\n' >&2; exit 2; }
[[ "$change_id" =~ ^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$ ]] || { printf 'invalid change id\n' >&2; exit 2; }

BACKUP_S3_REMOTE="${BACKUP_S3_REMOTE:?BACKUP_S3_REMOTE is required}"
RESTORE_DATABASE_URL="${RESTORE_DATABASE_URL:?RESTORE_DATABASE_URL is required}"
RESTORE_AGE_IDENTITY="${RESTORE_AGE_IDENTITY:?RESTORE_AGE_IDENTITY is required}"
RESTORE_MANIFEST_ALLOWED_SIGNERS="${RESTORE_MANIFEST_ALLOWED_SIGNERS:?RESTORE_MANIFEST_ALLOWED_SIGNERS is required}"
RESTORE_TMPDIR="${RESTORE_TMPDIR:-/run/goofish-restore}"
RESTORE_CONFIG_OUTPUT_DIR="${RESTORE_CONFIG_OUTPUT_DIR:-$PWD/recovered-runtime-config}"
RESTORE_MAINTENANCE_LOCK_FILE="${RESTORE_MAINTENANCE_LOCK_FILE:-/run/lock/goofish-postgres-restore.lock}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export RESTORE_DATABASE_URL

for command in age findmnt flock node pg_restore psql rclone sha256sum ssh-keygen tar; do
  command -v "$command" >/dev/null 2>&1 || { printf 'required command not found: %s\n' "$command" >&2; exit 1; }
done
[[ -r "$RESTORE_AGE_IDENTITY" ]] || { printf 'RESTORE_AGE_IDENTITY is not readable\n' >&2; exit 1; }
[[ -r "$RESTORE_MANIFEST_ALLOWED_SIGNERS" ]] || { printf 'RESTORE_MANIFEST_ALLOWED_SIGNERS is not readable\n' >&2; exit 1; }

install -d -m 0700 "$RESTORE_TMPDIR"
[[ "$(findmnt -no FSTYPE -T "$RESTORE_TMPDIR")" == "tmpfs" ]] || { printf 'RESTORE_TMPDIR must be on tmpfs\n' >&2; exit 1; }
install -d -m 0700 "$(dirname "$RESTORE_MAINTENANCE_LOCK_FILE")"
exec 9>"$RESTORE_MAINTENANCE_LOCK_FILE"
flock -n 9 || { printf 'another database restore holds the maintenance lock\n' >&2; exit 1; }

workdir="$(mktemp -d "$RESTORE_TMPDIR/postgres.XXXXXX")"
trap 'rm -rf "$workdir"' EXIT
remote_root="${BACKUP_S3_REMOTE%/}"
manifest_path="$workdir/backup.manifest.json"
rclone copyto "$remote_root/$manifest_object" "$manifest_path"
rclone copyto "$remote_root/$manifest_object.sig" "$manifest_path.sig"
ssh-keygen -Y verify -f "$RESTORE_MANIFEST_ALLOWED_SIGNERS" -I "goofish-backup:$environment" \
  -n goofish-backup -s "$manifest_path.sig" < "$manifest_path"
node "$SCRIPT_DIR/backup-manifest.mjs" verify --path "$manifest_path" --environment "$environment" >/dev/null

manifest_field() {
  node "$SCRIPT_DIR/backup-manifest.mjs" get --path "$manifest_path" --field "$1"
}

database_object="$(manifest_field database_object)"
database_sha256="$(manifest_field database_sha256)"
config_object="$(manifest_field config_object)"
config_sha256="$(manifest_field config_sha256)"
database_schema_version="$(manifest_field database_schema_version)"
git_sha="$(manifest_field git_sha)"

rclone copyto "$remote_root/$database_object" "$workdir/database.dump.age"
rclone copyto "$remote_root/$config_object" "$workdir/runtime-config.tar.age"
[[ "$(sha256sum "$workdir/database.dump.age" | awk '{print tolower($1)}')" == "$database_sha256" ]] || { printf 'database object SHA-256 mismatch\n' >&2; exit 1; }
[[ "$(sha256sum "$workdir/runtime-config.tar.age" | awk '{print tolower($1)}')" == "$config_sha256" ]] || { printf 'config object SHA-256 mismatch\n' >&2; exit 1; }

age --decrypt --identity "$RESTORE_AGE_IDENTITY" --output "$workdir/database.dump" "$workdir/database.dump.age"
age --decrypt --identity "$RESTORE_AGE_IDENTITY" --output "$workdir/runtime-config.tar" "$workdir/runtime-config.tar.age"
pg_restore --list "$workdir/database.dump" >/dev/null
while IFS= read -r entry; do
  [[ "$entry" != /* && "$entry" != *'../'* && "$entry" != '..' ]] || { printf 'unsafe path in runtime config archive\n' >&2; exit 1; }
done < <(tar --list --file "$workdir/runtime-config.tar")
tar --list --verbose --file "$workdir/runtime-config.tar" | awk '$1 ~ /^[lh]/ { exit 1 }' \
  || { printf 'runtime config archive contains links\n' >&2; exit 1; }

export PGSERVICEFILE="$workdir/pg_service.conf"
target_fingerprint="$(node "$SCRIPT_DIR/write-pg-service.mjs" \
  --url-env RESTORE_DATABASE_URL --output "$PGSERVICEFILE" --metadata "$workdir/target-database.json" --service goofish_restore)"
[[ "$target_fingerprint" == "$expected_target_fingerprint" ]] || { printf 'target database fingerprint mismatch\n' >&2; exit 1; }

active_connections="$(psql --no-psqlrc --tuples-only --no-align --dbname=service=goofish_restore \
  --command="select count(*) from pg_stat_activity where datname = current_database() and pid <> pg_backend_pid()")"
[[ "${active_connections//[[:space:]]/}" == "0" ]] || { printf 'target database has active connections\n' >&2; exit 1; }
user_tables="$(psql --no-psqlrc --tuples-only --no-align --dbname=service=goofish_restore \
  --command="select count(*) from pg_catalog.pg_class class join pg_catalog.pg_namespace namespace on namespace.oid = class.relnamespace where namespace.nspname not in ('pg_catalog', 'information_schema') and namespace.nspname !~ '^pg_toast' and class.relkind in ('r', 'p')")"
[[ "${user_tables//[[:space:]]/}" == "0" ]] || { printf 'target database is not empty; in-place replacement is forbidden\n' >&2; exit 1; }

install -d -m 0700 "$RESTORE_CONFIG_OUTPUT_DIR"
tar --extract --file "$workdir/runtime-config.tar" --directory "$RESTORE_CONFIG_OUTPUT_DIR" --no-same-owner --no-same-permissions
pg_restore --exit-on-error --single-transaction --no-owner --no-privileges \
  --dbname=service=goofish_restore "$workdir/database.dump"

printf 'Restore completed into an empty target (change %s, source Git SHA %s, schema %s). Validate with npm run check:migration and /api/health before switching traffic.\n' \
  "$change_id" "$git_sha" "$database_schema_version"

#!/usr/bin/env bash

set -Eeuo pipefail
umask 077

usage() {
  cat <<'EOF'
Usage: restore-postgres.sh --database-object OBJECT --config-object OBJECT --confirm-restore

Requires BACKUP_S3_REMOTE, RESTORE_DATABASE_URL and RESTORE_AGE_IDENTITY. The
target database must be a disposable recovery database or an approved empty
production replacement. Runtime configuration is extracted for inspection only.
EOF
}

database_object=''
config_object=''
confirmed=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --database-object) database_object="${2:?missing database object}"; shift 2 ;;
    --config-object) config_object="${2:?missing config object}"; shift 2 ;;
    --confirm-restore) confirmed=true; shift ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
done

[[ "$confirmed" == true ]] || { usage >&2; exit 2; }
[[ -n "$database_object" && -n "$config_object" ]] || { usage >&2; exit 2; }

BACKUP_S3_REMOTE="${BACKUP_S3_REMOTE:?BACKUP_S3_REMOTE is required}"
RESTORE_DATABASE_URL="${RESTORE_DATABASE_URL:?RESTORE_DATABASE_URL is required}"
RESTORE_AGE_IDENTITY="${RESTORE_AGE_IDENTITY:?RESTORE_AGE_IDENTITY is required}"
RESTORE_TMPDIR="${RESTORE_TMPDIR:-/run/goofish-restore}"
RESTORE_CONFIG_OUTPUT_DIR="${RESTORE_CONFIG_OUTPUT_DIR:-$PWD/recovered-runtime-config}"

for command in age findmnt pg_restore rclone tar; do
  command -v "$command" >/dev/null 2>&1 || { printf 'required command not found: %s\n' "$command" >&2; exit 1; }
done
[[ -r "$RESTORE_AGE_IDENTITY" ]] || { printf 'RESTORE_AGE_IDENTITY is not readable\n' >&2; exit 1; }

install -d -m 0700 "$RESTORE_TMPDIR"
[[ "$(findmnt -no FSTYPE -T "$RESTORE_TMPDIR")" == "tmpfs" ]] || { printf 'RESTORE_TMPDIR must be on tmpfs\n' >&2; exit 1; }
workdir="$(mktemp -d "$RESTORE_TMPDIR/postgres.XXXXXX")"
trap 'rm -rf "$workdir"' EXIT

remote_root="${BACKUP_S3_REMOTE%/}"
rclone copyto "$remote_root/$database_object" "$workdir/database.dump.age"
rclone copyto "$remote_root/$config_object" "$workdir/runtime-config.tar.age"
age --decrypt --identity "$RESTORE_AGE_IDENTITY" --output "$workdir/database.dump" "$workdir/database.dump.age"
age --decrypt --identity "$RESTORE_AGE_IDENTITY" --output "$workdir/runtime-config.tar" "$workdir/runtime-config.tar.age"
pg_restore --list "$workdir/database.dump" >/dev/null

install -d -m 0700 "$RESTORE_CONFIG_OUTPUT_DIR"
tar --extract --file "$workdir/runtime-config.tar" --directory "$RESTORE_CONFIG_OUTPUT_DIR" --no-same-owner
pg_restore --clean --if-exists --no-owner --no-privileges --dbname "$RESTORE_DATABASE_URL" "$workdir/database.dump"

printf 'Restore completed. Validate the target with npm run check:migration, /api/health, historical CDK verification, historical license verification, and a Skland credential decrypt check before traffic is enabled.\n'

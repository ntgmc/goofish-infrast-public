#!/usr/bin/env bash

set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT
fake_bin="$workdir/bin"
remote="$workdir/remote"
tmpfs="$workdir/tmpfs"
mkdir -p "$fake_bin" "$remote/daily" "$tmpfs"

cat > "$fake_bin/rclone" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
[[ "$1" == copyto ]]
cp "$2" "$3"
EOF
cat > "$fake_bin/ssh-keygen" <<'EOF'
#!/usr/bin/env bash
cat >/dev/null
EOF
cat > "$fake_bin/age" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
output=''
input="${!#}"
while [[ $# -gt 0 ]]; do
  if [[ "$1" == --output ]]; then output="$2"; shift 2; continue; fi
  shift
done
cp "$input" "$output"
EOF
cat > "$fake_bin/pg_restore" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
if [[ "$1" == --list ]]; then exit 0; fi
printf '%s\n' "$@" > "$PG_RESTORE_ARGUMENTS"
EOF
cat > "$fake_bin/psql" <<'EOF'
#!/usr/bin/env bash
printf '0\n'
EOF
cat > "$fake_bin/findmnt" <<'EOF'
#!/usr/bin/env bash
printf 'tmpfs\n'
EOF
chmod +x "$fake_bin"/*

timestamp='2026-08-03T120000Z'
printf 'encrypted dump fixture' > "$remote/daily/$timestamp.dump.age"
mkdir -p "$workdir/config/etc/goofish"
printf 'APP_ROLE=api\n' > "$workdir/config/etc/goofish/backend.env"
tar -C "$workdir/config" -cf "$remote/daily/$timestamp.config.tar.age" etc/goofish/backend.env
dump_sha="$(sha256sum "$remote/daily/$timestamp.dump.age" | awk '{print $1}')"
config_sha="$(sha256sum "$remote/daily/$timestamp.config.tar.age" | awk '{print $1}')"
node "$repo_root/scripts/backup-manifest.mjs" create \
  --output "$remote/daily/$timestamp.manifest.json" --backup-id "$timestamp" --environment test \
  --git-sha 0123456789abcdef0123456789abcdef01234567 --database-fingerprint "$(printf 'a%.0s' {1..64})" \
  --database-object "daily/$timestamp.dump.age" --database-sha256 "$dump_sha" --database-size "$(stat -c %s "$remote/daily/$timestamp.dump.age")" \
  --config-object "daily/$timestamp.config.tar.age" --config-sha256 "$config_sha" --config-size "$(stat -c %s "$remote/daily/$timestamp.config.tar.age")"
printf 'fixture signature' > "$remote/daily/$timestamp.manifest.json.sig"
printf 'fixture age identity\n' > "$workdir/age-identity"
printf 'goofish-backup:test ssh-ed25519 fixture\n' > "$workdir/allowed-signers"

export PATH="$fake_bin:$PATH"
export BACKUP_S3_REMOTE="$remote"
export RESTORE_DATABASE_URL='postgresql://restore_user:restore-secret@db.example.test:5432/goofish_restore'
export RESTORE_AGE_IDENTITY="$workdir/age-identity"
export RESTORE_MANIFEST_ALLOWED_SIGNERS="$workdir/allowed-signers"
export RESTORE_TMPDIR="$tmpfs"
export RESTORE_CONFIG_OUTPUT_DIR="$workdir/recovered-config"
export RESTORE_MAINTENANCE_LOCK_FILE="$workdir/restore.lock"
export PG_RESTORE_ARGUMENTS="$workdir/pg-restore-arguments"
target_fingerprint="$(node "$repo_root/scripts/write-pg-service.mjs" \
  --url-env RESTORE_DATABASE_URL --output "$workdir/target.service" --service fixture)"

bash "$repo_root/scripts/restore-postgres.sh" \
  --manifest-object "daily/$timestamp.manifest.json" \
  --environment test \
  --expected-target-fingerprint "$target_fingerprint" \
  --change-id DRILL-2026-08-03 \
  --confirm-empty-target

grep -Fx -- '--dbname=service=goofish_restore' "$PG_RESTORE_ARGUMENTS" >/dev/null
if grep -E -- '--clean|restore-secret|postgresql://' "$PG_RESTORE_ARGUMENTS" >/dev/null; then
  printf 'restore used a destructive flag or leaked the database URL\n' >&2
  exit 1
fi

rm -f "$PG_RESTORE_ARGUMENTS"
if bash "$repo_root/scripts/restore-postgres.sh" \
  --manifest-object "daily/$timestamp.manifest.json" \
  --environment test \
  --expected-target-fingerprint "$(printf 'b%.0s' {1..64})" \
  --change-id DRILL-2026-08-03 \
  --confirm-empty-target; then
  printf 'restore unexpectedly accepted the wrong target fingerprint\n' >&2
  exit 1
fi
test ! -e "$PG_RESTORE_ARGUMENTS"

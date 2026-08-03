#!/usr/bin/env bash

set -Eeuo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT
fake_bin="$workdir/bin"
mkdir -p "$fake_bin" "$workdir/tmpfs" "$workdir/app"

cat > "$fake_bin/pg_dump" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
printf '%s\n' "$@" > "$PG_DUMP_ARGUMENTS"
while [[ $# -gt 0 ]]; do
  if [[ "$1" == "--file" ]]; then printf 'dump' > "$2"; exit 0; fi
  shift
done
exit 1
EOF
cat > "$fake_bin/pg_restore" <<'EOF'
#!/usr/bin/env bash
[[ "${FAIL_PG_RESTORE:-}" != "1" ]]
EOF
cat > "$fake_bin/psql" <<'EOF'
#!/usr/bin/env bash
printf 'completed:%064d\n' 0
EOF
cat > "$fake_bin/age" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
output=''
input="${!#}"
while [[ $# -gt 0 ]]; do
  if [[ "$1" == "--output" ]]; then output="$2"; shift 2; continue; fi
  shift
done
cp "$input" "$output"
EOF
cat > "$fake_bin/rclone" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
case "$1" in
  copyto) mkdir -p "$(dirname "$3")"; cp "$2" "$3" ;;
  hashsum) sha256sum "$3" ;;
  size) printf '{"bytes":%s}\n' "$(stat -c %s "$3")" ;;
  lsf) test ! -d "$3" || find "$3" -maxdepth 1 -type f -printf '%f\n' ;;
  deletefile) rm -f "$2" ;;
  *) exit 1 ;;
esac
EOF
cat > "$fake_bin/ssh-keygen" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
input="${!#}"
printf 'fixture signature' > "$input.sig"
EOF
cat > "$fake_bin/curl" <<'EOF'
#!/usr/bin/env bash
touch "$HEARTBEAT_FILE"
EOF
cat > "$fake_bin/findmnt" <<'EOF'
#!/usr/bin/env bash
printf 'tmpfs\n'
EOF
chmod +x "$fake_bin"/*

printf 'DATABASE_URL=postgresql://example\n' > "$workdir/backend.env"
printf 'fixture signing key\n' > "$workdir/signing-key"
export PATH="$fake_bin:$PATH"
export BACKUP_S3_REMOTE="$workdir/remote"
export BACKUP_AGE_RECIPIENT='age1testrecipient'
export BACKUP_HEALTHCHECK_URL='https://healthcheck.invalid/test'
export BACKUP_ENVIRONMENT='test'
export BACKUP_MANIFEST_SIGNING_KEY="$workdir/signing-key"
export BACKUP_DATABASE_URL='postgresql://backup_user:fixture-secret@db.example.test:5432/goofish'
export BACKUP_GIT_SHA='0123456789abcdef0123456789abcdef01234567'
export BACKUP_TMPDIR="$workdir/tmpfs"
export BACKUP_CONFIG_PATHS="$workdir/backend.env"
export HEARTBEAT_FILE="$workdir/heartbeat"
export APP_DIR="$workdir/app"
export PG_DUMP_ARGUMENTS="$workdir/pg-dump-arguments"
export BACKUP_EXPECTED_DATABASE_FINGERPRINT
BACKUP_EXPECTED_DATABASE_FINGERPRINT="$(node "$repo_root/scripts/write-pg-service.mjs" \
  --url-env BACKUP_DATABASE_URL --output "$workdir/expected.service" --service expected)"

bash "$repo_root/scripts/backup-postgres.sh"
test -f "$workdir/heartbeat"
test -n "$(find "$workdir/remote/daily" -name '*.dump.age' -print -quit)"
test -n "$(find "$workdir/remote/daily" -name '*.config.tar.age' -print -quit)"
test -n "$(find "$workdir/remote/daily" -name '*.manifest.json' -print -quit)"
test -n "$(find "$workdir/remote/daily" -name '*.manifest.json.sig' -print -quit)"
grep -Fx -- '--dbname=service=goofish_backup' "$PG_DUMP_ARGUMENTS" >/dev/null
if grep -F 'fixture-secret' "$PG_DUMP_ARGUMENTS" >/dev/null; then
  printf 'database password leaked into pg_dump arguments\n' >&2
  exit 1
fi

rm -f "$workdir/heartbeat"
if FAIL_PG_RESTORE=1 bash "$repo_root/scripts/backup-postgres.sh"; then
  printf 'backup unexpectedly succeeded after validation failure\n' >&2
  exit 1
fi
test ! -e "$workdir/heartbeat"

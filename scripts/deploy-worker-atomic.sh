#!/usr/bin/env bash

set -Eeuo pipefail

TARGET_SHA="${TARGET_SHA:-}"
ALLOW_REDEPLOY="${ALLOW_REDEPLOY:-false}"
CANDIDATE_ONLY="${CANDIDATE_ONLY:-false}"
DEPLOY_ROOT="${DEPLOY_ROOT:-/opt/goofish-infrast-v1-worker}"
REPO_DIR="${REPO_DIR:-$DEPLOY_ROOT/repository}"
RELEASES_DIR="${RELEASES_DIR:-$DEPLOY_ROOT/releases}"
SLOTS_DIR="${SLOTS_DIR:-$DEPLOY_ROOT/slots}"
STATE_DIR="${STATE_DIR:-$DEPLOY_ROOT/state}"
CURRENT_LINK="${CURRENT_LINK:-$DEPLOY_ROOT/current}"
PREVIOUS_LINK="${PREVIOUS_LINK:-$DEPLOY_ROOT/previous}"
ACTIVE_SLOT_FILE="${ACTIVE_SLOT_FILE:-$STATE_DIR/active-slot}"
SERVICE_NAME="${SERVICE_NAME:-goofish-optimize-worker}"
BLUE_HEALTH_PORT="${BLUE_HEALTH_PORT:-3010}"
GREEN_HEALTH_PORT="${GREEN_HEALTH_PORT:-3012}"
REMOTE="${REMOTE:-origin}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"
LOCK_FILE="${LOCK_FILE:-/tmp/goofish-infrast-v1.worker.deploy.lock}"
HEALTH_RETRIES="${HEALTH_RETRIES:-30}"
HEALTH_DELAY_SECONDS="${HEALTH_DELAY_SECONDS:-2}"
HEALTH_CONNECT_TIMEOUT_SECONDS="${HEALTH_CONNECT_TIMEOUT_SECONDS:-2}"
HEALTH_REQUEST_TIMEOUT_SECONDS="${HEALTH_REQUEST_TIMEOUT_SECONDS:-5}"
RETAIN_RELEASES="${RETAIN_RELEASES:-5}"
INSTALL_COMMAND="${INSTALL_COMMAND:-npm ci --omit=dev}"
ARTIFACT_PATH="${ARTIFACT_PATH:-}"
ARTIFACT_SHA256="${ARTIFACT_SHA256:-}"
DEPLOY_RUN_ID="${DEPLOY_RUN_ID:-unknown}"
DEPLOY_RUN_URL="${DEPLOY_RUN_URL:-unknown}"

BUILD_DIR=""
RELEASE_DIR=""
CANDIDATE_SLOT=""
CANDIDATE_STARTED=false
CANDIDATE_ENABLED=false
CUTOVER_STARTED=false
DEPLOY_COMPLETE=false
OLD_ACTIVE_SLOT=""
OLD_ACTIVE_STATE=""
OLD_CURRENT_TARGET=""
OLD_PREVIOUS_TARGET=""
OLD_CANDIDATE_TARGET=""
PHASE="validation"

log() {
  printf '[worker-deploy] %s\n' "$*"
}

fail() {
  printf '[worker-deploy] ERROR: %s\n' "$*" >&2
  return 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "required command not found: $1"
}

run_privileged() {
  if [[ "$(id -u)" == "0" ]]; then
    "$@"
  else
    sudo -n "$@"
  fi
}

run_systemctl() {
  run_privileged systemctl "$@"
}

run_journalctl() {
  run_privileged journalctl "$@"
}

check_passwordless_sudo() {
  local command_path="$1"
  shift
  sudo -n -l "$command_path" "$@" >/dev/null 2>&1 ||
    fail "deployment user lacks passwordless sudo permission for: $command_path $*"
}

check_systemctl_access() {
  local slot unit systemctl_path
  [[ "$(id -u)" == "0" ]] && return 0
  systemctl_path="$(command -v systemctl)"

  for slot in blue green; do
    unit="$(service_unit "$slot")"
    check_passwordless_sudo "$systemctl_path" restart "$unit"
    check_passwordless_sudo "$systemctl_path" stop "$unit"
    check_passwordless_sudo "$systemctl_path" enable "$unit"
    check_passwordless_sudo "$systemctl_path" enable --now "$unit"
    check_passwordless_sudo "$systemctl_path" disable "$unit"
    check_passwordless_sudo "$systemctl_path" disable --now "$unit"
    check_passwordless_sudo "$systemctl_path" --no-block stop "$unit"
    check_passwordless_sudo "$systemctl_path" is-active --quiet "$unit"
    check_passwordless_sudo "$systemctl_path" status "$unit" --no-pager --lines=80
  done
}

service_unit() {
  printf '%s@%s.service' "$SERVICE_NAME" "$1"
}

slot_health_port() {
  case "$1" in
    blue) printf '%s' "$BLUE_HEALTH_PORT" ;;
    green) printf '%s' "$GREEN_HEALTH_PORT" ;;
    *) fail "invalid worker slot: $1" ;;
  esac
}

atomic_link() {
  local target="$1" link="$2" temporary
  temporary="${link}.tmp.$$"
  ln -s "$target" "$temporary"
  mv -Tf "$temporary" "$link"
}

restore_link() {
  local target="$1" link="$2"
  if [[ -n "$target" ]]; then
    atomic_link "$target" "$link"
  else
    rm -f -- "$link"
  fi
}

write_active_slot() {
  local slot="$1" temporary
  temporary="${ACTIVE_SLOT_FILE}.tmp.$$"
  printf '%s\n' "$slot" >"$temporary"
  mv -f "$temporary" "$ACTIVE_SLOT_FILE"
}

check_readiness() {
  local slot="$1" attempt body curl_error curl_exit error_file http_status port response summary
  port="$(slot_health_port "$slot")"

  error_file="$(mktemp "${TMPDIR:-/tmp}/goofish-worker-health.XXXXXX")" || {
    log "could not create a temporary file for worker readiness diagnostics"
    return 1
  }

  for attempt in $(seq 1 "$HEALTH_RETRIES"); do
    body=""
    curl_error=""
    response=""
    if response="$(curl --silent --show-error --connect-timeout "$HEALTH_CONNECT_TIMEOUT_SECONDS" \
      --max-time "$HEALTH_REQUEST_TIMEOUT_SECONDS" --output - --write-out $'\n%{http_code}' \
      "http://127.0.0.1:${port}/health/ready" 2>"$error_file")"; then
      curl_exit=0
    else
      curl_exit=$?
    fi
    curl_error="$(<"$error_file")"
    : >"$error_file"
    http_status="${response##*$'\n'}"
    body="${response%$'\n'*}"

    if ((curl_exit == 0)) && [[ "$http_status" == "200" ]] &&
      printf '%s' "$body" | grep -Eq '"ok"[[:space:]]*:[[:space:]]*true' &&
      printf '%s' "$body" | grep -Eq '"role"[[:space:]]*:[[:space:]]*"worker"' &&
      printf '%s' "$body" | grep -Eq '"type"[[:space:]]*:[[:space:]]*"postgres"'; then
      rm -f -- "$error_file"
      log "$slot readiness passed on attempt $attempt"
      return 0
    fi

    if ((curl_exit != 0)); then
      log "$slot readiness attempt $attempt/$HEALTH_RETRIES failed (curl exit $curl_exit)"
    elif [[ "$http_status" != "200" ]]; then
      log "$slot readiness attempt $attempt/$HEALTH_RETRIES failed (HTTP $http_status)"
    else
      log "$slot readiness attempt $attempt/$HEALTH_RETRIES failed (response is not ready)"
    fi
    sleep "$HEALTH_DELAY_SECONDS"
  done

  rm -f -- "$error_file"
  if ((curl_exit != 0)); then
    summary="${curl_error//$'\r'/ }"
    summary="${summary//$'\n'/ }"
    [[ -n "$summary" ]] || summary="no error details"
    log "last worker readiness transport error (curl exit $curl_exit): ${summary:0:1000}"
  else
    summary="${body//$'\r'/ }"
    summary="${summary//$'\n'/ }"
    [[ -n "$summary" ]] || summary="<empty>"
    log "last worker readiness response: HTTP $http_status; body: ${summary:0:1000}"
  fi
  return 1
}

verify_release() {
  local release_dir="$1"
  [[ -s "$release_dir/server/dist/worker.js" ]] || return 1
  [[ -s "$release_dir/server/dist/optimize-worker.js" ]] || return 1
  [[ -s "$release_dir/build-manifest.json" ]] || return 1
  [[ -s "$release_dir/release.json" ]] || return 1
  RELEASE_ROOT="$release_dir" RELEASE_ALLOW_SOURCE_TREE=true node "$release_dir/scripts/release-artifact.mjs" verify --kind worker --sha "$TARGET_SHA" || return 1
  RELEASE_DIR_TO_VERIFY="$release_dir" EXPECTED_SHA="$TARGET_SHA" node --input-type=module <<'NODE'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const root = process.env.RELEASE_DIR_TO_VERIFY
const manifest = JSON.parse(await readFile(join(root, 'release.json'), 'utf8'))
if (manifest.target_sha !== process.env.EXPECTED_SHA) throw new Error('worker release target SHA mismatch')
if (!/^[0-9a-f]{64}$/.test(manifest.artifact_sha256 || '')) throw new Error('worker release archive checksum is invalid')
NODE
}

write_release_manifest() {
  RELEASE_BUILD_DIR="$BUILD_DIR" RELEASE_TARGET_SHA="$TARGET_SHA" RELEASE_RUN_ID="$DEPLOY_RUN_ID" RELEASE_RUN_URL="$DEPLOY_RUN_URL" RELEASE_ARTIFACT_SHA="$ARTIFACT_SHA256" node --input-type=module <<'NODE'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const root = process.env.RELEASE_BUILD_DIR
const build = JSON.parse(await readFile(join(root, 'build-manifest.json'), 'utf8'))
const manifest = {
  target_sha: process.env.RELEASE_TARGET_SHA,
  artifact_sha256: process.env.RELEASE_ARTIFACT_SHA,
  artifact_kind: build.artifact_kind,
  role: 'worker',
  build,
  deployment: {
    github_run_id: process.env.RELEASE_RUN_ID,
    github_run_url: process.env.RELEASE_RUN_URL,
    deployed_at: new Date().toISOString(),
  },
}
await writeFile(join(root, 'release.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
NODE
}

build_release() {
  if [[ -d "$RELEASE_DIR" ]]; then
    log "validating existing immutable worker release $RELEASE_DIR"
    verify_release "$RELEASE_DIR" || fail "existing worker release failed validation: $RELEASE_DIR"
    return 0
  fi

  BUILD_DIR="$RELEASES_DIR/.building-$TARGET_SHA"
  [[ ! -e "$BUILD_DIR" ]] || fail "stale worker build directory exists: $BUILD_DIR"

  log "creating detached worker worktree for $TARGET_SHA"
  git -C "$REPO_DIR" worktree prune
  git -C "$REPO_DIR" worktree add --detach "$BUILD_DIR" "$TARGET_SHA"

  (
    cd "$BUILD_DIR"
    log "installing worker dependencies: $INSTALL_COMMAND"
    bash -lc "$INSTALL_COMMAND"
    log "extracting verified Quality Checks artifact"
    tar -xzf "$ARTIFACT_PATH" -C "$BUILD_DIR"
    [[ -s server/dist/worker.js ]] || fail "missing worker artifact: server/dist/worker.js"
    [[ -s server/dist/optimize-worker.js ]] || fail "missing thread worker artifact: server/dist/optimize-worker.js"
    RELEASE_ROOT="$BUILD_DIR" RELEASE_ALLOW_SOURCE_TREE=true node scripts/release-artifact.mjs verify --kind worker --sha "$TARGET_SHA"
    node --check server/dist/worker.js
    node --check server/dist/optimize-worker.js
    npm ls --omit=dev >/dev/null
  )

  write_release_manifest
  verify_release "$BUILD_DIR" || fail "new worker release failed validation"
  git -C "$REPO_DIR" worktree move "$BUILD_DIR" "$RELEASE_DIR"
  BUILD_DIR=""
  log "published immutable worker release $RELEASE_DIR"
}

is_protected_release() {
  local candidate="$1" link resolved
  for link in "$CURRENT_LINK" "$PREVIOUS_LINK" "$SLOTS_DIR/blue" "$SLOTS_DIR/green"; do
    if [[ -e "$link" ]]; then
      resolved="$(realpath -e "$link" 2>/dev/null || true)"
      [[ "$resolved" == "$candidate" ]] && return 0
    fi
  done
  return 1
}

cleanup_old_releases() {
  local kept=0 release
  local -a release_paths=()
  mapfile -t release_paths < <(
    find "$RELEASES_DIR" -mindepth 1 -maxdepth 1 -type d ! -name '.building-*' -printf '%T@ %p\n' |
      sort -rn | cut -d' ' -f2-
  )

  for release in "${release_paths[@]}"; do
    if is_protected_release "$release"; then
      continue
    fi
    if (( kept < RETAIN_RELEASES )); then
      kept=$((kept + 1))
      continue
    fi
    [[ "$release" == "$RELEASES_DIR/"* ]] || fail "refusing to remove release outside $RELEASES_DIR"
    log "removing expired worker release $release"
    git -C "$REPO_DIR" worktree remove --force "$release"
  done
  git -C "$REPO_DIR" worktree prune
}

cleanup_failed_build() {
  if [[ -n "$BUILD_DIR" && -e "$BUILD_DIR" ]]; then
    git -C "$REPO_DIR" worktree remove --force "$BUILD_DIR" >/dev/null 2>&1 || true
  fi
}

rollback() {
  local rollback_ok=true
  log "rolling back failed worker cutover"
  restore_link "$OLD_CURRENT_TARGET" "$CURRENT_LINK"
  restore_link "$OLD_PREVIOUS_TARGET" "$PREVIOUS_LINK"
  if [[ -n "$OLD_ACTIVE_STATE" ]]; then
    write_active_slot "$OLD_ACTIVE_STATE"
  else
    rm -f -- "$ACTIVE_SLOT_FILE"
  fi
  if [[ -n "$OLD_ACTIVE_SLOT" ]]; then
    run_systemctl enable --now "$(service_unit "$OLD_ACTIVE_SLOT")" || rollback_ok=false
    check_readiness "$OLD_ACTIVE_SLOT" || rollback_ok=false
  fi
  if [[ "$CANDIDATE_ENABLED" == "true" ]]; then
    run_systemctl disable --now "$(service_unit "$CANDIDATE_SLOT")" || true
  elif [[ "$CANDIDATE_STARTED" == "true" ]]; then
    run_systemctl stop "$(service_unit "$CANDIDATE_SLOT")" || true
  fi
  restore_link "$OLD_CANDIDATE_TARGET" "$SLOTS_DIR/$CANDIDATE_SLOT"
  [[ "$rollback_ok" == "true" ]] || log "CRITICAL: worker rollback requires manual intervention"
}

on_error() {
  local status=$?
  trap - ERR
  set +e
  cleanup_failed_build
  rm -f -- "$ARTIFACT_PATH"
  if [[ "$DEPLOY_COMPLETE" == "true" ]]; then
    log "post-cutover cleanup failed; the verified worker candidate remains active"
  elif [[ "$CUTOVER_STARTED" == "true" ]]; then
    rollback
  elif [[ "$CANDIDATE_STARTED" == "true" ]]; then
    run_systemctl stop "$(service_unit "$CANDIDATE_SLOT")" || true
    restore_link "$OLD_CANDIDATE_TARGET" "$SLOTS_DIR/$CANDIDATE_SLOT"
  fi
  log "worker deployment failed during $PHASE for $TARGET_SHA (exit $status)"
  exit "$status"
}

trap on_error ERR

[[ "$TARGET_SHA" =~ ^[0-9a-fA-F]{40}$ ]] || fail "TARGET_SHA must be a full 40-character commit SHA"
TARGET_SHA="${TARGET_SHA,,}"
[[ "$ALLOW_REDEPLOY" == "true" || "$ALLOW_REDEPLOY" == "false" ]] || fail "ALLOW_REDEPLOY must be true or false"
[[ "$CANDIDATE_ONLY" == "true" || "$CANDIDATE_ONLY" == "false" ]] || fail "CANDIDATE_ONLY must be true or false"
[[ "$BLUE_HEALTH_PORT" =~ ^[0-9]{1,5}$ && "$GREEN_HEALTH_PORT" =~ ^[0-9]{1,5}$ ]] || fail "worker health ports must be numeric"
(( BLUE_HEALTH_PORT >= 1 && BLUE_HEALTH_PORT <= 65535 && GREEN_HEALTH_PORT >= 1 && GREEN_HEALTH_PORT <= 65535 )) || fail "worker health ports must be between 1 and 65535"
[[ "$BLUE_HEALTH_PORT" != "$GREEN_HEALTH_PORT" ]] || fail "worker health ports must differ"
[[ "$HEALTH_RETRIES" =~ ^[1-9][0-9]*$ && "$HEALTH_DELAY_SECONDS" =~ ^[0-9]+$ ]] || fail "health retry settings must be non-negative integers"
[[ "$HEALTH_CONNECT_TIMEOUT_SECONDS" =~ ^[1-9][0-9]*$ && "$HEALTH_REQUEST_TIMEOUT_SECONDS" =~ ^[1-9][0-9]*$ ]] || fail "worker health timeouts must be positive integers"
[[ "$RETAIN_RELEASES" =~ ^[0-9]+$ ]] || fail "RETAIN_RELEASES must be a non-negative integer"
[[ "$SERVICE_NAME" =~ ^[A-Za-z0-9_.@-]+$ ]] || fail "SERVICE_NAME contains unsafe characters"
[[ -f "$ARTIFACT_PATH" ]] || fail "verified release artifact is required"
[[ "$ARTIFACT_SHA256" =~ ^[0-9a-f]{64}$ ]] || fail "ARTIFACT_SHA256 must be a SHA-256 digest"

for command in git npm node curl grep systemctl journalctl realpath find sort cut sha256sum tar mktemp; do
  require_command "$command"
done
if [[ "$(id -u)" != "0" ]]; then
  require_command sudo
fi

PHASE="privilege-preflight"
check_systemctl_access

[[ -d "$REPO_DIR/.git" ]] || fail "REPO_DIR is not a Git repository: $REPO_DIR"
mkdir -p "$RELEASES_DIR" "$SLOTS_DIR" "$STATE_DIR" "$(dirname "$LOCK_FILE")"
exec 9>"$LOCK_FILE"
require_command flock
flock -n 9 || fail "another worker deployment is already running"

actual_artifact_sha="$(sha256sum "$ARTIFACT_PATH" | cut -d ' ' -f1)"
[[ "$actual_artifact_sha" == "$ARTIFACT_SHA256" ]] || fail "release artifact checksum mismatch"

PHASE="fetch"
log "fetching immutable worker source $TARGET_SHA"
git -C "$REPO_DIR" fetch --prune --no-tags "$REMOTE" "+refs/heads/$DEPLOY_BRANCH:refs/remotes/$REMOTE/$DEPLOY_BRANCH"
git -C "$REPO_DIR" cat-file -e "${TARGET_SHA}^{commit}"
git -C "$REPO_DIR" merge-base --is-ancestor "$TARGET_SHA" "$REMOTE/$DEPLOY_BRANCH" ||
  fail "$TARGET_SHA is not an ancestor of $REMOTE/$DEPLOY_BRANCH"

if [[ -e "$CURRENT_LINK" ]]; then
  current_release="$(realpath -e "$CURRENT_LINK")"
  if [[ "$(basename "$current_release")" == "$TARGET_SHA" && "$ALLOW_REDEPLOY" != "true" ]]; then
    log "worker release $TARGET_SHA is already active"
    rm -f -- "$ARTIFACT_PATH"
    exit 0
  fi
fi

RELEASE_DIR="$RELEASES_DIR/$TARGET_SHA"
PHASE="build"
build_release

if [[ -s "$ACTIVE_SLOT_FILE" ]]; then
  OLD_ACTIVE_SLOT="$(tr -d '[:space:]' <"$ACTIVE_SLOT_FILE")"
  [[ "$OLD_ACTIVE_SLOT" == "blue" || "$OLD_ACTIVE_SLOT" == "green" ]] || fail "invalid worker active slot state: $OLD_ACTIVE_SLOT"
else
  OLD_ACTIVE_SLOT=""
fi

if [[ "$OLD_ACTIVE_SLOT" == "blue" ]]; then
  CANDIDATE_SLOT="green"
else
  CANDIDATE_SLOT="blue"
fi

OLD_ACTIVE_STATE="$OLD_ACTIVE_SLOT"
OLD_CURRENT_TARGET="$(readlink "$CURRENT_LINK" 2>/dev/null || true)"
OLD_PREVIOUS_TARGET="$(readlink "$PREVIOUS_LINK" 2>/dev/null || true)"
OLD_CANDIDATE_TARGET="$(readlink "$SLOTS_DIR/$CANDIDATE_SLOT" 2>/dev/null || true)"

PHASE="candidate-start"
log "starting worker candidate slot $CANDIDATE_SLOT for $TARGET_SHA"
atomic_link "../releases/$TARGET_SHA" "$SLOTS_DIR/$CANDIDATE_SLOT"
run_systemctl restart "$(service_unit "$CANDIDATE_SLOT")"
CANDIDATE_STARTED=true
run_systemctl is-active --quiet "$(service_unit "$CANDIDATE_SLOT")" || fail "worker candidate service is not active"
PHASE="candidate-readiness"
check_readiness "$CANDIDATE_SLOT" || {
  run_systemctl status "$(service_unit "$CANDIDATE_SLOT")" --no-pager --lines=80 || true
  run_journalctl --unit "$(service_unit "$CANDIDATE_SLOT")" --no-pager --lines=80 || true
  fail "worker candidate readiness failed"
}

if [[ "$CANDIDATE_ONLY" == "true" ]]; then
  PHASE="candidate-only-cleanup"
  log "worker candidate-only verification passed; stopping $CANDIDATE_SLOT"
  run_systemctl stop "$(service_unit "$CANDIDATE_SLOT")"
  CANDIDATE_STARTED=false
  restore_link "$OLD_CANDIDATE_TARGET" "$SLOTS_DIR/$CANDIDATE_SLOT"
  rm -f -- "$ARTIFACT_PATH"
  log "worker candidate-only verification complete for $TARGET_SHA"
  exit 0
fi

PHASE="cutover"
CUTOVER_STARTED=true
if [[ -n "$OLD_CURRENT_TARGET" ]]; then
  atomic_link "$OLD_CURRENT_TARGET" "$PREVIOUS_LINK"
else
  rm -f -- "$PREVIOUS_LINK"
fi
atomic_link "slots/$CANDIDATE_SLOT" "$CURRENT_LINK"
write_active_slot "$CANDIDATE_SLOT"
run_systemctl enable "$(service_unit "$CANDIDATE_SLOT")"
CANDIDATE_ENABLED=true

if [[ -n "$OLD_ACTIVE_SLOT" ]]; then
  PHASE="previous-slot-drain"
  log "disabling previous worker slot $OLD_ACTIVE_SLOT and handing its drain to systemd"
  run_systemctl disable "$(service_unit "$OLD_ACTIVE_SLOT")"
  run_systemctl --no-block stop "$(service_unit "$OLD_ACTIVE_SLOT")"
  log "previous worker slot $OLD_ACTIVE_SLOT is draining asynchronously"
fi

PHASE="post-drain-readiness"
check_readiness "$CANDIDATE_SLOT" || fail "worker candidate lost readiness after previous slot drain"

DEPLOY_COMPLETE=true
PHASE="release-cleanup"
cleanup_old_releases
rm -f -- "$ARTIFACT_PATH"
log "worker deployment complete: ${OLD_CURRENT_TARGET:-none} -> $TARGET_SHA on $CANDIDATE_SLOT"

#!/usr/bin/env bash

set -Eeuo pipefail

TARGET_SHA="${TARGET_SHA:-}"
ALLOW_REDEPLOY="${ALLOW_REDEPLOY:-false}"
CANDIDATE_ONLY="${CANDIDATE_ONLY:-false}"
MIGRATION_ONLY="${MIGRATION_ONLY:-false}"
DEPLOY_ROOT="${DEPLOY_ROOT:-/opt/goofish-infrast-v1}"
REPO_DIR="${REPO_DIR:-$DEPLOY_ROOT/repository}"
RELEASES_DIR="${RELEASES_DIR:-$DEPLOY_ROOT/releases}"
SLOTS_DIR="${SLOTS_DIR:-$DEPLOY_ROOT/slots}"
STATE_DIR="${STATE_DIR:-$DEPLOY_ROOT/state}"
NGINX_STATE_DIR="${NGINX_STATE_DIR:-$DEPLOY_ROOT/nginx}"
CURRENT_LINK="${CURRENT_LINK:-$DEPLOY_ROOT/current}"
PREVIOUS_LINK="${PREVIOUS_LINK:-$DEPLOY_ROOT/previous}"
MIGRATION_LINK="${MIGRATION_LINK:-$DEPLOY_ROOT/migration-candidate}"
ACTIVE_SLOT_FILE="${ACTIVE_SLOT_FILE:-$STATE_DIR/active-slot}"
ACTIVE_UPSTREAM_LINK="${ACTIVE_UPSTREAM_LINK:-$NGINX_STATE_DIR/active-upstream.conf}"
SERVICE_NAME="${SERVICE_NAME:-goofish-infrast-v1}"
MIGRATION_SERVICE_NAME="${MIGRATION_SERVICE_NAME:-goofish-database-migrate.service}"
PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-}"
BLUE_PORT="${BLUE_PORT:-3000}"
GREEN_PORT="${GREEN_PORT:-3002}"
REMOTE="${REMOTE:-origin}"
BLUE_GREEN_BRANCH="${BLUE_GREEN_BRANCH:-main}"
LOCK_FILE="${LOCK_FILE:-/tmp/goofish-infrast-v1.production.deploy.lock}"
HEALTH_RETRIES="${HEALTH_RETRIES:-20}"
HEALTH_DELAY_SECONDS="${HEALTH_DELAY_SECONDS:-3}"
PUBLIC_SMOKE_RETRIES="${PUBLIC_SMOKE_RETRIES:-20}"
PUBLIC_SMOKE_DELAY_SECONDS="${PUBLIC_SMOKE_DELAY_SECONDS:-3}"
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
OLD_CURRENT_TARGET=""
OLD_PREVIOUS_TARGET=""
OLD_UPSTREAM_TARGET=""
OLD_CANDIDATE_TARGET=""
OLD_ACTIVE_STATE=""
PHASE="validation"

log() {
  printf '[production-deploy] %s\n' "$*"
}

fail() {
  printf '[production-deploy] ERROR: %s\n' "$*" >&2
  exit 1
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

run_nginx() {
  run_privileged nginx "$@"
}

service_unit() {
  printf '%s@%s.service' "$SERVICE_NAME" "$1"
}

slot_port() {
  case "$1" in
    blue) printf '%s' "$BLUE_PORT" ;;
    green) printf '%s' "$GREEN_PORT" ;;
    *) fail "invalid deployment slot: $1" ;;
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
  local slot="$1" attempt body port
  port="$(slot_port "$slot")"

  for attempt in $(seq 1 "$HEALTH_RETRIES"); do
    body="$(curl -fsS "http://127.0.0.1:${port}/api/health/ready" 2>/dev/null || true)"
    if printf '%s' "$body" | grep -Eq '"ok"[[:space:]]*:[[:space:]]*true' &&
      printf '%s' "$body" | grep -Eq '"type"[[:space:]]*:[[:space:]]*"postgres"'; then
      log "$slot readiness passed on attempt $attempt"
      return 0
    fi
    log "$slot readiness attempt $attempt/$HEALTH_RETRIES failed"
    sleep "$HEALTH_DELAY_SECONDS"
  done
  return 1
}

check_public_smoke() {
  local attempt
  for attempt in $(seq 1 "$PUBLIC_SMOKE_RETRIES"); do
    if node "$CURRENT_LINK/scripts/check-public-http-smoke.mjs" "$PUBLIC_BASE_URL"; then
      log "public HTTPS smoke test passed on attempt $attempt"
      return 0
    fi
    log "public HTTPS smoke attempt $attempt/$PUBLIC_SMOKE_RETRIES failed"
    sleep "$PUBLIC_SMOKE_DELAY_SECONDS"
  done
  return 1
}

verify_release() {
  local release_dir="$1"
  [[ -s "$release_dir/dist/index.html" ]] || return 1
  [[ -s "$release_dir/server/dist/index.js" ]] || return 1
  [[ -s "$release_dir/server/dist/migrate.js" ]] || return 1
  [[ -s "$release_dir/build-manifest.json" ]] || return 1
  [[ -s "$release_dir/release.json" ]] || return 1
  RELEASE_ROOT="$release_dir" node "$release_dir/scripts/release-artifact.mjs" verify --sha "$TARGET_SHA" || return 1
  RELEASE_DIR_TO_VERIFY="$release_dir" EXPECTED_SHA="$TARGET_SHA" node --input-type=module <<'NODE'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const root = process.env.RELEASE_DIR_TO_VERIFY
const manifest = JSON.parse(await readFile(join(root, 'release.json'), 'utf8'))
if (manifest.target_sha !== process.env.EXPECTED_SHA) {
  throw new Error(`release manifest SHA mismatch: ${manifest.target_sha}`)
}
if (!/^[0-9a-f]{64}$/.test(manifest.artifact_sha256 || '')) throw new Error('release archive checksum is invalid')
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
    log "validating existing immutable release $RELEASE_DIR"
    verify_release "$RELEASE_DIR" || fail "existing release failed validation: $RELEASE_DIR"
    return 0
  fi

  BUILD_DIR="$RELEASES_DIR/.building-$TARGET_SHA"
  [[ ! -e "$BUILD_DIR" ]] || fail "stale build directory exists: $BUILD_DIR"

  log "creating detached worktree for $TARGET_SHA"
  git -C "$REPO_DIR" worktree prune
  git -C "$REPO_DIR" worktree add --detach "$BUILD_DIR" "$TARGET_SHA"

  (
    cd "$BUILD_DIR"
    log "installing dependencies: $INSTALL_COMMAND"
    bash -lc "$INSTALL_COMMAND"
    log "extracting verified Quality Checks artifact"
    tar -xzf "$ARTIFACT_PATH" -C "$BUILD_DIR"
    [[ -s dist/index.html ]] || fail "missing frontend artifact: dist/index.html"
    [[ -s server/dist/index.js ]] || fail "missing backend artifact: server/dist/index.js"
    RELEASE_ROOT="$BUILD_DIR" node scripts/release-artifact.mjs verify --sha "$TARGET_SHA"
    node --check server/dist/index.js
    npm ls --omit=dev >/dev/null
  )

  write_release_manifest
  verify_release "$BUILD_DIR" || fail "new release failed validation"
  git -C "$REPO_DIR" worktree move "$BUILD_DIR" "$RELEASE_DIR"
  BUILD_DIR=""
  log "published immutable release $RELEASE_DIR"
}

write_upstream_configs() {
  local blue_temp green_temp
  blue_temp="$NGINX_STATE_DIR/upstream-blue.conf.tmp.$$"
  green_temp="$NGINX_STATE_DIR/upstream-green.conf.tmp.$$"
  printf 'upstream goofish_backend { server 127.0.0.1:%s; keepalive 32; }\n' "$BLUE_PORT" >"$blue_temp"
  printf 'upstream goofish_backend { server 127.0.0.1:%s; keepalive 32; }\n' "$GREEN_PORT" >"$green_temp"
  mv -f "$blue_temp" "$NGINX_STATE_DIR/upstream-blue.conf"
  mv -f "$green_temp" "$NGINX_STATE_DIR/upstream-green.conf"
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
    log "removing expired release $release"
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
  log "rolling back failed cutover"
  restore_link "$OLD_CURRENT_TARGET" "$CURRENT_LINK"
  restore_link "$OLD_PREVIOUS_TARGET" "$PREVIOUS_LINK"
  restore_link "$OLD_UPSTREAM_TARGET" "$ACTIVE_UPSTREAM_LINK"
  if [[ -n "$OLD_ACTIVE_STATE" ]]; then
    write_active_slot "$OLD_ACTIVE_STATE"
  else
    rm -f -- "$ACTIVE_SLOT_FILE"
  fi

  if ! run_nginx -t || ! run_systemctl reload nginx; then
    rollback_ok=false
    log "CRITICAL: Nginx rollback validation or reload failed; the previous backend remains running"
  fi
  if [[ -n "$OLD_ACTIVE_SLOT" ]] && ! check_readiness "$OLD_ACTIVE_SLOT"; then
    rollback_ok=false
    log "CRITICAL: previous slot readiness failed after rollback"
  fi
  if [[ -n "$OLD_CURRENT_TARGET" ]] && ! check_public_smoke; then
    rollback_ok=false
    log "CRITICAL: public smoke failed after rollback"
  fi
  if [[ "$CANDIDATE_ENABLED" == "true" ]]; then
    run_systemctl disable --now "$(service_unit "$CANDIDATE_SLOT")" || true
  elif [[ "$CANDIDATE_STARTED" == "true" ]]; then
    run_systemctl stop "$(service_unit "$CANDIDATE_SLOT")" || true
  fi
  if [[ -n "$OLD_ACTIVE_SLOT" ]]; then
    run_systemctl enable --now "$(service_unit "$OLD_ACTIVE_SLOT")" || true
  fi
  restore_link "$OLD_CANDIDATE_TARGET" "$SLOTS_DIR/$CANDIDATE_SLOT"
  [[ "$rollback_ok" == "true" ]] || log "manual intervention required; do not stop the previous slot"
}

on_error() {
  local status=$?
  trap - ERR
  set +e
  cleanup_failed_build
  rm -f -- "$ARTIFACT_PATH"
  if [[ "$DEPLOY_COMPLETE" == "true" ]]; then
    log "post-cutover cleanup failed; the verified candidate remains active"
  elif [[ "$CUTOVER_STARTED" == "true" ]]; then
    rollback
  elif [[ "$CANDIDATE_STARTED" == "true" ]]; then
    run_systemctl stop "$(service_unit "$CANDIDATE_SLOT")" || true
    restore_link "$OLD_CANDIDATE_TARGET" "$SLOTS_DIR/$CANDIDATE_SLOT"
  fi
  log "deployment failed during $PHASE for $TARGET_SHA (exit $status); active release was ${OLD_CURRENT_TARGET:-legacy}"
  exit "$status"
}

trap on_error ERR

[[ "$TARGET_SHA" =~ ^[0-9a-fA-F]{40}$ ]] || fail "TARGET_SHA must be a full 40-character commit SHA"
TARGET_SHA="${TARGET_SHA,,}"
[[ "$ALLOW_REDEPLOY" == "true" || "$ALLOW_REDEPLOY" == "false" ]] || fail "ALLOW_REDEPLOY must be true or false"
[[ "$CANDIDATE_ONLY" == "true" || "$CANDIDATE_ONLY" == "false" ]] || fail "CANDIDATE_ONLY must be true or false"
[[ "$MIGRATION_ONLY" == "true" || "$MIGRATION_ONLY" == "false" ]] || fail "MIGRATION_ONLY must be true or false"
[[ "$CANDIDATE_ONLY" != "true" || "$MIGRATION_ONLY" != "true" ]] || fail "CANDIDATE_ONLY and MIGRATION_ONLY cannot both be true"
[[ "$BLUE_PORT" =~ ^[0-9]{1,5}$ && "$GREEN_PORT" =~ ^[0-9]{1,5}$ ]] || fail "slot ports must be numeric"
(( BLUE_PORT >= 1 && BLUE_PORT <= 65535 && GREEN_PORT >= 1 && GREEN_PORT <= 65535 )) || fail "slot ports must be between 1 and 65535"
[[ "$BLUE_PORT" != "$GREEN_PORT" ]] || fail "blue and green ports must differ"
[[ "$HEALTH_RETRIES" =~ ^[1-9][0-9]*$ && "$HEALTH_DELAY_SECONDS" =~ ^[0-9]+$ ]] || fail "health retry settings must be non-negative integers"
[[ "$PUBLIC_SMOKE_RETRIES" =~ ^[1-9][0-9]*$ && "$PUBLIC_SMOKE_DELAY_SECONDS" =~ ^[0-9]+$ ]] || fail "public smoke retry settings must be non-negative integers"
[[ "$RETAIN_RELEASES" =~ ^[0-9]+$ ]] || fail "RETAIN_RELEASES must be a non-negative integer"
[[ "$SERVICE_NAME" =~ ^[A-Za-z0-9_.@-]+$ ]] || fail "SERVICE_NAME contains unsafe characters"
[[ "$MIGRATION_SERVICE_NAME" =~ ^[A-Za-z0-9_.@-]+\.service$ ]] || fail "MIGRATION_SERVICE_NAME contains unsafe characters"
[[ -n "$PUBLIC_BASE_URL" ]] || fail "PUBLIC_BASE_URL is required"
[[ -f "$ARTIFACT_PATH" ]] || fail "verified release artifact is required"
[[ "$ARTIFACT_SHA256" =~ ^[0-9a-f]{64}$ ]] || fail "ARTIFACT_SHA256 must be a SHA-256 digest"

for command in git npm node curl grep systemctl nginx realpath find sort cut sha256sum tar; do
  require_command "$command"
done
if [[ "$(id -u)" != "0" ]]; then
  require_command sudo
fi

[[ -d "$REPO_DIR/.git" ]] || fail "REPO_DIR is not a Git repository: $REPO_DIR"
mkdir -p "$RELEASES_DIR" "$SLOTS_DIR" "$STATE_DIR" "$NGINX_STATE_DIR" "$(dirname "$LOCK_FILE")"
exec 9>"$LOCK_FILE"
require_command flock
flock -n 9 || fail "another production deployment is already running"

actual_artifact_sha="$(sha256sum "$ARTIFACT_PATH" | cut -d ' ' -f1)"
[[ "$actual_artifact_sha" == "$ARTIFACT_SHA256" ]] || fail "release artifact checksum mismatch"

PHASE="fetch"
log "fetching immutable production source $TARGET_SHA"
git -C "$REPO_DIR" fetch --prune --no-tags "$REMOTE" "+refs/heads/$BLUE_GREEN_BRANCH:refs/remotes/$REMOTE/$BLUE_GREEN_BRANCH"
git -C "$REPO_DIR" cat-file -e "${TARGET_SHA}^{commit}"
git -C "$REPO_DIR" merge-base --is-ancestor "$TARGET_SHA" "$REMOTE/$BLUE_GREEN_BRANCH" ||
  fail "$TARGET_SHA is not an ancestor of $REMOTE/$BLUE_GREEN_BRANCH"

if [[ -e "$CURRENT_LINK" ]]; then
  current_release="$(realpath -e "$CURRENT_LINK")"
  if [[ "$(basename "$current_release")" == "$TARGET_SHA" && "$ALLOW_REDEPLOY" != "true" && "$MIGRATION_ONLY" != "true" ]]; then
    log "release $TARGET_SHA is already active"
    rm -f -- "$ARTIFACT_PATH"
    exit 0
  fi
fi

RELEASE_DIR="$RELEASES_DIR/$TARGET_SHA"
PHASE="build"
build_release

if [[ "$MIGRATION_ONLY" == "true" ]]; then
  PHASE="database-migration"
  log "running controlled database migration for $TARGET_SHA"
  atomic_link "releases/$TARGET_SHA" "$MIGRATION_LINK"
  if ! run_systemctl start "$MIGRATION_SERVICE_NAME"; then
    run_systemctl status "$MIGRATION_SERVICE_NAME" --no-pager --lines=80 || true
    fail "controlled database migration failed"
  fi
  rm -f -- "$ARTIFACT_PATH"
  log "controlled database migration complete for $TARGET_SHA"
  exit 0
fi

write_upstream_configs

if [[ -s "$ACTIVE_SLOT_FILE" ]]; then
  OLD_ACTIVE_SLOT="$(tr -d '[:space:]' <"$ACTIVE_SLOT_FILE")"
  [[ "$OLD_ACTIVE_SLOT" == "blue" || "$OLD_ACTIVE_SLOT" == "green" ]] || fail "invalid active slot state: $OLD_ACTIVE_SLOT"
else
  OLD_ACTIVE_SLOT=""
fi

if [[ "$OLD_ACTIVE_SLOT" == "blue" ]]; then
  CANDIDATE_SLOT="green"
else
  CANDIDATE_SLOT="blue"
  if [[ -z "$OLD_ACTIVE_SLOT" && "$BLUE_PORT" == "3000" ]]; then
    CANDIDATE_SLOT="green"
  fi
fi

OLD_ACTIVE_STATE="$OLD_ACTIVE_SLOT"
OLD_CURRENT_TARGET="$(readlink "$CURRENT_LINK" 2>/dev/null || true)"
OLD_PREVIOUS_TARGET="$(readlink "$PREVIOUS_LINK" 2>/dev/null || true)"
OLD_UPSTREAM_TARGET="$(readlink "$ACTIVE_UPSTREAM_LINK" 2>/dev/null || true)"
OLD_CANDIDATE_TARGET="$(readlink "$SLOTS_DIR/$CANDIDATE_SLOT" 2>/dev/null || true)"

PHASE="candidate-start"
log "starting candidate slot $CANDIDATE_SLOT for $TARGET_SHA"
atomic_link "../releases/$TARGET_SHA" "$SLOTS_DIR/$CANDIDATE_SLOT"
run_systemctl restart "$(service_unit "$CANDIDATE_SLOT")"
CANDIDATE_STARTED=true
run_systemctl is-active --quiet "$(service_unit "$CANDIDATE_SLOT")" || fail "candidate service is not active"
PHASE="candidate-readiness"
check_readiness "$CANDIDATE_SLOT" || {
  run_systemctl status "$(service_unit "$CANDIDATE_SLOT")" --no-pager --lines=80 || true
  fail "candidate readiness failed"
}

if [[ "$CANDIDATE_ONLY" == "true" ]]; then
  PHASE="candidate-only-cleanup"
  log "candidate-only verification passed; stopping $CANDIDATE_SLOT without cutover"
  run_systemctl stop "$(service_unit "$CANDIDATE_SLOT")"
  CANDIDATE_STARTED=false
  restore_link "$OLD_CANDIDATE_TARGET" "$SLOTS_DIR/$CANDIDATE_SLOT"
  log "candidate-only verification complete for $TARGET_SHA"
  rm -f -- "$ARTIFACT_PATH"
  exit 0
fi

PHASE="nginx-preflight"
log "validating current Nginx configuration before cutover"
run_nginx -t

PHASE="cutover"
CUTOVER_STARTED=true
if [[ -n "$OLD_CURRENT_TARGET" ]]; then
  atomic_link "$OLD_CURRENT_TARGET" "$PREVIOUS_LINK"
else
  rm -f -- "$PREVIOUS_LINK"
fi
atomic_link "slots/$CANDIDATE_SLOT" "$CURRENT_LINK"
atomic_link "upstream-$CANDIDATE_SLOT.conf" "$ACTIVE_UPSTREAM_LINK"
write_active_slot "$CANDIDATE_SLOT"

PHASE="nginx-reload"
log "validating and reloading Nginx for slot $CANDIDATE_SLOT"
run_nginx -t
run_systemctl reload nginx
PHASE="public-smoke"
check_public_smoke || fail "public HTTPS smoke failed after cutover"

PHASE="boot-persistence"
run_systemctl enable "$(service_unit "$CANDIDATE_SLOT")"
CANDIDATE_ENABLED=true
if [[ -n "$OLD_ACTIVE_SLOT" ]]; then
  PHASE="previous-slot-stop"
  log "disabling and stopping drained previous slot $OLD_ACTIVE_SLOT"
  run_systemctl disable --now "$(service_unit "$OLD_ACTIVE_SLOT")"
fi

DEPLOY_COMPLETE=true
PHASE="release-cleanup"
cleanup_old_releases
rm -f -- "$ARTIFACT_PATH"
log "deployment complete: ${OLD_CURRENT_TARGET:-legacy} -> $TARGET_SHA on $CANDIDATE_SLOT"

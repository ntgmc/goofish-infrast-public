#!/usr/bin/env bash

set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/goofish-infrast-v1}"
BRANCH="${BRANCH:-main}"
REMOTE="${REMOTE:-origin}"
SERVICE_NAME="${SERVICE_NAME:-goofish-infrast-v1}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/api/health}"
PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-}"
HEALTH_RETRIES="${HEALTH_RETRIES:-20}"
HEALTH_DELAY_SECONDS="${HEALTH_DELAY_SECONDS:-3}"
PUBLIC_SMOKE_RETRIES="${PUBLIC_SMOKE_RETRIES:-$HEALTH_RETRIES}"
PUBLIC_SMOKE_DELAY_SECONDS="${PUBLIC_SMOKE_DELAY_SECONDS:-$HEALTH_DELAY_SECONDS}"
LOCK_FILE="${LOCK_FILE:-/tmp/goofish-infrast-v1.deploy.lock}"
INSTALL_COMMAND="${INSTALL_COMMAND:-npm ci}"
BUILD_COMMAND="${BUILD_COMMAND:-npm run build}"
SKIP_INSTALL="${SKIP_INSTALL:-false}"
FORCE_DEPLOY="${FORCE_DEPLOY:-false}"
EXPECT_STORAGE_TYPE="${EXPECT_STORAGE_TYPE:-postgres}"
GENERATED_DEPLOY_DIRTY_FILES="${GENERATED_DEPLOY_DIRTY_FILES:-src/lib/build-meta.ts server/handlers/data.ts}"

log() {
  printf '[deploy] %s\n' "$*"
}

fail() {
  printf '[deploy] ERROR: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "required command not found: $1"
}

run_systemctl() {
  if [[ "$(id -u)" == "0" ]]; then
    systemctl "$@"
  else
    sudo -n systemctl "$@"
  fi
}

check_systemctl_access() {
  if [[ "$(id -u)" == "0" ]]; then
    return 0
  fi

  if sudo -n systemctl is-active --quiet "$SERVICE_NAME" ||
    [[ "$?" == "3" ]]; then
    return 0
  fi

  fail "deploy user cannot run systemctl without a password. Configure sudoers with NOPASSWD for: systemctl restart/is-active/status $SERVICE_NAME"
}

check_worktree_clean() {
  git diff --quiet || fail "working tree has unstaged changes"
  git diff --cached --quiet || fail "working tree has staged changes"
}

is_generated_deploy_dirty_file() {
  local changed_file allowed_file

  changed_file="$1"
  for allowed_file in $GENERATED_DEPLOY_DIRTY_FILES; do
    if [[ "$changed_file" == "$allowed_file" ]]; then
      return 0
    fi
  done

  return 1
}

restore_generated_deploy_changes() {
  local changed_files staged_files changed_file has_generated_changes=false

  changed_files="$(git diff --name-only)"
  staged_files="$(git diff --cached --name-only)"
  if [[ -z "$changed_files" && -z "$staged_files" ]]; then
    return 0
  fi

  while IFS= read -r changed_file; do
    [[ -z "$changed_file" ]] && continue
    if ! is_generated_deploy_dirty_file "$changed_file"; then
      return 0
    fi
    has_generated_changes=true
  done <<<"$changed_files"

  while IFS= read -r changed_file; do
    [[ -z "$changed_file" ]] && continue
    if ! is_generated_deploy_dirty_file "$changed_file"; then
      return 0
    fi
    has_generated_changes=true
  done <<<"$staged_files"

  if [[ "$has_generated_changes" == "true" ]]; then
    log "discarding generated deploy changes: $GENERATED_DEPLOY_DIRTY_FILES"
    git restore --staged --worktree -- $GENERATED_DEPLOY_DIRTY_FILES
  fi
}

check_health() {
  local attempt body

  for attempt in $(seq 1 "$HEALTH_RETRIES"); do
    body="$(curl -fsS "$HEALTH_URL" 2>/dev/null || true)"

    if printf '%s' "$body" | grep -Eq '"ok"[[:space:]]*:[[:space:]]*true'; then
      if [[ -z "$EXPECT_STORAGE_TYPE" ]] ||
        printf '%s' "$body" | grep -Eq "\"type\"[[:space:]]*:[[:space:]]*\"$EXPECT_STORAGE_TYPE\""; then
        log "health check passed on attempt $attempt"
        return 0
      fi
    fi

    log "health check attempt $attempt/$HEALTH_RETRIES failed"
    sleep "$HEALTH_DELAY_SECONDS"
  done

  return 1
}

check_public_smoke() {
  local attempt

  for attempt in $(seq 1 "$PUBLIC_SMOKE_RETRIES"); do
    if node scripts/check-public-http-smoke.mjs "$PUBLIC_BASE_URL"; then
      log "public HTTPS smoke test passed on attempt $attempt"
      return 0
    fi

    log "public HTTPS smoke test attempt $attempt/$PUBLIC_SMOKE_RETRIES failed"
    sleep "$PUBLIC_SMOKE_DELAY_SECONDS"
  done

  return 1
}

require_command git
require_command npm
require_command curl
require_command grep
require_command node
require_command systemctl

if [[ "$(id -u)" != "0" ]]; then
  require_command sudo
fi

check_systemctl_access

[[ -n "$PUBLIC_BASE_URL" ]] || fail "PUBLIC_BASE_URL is required for the public HTTPS smoke test"

mkdir -p "$(dirname "$LOCK_FILE")"
exec 9>"$LOCK_FILE"
if command -v flock >/dev/null 2>&1; then
  flock -n 9 || fail "another deployment is already running"
else
  log "flock not found; continuing without deploy lock"
fi

[[ -d "$APP_DIR/.git" ]] || fail "APP_DIR is not a git repository: $APP_DIR"

cd "$APP_DIR"

log "deploying $REMOTE/$BRANCH from $APP_DIR"
restore_generated_deploy_changes
check_worktree_clean

git fetch --prune "$REMOTE" "+refs/heads/$BRANCH:refs/remotes/$REMOTE/$BRANCH"

if git show-ref --verify --quiet "refs/heads/$BRANCH"; then
  git switch "$BRANCH"
else
  git switch --track -c "$BRANCH" "$REMOTE/$BRANCH"
fi

restore_generated_deploy_changes
check_worktree_clean

before_sha="$(git rev-parse HEAD)"
target_sha="$(git rev-parse "$REMOTE/$BRANCH")"

if [[ "$before_sha" == "$target_sha" && "$FORCE_DEPLOY" != "true" ]]; then
  log "already at $target_sha; set FORCE_DEPLOY=true to rebuild and restart anyway"
  exit 0
fi

git pull --ff-only "$REMOTE" "$BRANCH"
after_sha="$(git rev-parse HEAD)"

log "checked out $after_sha"

if [[ "$SKIP_INSTALL" == "true" ]]; then
  log "skipping dependency install"
else
  log "installing dependencies: $INSTALL_COMMAND"
  bash -lc "$INSTALL_COMMAND"
fi

log "building production artifacts: $BUILD_COMMAND"
bash -lc "$BUILD_COMMAND"
restore_generated_deploy_changes

[[ -f "$APP_DIR/dist/index.html" ]] || fail "missing frontend artifact: dist/index.html"
[[ -f "$APP_DIR/server/dist/index.js" ]] || fail "missing backend artifact: server/dist/index.js"

log "restarting systemd service: $SERVICE_NAME"
run_systemctl restart "$SERVICE_NAME"

if run_systemctl is-active --quiet "$SERVICE_NAME"; then
  log "systemd service is active"
else
  run_systemctl status "$SERVICE_NAME" --no-pager --lines=50 || true
  fail "systemd service is not active after restart"
fi

if check_health; then
  if check_public_smoke; then
    log "deployment complete: $before_sha -> $after_sha"
  else
    fail "public HTTPS smoke test failed after deploying $after_sha; previous commit was $before_sha"
  fi
else
  run_systemctl status "$SERVICE_NAME" --no-pager --lines=50 || true
  fail "health check failed after deploying $after_sha; previous commit was $before_sha"
fi

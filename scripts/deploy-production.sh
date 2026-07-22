#!/usr/bin/env bash

set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/goofish-infrast-v1}"
BRANCH="${BRANCH:-dev}"
REMOTE="${REMOTE:-origin}"
TARGET_SHA="${TARGET_SHA:-}"
ARTIFACT_PATH="${ARTIFACT_PATH:-}"
ARTIFACT_SHA256="${ARTIFACT_SHA256:-}"
ARTIFACT_DIR=""
SERVICE_NAME="${SERVICE_NAME:-goofish-infrast-v1}"
MIGRATION_SERVICE_NAME="${MIGRATION_SERVICE_NAME:-}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/api/health}"
PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-}"
HEALTH_RETRIES="${HEALTH_RETRIES:-20}"
HEALTH_DELAY_SECONDS="${HEALTH_DELAY_SECONDS:-3}"
PUBLIC_SMOKE_RETRIES="${PUBLIC_SMOKE_RETRIES:-$HEALTH_RETRIES}"
PUBLIC_SMOKE_DELAY_SECONDS="${PUBLIC_SMOKE_DELAY_SECONDS:-$HEALTH_DELAY_SECONDS}"
LOCK_FILE="${LOCK_FILE:-/tmp/goofish-infrast-v1.deploy.lock}"
INSTALL_COMMAND="${INSTALL_COMMAND:-npm ci --omit=dev}"
SKIP_INSTALL="${SKIP_INSTALL:-false}"
FORCE_DEPLOY="${FORCE_DEPLOY:-false}"
EXPECT_STORAGE_TYPE="${EXPECT_STORAGE_TYPE:-postgres}"

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

show_service_diagnostics() {
  run_systemctl status "$SERVICE_NAME" --no-pager --lines=50 || true
  if ! command -v journalctl >/dev/null 2>&1; then
    log "journalctl is unavailable; systemctl status is the only service diagnostic"
    return
  fi

  if journalctl --unit "$SERVICE_NAME" --no-pager --lines=80 2>/dev/null; then
    return
  fi
  if [[ "$(id -u)" != "0" ]] &&
    sudo -n journalctl --unit "$SERVICE_NAME" --no-pager --lines=80 2>/dev/null; then
    return
  fi

  log "service journal is not readable by the deploy user; add it to systemd-journal or grant passwordless access to this journalctl command"
}

show_migration_diagnostics() {
  [[ -n "$MIGRATION_SERVICE_NAME" ]] || return
  run_systemctl status "$MIGRATION_SERVICE_NAME" --no-pager --lines=50 || true
  if command -v journalctl >/dev/null 2>&1; then
    journalctl --unit "$MIGRATION_SERVICE_NAME" --no-pager --lines=80 2>/dev/null || true
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

cleanup_artifact() {
  rm -f -- "$ARTIFACT_PATH"
  if [[ -n "$ARTIFACT_DIR" ]]; then
    rm -rf -- "$ARTIFACT_DIR"
  fi
}

check_health() {
  local attempt body curl_error curl_exit error_file http_status response summary

  error_file="$(mktemp "${TMPDIR:-/tmp}/goofish-health.XXXXXX")" || {
    log "could not create a temporary file for health-check diagnostics"
    return 1
  }

  for attempt in $(seq 1 "$HEALTH_RETRIES"); do
    body=""
    curl_error=""
    response=""
    if response="$(curl --silent --show-error --output - --write-out $'\n%{http_code}' "$HEALTH_URL" 2>"$error_file")"; then
      curl_exit=0
    else
      curl_exit=$?
    fi
    curl_error="$(<"$error_file")"
    : >"$error_file"
    http_status="${response##*$'\n'}"
    body="${response%$'\n'*}"

    if ((curl_exit == 0)) && [[ "$http_status" == "200" ]] &&
      printf '%s' "$body" | grep -Eq '"ok"[[:space:]]*:[[:space:]]*true'; then
      if [[ -z "$EXPECT_STORAGE_TYPE" ]] ||
        printf '%s' "$body" | grep -Eq "\"type\"[[:space:]]*:[[:space:]]*\"$EXPECT_STORAGE_TYPE\""; then
        rm -f -- "$error_file"
        log "health check passed on attempt $attempt"
        return 0
      fi
    fi

    if ((curl_exit != 0)); then
      log "health check attempt $attempt/$HEALTH_RETRIES failed (curl exit $curl_exit)"
    elif [[ "$http_status" != "200" ]]; then
      log "health check attempt $attempt/$HEALTH_RETRIES failed (HTTP $http_status)"
    else
      log "health check attempt $attempt/$HEALTH_RETRIES failed (response is not ready)"
    fi
    sleep "$HEALTH_DELAY_SECONDS"
  done

  rm -f -- "$error_file"
  if ((curl_exit != 0)); then
    summary="${curl_error//$'\r'/ }"
    summary="${summary//$'\n'/ }"
    [[ -n "$summary" ]] || summary="no error details"
    log "last health check transport error (curl exit $curl_exit): ${summary:0:1000}"
  else
    summary="${body//$'\r'/ }"
    summary="${summary//$'\n'/ }"
    [[ -n "$summary" ]] || summary="<empty>"
    log "last health response: HTTP $http_status; body: ${summary:0:1000}"
  fi

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
require_command sha256sum
require_command tar
require_command mktemp

if [[ "$(id -u)" != "0" ]]; then
  require_command sudo
fi

check_systemctl_access

[[ -n "$PUBLIC_BASE_URL" ]] || fail "PUBLIC_BASE_URL is required for the public HTTPS smoke test"
[[ "$TARGET_SHA" =~ ^[0-9a-f]{40}$ ]] || fail "TARGET_SHA must be a full 40-character commit SHA"
[[ -f "$ARTIFACT_PATH" ]] || fail "verified release artifact is required"
[[ "$ARTIFACT_SHA256" =~ ^[0-9a-f]{64}$ ]] || fail "ARTIFACT_SHA256 must be a SHA-256 digest"
trap cleanup_artifact EXIT

mkdir -p "$(dirname "$LOCK_FILE")"
exec 9>"$LOCK_FILE"
if command -v flock >/dev/null 2>&1; then
  flock -n 9 || fail "another deployment is already running"
else
  log "flock not found; continuing without deploy lock"
fi

[[ -d "$APP_DIR/.git" ]] || fail "APP_DIR is not a git repository: $APP_DIR"

cd "$APP_DIR"

log "deploying verified artifact for $TARGET_SHA from $APP_DIR"
check_worktree_clean

git fetch --prune "$REMOTE" "+refs/heads/$BRANCH:refs/remotes/$REMOTE/$BRANCH"
before_sha="$(git rev-parse HEAD)"
git cat-file -e "${TARGET_SHA}^{commit}" || fail "target commit is unavailable: $TARGET_SHA"
git merge-base --is-ancestor "$TARGET_SHA" "$REMOTE/$BRANCH" || fail "$TARGET_SHA is not an ancestor of $REMOTE/$BRANCH"

if [[ "$before_sha" == "$TARGET_SHA" && "$FORCE_DEPLOY" != "true" ]]; then
  log "already at $TARGET_SHA; set FORCE_DEPLOY=true to redeploy the verified artifact"
  exit 0
fi

git switch --detach "$TARGET_SHA"
after_sha="$(git rev-parse HEAD)"

log "checked out $after_sha"

if [[ "$SKIP_INSTALL" == "true" ]]; then
  log "skipping dependency install"
else
  log "installing dependencies: $INSTALL_COMMAND"
  bash -lc "$INSTALL_COMMAND"
fi

actual_artifact_sha="$(sha256sum "$ARTIFACT_PATH" | awk '{print $1}')"
[[ "$actual_artifact_sha" == "$ARTIFACT_SHA256" ]] || fail "release artifact checksum mismatch"

ARTIFACT_DIR="$APP_DIR/.artifact-$TARGET_SHA-$$"
rm -rf -- "$ARTIFACT_DIR"
mkdir -p "$ARTIFACT_DIR"
tar -xzf "$ARTIFACT_PATH" -C "$ARTIFACT_DIR"
RELEASE_ROOT="$ARTIFACT_DIR" node scripts/release-artifact.mjs verify --sha "$TARGET_SHA"

rm -rf -- dist server/dist
mv "$ARTIFACT_DIR/dist" dist
mv "$ARTIFACT_DIR/server/dist" server/dist
rm -rf -- "$ARTIFACT_DIR"
ARTIFACT_DIR=""

[[ -f "$APP_DIR/dist/index.html" ]] || fail "missing frontend artifact: dist/index.html"
[[ -f "$APP_DIR/server/dist/index.js" ]] || fail "missing backend artifact: server/dist/index.js"

if [[ -n "$MIGRATION_SERVICE_NAME" ]]; then
  [[ -f "$APP_DIR/server/dist/migrate.js" ]] || fail "missing migration artifact: server/dist/migrate.js"
  log "stopping systemd service before migration: $SERVICE_NAME"
  run_systemctl stop "$SERVICE_NAME"
  log "running database migration: $MIGRATION_SERVICE_NAME"
  if run_systemctl start "$MIGRATION_SERVICE_NAME"; then
    log "database migration completed"
  else
    show_migration_diagnostics
    fail "database migration failed: $MIGRATION_SERVICE_NAME"
  fi
fi

log "restarting systemd service: $SERVICE_NAME"
run_systemctl restart "$SERVICE_NAME"

if run_systemctl is-active --quiet "$SERVICE_NAME"; then
  log "systemd service is active"
else
  show_service_diagnostics
  fail "systemd service is not active after restart"
fi

if check_health; then
  if check_public_smoke; then
    log "deployment complete: $before_sha -> $after_sha"
  else
    fail "public HTTPS smoke test failed after deploying $after_sha; previous commit was $before_sha"
  fi
else
  show_service_diagnostics
  fail "health check failed after deploying $after_sha; previous commit was $before_sha"
fi

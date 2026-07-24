# Production Blue/Green Deployment

Production deploys immutable commits from `main` into release directories. A
candidate backend starts on the inactive blue/green port and must pass readiness
before Nginx receives the new upstream. The previously active backend remains
running until the public HTTPS smoke test succeeds and is restored automatically
if cutover fails.

Development continues to use the single-service workflow documented in
[dev-deploy.md](dev-deploy.md). Production optimization is consumed by the
dedicated Hangzhou worker documented in [worker-deploy.md](worker-deploy.md);
the Seoul backend runs with `APP_ROLE=api` and does not execute optimization
jobs locally.

## Trusted release source

`Deploy Production` never asks the server to deploy a branch HEAD.

- An automatic deployment uses the exact `workflow_run.head_sha` that completed
  `Quality Checks` successfully.
- A manual deployment requires a full 40-character `commit_sha`. The workflow
  verifies that the commit belongs to `main` and that the same SHA has a
  successful `Quality Checks` run for `main`.
- The server fetches `origin/main`, verifies the commit object and checks
  `git merge-base --is-ancestor <sha> origin/main` before creating a release.
- `release.json`, the GitHub Actions run and the application's generated
  `git_sha` must all identify the same commit.

The manual action is therefore a redeploy or rollback mechanism for an already
validated main commit, not a way to deploy a feature branch.

## Changelog confirmation

`package.json` supplies the manually maintained major/minor release train. The
Quality Checks workflow appends its build number, so a production candidate may
be identified as `2.0.435`. That number is a readable build label; the immutable
target SHA remains the source of truth for the changes it contains.

- Only a `main` push build generates a production changelog candidate. Pull
  requests, development builds and manual quality-check runs produce no public
  candidate record.
- The build reads prior `changelog-release.json` assets from published GitHub
  Releases, then creates a new candidate from the previous production SHA to
  the immutable target SHA. Conventional `feat`, `fix`, `perf` and `security`
  commits are grouped automatically. A commit may supply a user-facing
  `Release-Note:` trailer, an optional `Release-Note-Type:` trailer, or
  `Skip-Changelog: true` to opt out.
- `changelog-release.json` and `changelog-release.md` travel inside the same
  checksum-verified artifact as the frontend and backend. They are validated
  against `build-manifest.json`, the generated version metadata and target SHA.
- Only after the Worker and API deployments complete successfully does the
  production workflow create or verify the annotated `v<version>` tag, create
  the GitHub Release and upload the JSON release record. Failed candidates never
  publish a tag or public changelog entry.

The first automated production candidate has no previous published release
asset, so it is marked as a changelog baseline unless a maintainer explicitly
sets `CHANGELOG_BASE_SHA` to a known prior production SHA. The next successful
version then uses that baseline SHA and produces the first commit-derived update
list.

## Runtime layout

The production root is not a live Git checkout:

```text
/opt/goofish-infrast-v1/
  repository/                  # control checkout used only for fetch/worktrees
  releases/<full-sha>/         # complete immutable application releases
  releases/.building-<sha>/    # temporary build worktree
  slots/blue -> ../releases/<sha>
  slots/green -> ../releases/<sha>
  current -> slots/<active-slot>
  previous -> slots/<previous-slot>
  state/active-slot
  nginx/
    active-upstream.conf -> upstream-blue.conf|upstream-green.conf
    upstream-blue.conf
    upstream-green.conf
```

Nginx serves static files from `/opt/goofish-infrast-v1/current/dist`. The blue
backend listens on `127.0.0.1:3000`; green listens on `127.0.0.1:3002`. Neither
backend port should be exposed outside the host.

Completed releases contain `release.json` with the target SHA, build time,
GitHub run ID and URL, Node/npm versions, and SHA-256 hashes for the frontend and
backend entry artifacts. Existing release directories are validated and reused;
they are never overwritten.
Each completed build therefore lives at
`/opt/goofish-infrast-v1/releases/<full-sha>/`.

## Database schema ownership

Production API and Worker processes perform a read-only catalog compatibility check at startup and never replay schema DDL or data backfills. The check is scoped to the process role, so a dedicated Worker validates the shared and optimization tables it can access without depending on API-only tables such as `feature_settings`. This prevents blue/green candidates from taking `AccessExclusiveLock` while the active API or Worker is writing the same tables. `Deploy Production` applies the target release's controlled migration through `goofish-database-migrate.service` before starting either candidate. A missing runtime table or column required by a role must still fail readiness instead of triggering migration inside that runtime process. Development and test processes retain automatic schema setup for local and integration-test databases.

The workflow invokes `scripts/deploy-production-atomic.sh` with `MIGRATION_ONLY=true`. That mode verifies and publishes the immutable release, updates only the `migration-candidate` link, runs the guarded oneshot, and exits without starting an API slot or changing Nginx. Migrations must remain forward-compatible with the currently active API and Worker because database changes commit before either service is cut over. A later deployment failure does not roll back schema or destructive data backfills.

Transient validation failures are not cached permanently. The next request retries validation, while a successful validation is cached for the lifetime of the process.

### Optimizer workspace retention migration

The release that introduces the workspace retention policy must run the
controlled database migration before starting the production API or Worker.
The migration permanently trims every `user_profile_workspaces.record_json`
record to its newest **3 saved configurations** and newest **5 result-history
entries**. Records are stored newest first, so the discarded items are the
oldest ones. This cleanup has no archive or in-product restore path; rolling
back application code does not restore trimmed data.

## One-time migration

Schedule the first migration as a controlled production change. Keep the legacy
`goofish-infrast-v1.service` running on port 3000 until the green candidate is
ready and Nginx has switched successfully.

1. Move the current checkout into the control repository location and create
   the deployment-owned directories:

   ```bash
   sudo systemctl status goofish-infrast-v1 --no-pager
   sudo mv /opt/goofish-infrast-v1 /opt/goofish-infrast-v1-migration
   sudo mkdir -p /opt/goofish-infrast-v1/{releases,slots,state,nginx}
   sudo mv /opt/goofish-infrast-v1-migration /opt/goofish-infrast-v1/repository
   sudo chown -R deploy:deploy /opt/goofish-infrast-v1
   ```

   Replace `deploy:deploy` with the real deployment account. If moving the live
   checkout would invalidate the legacy unit path, update the legacy unit to the
   `repository` path and verify it before continuing.

2. Install the blue/green unit, controlled migration unit, and slot port files:

   ```bash
   sudo install -m 0644 deploy/systemd/goofish-infrast-v1@.service /etc/systemd/system/goofish-infrast-v1@.service
   sudo install -m 0644 deploy/systemd/goofish-database-migrate.service /etc/systemd/system/goofish-database-migrate.service
   sudo install -d -m 0750 /etc/goofish-infrast-v1
   sudo install -m 0644 deploy/systemd/blue.env /etc/goofish-infrast-v1/blue.env
   sudo install -m 0644 deploy/systemd/green.env /etc/goofish-infrast-v1/green.env
   sudo systemctl daemon-reload
   ```

   Preserve the existing secrets in
   `/etc/goofish-infrast-v1/backend.env`. It must not define `APP_ROLE`, `PORT`,
   or a non-loopback `HOST`, because the unit and slot files own those settings.
   It must define the canonical public HTTPS origin:

   ```text
   PUBLIC_APP_URL=https://maatool.com
   ```

   Do not include a path, query string, fragment, or credentials. The backend
   validates this value before listening and uses it for browser-origin checks.
   The managed template runs both slots as the unprivileged `ntgmc` user and
   group; adjust both fields before installation if the production application
   account differs.

3. Seed the runtime upstream files and active pointer while legacy port 3000 is
   still serving production:

   ```bash
   install -m 0644 deploy/nginx/goofish-upstream-blue.conf /opt/goofish-infrast-v1/nginx/upstream-blue.conf
   install -m 0644 deploy/nginx/goofish-upstream-green.conf /opt/goofish-infrast-v1/nginx/upstream-green.conf
   ln -sfn upstream-blue.conf /opt/goofish-infrast-v1/nginx/active-upstream.conf
   ln -sfn repository /opt/goofish-infrast-v1/current
   ```

   The initial `current -> repository` pointer gives the rollback path a valid
   legacy static root until the first immutable release becomes active.

4. In the Nginx `http {}` context, include the active upstream before any
   `server {}` blocks:

   ```nginx
   include /opt/goofish-infrast-v1/nginx/active-upstream.conf;
   ```

   Install the repository-managed production snippets, remove old conflicting
   API/static locations, and configure the production HTTPS server:

   ```bash
   sudo install -m 0644 deploy/nginx/goofish-api-production.conf /etc/nginx/snippets/goofish-api-production.conf
   sudo install -m 0644 deploy/nginx/goofish-canonical-redirect.conf /etc/nginx/snippets/goofish-canonical-redirect.conf
   sudo install -m 0644 deploy/nginx/goofish-proxy-common.conf /etc/nginx/snippets/goofish-proxy-common.conf
   sudo install -m 0644 deploy/nginx/goofish-server-hardening.conf /etc/nginx/snippets/goofish-server-hardening.conf
   sudo install -m 0644 deploy/nginx/goofish-security-headers.conf /etc/nginx/snippets/goofish-security-headers.conf
   sudo install -m 0644 deploy/nginx/goofish-static-files.conf /etc/nginx/snippets/goofish-static-files.conf
   ```

   ```nginx
   server {
     listen 80;
     server_name maatool.com www.maatool.com;

     include /etc/nginx/snippets/goofish-canonical-redirect.conf;
   }

   server {
     listen 443 ssl;
     server_name www.maatool.com;

     # Keep the existing TLS certificate directives here. The certificate must
     # cover www.maatool.com as well as maatool.com.
     include /etc/nginx/snippets/goofish-server-hardening.conf;
     include /etc/nginx/snippets/goofish-security-headers.conf;
     include /etc/nginx/snippets/goofish-canonical-redirect.conf;
   }

   server {
     listen 443 ssl;
     server_name maatool.com;

     root /opt/goofish-infrast-v1/current/dist;
     index index.html;

     include /etc/nginx/snippets/goofish-server-hardening.conf;
     include /etc/nginx/snippets/goofish-security-headers.conf;
     include /etc/nginx/snippets/goofish-api-production.conf;
     include /etc/nginx/snippets/goofish-static-files.conf;
   }
   ```

   The redirect snippet keeps the complete path and query string while sending
   both HTTP hosts and the HTTPS `www` alias to the canonical HTTPS origin. The
   security header snippet belongs only in HTTPS servers, not the plain HTTP
   redirect server. Before enabling the HTTPS alias, ensure DNS points
   `www.maatool.com` at this server and the installed certificate includes that
   hostname. Validate without reloading:

   ```bash
   sudo nginx -t
   ```

5. Update the production environment variables used by GitHub Actions when the
   defaults differ:

   | Variable | Default |
   | --- | --- |
   | `DEPLOY_PORT` | `22` |
   | `DEPLOY_ROOT` | `/opt/goofish-infrast-v1` |
   | `DEPLOY_REPO_DIR` | `/opt/goofish-infrast-v1/repository` |
   | `DEPLOY_SERVICE_NAME` | `goofish-infrast-v1` |
   | `DEPLOY_MIGRATION_SERVICE_NAME` | `goofish-database-migrate.service` |
   | `DEPLOY_PUBLIC_BASE_URL` | `https://maatool.com` |
   | `DEPLOY_BLUE_PORT` | `3000` |
   | `DEPLOY_GREEN_PORT` | `3002` |

   Required secrets are `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, and
   `DEPLOY_KNOWN_HOSTS`. The latter must contain pinned host-key lines; the
   workflow rejects deployments instead of trusting opportunistic `ssh-keyscan` output.

6. Run a manual deployment for a successful main `commit_sha`. On an initial
   migration the script deliberately chooses green:3002 to avoid the legacy
   service on port 3000. After the public smoke test succeeds:

   ```bash
   readlink -f /opt/goofish-infrast-v1/current
   cat /opt/goofish-infrast-v1/current/release.json
   cat /opt/goofish-infrast-v1/state/active-slot
   curl -fsS http://127.0.0.1:3002/api/health/ready
   curl -fsS https://maatool.com/api/health/ready
   curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' 'https://www.maatool.com/tool?source=www-check'
   ```

   The final command must report `308` and
   `https://maatool.com/tool?source=www-check`.

   Only then disable the legacy unit. Do not disable the templated slot units:

   ```bash
   sudo systemctl disable --now goofish-infrast-v1.service
   ```

## Deployment behavior

`scripts/deploy-production-atomic.sh` performs these stages under an exclusive
`flock` lock:

1. Verify the full target SHA exists and is an ancestor of `origin/main`.
2. Check out the immutable target SHA, download its SHA-bound artifact from the
   successful `Quality Checks` run, verify the archive SHA-256, and upload both
   the artifact and that commit's deployment script to temporary server paths.
   Running the uploaded script avoids bootstrapping through a stale repository
   checkout; both temporary inputs are removed after the SSH command finishes.
3. Create a detached temporary worktree, run `npm ci --omit=dev`, extract the
   prebuilt frontend/backend artifacts, and verify every file against
   `build-manifest.json` before a candidate service can start.
4. Write `release.json`, preserving both CI build provenance and deployment run
   provenance, then atomically move the worktree to
   `releases/<sha>`.
5. Point `migration-candidate` at the verified release and run the guarded
   migration oneshot. The workflow stops here if migration fails, before a new
   Worker or API starts.
6. Deploy and verify the dedicated Worker candidate against the migrated schema.
7. Point the inactive API slot at the release, restart only that slot, and poll
   `/api/health/ready` for `ok=true` and `storage.type=postgres`.
8. Validate Nginx, atomically update `current`, `previous`, the active upstream
   and active-slot state, validate again, then reload Nginx.
9. Run the public HTTPS smoke test. Only after it passes is the candidate slot
   enabled for boot and the old slot disabled/stopped through its 75-second
   graceful-drain policy.
10. Keep every referenced release plus the five most recent releases; remove
   only unreferenced older worktrees after a successful deployment.
11. After both services are live, publish the SHA-bound changelog record as the
   annotated version tag and GitHub Release; this is the final confirmation that
   the build is publicly released.

The candidate and active backend overlap briefly. PostgreSQL-backed job locking
must remain safe with two processes. Any future singleton background task must
gain a database-level lock before it is enabled in production.

GitHub Actions artifacts are the only trusted build source. The production host
never regenerates `data.ts` or `build-meta.ts` and never runs `npm run build`.
If an artifact is missing or has expired, rerun `Quality Checks` for that exact
SHA; there is intentionally no server-side build fallback. An existing immutable
release may be reused only after its manifest and file hashes validate.

Normal deployments never run `systemctl daemon-reload` and never restart Nginx.
Unit installation uses `daemon-reload` once; traffic changes use
`systemctl reload nginx`.

## Automatic rollback

Failures before cutover leave `current`, the active upstream and the active
service unchanged. A failed candidate is stopped and its old slot pointer is
restored.

After cutover begins, any Nginx validation, reload, or public smoke failure
restores the captured `current`, `previous`, upstream and active-slot pointers,
reloads Nginx, verifies the old slot readiness and repeats the public smoke test.
The previous backend is never stopped before the new public smoke test passes.

If rollback validation itself fails, the script leaves the previous backend
running and prints a `CRITICAL` message. Treat this as an incident: inspect both
Nginx and slot services before stopping either process.

Useful diagnostics:

```bash
sudo systemctl status goofish-infrast-v1@blue.service --no-pager --lines=80
sudo systemctl status goofish-infrast-v1@green.service --no-pager --lines=80
sudo journalctl -u 'goofish-infrast-v1@*' --since '-30 min'
sudo nginx -t
readlink /opt/goofish-infrast-v1/current
readlink /opt/goofish-infrast-v1/previous
readlink /opt/goofish-infrast-v1/nginx/active-upstream.conf
```

To perform an explicit rollback, run `Deploy Production` manually with the full
SHA in `/opt/goofish-infrast-v1/previous/release.json` as `commit_sha`. The SHA
still must belong to main and have successful Quality Checks.

## Least-privilege operations

The deployment account needs passwordless access only to the controlled
migration oneshot, the two slot units, Nginx validation, and Nginx reload.
Adapt command paths to the server:

```sudoers
deploy ALL=(root) NOPASSWD: /usr/bin/systemctl start goofish-database-migrate.service
deploy ALL=(root) NOPASSWD: /usr/bin/systemctl status goofish-database-migrate.service --no-pager --lines=80
deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart goofish-infrast-v1@blue.service
deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart goofish-infrast-v1@green.service
deploy ALL=(root) NOPASSWD: /usr/bin/systemctl stop goofish-infrast-v1@blue.service
deploy ALL=(root) NOPASSWD: /usr/bin/systemctl stop goofish-infrast-v1@green.service
deploy ALL=(root) NOPASSWD: /usr/bin/systemctl enable goofish-infrast-v1@blue.service
deploy ALL=(root) NOPASSWD: /usr/bin/systemctl enable goofish-infrast-v1@green.service
deploy ALL=(root) NOPASSWD: /usr/bin/systemctl enable --now goofish-infrast-v1@blue.service
deploy ALL=(root) NOPASSWD: /usr/bin/systemctl enable --now goofish-infrast-v1@green.service
deploy ALL=(root) NOPASSWD: /usr/bin/systemctl disable --now goofish-infrast-v1@blue.service
deploy ALL=(root) NOPASSWD: /usr/bin/systemctl disable --now goofish-infrast-v1@green.service
deploy ALL=(root) NOPASSWD: /usr/bin/systemctl is-active --quiet goofish-infrast-v1@blue.service
deploy ALL=(root) NOPASSWD: /usr/bin/systemctl is-active --quiet goofish-infrast-v1@green.service
deploy ALL=(root) NOPASSWD: /usr/bin/systemctl status goofish-infrast-v1@blue.service --no-pager --lines=80
deploy ALL=(root) NOPASSWD: /usr/bin/systemctl status goofish-infrast-v1@green.service --no-pager --lines=80
deploy ALL=(root) NOPASSWD: /usr/sbin/nginx -t
deploy ALL=(root) NOPASSWD: /usr/bin/systemctl reload nginx
```

Production secrets such as `DATABASE_URL`, `MAA_ADMIN_PASSWORD`,
`MAA_ADMIN_SECRET`, `CDK_HASH_SECRET`, `DEPOT_SAMPLE_HASH_SECRET`,
`FREE_PREVIEW_UID_HASH_SECRET`, and `SKLAND_CREDENTIAL_SECRET` stay in the
systemd `EnvironmentFile`; they are not deployment workflow secrets. Backup,
recovery, key rotation and restore drills remain documented in
[disaster-recovery.md](disaster-recovery.md).

The same `EnvironmentFile` should set explicit optimization queue limits:

```text
OPTIMIZE_GLOBAL_QUEUE_LIMIT=200
OPTIMIZE_ANALYSIS_QUEUE_LIMIT=40
OPTIMIZE_QUEUE_MAX_AGE_MS=86400000
OPTIMIZE_GLOBAL_WORKER_CONCURRENCY=3
OPTIMIZE_RETRY_BASE_MS=2000
```

`OPTIMIZE_QUEUE_MAX_AGE_MS` is 24 hours. A job clears this queue-only expiry as
soon as a worker claims it, so execution is governed by the separate worker
hard timeout rather than the time already spent waiting.

`OPTIMIZE_GLOBAL_WORKER_CONCURRENCY` is enforced through PostgreSQL across all
worker processes. Keep the same value on the Seoul API and every Hangzhou
worker slot, and size it for the CPU and database capacity of the whole
deployment rather than multiplying it by the number of systemd instances.
Never remove the queue limits during an incident; lower the numeric queue limits
to shed load.

## Pre-production acceptance

Before enabling automatic deployment:

1. Run `npm run check:deploy` in CI.
2. Deploy a validated SHA to the inactive slot and stop before cutover to prove
   candidate readiness without changing public traffic. On the server, invoke
   the atomic script with its normal required environment plus
   `CANDIDATE_ONLY=true`; it restores the inactive slot pointer after readiness
   and does not modify `current`, active-slot state, or Nginx.
3. Perform one controlled successful cutover.
4. Force the public smoke stage to fail once and confirm automatic 回滚 restores
   the old SHA, old upstream and public availability.
5. Confirm the application `git_sha`, `release.json.target_sha`, and authorizing
   Quality Checks run all match.

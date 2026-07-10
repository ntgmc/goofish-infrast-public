# Production Deploy Workflow

This project deploys production from `main` to the self-hosted server through
GitHub Actions. GitHub only opens an SSH session; the server-side deploy script
performs the actual update, build, restart, and health check.

## Flow

1. A change lands on `main`.
2. `Quality Checks` runs for `main`.
3. `Deploy Production` starts only after `Quality Checks` succeeds.
4. The workflow SSHs into the server.
5. The server runs `scripts/deploy-production.sh`.
6. The script fetches `origin/main`, fast-forwards the server checkout, runs
   `npm ci`, runs `npm run build`, restarts systemd, and checks
   `/api/health`.

Manual deployment is also available from the GitHub Actions UI through
`workflow_dispatch`.

## Server Setup

The default workflow assumes these production paths and names:

```bash
APP_DIR=/opt/goofish-infrast-v1
SERVICE_NAME=goofish-infrast-v1
HEALTH_URL=http://127.0.0.1:3000/api/health
```

On the server, make sure the repository exists and the deploy script is
executable:

```bash
cd /opt/goofish-infrast-v1
chmod +x scripts/deploy-production.sh
```

Run one manual deployment before enabling automatic deploys:

```bash
APP_DIR=/opt/goofish-infrast-v1 \
SERVICE_NAME=goofish-infrast-v1 \
HEALTH_URL=http://127.0.0.1:3000/api/health \
bash scripts/deploy-production.sh
```

If the deploy user is not root, grant passwordless access only to the required
systemd commands. Adjust the service name and `systemctl` path for your server:

```sudoers
deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart goofish-infrast-v1
deploy ALL=(root) NOPASSWD: /usr/bin/systemctl is-active --quiet goofish-infrast-v1
deploy ALL=(root) NOPASSWD: /usr/bin/systemctl status goofish-infrast-v1 --no-pager --lines=50
```

Verify the rule as the deploy user before running the workflow:

```bash
sudo -n systemctl is-active --quiet goofish-infrast-v1
```

Keep production secrets such as `DATABASE_URL`, `MAA_ADMIN_PASSWORD`,
`MAA_ADMIN_SECRET`, and `CDK_HASH_SECRET` in the systemd `EnvironmentFile`; do
not store them in GitHub Actions secrets unless the workflow truly needs them.
This workflow does not need those application secrets.

The production service must set `NODE_ENV=production`. Administrator login now
uses the `maa_admin_session` HttpOnly, SameSite=Strict cookie, and production
mode adds the required `Secure` attribute. Sessions expire after 30 minutes of
inactivity or 8 hours absolutely and are removed when the browser closes.

The existing `^~ /api/admin/` Nginx location forwards Cookie and Set-Cookie
headers without additional directives. No new location is required. Legacy
`X-Admin-User` / `X-Admin-Password` and `admin_user` / `admin_password`
authentication has been removed; operational scripts must log in through
`POST /api/admin/session` and retain a cookie jar for subsequent requests.

## GitHub Settings

Create these repository or environment secrets:

| Secret | Required | Purpose |
| --- | --- | --- |
| `DEPLOY_HOST` | Yes | Server hostname or IP address. |
| `DEPLOY_USER` | Yes | SSH user that can run the deploy script. |
| `DEPLOY_SSH_KEY` | Yes | Private SSH key for the deploy user. |
| `DEPLOY_KNOWN_HOSTS` | Recommended | Pinned SSH host key lines for the server. |

Create these repository or environment variables when the defaults do not match
your server:

| Variable | Default |
| --- | --- |
| `DEPLOY_PORT` | `22` |
| `DEPLOY_APP_DIR` | `/opt/goofish-infrast-v1` |
| `DEPLOY_SCRIPT` | `/opt/goofish-infrast-v1/scripts/deploy-production.sh` |
| `DEPLOY_SERVICE_NAME` | `goofish-infrast-v1` |
| `DEPLOY_HEALTH_URL` | `http://127.0.0.1:3000/api/health` |

To get the recommended `DEPLOY_KNOWN_HOSTS` value:

```bash
ssh-keyscan -H your-server.example.com
```

## Runtime Behavior

The deploy script is intentionally conservative:

- It refuses to deploy if the server checkout has local changes.
- It automatically discards local changes to generated build metadata files
  (`src/lib/build-meta.ts` and `server/handlers/data.ts`) before clean checks
  and after building, because `npm run build` can regenerate them on the server.
- It uses `git pull --ff-only`, so divergent history fails instead of being
  merged on the server.
- It keeps a deployment lock with `flock` when available.
- It checks that both `dist/index.html` and `server/dist/index.js` exist before
  restarting the service.
- It requires `/api/health` to return `ok=true` and, by default,
  `storage.type=postgres`.

Set `FORCE_DEPLOY=true` for a manual rebuild and restart when the server is
already on the latest commit.

## Failure Handling

If deployment fails before the systemd restart, the old service keeps running.
If it fails after restart or health check, inspect the workflow log and then run
these commands on the server:

```bash
sudo systemctl status goofish-infrast-v1 --no-pager --lines=50
curl -fsS http://127.0.0.1:3000/api/health
```

Rollback should be explicit: check out the previous known-good commit on the
server, rebuild, restart systemd, and rerun the health check.

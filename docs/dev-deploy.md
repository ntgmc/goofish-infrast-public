# Dev Preview Deploy Workflow

This project deploys the fixed dev preview from the `dev` branch to a
self-hosted server through GitHub Actions. The preview URL is
`https://dev.maatool.com/`.

The dev environment is intentionally separate from production:

- It uses a separate checkout at `/opt/goofish-infrast-v1-dev`.
- It runs a separate systemd service named `goofish-infrast-v1-dev`.
- It listens on `127.0.0.1:3001`.
- It uses a separate PostgreSQL database, starting from an empty dev database.

PR preview for this version is handled by merging, rebasing, or cherry-picking a
feature branch into `dev`. The workflow does not deploy arbitrary PR heads and
does not create per-PR preview URLs.

## Flow

1. A change lands on `dev`.
2. `Quality Checks` runs for `dev`.
3. `Deploy Dev` starts only after `Quality Checks` succeeds.
4. The workflow SSHs into the server using the `development` GitHub environment.
5. The server runs `/opt/goofish-infrast-v1-dev/scripts/deploy-production.sh`
   with dev-specific parameters.
6. The script fetches `origin/dev`, fast-forwards the server checkout, runs
   `npm ci`, runs `npm run build`, restarts systemd, and checks
   `http://127.0.0.1:3001/api/health`.

Manual deployment is also available from the GitHub Actions UI through
`workflow_dispatch`. Set `force_deploy=true` to rebuild and restart when the
server is already on the latest `dev` commit.

## Server Setup

Prepare a dedicated dev checkout:

```bash
sudo mkdir -p /opt/goofish-infrast-v1-dev
sudo chown deploy:deploy /opt/goofish-infrast-v1-dev
git clone --branch dev git@github.com:ntgmc/goofish-infrast-v1.git /opt/goofish-infrast-v1-dev
cd /opt/goofish-infrast-v1-dev
chmod +x scripts/deploy-production.sh
```

Run one manual deployment before enabling automatic deploys:

```bash
APP_DIR=/opt/goofish-infrast-v1-dev \
BRANCH=dev \
SERVICE_NAME=goofish-infrast-v1-dev \
HEALTH_URL=http://127.0.0.1:3001/api/health \
LOCK_FILE=/tmp/goofish-infrast-v1-dev.deploy.lock \
bash scripts/deploy-production.sh
```

If the deploy user is not root, grant passwordless access only to the required
systemd commands:

```sudoers
deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart goofish-infrast-v1-dev
deploy ALL=(root) NOPASSWD: /usr/bin/systemctl is-active --quiet goofish-infrast-v1-dev
deploy ALL=(root) NOPASSWD: /usr/bin/systemctl status goofish-infrast-v1-dev --no-pager --lines=50
```

The deploy script keeps the server checkout clean. It still rejects unexpected
local changes, but it automatically discards local changes to
`src/lib/build-meta.ts` and `server/handlers/data.ts` because `npm run build`
can regenerate those tracked files during deployment.

## PostgreSQL

Create an independent dev database. Do not point dev at the production database,
and do not automatically import production data.

Example baseline:

```sql
CREATE DATABASE goofish_infrast_v1_dev;
CREATE USER goofish_dev WITH PASSWORD 'replace-with-a-secret';
GRANT ALL PRIVILEGES ON DATABASE goofish_infrast_v1_dev TO goofish_dev;
```

Keep the real dev `DATABASE_URL` in the server's systemd environment file, not
in GitHub Actions secrets.

## systemd

Example service:

```ini
[Unit]
Description=goofish-infrast-v1 dev backend
After=network.target postgresql.service
Wants=postgresql.service

[Service]
WorkingDirectory=/opt/goofish-infrast-v1-dev
ExecStart=/usr/bin/node /opt/goofish-infrast-v1-dev/server/dist/index.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=3001
Environment=HOST=127.0.0.1
EnvironmentFile=/etc/goofish-infrast-v1/dev.env

[Install]
WantedBy=multi-user.target
```

The dev environment file should include only dev values:

```text
DATABASE_URL=postgresql://goofish_dev:...@127.0.0.1:5432/goofish_infrast_v1_dev
MAA_ADMIN_PASSWORD=...
MAA_ADMIN_SECRET=...
CDK_HASH_SECRET=...
```

Use dev-specific secrets. Do not reuse production credentials unless explicitly
required for a controlled compatibility test.

## Nginx

Install the rate-limit zones in the Nginx `http` context, then install the
repository-managed development API proxy snippet:

```bash
sudo install -m 0644 deploy/nginx/goofish-rate-limit-zones.conf /etc/nginx/conf.d/goofish-rate-limit-zones.conf
sudo install -m 0644 deploy/nginx/goofish-api-development.conf /etc/nginx/snippets/goofish-api-development.conf
sudo install -m 0644 deploy/nginx/goofish-security-headers.conf /etc/nginx/snippets/goofish-security-headers.conf
```

If this Nginx installation does not load `/etc/nginx/conf.d/*.conf` from inside
`http {}`, include the zone file explicitly in that context.

Then remove the old `/api/` location from the development virtual host and include
the snippet. It limits ordinary request bodies to 256 KiB and allows up to 1 MiB
for `/api/depot-value`:

```nginx
server {
  listen 80;
  server_name dev.maatool.com;

  root /opt/goofish-infrast-v1-dev/dist;
  index index.html;

  include /etc/nginx/snippets/goofish-api-development.conf;

  location / {
    try_files $uri $uri/ /index.html;
  }
}
```

Add TLS for `dev.maatool.com` with the server's normal certificate process.
Inside the resulting HTTPS `server {}` only, include the security baseline before
the API snippet:

```nginx
include /etc/nginx/snippets/goofish-security-headers.conf;
include /etc/nginx/snippets/goofish-api-development.conf;
```

Do not include `goofish-security-headers.conf` in the plain HTTP redirect server;
it contains one-year HSTS with `includeSubDomains`. The policy is enforced, not
Report-Only, and API responses intentionally contain no CORS allow headers.
Validate and reload Nginx after installing the snippet:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

Nginx returns 413 directly when a request exceeds the proxy-layer body limit.
Login and management authentication IP floods return 429. The response body may
use the default Nginx format.

Administrator authentication uses the `maa_admin_session` HttpOnly,
SameSite=Strict cookie. The existing `^~ /api/admin/` location already forwards
Cookie and Set-Cookie headers, so no additional location is required. With the
documented `NODE_ENV=production` setting, the cookie is `Secure` and therefore
the development site must be accessed through its configured HTTPS origin.
Sessions expire after 30 minutes of inactivity or 8 hours absolutely and close
with the browser. Legacy administrator password headers and business-body
credentials are not accepted; scripts must use `POST /api/admin/session` and a
cookie jar.

## GitHub Settings

Create a `development` environment in GitHub and configure these secrets:

| Secret | Required | Purpose |
| --- | --- | --- |
| `DEPLOY_HOST` | Yes | Server hostname or IP address. |
| `DEPLOY_USER` | Yes | SSH user that can run the deploy script. |
| `DEPLOY_SSH_KEY` | Yes | Private SSH key for the deploy user. |
| `DEPLOY_KNOWN_HOSTS` | Recommended | Pinned SSH host key lines for the server. |

Optional `development` environment variables:

| Variable | Default |
| --- | --- |
| `DEPLOY_PORT` | `22` |
| `DEPLOY_APP_DIR` | `/opt/goofish-infrast-v1-dev` |
| `DEPLOY_SCRIPT` | `/opt/goofish-infrast-v1-dev/scripts/deploy-production.sh` |
| `DEPLOY_SERVICE_NAME` | `goofish-infrast-v1-dev` |
| `DEPLOY_HEALTH_URL` | `http://127.0.0.1:3001/api/health` |
| `DEPLOY_LOCK_FILE` | `/tmp/goofish-infrast-v1-dev.deploy.lock` |

Application secrets such as `DATABASE_URL`, `MAA_ADMIN_PASSWORD`,
`MAA_ADMIN_SECRET`, and `CDK_HASH_SECRET` stay on the server in the systemd
environment file. They are not required by the GitHub workflow.

## Verification

After a dev deployment:

```bash
sudo systemctl status goofish-infrast-v1-dev --no-pager --lines=50
curl -fsS http://127.0.0.1:3001/api/health
curl -fsS https://dev.maatool.com/api/health
```

Also verify:

- `https://dev.maatool.com/` loads the frontend.
- Refreshing any frontend route falls back to `index.html` instead of 404.
- Writes made through dev APIs appear only in the dev PostgreSQL database.
- Production service, production database, and `Deploy Production` remain
  unchanged.

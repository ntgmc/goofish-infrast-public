# Hangzhou Optimize Worker Deployment

Production optimization runs on a dedicated Hangzhou worker while the public API and PostgreSQL remain in Seoul. The hosts communicate only through WireGuard. The worker has no public HTTP listener and never receives API traffic.

## Runtime topology

```text
Browser -> Seoul Nginx/API -> Seoul PostgreSQL
                                  ^
                                  | PostgreSQL TLS over WireGuard
                                  |
                         Hangzhou optimize worker
```

The API uses `APP_ROLE=api`; the worker uses `APP_ROLE=worker`. Both must use the same `OPTIMIZE_GLOBAL_WORKER_CONCURRENCY`. The worker health ports bind to `127.0.0.1` and are checked only by the local deployment script.

## WireGuard

Use `deploy/wireguard/seoul-wg0.conf.example` and `deploy/wireguard/hangzhou-wg0.conf.example` as templates. Generate keys independently on each host and keep `/etc/wireguard/wg0.conf` mode `0600`. Never store private keys in this repository or GitHub Actions.

On the Seoul cloud firewall, allow UDP 51820 only from the fixed Hangzhou public IP. Do not expose PostgreSQL 5432 publicly. On the host firewall, permit PostgreSQL only from `10.66.0.2` through `wg0`.

Configure PostgreSQL to listen on localhost and the Seoul tunnel address:

```text
listen_addresses = '127.0.0.1,10.66.0.1'
```

Add a narrow `pg_hba.conf` rule using SCRAM and TLS:

```text
hostssl goofish_infrast_v1 goofish_worker 10.66.0.2/32 scram-sha-256
```

Use a PostgreSQL server certificate trusted by the worker. The worker `DATABASE_URL` must target `10.66.0.1` and require TLS. Defense in depth is intentional: WireGuard protects the route, while PostgreSQL TLS authenticates and encrypts the database session.

Enable the tunnel on both hosts:

```bash
sudo systemctl enable --now wg-quick@wg0.service
sudo wg show
ping -c 5 10.66.0.1 # from Hangzhou
```

Both hosts must run NTP. Investigate clock drift before enabling worker leases.

## One-time Hangzhou setup

Create the deployment-owned layout and control checkout:

```bash
sudo mkdir -p /opt/goofish-infrast-v1-worker/{releases,slots,state}
sudo chown -R deploy:deploy /opt/goofish-infrast-v1-worker
git clone --branch main <repository-url> /opt/goofish-infrast-v1-worker/repository
```

Install the worker unit and slot files:

```bash
sudo install -m 0644 deploy/systemd/goofish-optimize-worker@.service /etc/systemd/system/goofish-optimize-worker@.service
sudo install -d -m 0750 /etc/goofish-infrast-v1-worker
sudo install -m 0644 deploy/systemd/worker-blue.env /etc/goofish-infrast-v1-worker/blue.env
sudo install -m 0644 deploy/systemd/worker-green.env /etc/goofish-infrast-v1-worker/green.env
sudo install -m 0600 deploy/systemd/worker.env.example /etc/goofish-infrast-v1-worker/worker.env
sudoedit /etc/goofish-infrast-v1-worker/worker.env
sudo systemctl daemon-reload
```

The production worker environment starts with:

```text
APP_ROLE=worker
OPTIMIZE_WORKER_CONCURRENCY=3
OPTIMIZE_GLOBAL_WORKER_CONCURRENCY=3
OPTIMIZE_QUEUE_POLL_MS=2000
OPTIMIZE_JOB_LOCK_TTL_MS=60000
OPTIMIZE_JOB_HEARTBEAT_MS=15000
OPTIMIZE_JOB_HARD_TIMEOUT_MS=900000
OPTIMIZE_SHUTDOWN_GRACE_MS=900000
POSTGRES_POOL_MAX=3
```

The worker needs the current Skland credential decryption key and the previous key pair only during rotation. It does not need administrator passwords, administrator signing secrets, Brevo credentials, or public application credentials. Allow DNS and outbound HTTPS for Skland and Yituliu requests.

## Least-privilege deployment commands

Adapt command paths and the deployment user as needed:

```sudoers
deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart goofish-optimize-worker@blue.service
deploy ALL=(root) NOPASSWD: /usr/bin/systemctl restart goofish-optimize-worker@green.service
deploy ALL=(root) NOPASSWD: /usr/bin/systemctl stop goofish-optimize-worker@blue.service
deploy ALL=(root) NOPASSWD: /usr/bin/systemctl stop goofish-optimize-worker@green.service
deploy ALL=(root) NOPASSWD: /usr/bin/systemctl enable goofish-optimize-worker@blue.service
deploy ALL=(root) NOPASSWD: /usr/bin/systemctl enable goofish-optimize-worker@green.service
deploy ALL=(root) NOPASSWD: /usr/bin/systemctl enable --now goofish-optimize-worker@blue.service
deploy ALL=(root) NOPASSWD: /usr/bin/systemctl enable --now goofish-optimize-worker@green.service
deploy ALL=(root) NOPASSWD: /usr/bin/systemctl disable goofish-optimize-worker@blue.service
deploy ALL=(root) NOPASSWD: /usr/bin/systemctl disable goofish-optimize-worker@green.service
deploy ALL=(root) NOPASSWD: /usr/bin/systemctl --no-block stop goofish-optimize-worker@blue.service
deploy ALL=(root) NOPASSWD: /usr/bin/systemctl --no-block stop goofish-optimize-worker@green.service
deploy ALL=(root) NOPASSWD: /usr/bin/systemctl is-active --quiet goofish-optimize-worker@blue.service
deploy ALL=(root) NOPASSWD: /usr/bin/systemctl is-active --quiet goofish-optimize-worker@green.service
deploy ALL=(root) NOPASSWD: /usr/bin/systemctl status goofish-optimize-worker@blue.service --no-pager --lines=80
deploy ALL=(root) NOPASSWD: /usr/bin/systemctl status goofish-optimize-worker@green.service --no-pager --lines=80
```

## GitHub production environment

Add these worker secrets:

- `WORKER_DEPLOY_HOST`
- `WORKER_DEPLOY_USER`
- `WORKER_DEPLOY_SSH_KEY`
- `WORKER_DEPLOY_KNOWN_HOSTS`

Optional variables have repository defaults:

- `WORKER_DEPLOY_PORT=22`
- `WORKER_DEPLOY_ROOT=/opt/goofish-infrast-v1-worker`
- `WORKER_DEPLOY_REPO_DIR=/opt/goofish-infrast-v1-worker/repository`
- `WORKER_DEPLOY_SERVICE_NAME=goofish-optimize-worker`
- `WORKER_BLUE_HEALTH_PORT=3010`
- `WORKER_GREEN_HEALTH_PORT=3012`

Application and WireGuard secrets remain on the servers. They are not GitHub deployment secrets.

## Deployment order and partial failures

`Deploy Production` downloads one immutable Quality Checks artifact and deploys the exact SHA in this order:

1. Start and verify the inactive Hangzhou worker slot.
2. Switch the worker slot and ask systemd to gracefully drain the previous worker for up to 15 minutes without blocking the deployment.
3. Deploy the Seoul API through its existing blue/green process.

The previous worker release remains protected by its slot and `previous` links while systemd completes the asynchronous drain. If the worker candidate fails readiness, the API is not deployed. If the worker succeeds and the API fails, the previous API remains active and the new worker continues to accept the previous persisted payload version. Re-run the workflow after repairing the API failure, or manually deploy the previous successful SHA to the worker.

Use `CANDIDATE_ONLY=true` with `scripts/deploy-worker-atomic.sh` to verify a worker release without switching slots.

## Acceptance

Before switching the Seoul API to `APP_ROLE=api`:

1. Verify `sudo wg show` reports a recent handshake.
2. Verify PostgreSQL is inaccessible through the public interface.
3. Deploy a worker candidate and check its loopback readiness endpoint.
4. Run one redacted production-shaped job at concurrency 1.
5. Set concurrency 3 and run at least three long jobs.
6. Confirm no `lease_lost`, OOM, unexpected retry, or dead letter.
7. Confirm API CPU drops after the API-only release.

Useful commands:

```bash
sudo systemctl status 'goofish-optimize-worker@*' --no-pager
sudo journalctl -u 'goofish-optimize-worker@*' --since '-30 min'
curl -fsS http://127.0.0.1:3010/health/ready
curl -fsS http://127.0.0.1:3012/health/ready
```

## Rollback and outage handling

A normal rollback is a manual `Deploy Production` run for the previous validated main SHA. The Worker deployment accepts the same immutable artifact contract as the API.

If WireGuard or Hangzhou fails, Seoul continues accepting and maintaining queued jobs but does not execute them. Lower queue admission limits or temporarily stop new submissions during a prolonged incident. Do not expose PostgreSQL publicly as a recovery shortcut. Restore the tunnel or Worker, verify readiness, and allow expired leases to recover through PostgreSQL.

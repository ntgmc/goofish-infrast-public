# Production Disaster Recovery

Production has a 24-hour RPO and a four-hour RTO. The source of truth is the
encrypted S3-compatible backup bucket; a local PostgreSQL disk is never a
backup target.

## Backup Setup

Install `age`, `rclone`, PostgreSQL client tools, GNU tar, and the repository's
`deploy/systemd/goofish-backup.*` units on the production server. Create an
append-only S3-compatible bucket in a separate account or project. Enable
versioning and configure lifecycle retention for 35 daily backups and 12
monthly backups. The backup identity may write and list only this bucket; it
must not have object-read permission.

Create `/etc/goofish-infrast-v1/backup.env` from
`deploy/systemd/backup.env.example`, with mode `0600`. `BACKUP_AGE_RECIPIENT`
is an age public recipient only. The matching age private key must never be
placed on the production server or in the bucket.

Generate the age identity offline, record its public-key fingerprint, then split
the private key using 2-of-2 Shamir secret sharing. Each of two named recovery
custodians stores one encrypted offline share and the fingerprint. Recovery
requires both shares and must be recorded in the incident log.

Install and enable the timer:

```bash
sudo install -m 0644 deploy/systemd/goofish-backup.service /etc/systemd/system/goofish-backup.service
sudo install -m 0644 deploy/systemd/goofish-backup.timer /etc/systemd/system/goofish-backup.timer
sudo chmod 0750 scripts/backup-postgres.sh scripts/restore-postgres.sh
sudo systemctl daemon-reload
sudo systemctl enable --now goofish-backup.timer
sudo systemctl start goofish-backup.service
sudo systemctl list-timers goofish-backup.timer
```

The health-check endpoint receives a heartbeat only after both encrypted objects
have been uploaded and remotely verified. Configure its expected period to 24
hours and alert after 26 hours. Treat any failed unit, missed heartbeat, or
backup older than 24 hours as P0 until a new verified backup exists.

## Restore Drill

Perform a full isolated drill quarterly and before retiring a key. Provision a
clean PostgreSQL database and a disposable application host. Reconstruct the
age identity only on that recovery host, use a tmpfs `RESTORE_TMPDIR`, then run:

```bash
BACKUP_S3_REMOTE=s3-encrypted:goofish-production-backup \
RESTORE_DATABASE_URL=postgresql://goofish_restore:...@127.0.0.1:5432/goofish_restore \
RESTORE_AGE_IDENTITY=/run/recovery/age-identity.txt \
scripts/restore-postgres.sh \
  --database-object daily/2026-07-14T021700Z.dump.age \
  --config-object daily/2026-07-14T021700Z.config.tar.age \
  --confirm-restore
```

The configuration archive is extracted for review only. Do not overwrite
production configuration automatically. Restore the reviewed EnvironmentFile,
systemd unit, and Nginx configuration to a fresh host, deploy the recorded Git
commit, then run `npm run check:migration` and verify `/api/health` reports
PostgreSQL storage. Record elapsed time and require it to stay within the
four-hour RTO.

Validate a historical CDK, a historical signed license, a current free-preview
claim, a stored depot sample removal path, and a stored Skland credential. Do
not log decrypted credentials or restored secret values.

## Key Rotation

`CDK_HASH_SECRET_PREVIOUS` and `MAA_ADMIN_SECRET_PREVIOUS` provide one previous
key slot. New CDKs and signatures use the current value; reads accept current
and previous values. A historical CDK hash cannot be rehashed without its
plaintext code, so retain the previous CDK secret until every legacy CDK has
expired, been redeemed, or been replaced.

Set `SKLAND_CREDENTIAL_KEY_ID` before rotating
`SKLAND_CREDENTIAL_SECRET`. Keep the old secret and ID in their `_PREVIOUS`
variables, then run `node scripts/rekey-skland-credentials.mjs` for an audit and
`node scripts/rekey-skland-credentials.mjs --apply` in a controlled maintenance
window. V1 and previous-key credentials remain readable during the window; new
and migrated records use `SKLAND-V2:<key-id>`. Resolve every reported invalid
credential before removing the previous secret.

`DEPOT_SAMPLE_HASH_SECRET` and `FREE_PREVIEW_UID_HASH_SECRET` are independent,
required production secrets. Rotate them only with a dedicated data-migration
and deletion-path verification procedure; they intentionally do not fall back
to `CDK_HASH_SECRET`.

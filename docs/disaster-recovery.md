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
required production secrets. They intentionally do not fall back to
`CDK_HASH_SECRET`.

Rotate depot-sample hashing with one current and one previous slot. Before the
deployment, move the old `DEPOT_SAMPLE_HASH_SECRET` and
`DEPOT_SAMPLE_HASH_KEY_VERSION` values to
`DEPOT_SAMPLE_HASH_SECRET_PREVIOUS` and
`DEPOT_SAMPLE_HASH_PREVIOUS_KEY_VERSION`, then install a new current secret and
a new, distinct key version. Apply the same four values to every API process in
one maintenance window. New samples use the current key; a successful sample
save atomically removes the matching previous-key row. Distribution queries
also deduplicate by contributor profile while both slots are active. Account
deletion checks both secrets after deleting profile-linked samples, so keep the
previous slot configured until the verification below is clean.

After deployment, exercise a consented depot valuation and its sample-revoke
path, then audit rotation progress without selecting hashes or profile IDs:

```sql
SELECT uid_hash_key_version, count(*)
  FROM depot_value_samples
 GROUP BY uid_hash_key_version
 ORDER BY uid_hash_key_version;

SELECT count(*) AS duplicate_contributors
  FROM (
    SELECT contributor_profile_id
      FROM depot_value_samples
     WHERE contributor_profile_id IS NOT NULL AND complete = true
     GROUP BY contributor_profile_id, valuation_version
    HAVING count(*) > 1
  ) duplicates;
```

Do not remove the previous slot while its key version still has rows unless a
reviewed retention/deletion migration intentionally removes those rows. In
particular, hash-only legacy rows cannot be recomputed or found during account
deletion once their secret is gone. Record the pre/post counts, confirm the
duplicate-contributor query returns zero, verify account deletion with a
previous-key sample, and only then remove both previous-slot variables in a
later deployment. Roll back by restoring the original secret as the current
slot with its original key version; never reuse a key-version label for a
different secret.

`BEHAVIOR_RISK_HMAC_SECRET` is also independent and must match on the API and
Worker processes. It never falls back to raw identifiers or another product
secret. Record `BEHAVIOR_RISK_HMAC_KEY_VERSION` with each rotation; signals
written under different key versions intentionally stop linking, while the old
HMAC-only evidence expires under the 90-day behavior-risk retention policy.

## Hangzhou Worker or WireGuard Outage

The Seoul API remains the queue authority when the Hangzhou worker or the
WireGuard tunnel is unavailable. It continues to accept, query, cancel, expire,
and recover PostgreSQL-backed jobs, but `APP_ROLE=api` prevents it from claiming
CPU work. During a prolonged incident, lower the global and analysis queue
limits or temporarily suspend submissions so admitted jobs do not accumulate
beyond operational capacity.

Do not expose PostgreSQL publicly as a recovery shortcut. Restore
`wg-quick@wg0.service`, verify a recent handshake, run
`scripts/check-worker-link.mjs` with the worker EnvironmentFile, and require the
inactive worker slot readiness check to pass before resuming normal admission.
Expired running leases are safely returned to the queue; ownership checks stop
a stale worker from committing results after recovery.

If Seoul must temporarily execute urgent work, install a separate standby
worker unit that is disabled by default and uses concurrency one. Enabling it is
a documented incident action, not an automatic fallback, because CPU-bound
jobs can make the two-core API host unavailable. Disable the standby again as
soon as Hangzhou readiness is restored.

Worker rollback uses the same validated main SHA as API rollback. Keep the
current and previous worker releases protected from cleanup and record any
period in which API and worker SHAs differ. The current worker accepts persisted
payload versions 2 and 3 so an API rollback does not strand already admitted
jobs.

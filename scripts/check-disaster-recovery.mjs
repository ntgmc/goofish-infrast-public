import { access, readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'

const required = {
  'scripts/backup-postgres.sh': ['pg_dump --format=custom', 'pg_restore --list', 'BACKUP_AGE_RECIPIENT', 'BACKUP_HEALTHCHECK_URL', 'rclone copyto', 'prune_prefix daily 70', 'prune_prefix monthly 24'],
  'scripts/restore-postgres.sh': ['--confirm-restore', 'pg_restore --clean --if-exists', 'RESTORE_AGE_IDENTITY'],
  'deploy/systemd/goofish-backup.service': ['RuntimeDirectory=goofish-backup', 'ProtectSystem=strict', 'EnvironmentFile=/etc/goofish-infrast-v1/backup.env'],
  'deploy/systemd/goofish-backup.timer': ['Persistent=true', 'OnCalendar=*-*-* 02:17:00 UTC'],
  'docs/disaster-recovery.md': ['24-hour RPO', 'four-hour RTO', 'Shamir'],
}

for (const [path, fragments] of Object.entries(required)) {
  await access(path)
  const content = await readFile(path, 'utf8')
  for (const fragment of fragments) {
    if (!content.includes(fragment)) throw new Error(`${path} is missing ${fragment}`)
  }
}

if (process.platform !== 'win32') {
  const result = spawnSync('bash', ['scripts/test-backup-postgres.sh'], { stdio: 'inherit' })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

console.log('disaster recovery asset checks passed')

import { resolveAppRole } from './process-role'
import { closePool, hasDatabaseUrl } from './storage/postgres'
import { migrateDatabaseSchema } from './storage/schema'

if (process.env.ALLOW_DATABASE_MIGRATION !== 'true') {
  throw new Error('Database migration requires ALLOW_DATABASE_MIGRATION=true')
}
if (resolveAppRole() !== 'api') {
  throw new Error('Database migration requires APP_ROLE=api')
}
if (!hasDatabaseUrl()) {
  throw new Error('Database migration requires DATABASE_URL')
}

try {
  console.log('Starting controlled database migration')
  await migrateDatabaseSchema()
  console.log('Controlled database migration completed')
} finally {
  await closePool()
}

import { drizzle } from 'drizzle-orm/node-postgres'
import { getPool } from './postgres'

export function getDrizzle() {
  return drizzle({ client: getPool() })
}

import { NodePgSession, type NodePgClient } from 'drizzle-orm/node-postgres'
import { PgDialect } from 'drizzle-orm/pg-core'
import { DrizzleQueryError } from 'drizzle-orm'
import { types, type PoolClient, type QueryConfig, type QueryResult, type QueryResultRow } from 'pg'

// Use Drizzle's parameterized execution without changing pg's existing date/array decoding.
export function createDrizzleExecutor(client: NodePgClient, queryTimeoutMs?: number) {
  const driver = new Proxy(client, {
    get(target, property, receiver) {
      if (property === 'query') {
        return (config: QueryConfig, values: unknown[]) =>
          target.query(
            {
              ...config,
              types,
              ...(queryTimeoutMs === undefined ? {} : { query_timeout: queryTimeoutMs }),
            },
            values,
          )
      }
      return Reflect.get(target, property, receiver)
    },
  })
  const session = new NodePgSession(driver, new PgDialect(), undefined)
  return async <T extends QueryResultRow = QueryResultRow>(
    text: string,
    values: unknown[] = [],
  ): Promise<QueryResult<T>> => {
    try {
      return await session
        .prepareQuery<{ execute: QueryResult<T>; all: T[]; values: unknown[][] }>(
          { sql: text, params: values },
          undefined,
          undefined,
          false,
        )
        .execute()
    } catch (error) {
      if (error instanceof DrizzleQueryError && error.cause instanceof Error) throw error.cause
      throw error
    }
  }
}

export function drizzleTransactionClient(client: PoolClient) {
  return {
    query: createDrizzleExecutor(client),
    release: client.release.bind(client),
  }
}

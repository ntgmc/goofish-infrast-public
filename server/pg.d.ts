import 'pg'

declare module 'pg' {
  interface QueryConfig<I = any[]> {
    // node-postgres supports a timeout per query as well as per connection.
    query_timeout?: number
  }
}

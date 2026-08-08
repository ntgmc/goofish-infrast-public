# Database Migration Safety

This is the operational knowledge captured from the production failure where
`goofish-database-migrate.service` stopped with:

```text
Database migration 2026-08-06.1 checksum does not match the current application.
Publish schema changes under a new migration version.
```

## Why the failure happened

`server/storage/schema.ts` computes `DATABASE_SCHEMA_CHECKSUM` from the complete
schema SQL, the current personal-use declaration, and the minimum app version.
The migration ledger stores that checksum under the schema contract's version.
If the application changes any checksum input but keeps the old version, the
migrator must reject the release instead of silently changing the meaning of a
completed migration.

The incident was caused by the `skland_uid_mismatch` event-type and constraint
change in commit `cb22095`. The schema SQL changed while
`server/database-schema-contract.json` remained at `2026-08-06.1`.

## Versioning rules

- When schema SQL, the schema declaration input, or the minimum app version
  changes, publish a new unused `YYYY-MM-DD.sequence` migration version.
- Increment the sequence for additional migrations on the same date.
- Keep the old `goofish_schema_migrations` row and checksum unchanged.
- Do not delete ledger rows or overwrite a historical checksum to make a
  release start.
- The new migration runs the existing idempotent migration phases and records a
  new completed ledger row after validation succeeds.

## Production response

1. Compare the release's schema contract and schema SQL with the last completed
   ledger version.
2. If the checksum mismatch is caused by an intentional schema change, bump the
   contract version and redeploy the complete release artifact.
3. Run the controlled database migration service and verify the new version is
   `completed` before starting API or Worker processes.
4. If the checksum is unchanged but migration still fails, investigate the
   actual PostgreSQL error; do not bypass the checksum guard.
5. After a successful migration, re-check management-console and risk-control
   views that depend on the changed schema.

## Validation

For schema changes, run the closest schema tests first, then the repository
checks required by [`docs/agent-validation.md`](agent-validation.md). PostgreSQL
integration tests are preferred when the configured database environment is
available.

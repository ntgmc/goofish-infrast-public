# Agent validation

Use this guide when changing repository files, as required by `AGENTS.md`.
Choose the targeted tests for each changed area, then run the required build,
HTTP, public-export, database, and release checks.

## Test-writing policy

- Do not add tests for simple, isolated, low-risk functionality, such as static UI or copy, straightforward local interactions, constants and mappings, formatting helpers, or thin forwarding wrappers. Do not add tests that merely restate the implementation.
- Add or retain necessary tests for complex coupling or high-impact failures: cross-module or cross-layer workflows, asynchronous races, critical state transitions, authentication and authorization, billing, idempotency, data-loss prevention, revision conflicts, and database transactions. Assess coupling and failure consequences rather than function length.
- Run relevant existing tests and the required checks below. For simple, isolated, low-risk changes without existing tests, use applicable build or static checks and focused manual verification; a missing test alone does not justify creating one.

## Required sequence

1. Inspect the affected code and existing tests.
2. State a short implementation plan before editing.
3. Make the smallest focused change.
4. Run the closest targeted tests from the matrix below.
5. Run both mandatory repository checks from the repository root.
6. Inspect the final diff and working tree before reporting completion.

The mandatory checks are required after every repository file change, including
documentation-only changes:

```sh
pnpm run check:architecture
pnpm run check:dead-code
```

Run the commands for every matching row when a change spans multiple areas. A
test file changed alongside its implementation counts as an implementation
change. If a later edit occurs after validation, rerun the affected targeted
tests and both mandatory checks.

## Targeted test selection

Start with the nearest test file, then expand to the owning subsystem, then to
the relevant boundary check. Use Vitest's path filter for focused tests:

```sh
pnpm test src/path/to/feature.test.tsx server/path/to/feature.test.ts
```

Use `pnpm run test:postgres` for `*.postgres.test.ts` files; it uses
`vitest.postgres.config.ts`, requires a reachable PostgreSQL database, and runs
serially. The ordinary `pnpm test` run excludes PostgreSQL tests.

## Change-to-test matrix

### Frontend source, routes, and public pages

For changes under `src/` (components, pages, hooks, or libraries), run the
nearest colocated or named test first, then:

```sh
pnpm run build:web
```

Add the following when the scope matches:

- Routing, navigation, metadata, sitemap, or public-page changes:
  `pnpm test src/App.public-content-routing.test.tsx src/lib/app-routes.test.ts src/components/RouteMetadata.test.tsx src/seo-static-files.test.ts`
  and `pnpm run check:public-http`.
- Public content or copy changes: the related content tests and
  `pnpm run check:copy`.
- Admin pages, admin controllers, confirmation flows, or optimistic updates:
  the nearest `src/pages/admin/**` tests and read
  `docs/admin-operations.md` first.
- Optimization UI, job progress, result projection, or billing UI: the nearest
  `src/pages/tool/optimize/**`, `src/lib/*optimization*`, or billing tests;
  add `pnpm run check:api` when the UI changes an API contract.
- Shared API clients, session/auth clients, or cross-page contexts: their
  nearest client/context tests plus `pnpm test` when the change affects more
  than one route or consumer.

### Static assets and frontend build configuration

For `public/`, `index.html`, `src/index.css`, `vite.config.ts`, `tsconfig.json`,
or frontend dependency/configuration changes, run:

```sh
pnpm run build:web
pnpm run check:public-http
pnpm run check:public-export
```

Use `pnpm test` when the change can alter runtime route loading, asset discovery,
or shared test setup. For `package.json` or `pnpm-lock.yaml`, run `pnpm install --frozen-lockfile`
before these checks.

### Server handlers, routes, HTTP adapters, and security

For `server/handlers/**`, `server/routes.ts`, `server/http-server.ts`, HTTP
adapters, request policy, security boundaries, authentication, or rate-limit
changes:

1. Run the matching `server/**/*.test.ts` file(s).
2. Run the complete API boundary suite:

   ```sh
   pnpm run check:api
   ```

3. Build the public server:

   ```sh
   pnpm run build:server:public
   ```

Add these checks when applicable:

- Route additions/removals or method changes:
  `node scripts/check-server-routes.mjs` after the server build, plus
  `server/routes.health.test.ts` or the matching route test.
- Body-size, CORS, security-header, or same-origin changes:
  `node scripts/check-http-body-limit.mjs`,
  `node scripts/check-http-security-baseline.mjs`, and
  `pnpm run check:public-http` (all three are also included by `check:api`).
- Public API handler bundle boundaries:
  `node scripts/check-api-handlers.mjs` (also included by `check:api`).
- Authentication or security-check mock changes under `scripts/`:
  run the changed smoke script directly and then `pnpm run check:api`; esbuild
  virtual mocks must export every symbol imported by the bundled production
  module.

### Storage, PostgreSQL, schema, and migrations

For `server/storage/**`, PostgreSQL queries/transactions/indexes, schema SQL,
`server/database-schema-contract.json`, migration ledgers, or migration tools,
read `docs/database-migration.md` first. Run the nearest unit tests and, when a
database contract is involved:

```sh
pnpm run test:postgres
pnpm run build
node scripts/check-server-routes.mjs
node scripts/verify-migrated-data.mjs --require-database
```

Use `pnpm run check:migration` as the combined migration gate when a configured
database is available. It builds the application, verifies registered routes,
and validates migrated data. A schema or migration edit must use a new
migration version; never rewrite a historical migration checksum.

Specific script changes map as follows:

- `scripts/migration-verifier-lib.mjs` or its tests:
  `pnpm run test:migration-verifier`, then the database verification commands
  above when the change affects live migration semantics.
- `scripts/backup-manifest.mjs`, backup/restore scripts, or backup contracts:
  `pnpm run test:backup-contracts`.

### Optimization jobs, queues, and workers

For `server/optimization/**`, `server/optimize-*.ts`, worker runtime/lifecycle,
queue maintenance, job state, retry, cancellation, or concurrency changes:

- Run all nearest optimization/job/worker tests, not only the edited file's
  test (for example, job status, dispatcher, runner, queue maintenance, and
  worker runtime tests when those layers interact).
- Run `pnpm run check:api` and `pnpm run build:server:public`.
- Run `node scripts/check-api-handlers.mjs` when a public/admin handler imports
  optimization code.
- Run `pnpm run test:postgres` when queue/storage schema or transaction behavior
  changes.
- Run the relevant frontend optimization tests and `pnpm run build:web` when
  the server contract is consumed by `src/pages/tool/optimize/**` or shared
  optimization clients.

### Scripts, generators, and CI/build contracts

For `scripts/**`, run the nearest Node test or smoke script in addition to the
mandatory checks. Use this mapping:

| Changed area | Targeted validation |
| --- | --- |
| `scripts/generate-data.mjs` | `pnpm run test:generate-data` |
| `scripts/product-catalog*.mjs` or catalog data | `pnpm run test:product-catalog` and `pnpm run check:catalog` |
| `scripts/generate-changelog.mjs`, changelog libraries, PR changelog analysis | `pnpm run test:generate-changelog` |
| `scripts/migration-verifier-lib.mjs` | `pnpm run test:migration-verifier` |
| `scripts/backup-manifest.mjs`, backup/restore scripts | `pnpm run test:backup-contracts` |
| `scripts/release-artifact*.mjs`, staging, or release manifests | `pnpm run test:release-artifact` and `pnpm run check:release-runtime` when runtime packaging changes |
| production release confirmation | `pnpm run test:release-confirmation` |
| build relevance or build-relevance configuration | `pnpm run test:build-relevance` and `pnpm run check:build-relevance` |
| `.github/workflows/**` or workflow command contracts | `pnpm run test:workflow-contracts`, then run every command block changed in the workflow |
| API/security smoke scripts (`check-auth-security`, `check-depot-profile`, `check-workspace-history`, `check-skland-handler`, HTTP checks) | Run the changed script directly and `pnpm run check:api` |
| `scripts/build-server.mjs`, public export, or release runtime checks | `pnpm run build:server:public`, `pnpm run build`, and `pnpm run check:public-export` |

If a script has no dedicated test, execute it directly with its documented
self-test or smoke mode and include the owning build/check command.

### Dependencies and repository configuration

For `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`, TypeScript/Vite/Vitest configuration,
aliases, or shared build configuration:

```sh
pnpm install --frozen-lockfile
pnpm run check:types
pnpm run check:catalog
pnpm test
pnpm run build
pnpm run check:api
pnpm run check:copy
pnpm run check:public-export
```

Add `pnpm run test:postgres` when database dependencies or test configuration
changes. Dependency-only changes still require the mandatory architecture and
dead-code checks because the dependency graph can expose stale imports or
unused symbols.

### Documentation and agent instruction files

For `AGENTS.md`, `docs/**`, README files, or other documentation-only changes,
run `git diff --check`, inspect links and headings manually, and run the two
mandatory checks. No application test is required unless the document is an
operational contract:

- `docs/database-migration.md`: use the migration/storage validation above.
- `docs/admin-operations.md`: use the affected admin tests and API checks.
- `docs/release-artifacts.md`: use release-artifact and public-export checks.
- `docs/disaster-recovery.md`: use the backup/restore and migration checks
  described by that document.

## Broad or uncertain changes

When a change crosses two or more rows, changes a shared abstraction, changes a
public contract, or its impact cannot be bounded confidently, run the full local
gate:

```sh
pnpm run check:local
```

`check:local` includes catalog, generators, migration verifiers, backup
contracts, release tests, workflow contracts, the full Vitest suite, build,
architecture, copy, API, and route checks. It may require PostgreSQL or other
environment services; report unavailable external prerequisites separately.

### Historical service-status changes

Changes to `/api/status`, the service-status sampler/storage, public status
history UI, or the optimization admin status panel span frontend, HTTP,
background-worker, PostgreSQL, and migration boundaries. Run the nearest tests
for every changed layer, then this complete matrix:

```sh
pnpm exec tsc --noEmit
pnpm test src/lib/service-status.test.ts server/handlers/service-status.test.ts server/handlers/admin-service-status.test.ts src/pages/StatusPage.test.tsx src/pages/admin/optimization/QueueMonitorPanel.test.tsx server/process-hooks.test.ts server/storage/schema.test.ts
pnpm run test:postgres
pnpm run build:web
pnpm run build:server:public
pnpm run check:api
pnpm run check:copy
pnpm run check:public-export
pnpm run check:architecture
pnpm run check:dead-code
pnpm run check:migration
node scripts/check-server-routes.mjs
git diff --check
```

If the sampler or queue snapshot changes, also run all queue, worker lifecycle,
dispatcher, retry, and optimization storage tests, plus
`node scripts/check-api-handlers.mjs`. If request policy, route declarations,
authentication, or security-boundary code changes, run matching security
boundary tests and `pnpm run check:public-http`. If schema or migration
contracts change, read `docs/database-migration.md`, run the PostgreSQL suite
and migration gate, and verify that the schema version is new.

## Failure handling and completion

- If a required check fails within the changed scope, investigate and fix it
  before finishing.
- If a failure is outside the changed scope or an environment dependency is
  unavailable, report the exact command and evidence; do not claim validation
  passed.
- Do not hide warnings emitted by injected smoke scenarios; judge the command by
  its exit code and the final pass marker.
- Before reporting completion, verify the requested change, the final diff, the
  working tree, and that no temporary validation process remains running.

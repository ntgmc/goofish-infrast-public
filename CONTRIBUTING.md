# Contributing

Contributions can change the public web application, API, queue runtime,
or OptimizerPort contract.

## Development

1. Create a focused branch from `main`.
2. Use Node.js 24.22.1 and pnpm 12.14.0, then install dependencies with `pnpm install --frozen-lockfile`.
3. Add or update tests for behavior changes.
4. Run the public checks documented in `README.md`.
5. Submit a pull request with a concise explanation of the behavior and tests.

Contributions are submitted under Apache License 2.0.

## Backend tooling

`pnpm run check:lint` runs Biome across frontend, server, tests, scripts and root
configuration; CI, `check:local` and public-export validation run the same check.
`pnpm run format` formats that scope using two spaces, single quotes, and optional
semicolons. Generated data, frozen benchmark evidence, schema contracts and build
output stay with their generators. Format only the files touched by a change.
TypeScript, Knip, architecture checks and tests remain separate gates.

`biome.json` enables Tailwind syntax and project-specific rules. React dependency
arrays, component factories, index keys, TypeScript's control-flow inference,
security regular expressions and CSS specificity retain their existing conventions.
Frontend rules retain the ES2020 target, including its own-property checks.
Accessibility checks cover alternative text, ARIA validity, hidden focus targets,
tab order, document language and frame titles. Component interaction and semantics
are also verified by the existing UI tests. Other diagnostics include advisory
style suggestions; `check:lint` fails on errors.

All API endpoints run through Fastify in `server/http-server.ts`, using the
request-policy route inventory. The HTTP boundary validates the original target
before URL normalization and reads the original request bytes before Fastify's
body parser. Existing handlers retain their Web Request/Response contracts,
authorization and feature gates. Fastify sends responses and streams; request
observations, native server limits and graceful process shutdown are preserved.

All business SQL uses Drizzle: shared `query()` and transaction callbacks execute
parameterized SQL through `server/storage/drizzle-executor.ts`; directly borrowed
business connections use `drizzleTransactionClient()`. Keep complex SQL in its
parameterized form. The adapter preserves pg date/array decoding, result metadata,
original PostgreSQL errors, connection timeouts and transaction ownership. Only
standalone statements use the existing deadlock/serialization retry policy; do
not retry an individual failed statement inside a transaction.

Use `server/storage/drizzle.ts` and `drizzle-schema.ts` for typed query builders.
They share the observed pg pool with the SQL execution path. PostgreSQL connection
management, migration DDL and maintenance leadership retain direct driver access.
`server/storage/schema.ts` and its migration ledger own DDL; Drizzle Kit is not
part of the build or deployment workflow.

## Product copy

When editing product copy, free/paid comparisons, or upgrade previews, follow
[Product copy and paid capability previews](docs/product-copy.md). Verify claims
against the product catalog and runtime entitlements, keep free actions available,
and test every preview destination.

## Public/private boundary

Do not submit production optimizer source, private fixtures, benchmarks, or
algorithm diagnostics. The public repository may discuss the OptimizerPort
contract and observable job behavior. Keep private implementations in the
private repository.

Adding an optimization job kind requires updating the public payload union,
OptimizerPort interface, exhaustive dispatcher, snapshots, UI labels, and
compatibility tests together.

Do not add a fake optimizer that returns plausible success data. Public API-only
development should leave jobs queued when no real external worker is available.

# Contributing

Contributions can change the public web application, API, queue runtime,
or OptimizerPort contract.

## Development

1. Create a focused branch from `main`.
2. Follow [README.md](README.md) to install dependencies and start the application.
3. Choose tests and run the required checks in [agent validation](docs/agent-validation.md).
4. Submit a pull request explaining the resulting behavior and validation.

Contributions are submitted under Apache License 2.0. The [documentation index](docs/README.md)
routes product, feature, integration and deployment work to its topic guide.

## Backend tooling

`pnpm run check:lint` runs Biome across frontend, server, tests, scripts and root
configuration; CI, `check:local` and public-export validation run the same check.
`pnpm run format` formats that scope using two spaces, single quotes, and optional
semicolons. Generated data, frozen benchmark evidence, schema contracts and build
output stay with their generators. Format only the files touched by a change.
TypeScript, Knip, architecture checks and tests remain separate gates.

Lint rules are defined in `biome.json`; `check:lint` fails on errors. Use existing
UI tests to verify interaction and accessibility beyond static diagnostics.

`server/routes.ts` declares API paths, handlers and feature-gate policy;
`server/http-server.ts` registers those handlers directly with Fastify. Tests
check the declarations against the request-policy inventory. The HTTP boundary
validates the original target before URL normalization and reads the original
request bytes before Fastify's body parser. Business handlers use Web
Request/Response contracts. Fastify sends responses and streams; the HTTP server
applies security headers, records observations and preserves native connection
limits and graceful process shutdown.

All business SQL uses Drizzle: shared `query()` and transaction callbacks execute
parameterized SQL through `server/storage/drizzle-executor.ts`. Use
`withTransaction()` for business transactions and `QueryClient` for their query
parameters; it exposes the parameterized query interface. Maintenance that holds
a connection across several transactions uses `drizzleTransactionClient()`.
Keep complex SQL in its parameterized form. The adapter preserves pg date/array
decoding, result metadata, original PostgreSQL errors and connection timeouts.
The transaction helper owns commit, rollback and connection release. Only
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

Follow [OPEN_SOURCE_BOUNDARY.md](OPEN_SOURCE_BOUNDARY.md) for source and fixture
boundaries. The public repository owns the OptimizerPort contract and observable
job behavior; private optimizer implementations stay in the private repository.

Adding an optimization job kind requires updating the public payload union,
OptimizerPort interface, exhaustive dispatcher, snapshots, UI labels, and
compatibility tests together.

Do not add a fake optimizer that returns plausible success data. Public API-only
development should leave jobs queued when no real external worker is available.

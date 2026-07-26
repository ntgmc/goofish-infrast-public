# Contributing

Thank you for contributing to the public web application, API, queue runtime,
or OptimizerPort contract.

## Development

1. Create a focused branch from `main`.
2. Install dependencies with `npm install`.
3. Add or update tests for behavior changes.
4. Run the public checks documented in `README.md`.
5. Submit a pull request with a concise explanation of the behavior and tests.

Contributions are submitted under Apache License 2.0.

## Public/private boundary

Do not submit production optimizer source, private fixtures, benchmarks, or
algorithm diagnostics. The public repository may discuss the OptimizerPort
contract and observable job behavior, but the private implementation is out of
scope.

Adding an optimization job kind requires updating the public payload union,
OptimizerPort interface, exhaustive dispatcher, snapshots, UI labels, and
compatibility tests together.

Do not add a fake optimizer that returns plausible success data. Public API-only
development should leave jobs queued when no real external worker is available.

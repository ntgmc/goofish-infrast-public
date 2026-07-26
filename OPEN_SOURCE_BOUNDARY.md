# Open-source boundary

## Included

- React web application and user-facing optimization job UI.
- Node.js API, authentication, profiles, workspaces, and administration.
- PostgreSQL job admission, idempotency, leases, retries, cancellation, dead
  letters, queue maintenance, and entitlement settlement.
- Process-local job signals, runner, worker process lifecycle, worker-thread
  messaging, combined hooks, and health-state primitives.
- OptimizerPort v1, payload validation, and exhaustive job dispatch.
- Schedule, scenario-comparison, and reorder-check public request/result types.

## Not included

- Production OptimizerPort composition roots.
- Candidate generation and pruning.
- Optimization rules and dynamic rule execution.
- Assignment solvers and search strategies.
- Economic objective implementation.
- Scenario-comparison and reorder-check calculation services.
- Private result formatting, optimizer benchmarks, fixtures, and diagnostics.

## Runtime behavior

The API can authenticate, validate, enqueue, query, and cancel optimization
jobs without an optimizer implementation. PostgreSQL is the reliable boundary
between the public API and an external worker. Without a compatible worker,
jobs remain queued; the API never computes a substitute result.

The public worker runtime requires an explicitly registered OptimizerPort v1
before it can become ready or claim work. Missing or incompatible ports fail
fast during worker initialization.

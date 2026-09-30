# Open-source boundary

## Included

- React web application and user-facing optimization job UI.
- Node.js API, authentication, profiles, workspaces, and administration.
- PostgreSQL job admission, idempotency, leases, retries, cancellation, dead
  letters, queue maintenance, and entitlement settlement.
- Process-local job signals, runner, worker process lifecycle, worker-thread
  messaging, combined hooks, and health-state primitives.
- OptimizerPort v1, payload validation, and exhaustive job dispatch.
- Schedule and scenario-comparison public request/result types.

## Not included

- Production OptimizerPort composition roots.
- Candidate generation and pruning.
- Optimization rules and dynamic rule execution.
- Assignment solvers and search strategies.
- Economic objective implementation.
- Scenario-comparison calculation services.
- Private result formatting, optimizer benchmarks, fixtures, and diagnostics.

## Runtime behavior

The API authenticates requests, validates and queues jobs, and handles queries
and cancellation. PostgreSQL stores jobs for the external worker. In an
API-only deployment, jobs stay queued until a compatible worker is available;
the API does not generate substitute results. A private combined build can
register the real `OptimizerPort` on the service host and process jobs with one
local thread while the optional Aliyun ECS worker is stopped.

The public worker runtime requires an explicitly registered OptimizerPort v1
before it can become ready or claim work. Missing or incompatible ports fail
fast during worker initialization.

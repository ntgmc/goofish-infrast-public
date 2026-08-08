# Agent Validation

This document contains the detailed validation contract routed from the project
`AGENTS.md` entrypoint.

## Required sequence

1. Inspect the affected code and existing tests.
2. State a short implementation plan before editing.
3. Make the smallest focused change.
4. Run tests closest to the changed behavior.
5. Run both mandatory repository checks from the repository root.
6. Inspect the final diff and working tree before reporting completion.

## Test requirements

Every task that modifies a repository file must run tests specifically relevant
to the changed behavior. A task is incomplete while a relevant test is missing,
failed, or still needs to be rerun after a later edit.

The mandatory checks are:

```sh
npm run check:architecture
npm run check:dead-code
```

Run them against the final working tree, even when the change appears unrelated
to architecture or dead-code analysis.

## Failure handling

- If a required check fails and the failure is within the task's scope,
  investigate and resolve it before finishing.
- If the failure is outside the task's scope or caused by an unavailable
  environment dependency, report the exact command and evidence; do not claim
  that validation passed.
- If any file changes after validation, rerun the affected targeted tests and
  both mandatory checks before reporting completion.

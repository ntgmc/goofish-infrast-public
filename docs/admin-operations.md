# Management-console mutations

Management-console profile mutations use optimistic concurrency. The client
sends `expected_updated_at`, the handler checks it against the current profile,
and the storage transaction checks it again while holding the profile row lock.
Keep both checks so an administrator cannot overwrite a newer change.

## Timestamp ownership

The profile record and its workspace have separate timestamps:

- `user_game_accounts.updated_at` identifies the version of the account profile
  being edited.
- `user_profile_workspaces.updated_at` identifies the version of workspace
  content.

`toPublicProfile()` may expose the workspace timestamp as `updated_at` for the
normal user-facing profile payload. The admin profile summary must override that
field with the profile record timestamp before it is used by any admin mutation.
Otherwise every profile with a workspace can be rejected as stale even when no
administrator changed the profile.

When changing this flow, keep the timestamps distinct and add a regression test
where the profile and workspace timestamps differ. The test should load the
admin detail, use the returned profile timestamp in a mutation request, and
assert that the request is accepted.

## Conflict behavior

A concurrent profile or workspace change must return `409` with a message
asking the administrator to refresh and retry. Keep the handler pre-check and
the transactional row-lock check; stale data must be rejected.

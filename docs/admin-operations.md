# Management-Console Mutations

Management-console profile mutations use optimistic concurrency. The client
sends `expected_updated_at`, the handler checks it against the current profile,
and the storage transaction checks it again while holding the profile row lock.
Both checks are required to prevent an administrator from overwriting a newer
change.

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

A genuine concurrent profile or workspace change must remain a `409` response
with the refresh-and-retry message. Do not remove the handler pre-check or the
transactional row-lock check merely to make the UI accept stale data.

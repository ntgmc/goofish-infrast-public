# Management-console mutations

Management-console profile mutations use optimistic concurrency. The client
sends `expected_updated_at`, the handler checks it against the current profile,
and the storage transaction checks it again while holding the profile row lock.
Keep both checks so an administrator cannot overwrite a newer change.

## Optimization submission rate exemption

The `security_admin` role includes `optimization_rate_limit_bypass`. Log in to
both the normal account and management console in the same browser to apply it
automatically when submitting an optimization job. Existing administrators must
log in again after this change so the session Cookie covers `/api`.

The server validates the current administrator session and capability for each
new submission. This exempts the profile's rolling submission limit (12 per hour
for ordinary profiles, two per six hours for free previews) and the commercial
account's 30-per-hour limit. Queue capacity, account/profile authorization,
billing, runtime limits, and all other admission checks still apply. Every
accepted submission remains recorded. Expired sessions, disabled administrators,
and roles without the capability receive normal submission limits. Request-body
flags cannot grant the exemption. No item is required or consumed.

Login and logout clear the previous `/api/admin` Cookie as well as managing the
new `/api` Cookie. Capability decisions use the existing administrator operation
audit.

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

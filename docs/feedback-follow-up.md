# Feedback follow-up

Users can submit a problem and revisit it through **反馈 → 我的反馈**. Administrators use `/admin/feedback` to select a report, take ownership, keep private investigation notes, reply and publish a result. No email is sent; public progress creates or refreshes a station notification with a link to the report. When notifications are disabled, feedback history remains available.

## Handling a report

| Status | Meaning |
| --- | --- |
| `open` | Received, awaiting handling. Existing reports start here. |
| `processing` | Investigation or action is underway. |
| `waiting_user` | The administrator has asked the user for more information. |
| `resolved` | The administrator has published a resolution. |
| `closed` | Handling has ended with an explanation, for example a duplicate or a declined suggestion. |

A transition to `waiting_user`, `resolved` or `closed` requires a public reply. The last reply when resolved or closed becomes the current result. A later user supplement resumes handling (`processing`, or still `open` for an unhandled report) and clears the current result. Previous replies and results remain in the timeline. Reopening from the administration side also keeps all records.

Administrators can take ownership themselves or release ownership. A public reply and a private note can be recorded together. A status change, ownership change, nonempty message or linked operation is required; submitting an unchanged form is rejected. Every administrator write requires a 2–500 character operation reason and `user_manage`; read access retains `user_view`. Private records are visible to authorized administrators.

## Workbench search and links

The queue supports personal pending reports (`todo=mine`, using the authenticated administrator), unassigned reports (`unassigned`), all reports awaiting a reply (`reply`), and reports awaiting a reply after a user supplement (`supplement`). These queues cover `open` and `processing`; reports awaiting the user are excluded. Combine them with status, category, case-insensitive literal email substring, user ID and minimum waiting hours (1–8,760). Pending replies appear oldest first. Waiting starts at the latest user message, or the original submission when there is no supplement; internal notes and ownership changes do not reset it.

The three metrics cover all retained reports, independently of list filters: average time from submission to the first public administrator message (responded reports only), the longest current wait for a reply, and the number of distinct reports ever reopened from `resolved` or `closed`. Empty duration samples display “暂无记录”. No new response target is set by these metrics.

Users may attach their current profile and enter a result or task ID. The server verifies ownership, resolves the matching profile, and rejects mismatched or ambiguous references. Feedback details link to user details, the selected profile and related tasks according to the administrator's capabilities. User details link back to that user's feedback and tasks. Profile links load the page containing that profile; task links query the related history rather than only filtering the global recent list.

After completing an account/profile operation or item grant, administrators can select one of the user's 50 most recent operations when saving follow-up. The server verifies the operation's owner and saves its source, ID, action, reason and timestamp as a private timeline snapshot in the same transaction. User-facing replies still explain the outcome separately. The combined user timeline is deferred; this version provides links.

Public support, pricing and footer contact entries use website feedback. `/support` remains the help address; submission links open the feedback dialog for signed-in users and lead guests to login before submission. QQ group configuration remains available for community use.

## Storage and privacy

Migration **2026-10-13.1** adds status, revision, ownership, result and update times to `user_feedback`, with ordered append-only follow-up rows in `user_feedback_entries`. Existing submissions, screenshots and timestamps are preserved. Migration **2026-10-16.1** adds `context_json` to reports and private `related_operation` snapshots to timeline entries. The historical migration ledger is retained.

User list, detail, screenshots and supplements are scoped to the authenticated account. User responses omit email, account ID, ownership, administrator identity, operation reasons and private notes. Ownership-only and private-note-only entries are omitted from the user's timeline and do not change its public update time or create notifications. The revision is an opaque concurrency token and includes private changes.

The personal data export includes public follow-up records, attached context and the current result. Linked operations and candidate operation lists are private and are omitted from user reads and exports. Deleting an account cascades through feedback, screenshots, entries and notifications; the existing administrator operation audit retention remains independent. Follow-ups support plain text up to 2,000 characters; the original optional screenshot keeps its existing limits. Creating a report and supplementing it share the persistent account rate limit of 10 attempts per hour.

## Consistency

A row lock checks `expected_revision` and rejects stale writes with `409`. Each mutation carries a UUID `request_key`; an identical retry returns success without another timeline entry, audit record or notification. Reusing a key for changed content returns `409`. The browser retains the key after an uncertain network failure and generates another only when the requested action changes. Refreshing the revision keeps the same key; an already completed request remains a successful replay after that refresh.

Updating the feedback, appending the entry, recording the administrator audit and notifying the user use one transaction. Invalid results or failed audit/notification writes roll everything back. Notification timestamps use millisecond precision to match the existing read-version contract. A public administrator update refreshes one notification per report and resets it to unread; internal follow-up leaves it alone.

Failed saves preserve the reply, private note, status and reason. Refresh replaces the record version explicitly, and a retry uses that version. Aborted or delayed responses cannot overwrite another selected report. The user dialog cannot close while a supplement is being saved. Timeline reads return 25 entries with a `before_revision` cursor for older records; no records are silently dropped.

## API

- `GET /api/user/feedback?page=1&page_size=25`: own reports; page sizes 25, 50 and 100.
- `GET /api/admin/feedback?status=open&page=1&page_size=25`: administrative queue; omit status for all reports.
- Either endpoint with `feedback_id=<uuid>`: report and recent timeline. Add `before_revision=<positive integer>` for an older page.
- Either endpoint with `image_id=<uuid>`: authenticated screenshot.
- User `POST`: `category`, `message`, optional `image` and optional `context` (`profile_id`, `result_id`, `job_id`).
- User `PATCH`: `feedback_id`, `expected_revision`, `request_key`, `message`.
- Admin `PATCH`: the same fields plus `status`, `internal_note`, `assignment` (`keep`, `mine`, `unassigned`), `reason` and optional `related_operation` (`source`: `admin` or `inventory`, `id`: UUID).
- Admin list filters: `todo`, `category`, `email`, `min_wait_hours`, `user_id`, `status`. Filter fields cannot be combined with a detail or image read and are rejected on user history. List responses include `metrics`; detail responses include private `recent_operations`.

All feedback responses use `Cache-Control: no-store`. User writes cannot set administrator fields. The existing same-origin, JSON validation and request-size boundaries also apply to the new methods.

## Verification

Targeted handler, dialog, notification, administrative workflow and asynchronous request tests cover authorization, private/public boundaries, preserved drafts, revision conflicts and retry keys. PostgreSQL integration covers actual row locks, transaction rollback, result requirements, repeated submissions, notification read versions, complete timeline pagination and account deletion. Browser checks use synthetic feedback to inspect light/dark rendering and 320, 375, 414, 768, 1280, 1440 and 1920px layouts; synthetic content is not production feedback.

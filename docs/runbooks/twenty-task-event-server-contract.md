# Twenty Task-Event Server Contract Smoke

This runbook verifies THNK-33 `server_contract_verified` only.

It does not verify `native_producer_verified`. The native Twenty application,
Twenty logic-function producer, embedded component, plugin catalog manifest, and
plugin installer path remain blocked follow-up work.

## Prerequisites

- A deployed ThinkWork stage.
- A tenant UUID.
- A Space Thread in that tenant with a non-null `space_id`.
- Database access for setup/inspection.
- A task-event signing secret in Secrets Manager:

```sh
scripts/smoke/webhook-secret-put.sh <tenant-id> task-event
```

The `task-event` route requires `x-thinkwork-timestamp` freshness and signs
`<timestamp>.<raw-json-body>`. `scripts/smoke/webhook-smoke.sh` does this
automatically for `--integration task-event`.

## Seed a Linked Twenty Task

Pick a thread that belongs to a Space:

```sql
SELECT id, tenant_id, space_id, title
FROM threads
WHERE tenant_id = '<tenant-id>'
  AND space_id IS NOT NULL
ORDER BY created_at DESC
LIMIT 10;
```

Seed the linked Twenty task used by the smoke fixtures:

```sql
INSERT INTO linked_tasks (
  tenant_id,
  space_id,
  thread_id,
  provider,
  external_task_id,
  external_task_url,
  title,
  required,
  status,
  sync_status,
  metadata
) VALUES (
  '<tenant-id>',
  '<space-id>',
  '<thread-id>',
  'twenty',
  'twenty-smoke-task-0001',
  'https://twenty.example/tasks/twenty-smoke-task-0001',
  'Review security addendum',
  true,
  'todo',
  'synced',
  '{"smoke":"THNK-33 server_contract_verified"}'::jsonb
)
ON CONFLICT (tenant_id, provider, external_task_id) DO UPDATE SET
  thread_id = EXCLUDED.thread_id,
  space_id = EXCLUDED.space_id,
  title = EXCLUDED.title,
  status = 'todo',
  sync_status = 'synced',
  updated_at = now();
```

## Valid Status Event

```sh
scripts/smoke/webhook-smoke.sh \
  --tenant-id <tenant-id> \
  --integration task-event \
  --payload scripts/smoke/fixtures/task-event-status-changed.json
```

Expected response: HTTP 200 with `linkedTaskId`, `threadId`, `status`,
`syncStatus`, `eventType`, and `milestonePosted`.

Inspect:

```sql
SELECT provider, external_task_id, status, sync_status, metadata
FROM linked_tasks
WHERE tenant_id = '<tenant-id>'
  AND provider = 'twenty'
  AND external_task_id = 'twenty-smoke-task-0001';

SELECT provider, event_type, external_event_id, message, metadata, occurred_at
FROM linked_task_events
WHERE tenant_id = '<tenant-id>'
  AND provider = 'twenty'
ORDER BY created_at DESC
LIMIT 10;

SELECT provider_name, provider_event_id, external_task_id, normalized_kind,
       signature_status, resolution_status, status_code, body_preview,
       body_sha256, error_message
FROM webhook_deliveries
WHERE tenant_id = '<tenant-id>'
  AND provider_name = 'twenty'
ORDER BY received_at DESC
LIMIT 10;
```

The delivery row should have `signature_status = 'verified'`,
`resolution_status = 'ok'`, a `body_sha256`, and no raw `body_preview`.

## Valid Comment Event

```sh
scripts/smoke/webhook-smoke.sh \
  --tenant-id <tenant-id> \
  --integration task-event \
  --payload scripts/smoke/fixtures/task-event-comment-added.json
```

Expected: HTTP 200, one `linked_task_events.comment_added` row, one bounded
system message on the thread, and one delivery diagnostic row.

## Duplicate Replay

Run the comment command above a second time.

Expected: HTTP 200 with `milestonePosted: false`. There should still be only
one `linked_task_events` row for `external_event_id =
'twenty-smoke-comment-0001'` and no second thread milestone.

```sql
SELECT count(*)
FROM linked_task_events
WHERE tenant_id = '<tenant-id>'
  AND provider = 'twenty'
  AND external_event_id = 'twenty-smoke-comment-0001';
```

## Unknown Task Diagnostic

```sh
scripts/smoke/webhook-smoke.sh \
  --tenant-id <tenant-id> \
  --integration task-event \
  --payload scripts/smoke/fixtures/task-event-status-unknown.json
```

Expected: HTTP 200 with `skipped: true`. No thread message and no wakeup should
be created. `webhook_deliveries` should record `resolution_status = 'ignored'`
with `external_task_id = 'twenty-smoke-missing-task'`.

## Stale Timestamp Rejection

```sh
scripts/smoke/webhook-smoke.sh \
  --tenant-id <tenant-id> \
  --integration task-event \
  --payload scripts/smoke/fixtures/task-event-comment-added.json \
  --timestamp "$(($(date +%s) - 600))"
```

Expected: HTTP 401. The diagnostic row should have
`signature_status = 'invalid'`, `resolution_status = 'unverified'`, and no raw
request body.

## Invalid Signature Rejection

```sh
scripts/smoke/webhook-smoke.sh \
  --tenant-id <tenant-id> \
  --integration task-event \
  --payload scripts/smoke/fixtures/task-event-comment-added.json \
  --secret wrong-secret
```

Expected: HTTP 401 with no tenant-specific response details. The diagnostic row
should have `signature_status = 'invalid'` and `resolution_status =
'unverified'`.

## Retention

`webhook_deliveries` is PII-bearing because it contains provider/task metadata.
The table intentionally does not store raw bodies for this path. Rows are
bounded by the existing `webhook-deliveries-cleanup` Lambda, which deletes rows
older than 90 days.

## Proof Result

If the valid, duplicate, unknown-task, stale-timestamp, and invalid-signature
paths match the expectations above, record this on THNK-33 as:

```yaml
server_contract_verified: true
native_producer_verified: false
native_producer_status: blocked
```

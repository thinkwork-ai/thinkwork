---
title: Slack Operations Runbook
description: "Operating the Slack workspace app: signed ingress, source-event idempotency, and exactly-once finalized thread-reply delivery."
---

This runbook covers the ThinkWork Slack workspace app from signed ingress through outbound response delivery.

The shipped surfaces are `app_mention` and bot direct messages on `POST /slack/events`, plus workspace OAuth install on `/slack/oauth/install`. Final responses are posted by the turn finalizer through `packages/api/src/lib/slack/thread-reply.ts` — there is no separate dispatch Lambda or queue.

## Metrics

Slack emits CloudWatch Embedded Metric Format records in the `ThinkWork/Slack` namespace.

| Metric                      | Dimensions    | Meaning                                                                                              |
| --------------------------- | ------------- | ---------------------------------------------------------------------------------------------------- |
| `slack.events.ingest_ms`    | `handler`     | Time spent handling a signed Slack request. Watch p95 against Slack's 3-second ack limit.            |
| `slack.events.dedupe_hits`  | `surface`     | Duplicate Slack delivery was absorbed by the message source-event constraint. Normal during retries. |
| `slack.events.unknown_team` | `handler`     | Slack sent a request for a workspace that is not actively installed.                                 |
| `slack.dispatch.success`    | `surface`     | An accepted event was persisted and dispatched to the platform agent.                                |
| `slack.dispatch.failure`    | `error_class` | Persistence or agent dispatch failed for an accepted event.                                          |

## Delivery ledger

Each Slack-delivered assistant message carries a `metadata.slackDelivery` object on its `messages` row:

- `status`: `sending` (claimed), `succeeded`, or `failed`
- `claimedAt`: claim timestamp; a stale `sending` claim is recoverable by a later retry
- `deliveredAt`, `providerMessageTs`: success evidence
- `error`: last failure reason (`missing_thread_mapping`, `workspace_unavailable`, Slack API error, or `transport_error`)

Delivery is origin-gated (only turns triggered by a Slack-originated message post externally) and exactly-once per assistant message. A delivery failure never rolls back the assistant message or fails the turn.

## Common procedures

### Ingest latency near 3 seconds

**Signal:** `slack.events.ingest_ms` p95 approaches 3000ms or Slack retries increase.

1. Review recent cold starts, Lambda duration, and Secrets Manager latency.
2. Confirm the events handler is only verifying, resolving, persisting, and creating the durable wakeup — never waiting on agent execution.
3. If retries already occurred, verify `slack.events.dedupe_hits` increased instead of duplicate messages/turns appearing.

### Duplicate Slack deliveries

**Signal:** `slack.events.dedupe_hits` increases.

Duplicates are expected during Slack retries. The tenant-scoped unique index on `messages.source_event_id` guarantees one message and one turn per Slack `event_id`. Investigate only if a duplicate ThinkWork message or turn actually exists — that would indicate the constraint was bypassed.

### Final reply missing in Slack

**Signal:** The agent turn completed in ThinkWork but no response appeared in the Slack thread.

1. Find the assistant message for the turn and inspect `metadata.slackDelivery`.
2. `status=failed` with `error=missing_thread_mapping` — the Slack thread mapping row is missing; check `slack_threads` for the channel/thread.
3. `status=failed` with `error=workspace_unavailable` — the workspace row is inactive or the bot token secret is unavailable; check `slack_workspaces.status`.
4. Slack API errors (`channel_not_found`, `token_revoked`, …) or `transport_error` — delivery is retryable; reprocessing the turn's finalization redrives it without double-posting.
5. No `slackDelivery` at all — the turn was not Slack-originated (origin gate) or finalization never ran; check the thread's triggering message provenance first.

### Bot token revoked or workspace uninstalled

**Signal:** delivery failures with Slack Web API errors such as `not_authed`, `invalid_auth`, `token_revoked`, or `account_inactive`.

1. Check the `slack_workspaces` row status for the team id in the thread mapping.
2. If the workspace was uninstalled in Slack, treat it as revoked and ask a tenant admin to reinstall from ThinkWork admin.
3. Ask affected users to re-link only if their `slack_user_links` row is missing or stale; a workspace reinstall alone does not require per-user relinking.
4. Do not manually mutate production secrets. Token recovery flows through the normal OAuth install path.

### `/thinkwork` shows `dispatch_failed` / interactivity delivery warnings

**Signal:** A user reports the `/thinkwork` slash command failing with Slack's `dispatch_failed` banner, or the Slack app dashboard shows failed interactivity deliveries.

The slash-command and interactivity endpoints were removed (THINK-84 U3) — API Gateway returns 404 for them. This is expected; the fix is Slack-side configuration, not a ThinkWork incident:

1. In the Slack app configuration, delete the `/thinkwork` slash command registration.
2. Disable Interactivity (or clear its request URL).
3. Confirm event subscriptions match the integration page: `app_mention`, `message.im`, `message.channels` (+ `message.groups` for private channels).

Existing installs also retain previously granted scopes (`commands`, `chat:write.customize`, `users:read.email`, metadata reads) until the workspace is reinstalled; reinstall through ThinkWork admin to converge on the minimum scope set.

### Unknown Slack team

**Signal:** `slack.events.unknown_team` increases.

1. Confirm whether the Slack team id belongs to a previously installed workspace.
2. If the workspace is no longer active, this is likely a stale Slack retry or an uninstall race. No action needed unless it persists.
3. If the workspace should be active, verify the `slack_workspaces` row status is `active` and the install completed.

## Useful queries

Find recent failed Slack deliveries:

```sql
select id, thread_id, created_at,
       metadata #>> '{slackDelivery,status}'  as delivery_status,
       metadata #>> '{slackDelivery,error}'   as delivery_error
from messages
where metadata #>> '{slackDelivery,status}' = 'failed'
order by created_at desc
limit 25;
```

Find stale delivery claims (crashed mid-send; recoverable by finalize retry):

```sql
select id, thread_id,
       metadata #>> '{slackDelivery,claimedAt}' as claimed_at
from messages
where metadata #>> '{slackDelivery,status}' = 'sending'
  and (metadata #>> '{slackDelivery,claimedAt}')::timestamptz < now() - interval '10 minutes'
order by claimed_at asc
limit 25;
```

Find Slack-originated inbound messages by event id:

```sql
select id, thread_id, source_event_id, created_at
from messages
where source_event_id like 'slack:%'
order by created_at desc
limit 25;
```

## Recovery boundaries

- Do not manually invoke production Slack callbacks with forged payloads.
- Do not edit Slack bot tokens directly in Secrets Manager as a recovery path; reinstall through OAuth.
- Do not hand-edit `metadata.slackDelivery` to force a resend; reprocess the turn's finalization instead — the claim ledger makes that safe.
- Do not manually post final user answers from operator accounts unless the customer explicitly asks for a one-off status note.

## Related code

- Slack ingress handlers: `packages/api/src/handlers/slack/`
- Transport boundary (pinned Chat SDK primitives): `packages/api/src/lib/slack/provider.ts`
- Final reply delivery: `packages/api/src/lib/slack/thread-reply.ts`
- Finalizer integration: `packages/api/src/lib/chat-finalize/process-finalize.ts`
- Slack metrics helper: `packages/api/src/lib/slack/metrics.ts`
- Slack envelope: `packages/api/src/lib/slack/envelope.ts`

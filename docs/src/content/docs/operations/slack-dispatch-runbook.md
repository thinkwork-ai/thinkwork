---
title: Slack Dispatch Runbook
description: "How to operate Slack Computer responses, attribution degradation, revoked tokens, unknown teams, and dispatch failures."
---

This runbook covers the ThinkWork Slack workspace app from signed ingress through outbound response delivery. Use it when Slack users report missing answers, duplicated answers, degraded attribution, or install/linking problems.

## Metrics

Slack emits CloudWatch Embedded Metric Format records in the `ThinkWork/Slack` namespace.

| Metric                       | Dimensions    | Meaning                                                                                               |
| ---------------------------- | ------------- | ----------------------------------------------------------------------------------------------------- |
| `slack.events.ingest_ms`     | `handler`     | Time spent handling a signed Slack request. Watch for p95 approaching Slack's 3-second ack limit.     |
| `slack.events.dedupe_hits`   | `surface`     | Duplicate Slack delivery was accepted but not re-enqueued. Some hits are normal during Slack retries. |
| `slack.events.unknown_team`  | `handler`     | Slack sent a request for a workspace that is not actively installed.                                  |
| `slack.dispatch.success`     | `surface`     | A completed Computer response was delivered to Slack.                                                 |
| `slack.dispatch.failure`     | `error_class` | The dispatcher gave up and marked the task failed.                                                    |
| `slack.attribution.degraded` | none          | Slack rejected customized username/avatar attribution and ThinkWork retried with bot identity.        |

## Common procedures

### Attribution degradation alarm

**Signal:** `slack.attribution.degraded` is non-zero or Slack messages render as the ThinkWork bot with a body prefix.

1. Confirm the dispatcher still posted the response. `slack.dispatch.success` should increase for the same window.
2. Check Slack app installed scopes in the affected workspace. Missing or rejected `chat:write.customize` is the expected cause.
3. If the customer intentionally removed the scope, no incident is required. The fallback is by design: bot identity, shared Computer body prefix when needed, and attribution footer.
4. If the scope should be present, ask the workspace admin to reinstall or reauthorize the Slack app with optional identity customization enabled.
5. Watch the metric after reinstall. It should return to zero for new messages.

### Bot token revoked or workspace uninstalled

**Signal:** `slack.dispatch.failure{error_class="bot_token"}` or Slack Web API errors such as `not_authed`, `invalid_auth`, `token_revoked`, or `account_inactive`.

1. Find the affected task in `computer_events` by `slack.dispatch_failed` and inspect `payload.error`.
2. Resolve the Slack team id from the task envelope (`computer_tasks.input.slack.slackTeamId`).
3. In admin, check the Slack workspace status. If the workspace was uninstalled in Slack, mark or treat it as revoked.
4. Ask a tenant admin to reinstall the app from ThinkWork admin.
5. Ask affected users to re-link only if their `slack_user_links` row is missing or stale. A workspace reinstall alone does not always require per-user relinking.
6. Do not manually mutate production secrets. Token recovery flows through the normal OAuth install path.

### Unknown Slack team

**Signal:** `slack.events.unknown_team` increases.

1. Confirm whether the Slack team id belongs to a previously installed workspace.
2. If the workspace is no longer active, this is likely a stale Slack retry or an uninstall race. No action is needed unless it persists.
3. If the workspace should be active, verify the `slack_workspaces` row status is `active` and the Slack app install completed successfully.
4. If the row is missing, ask the tenant admin to install the app again from admin.

### Ingest latency near 3 seconds

**Signal:** `slack.events.ingest_ms` p95 approaches 3000ms or Slack retries increase.

1. Check which handler dimension is slow: `events`, `slash-command`, or `interactivity`.
2. For `interactivity`, prioritize modal-open latency. Message shortcut `trigger_id` values expire quickly.
3. Review recent cold starts, Lambda duration, and Secrets Manager latency.
4. Confirm the handlers are not waiting on Computer completion. They should only verify, resolve, enqueue, and ack.
5. If retries already occurred, dedupe should prevent duplicate Computer work. Verify `slack.events.dedupe_hits` increased instead of duplicate `computer_tasks`.

### Slash command response missing

**Signal:** `/thinkwork` acked, but no ephemeral response appeared.

1. Check `computer_tasks` for a `source=slack` task with `triggerSurface=slash_command`.
2. If the task completed, check `slack.dispatch_failed` for `response_url` errors.
3. If the Computer turn exceeded Slack's `response_url` usability window or follow-up limits, use the source task/thread to post an operator note and investigate runtime latency.
4. If dispatch succeeded, ask the user to check ephemeral visibility in the original channel; ephemeral responses are visible only to the invoking user.

### Message shortcut modal did not update

**Signal:** The working modal opened but stayed stale, or the answer posted without modal confirmation.

1. Check the task envelope for `modalViewId`.
2. Check `slack.dispatch_failed` for `views.update` failures.
3. If the response was still posted in-thread, treat the modal update as a degraded delivery rather than lost work.
4. If both modal update and thread post failed, follow the dispatch failure path.

## Useful queries

Find recent Slack dispatch failures:

```sql
select created_at, tenant_id, computer_id, task_id, payload
from computer_events
where event_type = 'slack.dispatch_failed'
order by created_at desc
limit 25;
```

Find attribution degradation by workspace/team:

```sql
select e.created_at, t.input->'slack'->>'slackTeamId' as slack_team_id, e.payload
from computer_events e
join computer_tasks t on t.id = e.task_id
where e.event_type = 'slack.attribution_degraded'
order by e.created_at desc
limit 25;
```

Find pending completed Slack tasks that have not been dispatched:

```sql
select t.id, t.tenant_id, t.computer_id, t.status, t.updated_at, t.input->'slack' as slack
from computer_tasks t
where t.input->>'source' = 'slack'
  and t.status = 'completed'
  and not exists (
    select 1
    from computer_events e
    where e.task_id = t.id
      and e.event_type in ('slack.dispatch_completed', 'slack.dispatch_failed')
  )
order by t.updated_at asc
limit 25;
```

## Recovery boundaries

- Do not manually invoke production Slack callbacks with forged payloads.
- Do not edit Slack bot tokens directly in Secrets Manager as a recovery path; reinstall through OAuth.
- Do not manually post final user answers from operator accounts unless the customer explicitly asks for a one-off status note.
- Do not delete `computer_events` or `computer_tasks` rows to "retry" a dispatch. Create code or operational fixes, then let the scheduler drain eligible tasks.

## Related code

- Slack ingress handlers: `packages/api/src/handlers/slack/`
- Slack metrics helper: `packages/api/src/lib/slack/metrics.ts`
- Dispatch Lambda: `packages/lambda/slack-dispatch.ts`
- Slack task envelope: `packages/api/src/lib/slack/envelope.ts`
- Slack data disclosure: [Slack data handling](/compliance/slack-data-handling/)

# Computer-First Linear Connector Checkpoint

This runbook verifies the first honest connector checkpoint: one fresh Linear issue with the `symphony` label is picked up by the Linear connector, recorded as a terminal connector execution, handed to a Computer as a `connector_work` task/event, and surfaced as a Computer-owned connector thread.

## Scope

This proof is Linear-only. It does not prove Slack, GitHub, Google Workspace, automatic actor matching, signed provider callbacks, spend enforcement, or the full Computer runtime delegation loop. Direct Agent, routine, and hybrid connector targets still exist as advanced/admin paths, but the checkpoint path should use a Computer target.

## Entry Criteria

- The deployed stack includes the connector dispatch target, Computer handoff runtime, and Computer-first Symphony form changes.
- The tenant has an active Computer for the user who should own the work.
- The tenant has an active Linear credential, usually the `linear` credential slug.
- The Symphony connector is active, enabled, type `linear_tracker`, and targets a Computer.
- The connector config filters on the `symphony` Linear label. Do not use `symphony-eligible` for this proof.
- The deployed connector poller schedule is enabled. For dev:

```bash
aws scheduler get-schedule \
  --region us-east-1 \
  --group-name default \
  --name thinkwork-dev-connector-poller
```

- Any old Symphony process or temporary dev-only poller that also watches the tenant is stopped.
- The Linear issue used for the proof is fresh and has not previously been seen by this connector.

## Configure The Connector

In Admin, open **Symphony** and create or edit the Linear connector:

1. Set **Type** to `linear_tracker`.
2. Set **Target Type** to **Computer**.
3. Select the target Computer.
4. Use the Linear starter config and confirm it includes the `symphony` label and the expected Linear credential.
5. Keep the connector enabled.

The important shape is:

```json
{
  "credentialSlug": "linear",
  "issueQuery": {
    "labels": ["symphony"]
  }
}
```

Other config fields can narrow the team, project, or issue count, but the checkpoint label must be `symphony`.

## Run The Proof

1. Create a new Linear issue with a unique title.
2. Add only the `symphony` label for the connector proof.
3. Wait for the scheduled connector poller. The dev schedule currently runs once per minute; allow at least two schedule windows before declaring failure.
4. Do not manually invoke the poller Lambda for the checkpoint path. Manual invocation and **Run now** are debugging fallbacks after the unattended path fails.
5. Leave the issue open until the first pickup path has been verified.

## Verify In Admin

Use the Symphony page first:

1. On the **Connectors** tab, confirm the connector is active and targets a Computer.
2. On the **Runs** tab, find the new execution for the Linear issue identifier.
3. Confirm the execution is terminal and includes a thread link plus Computer handoff details.

Then verify the Computer-owned side:

1. Open the target Computer detail page.
2. Confirm a `connector_work` task exists for the Linear issue.
3. Confirm a `connector_work_received` event exists for the same task.
4. Open Threads and confirm there is a connector thread assigned to the Computer.
5. Confirm the first connector message contains the Linear issue body.

## Optional SQL Checks

Use these checks when the UI is unclear. Replace the placeholders with the deployed tenant, connector, Computer, or Linear issue values.

```sql
select
  id,
  last_poll_at,
  next_poll_at,
  status,
  enabled,
  config -> 'issueQuery' -> 'labels' as labels,
  updated_at
from connectors
where id = '<connector uuid>';
```

```sql
select
  id,
  external_ref,
  current_state,
  outcome_payload ->> 'computerId' as computer_id,
  outcome_payload ->> 'computerTaskId' as computer_task_id,
  outcome_payload ->> 'threadId' as thread_id,
  finished_at
from connector_executions
where connector_id = '<connector uuid>'
  and external_ref = '<linear issue identifier>'
order by created_at desc;
```

```sql
select
  id,
  task_type,
  status,
  idempotency_key,
  input ->> 'externalRef' as external_ref,
  created_at
from computer_tasks
where tenant_id = '<tenant uuid>'
  and computer_id = '<computer uuid>'
  and task_type = 'connector_work'
order by created_at desc
limit 10;
```

```sql
select
  id,
  event_type,
  task_id,
  payload ->> 'externalRef' as external_ref,
  created_at
from computer_events
where tenant_id = '<tenant uuid>'
  and computer_id = '<computer uuid>'
  and event_type = 'connector_work_received'
order by created_at desc
limit 10;
```

```sql
select
  id,
  identifier,
  title,
  assignee_type,
  assignee_id,
  created_by_type,
  metadata ->> 'connectorExecutionId' as connector_execution_id,
  metadata ->> 'computerTaskId' as computer_task_id,
  created_at
from threads
where tenant_id = '<tenant uuid>'
  and channel = 'connector'
  and assignee_type = 'computer'
order by created_at desc
limit 10;
```

## Duplicate Check

After the first pickup succeeds, trigger the same connector again without changing the Linear issue. The expected result is no second Computer task, no second Computer event, and no second connector thread for the same external reference. A duplicate run may report that the candidate was already claimed; it should not notify repeatedly or create more visible work.

For the checkpoint, pass means:

- one connector execution for the fresh Linear issue reaches `terminal`
- one Computer task exists for that external reference
- one `connector_work_received` event exists for that task
- one Computer-owned connector thread exists for that external reference

## Failure Signals

| Symptom                                           | Likely check                                                                                                                                                      |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No execution appears after two scheduler windows  | Connector is disabled, `next_poll_at` is still in the future, wrong credential, wrong Linear team/project filter, or the issue does not have the `symphony` label |
| Execution fails before handoff                    | Linear credential or poller runtime failed; inspect connector run details and Lambda logs                                                                         |
| Execution is terminal but no Computer task exists | Handoff runtime is not deployed or the connector target is not a valid Computer                                                                                   |
| Thread is assigned to an Agent                    | Connector is still using an advanced Agent target instead of a Computer target                                                                                    |
| Repeated Linear pickup notifications              | Duplicate/idempotency behavior regressed, or another Symphony process is watching the same issue                                                                  |
| UI still shows old issue label                    | The connector config still filters on `symphony-eligible`; update it to `symphony`                                                                                |

## Exit Criteria

The checkpoint is complete when one fresh Linear issue labeled `symphony` produces exactly one terminal connector execution, one Computer task/event handoff, one Computer-owned connector thread, one completed delegation, one succeeded thread turn, and one Symphony Runs lifecycle row without manual Lambda invocation. The connector row should also show a recent `last_poll_at` and future `next_poll_at`. Treat that as proof of the Linear connector path only; the broader connector-platform roadmap remains active follow-on work.

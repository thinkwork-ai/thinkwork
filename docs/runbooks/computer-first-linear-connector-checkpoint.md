# Computer-First Linear Connector Checkpoint

This runbook verifies the first honest connector checkpoint: one fresh Linear issue with the `symphony` label is picked up by the Linear connector, recorded as a terminal connector execution, handed to a Computer as a `connector_work` task/event, surfaced as a Computer-owned connector thread, and completed with a branch, draft PR, Linear comments, and `In Review` writeback.

For the normal operator walkthrough, start with the docs guide: `docs/src/content/docs/guides/symphony-linear-checkpoint.mdx`. This runbook keeps the lower-level scheduler checks, optional SQL, stale cleanup path, and failure table.

## Scope

This proof is Linear-only. It does not prove Slack, GitHub, Google Workspace, automatic actor matching, signed provider callbacks, spend enforcement, or the full Computer runtime delegation loop. Direct Agent, routine, and hybrid connector targets still exist as advanced/admin paths, but the checkpoint path should use a Computer target.

## Entry Criteria

- The deployed stack includes the connector dispatch target, Computer handoff runtime, and Computer-first Symphony form changes.
- The tenant has an active Computer for the user who should own the work.
- The tenant has an active Linear credential, usually the `linear` credential slug.
- The tenant has an active GitHub credential with write access to the checkpoint repo, usually the `github` credential slug.
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
4. Confirm **Linear team key**, **Label**, **Credential**, and **Writeback state** in the structured Linear fields. The checkpoint label must be `symphony`.
5. In **GitHub PR setup**, select an active GitHub credential and confirm the repo owner, repo name, base branch, and checkpoint file path.
6. Keep the connector enabled.

If the Connectors table shows **GitHub setup required**, the selected GitHub credential slug is not active for the tenant. Create or reactivate that credential under **Automations > Credentials**, then return to Symphony and save the connector again. Do not rely on Advanced JSON to hide this state; the structured GitHub fields are the operator source of truth.

The important shape is:

```json
{
  "credentialSlug": "linear",
  "issueQuery": {
    "labels": ["symphony"]
  },
  "github": {
    "credentialSlug": "github",
    "owner": "thinkwork-ai",
    "repoName": "thinkwork",
    "baseBranch": "main",
    "filePath": "README.md"
  },
  "writeback": {
    "moveOnDispatch": {
      "enabled": true,
      "stateName": "In Progress"
    },
    "moveOnPrOpened": {
      "enabled": true,
      "stateName": "In Review"
    }
  }
}
```

Other config fields can narrow the team, project, or issue count, but the checkpoint label must be `symphony`.

## Run The Proof

1. Create a new Linear issue with a unique title.
2. Add only the `symphony` label for the connector proof.
3. Wait for the scheduled connector poller. The dev schedule currently runs once per minute; allow at least two schedule windows before declaring failure.
4. Do not manually invoke the poller Lambda for the checkpoint path. Manual invocation and **Run now** are debugging fallbacks after the unattended path fails.
5. Confirm Linear moves the issue to **In Progress** after Thinkwork claims it.
6. Confirm Linear receives one "Symphony agent is now working..." comment with the branch name.
7. Wait for the connector work harness to open a draft PR.
8. Confirm Linear receives one "Symphony agent opened a draft PR..." comment and moves to **In Review** only after the PR exists.
9. Leave the issue open until the first pickup path has been verified.

## Verify In Admin

Use the Symphony page first:

1. On the **Connectors** tab, confirm the connector is active and targets a Computer.
2. On the **Runs** tab, find the new execution for the Linear issue identifier.
3. Confirm the execution is terminal and includes a thread link plus Computer handoff details.
4. Confirm the lifecycle chips show a completed `connector_work` task, completed delegation, and succeeded thread turn.
5. Confirm the Writeback column says `Linear: In Review`.
6. Confirm the PR column links to the draft pull request.
7. Confirm the row stays single-line with no horizontal scroll in the table.

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

After the first pickup succeeds, trigger the same connector again without changing the Linear issue. The expected result is no second Computer task, no second Computer event, no second connector thread, no duplicate branch, no duplicate draft PR, and no duplicate Linear comments for the same external reference. A duplicate run may report that the candidate was already claimed; it should not notify repeatedly or create more visible work.

For the checkpoint, pass means:

- one connector execution for the fresh Linear issue reaches `terminal`
- one Computer task exists for that external reference
- one `connector_work_received` event exists for that task
- one Computer-owned connector thread exists for that external reference
- one completed delegation exists with branch, commit SHA, PR URL, and thread-turn metadata
- one succeeded lifecycle thread turn exists for the PR-producing harness
- one draft PR exists for the deterministic branch
- the Linear issue has moved to `In Review` with one dispatch comment and one PR-opened comment

## Stale Historical Rows

Older Symphony proof attempts from before the Computer delegation and Linear writeback fixes may show as stale `dispatching`, pending, or running lifecycle rows. Treat fresh rows as the source of truth; do not manually repair fresh successful checkpoints.

If historical rows make the Runs tab noisy, use the cleanup script. It is dry-run by default and only applies when you pass `--apply`.

Prefer scoping to the tenant or connector:

```bash
pnpm -C packages/api exec tsx scripts/cleanup-stale-connector-runs.ts \
  --tenant '<tenant uuid>' \
  --older-than-hours 4
```

Review the candidate list. If it only contains stale historical proof rows, apply it:

```bash
pnpm -C packages/api exec tsx scripts/cleanup-stale-connector-runs.ts \
  --tenant '<tenant uuid>' \
  --older-than-hours 4 \
  --apply
```

The script only targets Computer-bound connector rows. It marks matching stale connector executions as `cancelled`, adds cleanup metadata to `outcome_payload`, and cancels linked non-terminal Computer tasks, delegations, or thread turns when those ids are present. Symphony Runs hides cancelled connector executions by default; toggle **Show cancelled** to inspect them. Cleaned rows should show a compact cleanup reason instead of looking like active work.

`--external-ref-prefix` is available when the raw connector `external_ref` values share a known prefix. Linear issue keys such as `TECH-66` are usually stored inside the execution payload and displayed by the UI, while the raw `external_ref` may be the provider UUID, so tenant or connector scope is usually the better filter.

## Failure Signals

| Symptom                                           | Likely check                                                                                                                                                      |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No execution appears after two scheduler windows  | Connector is disabled, `next_poll_at` is still in the future, wrong credential, wrong Linear team/project filter, or the issue does not have the `symphony` label |
| Execution fails before handoff                    | Linear credential or poller runtime failed; inspect connector run details and Lambda logs                                                                         |
| Execution is terminal but no Computer task exists | Handoff runtime is not deployed or the connector target is not a valid Computer                                                                                   |
| Thread is assigned to an Agent                    | Connector is still using an advanced Agent target instead of a Computer target                                                                                    |
| Repeated Linear pickup notifications              | Duplicate/idempotency behavior regressed, or another Symphony process is watching the same issue                                                                  |
| Linear card stays in Todo                         | Linear writeback failed, the target workflow lacks an `In Progress` state, or the connector credential lacks issue update permission                              |
| Linear card stays in In Progress                  | Draft PR creation failed, GitHub credential lacks repo write permission, or the target workflow lacks an `In Review` state                                        |
| No PR link appears in Runs                        | Delegation result/output metadata is missing `prUrl`, or the Runs tab is still on an older admin deploy                                                           |
| UI still shows old issue label                    | The connector config still filters on `symphony-eligible`; update it to `symphony`                                                                                |
| Old rows look like live work                      | Run the stale historical cleanup dry-run, then apply only if the candidate list is limited to old proof rows                                                      |

## Exit Criteria

The checkpoint is complete when one fresh Linear issue labeled `symphony` moves to `In Review` and produces exactly one terminal connector execution, one Computer task/event handoff, one Computer-owned connector thread, one completed delegation, one succeeded lifecycle thread turn, one deterministic branch, one draft PR, one dispatch comment, one PR-opened comment, and one Symphony Runs lifecycle row with a PR link without manual Lambda invocation. The connector row should also show a recent `last_poll_at` and future `next_poll_at`. Treat that as proof of the Linear connector path only; the broader connector-platform roadmap remains active follow-on work.

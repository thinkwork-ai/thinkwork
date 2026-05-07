---
title: "feat: Production connector polling cadence"
status: active
created: 2026-05-07
origin: user request, fresh Linear symphony checkpoint
---

# feat: Production connector polling cadence

## Problem Frame

The Linear `symphony` checkpoint now proves the connector handoff chain when the deployed `connector-poller` Lambda is invoked directly: Linear issue, connector execution, Computer task/event, Computer-owned thread, managed-agent delegation, succeeded thread turn, and Symphony Runs lifecycle visibility. The production stack also has an EventBridge Scheduler rule for `thinkwork-<stage>-connector-poller`, but the runtime does not advance connector poll metadata after a tick. Because `next_poll_at` remains null, every scheduled minute re-reads the same Linear window and reports duplicates forever.

This plan makes the deployed polling cadence operationally honest: active/enabled due connectors should be picked up by the scheduled poller without manual Lambda invocation, and after each scheduler tick the connector row should record `last_poll_at` and a bounded future `next_poll_at` so the one-minute platform scheduler can scan cheaply across tenants.

## Scope

- Keep the proof Linear-only.
- Use the existing deployed `connector-poller` Lambda and EventBridge Scheduler resource.
- Update connector runtime behavior so successful or handled connector ticks advance poll metadata.
- Preserve existing idempotency for duplicate Linear candidates.
- Update the checkpoint runbook to verify unattended pickup by waiting for the schedule rather than invoking Lambda.

## Non-Goals

- No new connector types.
- No per-connector EventBridge schedule provisioning.
- No signed callback/HMAC substrate.
- No spend enforcement.
- No UI redesign beyond existing metadata already exposed.
- No change to Computer delegation behavior.

## Requirements Trace

- R1. A fresh Linear issue with only the `symphony` label is picked up by deployed infrastructure without manual Lambda invocation.
- R2. Repeated scheduled polls must not create duplicate connector executions, Computer tasks/events, threads, delegations, thread turns, or Linear notifications.
- R3. Runtime scans should honor `next_poll_at` so connectors are not repeatedly polled every scheduler minute unless explicitly due or force-run.
- R4. Manual `force` runs remain possible and should not be blocked by `next_poll_at`.
- R5. Operators have a documented verification path for the unattended checkpoint.

## Existing Patterns

- `terraform/modules/app/lambda-api/handlers.tf` already provisions `aws_scheduler_schedule.connector_poller` at `rate(1 minutes)`.
- `packages/api/src/handlers/connector-poller.ts` turns scheduler/manual events into `runConnectorDispatchTick` options.
- `packages/api/src/lib/connectors/runtime.ts` already filters by `next_poll_at` in `listDueConnectors` and `isRuntimeEligibleConnector`; it simply never updates the fields.
- `packages/database-pg/src/schema/connectors.ts` already has `last_poll_at`, `last_poll_cursor`, and `next_poll_at`.
- `docs/runbooks/computer-first-linear-connector-checkpoint.md` already describes the Linear proof and duplicate checks.

## Key Decisions

- **Advance connector timestamps inside the runtime store.** The store owns persistence and already abstracts Drizzle operations. Adding a `markConnectorPolled` store method keeps handler code simple and keeps fake-store unit coverage focused.
- **Use a conservative default interval.** Set `next_poll_at` to `now + 60 seconds` by default, matching the deployed scheduler cadence. This avoids repeated same-minute scans while preserving fast checkpoint feedback. A later connector-config PR can introduce per-connector intervals.
- **Advance after each connector is processed, including no-candidate and credential-failure cases.** A bad credential should not retry every minute forever; operators still see failure logs and can manually force-run after fixing config.
- **Do not advance skipped-ineligible connectors.** `listDueConnectors` should normally avoid them; if a force/manual call returns an ineligible row, do not mutate cadence for a connector that was not actually polled.

## Implementation Units

### U1. Runtime Poll Metadata Advancement

**Goal:** Make scheduled ticks advance `last_poll_at` and `next_poll_at` for each active/enabled connector that the runtime actually polls.

**Files:**

- Modify: `packages/api/src/lib/connectors/runtime.ts`
- Modify: `packages/api/src/lib/connectors/runtime.test.ts`

**Implementation Notes:**

- Extend `ConnectorRuntimeStore` with a `markConnectorPolled({ connectorId, now, nextPollAt })` method.
- In `runConnectorDispatchTick`, call `markConnectorPolled` once per eligible connector after candidate loading and candidate dispatch attempts complete, including no-candidate and load-failure outcomes.
- Add a small helper for default next-poll calculation.
- In the Drizzle store, update `connectors.last_poll_at`, `connectors.next_poll_at`, and `connectors.updated_at`.

**Tests:**

- Scheduled tick with dispatch results advances poll metadata once for the connector.
- No-candidate tick advances poll metadata.
- Credential/load failure advances poll metadata.
- Future-`next_poll_at` connector remains skipped and does not advance unless force-run.
- Force-run with future `next_poll_at` still processes and advances metadata from the force-run clock.

### U2. Poller/Scheduler Test Coverage

**Goal:** Lock the deployed scheduler assumptions into focused tests so future changes do not silently break unattended pickup.

**Files:**

- Modify: `packages/api/src/handlers/connector-poller.test.ts`
- Optionally modify: `terraform/modules/app/lambda-api/handlers.tf`

**Implementation Notes:**

- Keep handler defaults as global scheduled scan: no tenant id, no connector id, `force=false`, bounded limit.
- If Terraform needs clearer target input or retry settings after implementation review, keep changes minimal and local to the existing `connector_poller` schedule.

**Tests:**

- Scheduler-default handler invocation remains a non-force global due scan.
- Explicit manual `force` event continues to pass through.

### U3. Operator Runbook Update

**Goal:** Make the checkpoint instructions match the production cadence path.

**Files:**

- Modify: `docs/runbooks/computer-first-linear-connector-checkpoint.md`

**Implementation Notes:**

- Replace ambiguous “wait or run now” proof wording with a dedicated unattended scheduler path.
- Document that manual Lambda invocation is only a debugging fallback, not the checkpoint.
- Add a `last_poll_at` / `next_poll_at` SQL snippet so operators can see cadence state.

**Tests:**

- Documentation review only.

## Rollout and Verification

After merge and deploy:

1. Confirm `aws scheduler get-schedule --name thinkwork-dev-connector-poller --group-name default` is enabled.
2. Create a fresh Linear issue with only the `symphony` label.
3. Do not invoke the Lambda manually.
4. Wait for the scheduled poller window.
5. Verify exactly one terminal connector execution, one completed `connector_work` task, one `connector_work_received` event, one Computer-owned thread, one completed delegation, one succeeded thread turn, and one Symphony Runs lifecycle row.
6. Confirm connector `last_poll_at` moved and `next_poll_at` is in the future after the scheduled tick.

## Risks

- Advancing after credential failure can delay retries after fixing the credential. Mitigation: manual Run now / force path still exists.
- A fixed 60-second interval is not a long-term connector policy. Mitigation: it matches the current scheduler and can be replaced by config-driven intervals later.
- If candidate dispatch is slow for many tenants, one Lambda tick may run close to timeout. Mitigation: existing `limit` stays bounded and defaults to 50 connectors.

# AgentCore Harness cutover and Pi rollback

This runbook controls the transition of the tenant default runtime from Pi to
AgentCore Harness. Pi stays provisioned and selectable throughout the soak and
rollback window. A default-runtime change affects new threads and background
work; it must never reinterpret an existing thread or an answered-question
resume.

## Preconditions

1. Deploy the current `main`, including the web application, API Lambdas,
   AgentCore Gateway target reconciliation, and grouped IAM policies.
   Confirm the Harness runner Errors, Throttles, p95 Duration, and p95
   AsyncEventAge alarms exist and are not in `ALARM`.
2. Confirm Eval Profiles expose a `Runtime` field and create one pinned profile
   for `pi` and one for `agentcore` using the same model/test set.
3. Prove a new Pi thread and a new AgentCore thread both finalize with usage and
   cost rows. Do not use one thread for both runtimes.
4. Run the authoritative retirement command with an exact turn for every
   required surface. `PASS` is the only cutover verdict. `IN_PROGRESS` is not a
   waiver and `FAIL` requires a new clean soak window.

```bash
DATABASE_URL=... HARNESS_CERTIFICATION_CANARIES=... \
  pnpm --filter @thinkwork/api agentcore:retirement-certify -- \
  --tenant-id <tenant-uuid> --since <window-start> --until <window-end> \
  --case <surface>=<thread-uuid>@<turn-uuid> \
  --eval pi=<eval-run-uuid> --eval agentcore=<eval-run-uuid> \
  --capacity-admitted --rollback-rehearsed
```

The gate proves a 24-hour parallel window, success and latency thresholds,
complete turn/cost records, exact-user multiplayer and OAuth ownership,
AgentCore question resumes, durable memory retention, all required capability
surfaces, Pi/AgentCore evaluation parity, zero cross-runtime or uncertain tool
operations, and zero injected-secret canary persistence.

## Runtime invariants

- New Composer threads use the saved tenant default.
- A question-answer wakeup carries the runtime of the turn that asked the
  question. It never consults a changed tenant or agent default.
- Automations, schedules, timers, loops, and workflow steps for the default
  agent honor `runtimeConfig.defaultThreadRuntime`.
- Eval runs use the runtime pinned in the immutable Eval Profile snapshot.
- Existing Pi and AgentCore threads remain on their original runtime.

## Cutover

1. Record the certification JSON, deployment SHA, tenant id, start/end times,
   and exact evidence turn ids.
2. Save `AgentCore Harness` as the tenant default in Agent Configuration.
3. Start a new thread and run a cheap identity/tool probe. Confirm the turn row
   says `runtime_type = 'agentcore'`, the UI runtime marker agrees, and no Pi
   cost row exists for that turn.
4. Run one automation and one scheduled job. Confirm both are AgentCore turns.
5. Keep Pi selectable and provisioned for at least the agreed rollback window.

## Healthy signals

- AgentCore turns are `succeeded`, finalized, and have non-partial usage/cost.
- Harness runner errors/throttles are zero and p95 is within the certified
  threshold.
- Gateway operations have paired `started` and terminal execution events;
  `uncertain` remains zero.
- Memory-enabled completed turns reach `brain.retain_attempts.status =
'retained'`.
- Question answers create a `question_answer` turn on AgentCore with the same
  participant and thread.
- Eval runs report their profile's pinned runtime and a complete cost record.

## Rollback

Rollback is a saved-default change, not a resource deletion:

1. Save `Pi` as the tenant default.
2. Start a new thread and confirm its turn and cost rows are Pi.
3. Leave existing AgentCore threads unchanged; do not resume them through Pi.
4. Preserve all Harness, Identity, Gateway, policy, OAuth grant, and telemetry
   evidence for incident review.
5. Fix the defect, deploy, prove a clean AgentCore question/tool turn, and start
   a brand-new 24-hour soak window before attempting cutover again.

## Resource cleanup after certification

Delete only resources proven obsolete by inventory and tags:

- expired spike/proof Harness runtimes and versions;
- spike-only Gateway targets, policies, workload identities, issuer Lambdas,
  IAM roles, API Gateway routes, SSM parameters, and Secrets Manager entries;
- stale proof log groups after their evidence-retention period;
- superseded proof KMS keys after their mandatory pending-deletion window.

Do **not** delete Pi during the parallel soak or rollback window. Do not delete
the current Harness, shared production Gateway/Identity resources, Token Vault
grants, canonical database objects, or customer OAuth credentials merely
because a similarly named proof resource exists. Resolve exact ARNs, tags,
dependencies, last-use evidence, and Terraform ownership before deletion.

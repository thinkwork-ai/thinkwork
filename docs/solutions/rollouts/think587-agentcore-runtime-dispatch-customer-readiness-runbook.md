# Customer-readiness runbook: AgentCore Runtime chat dispatch (THINK-587 / U8)

Same-day rollout runbook for flipping a customer stage (TEI, McPherson) from
Pi-Lambda chat dispatch onto Bedrock AgentCore Runtime dispatch with warm
per-thread sessions.

Plan: `docs/plans/2026-08-03-001-feat-thread-agent-agentcore-runtime-warm-sessions-plan.md`
(U8, R18). Status log: `docs/plans/2026-08-03-agentcore-harness-autopilot-status.md`.

**Decision record (2026-08-04):** Eric cancelled the plan's ≥1-week dev soak
window. Everything lands same-day; Eric validates dev, TEI, and McPherson
himself. The R18 thresholds below are kept verbatim as go/no-go checks, but
evaluated over a short observation window (the same-day turns Eric drives plus
whatever organic traffic accrues) instead of a week. The ≥200-turn sample
requirement is therefore relaxed to "every turn in the observation window" —
all other thresholds are absolute (zero-tolerance) and do not depend on window
length.

**Flag flips on customer stages are user-owned and manual.** This runbook
instructs a human operator; nothing here is automated, and no CI workflow
flips a customer stage.

## How the two flags compose

A chat turn rides the AgentCore Runtime dispatcher only when **both** are on
(`resolveChatDispatchTarget` in
`packages/api/src/lib/resolve-runtime-function-name.ts`):

1. **Stage kill-switch** — `AGENTCORE_RUNTIME_DISPATCH_ENABLED` key in the
   stage's runtime-config SSM document (`/thinkwork/<stage>/runtime-config`,
   built by `terraform/modules/app/lambda-api/runtime-config.tf` from the
   `agentcore_runtime_dispatch_enabled` module variable in
   `terraform/modules/app/lambda-api/handlers.tf`). Module default is `false`
   (`""` = stripped from the document = off). Dev opts in via
   `scripts/deploy/terraform-vars.sh`; customer stages opt in via
   runner-secrets on their own cadence.
2. **Per-agent flag** — `agents.agentcore_runtime_dispatch` boolean column
   (migration `packages/database-pg/drizzle/0283_agents_agentcore_runtime_dispatch.sql`,
   hand-rolled, default `false`). Read per turn by
   `packages/api/src/lib/resolve-agent-runtime-config.ts`, so flips take
   effect on the next turn with no deploy.

Either flag off → the turn routes to the Pi Lambda exactly as before. When
the stage flag is on but an agent rides the Lambda path anyway, the caller
logs a `legacy_lambda_dispatch` sentinel (soak signal, must be 0 for flagged
agents).

## Preconditions per customer stage (TEI, McPherson)

Check every item before flipping anything. Run with the stage's AWS profile
(see `docs/solutions/` memory: runner-secrets in Secrets Manager is the
effective tfvars for customer stages).

### 0. Runner plumbing exists (blocking as of 2026-08-04)

`terraform/modules/app/deployment-control-plane/runner.py` does **not** yet
read an `agentcore_runtime_dispatch_enabled` value from runner-secrets into
`vars_json`. Until a runner.py that plumbs this key is merged **and seeded to
each customer's evidence bucket** (removing/adding runner inputs without
re-seeding strands TEI/McPherson — see
`docs/solutions/` runner bootstrap-skew learning), the stage kill-switch
cannot be turned on for a customer stage through the supported path. Verify
the seeded runner.py in the customer evidence bucket contains the key before
proceeding.

### 1. Migration 0283 applied

`0283_agents_agentcore_runtime_dispatch.sql` is hand-rolled (not in
`meta/_journal.json`); it must have been applied via
`psql "$DATABASE_URL" -f drizzle/0283_agents_agentcore_runtime_dispatch.sql`
or the deploy gate. Verify:

```sql
SELECT column_name, column_default
FROM information_schema.columns
WHERE table_name = 'agents' AND column_name = 'agentcore_runtime_dispatch';
-- expect: one row, default false
```

`pnpm db:migrate-manual` also reports it (the file declares
`-- creates-column: public.agents.agentcore_runtime_dispatch`).

### 2. Dispatcher Lambda + DLQ + redrive consumer deployed

All created by `terraform/modules/app/lambda-api/` (`handlers.tf`,
`dispatch-dlq.tf`):

```bash
aws lambda get-function --function-name thinkwork-<stage>-api-agentcore-runtime-dispatch \
  --query 'Configuration.[FunctionName,Timeout,State]'          # Timeout 900, Active
aws lambda get-function-event-invoke-config \
  --function-name thinkwork-<stage>-api-agentcore-runtime-dispatch \
  --query '[MaximumRetryAttempts,DestinationConfig.OnFailure.Destination]'
  # expect: 0, arn:aws:sqs:...:thinkwork-<stage>-agentcore-dispatch-dlq
aws sqs get-queue-attributes \
  --queue-url "https://sqs.<region>.amazonaws.com/<account>/thinkwork-<stage>-agentcore-dispatch-dlq" \
  --attribute-names ApproximateNumberOfMessages    # expect 0
aws lambda get-function --function-name thinkwork-<stage>-api-agentcore-dispatch-dlq-redrive \
  --query 'Configuration.State'                    # Active (SQS event source mapping enabled)
```

### 3. Runtime READY with the session-cache env overlay

The runtime's env is a **mirror snapshot** of the Pi Lambda env plus exactly
one runtime-only overlay key, `AGENTCORE_RUNTIME_SESSION_CACHE=1` (set only
by `scripts/update-agentcore-runtime-image.sh` on dev and the runner's
reconcile step on customer stages — never in the Pi Lambda Terraform env, so
the Lambda path structurally cannot build the warm-session cache).

- Runtime and DEFAULT endpoint status `READY`:

  ```bash
  aws bedrock-agentcore-control get-agent-runtime --agent-runtime-id <runtime-id> \
    --query '{status:status,version:agentRuntimeVersion}'
  ```

- Env var count: the reconcile/mirror logs print
  `Mirroring N environment variables` (values never logged, R19). N must be
  **Pi Lambda env count + 1** (the overlay). An empty mirrored env is an
  atomic-or-abort failure — if the reconcile aborted, do not proceed.

### 4. Provisioned concurrency READY (R13 covers customer stages)

```bash
aws lambda get-provisioned-concurrency-config \
  --function-name thinkwork-<stage>-api-chat-agent-invoke --qualifier live
aws lambda get-provisioned-concurrency-config \
  --function-name thinkwork-<stage>-api-workspace-renderer --qualifier live
# expect Status: READY on both
```

### 5. Fresh-enough deploy

The stage runs a release that includes U6 + U7 (dispatcher, DLQ, sentinel,
session cache — merged to `main` 2026-08-04). Confirm the customer stage's
last successful runner deploy postdates those merges.

## Flag flip procedure (manual, user-owned)

1. **Stage kill-switch on** — add `agentcore_runtime_dispatch_enabled: true`
   to the stage's runner-secrets (Secrets Manager, the effective tfvars) and
   run the customer deploy. Post-apply, confirm the key landed:

   ```bash
   aws ssm get-parameter --name /thinkwork/<stage>/runtime-config \
     --query 'Parameter.Value' --output text | jq -r '.AGENTCORE_RUNTIME_DISPATCH_ENABLED'
   # expect: "true"
   ```

   This alone routes **no traffic** — the per-agent flag gates on top.

2. **Per-agent flag on, one agent at a time** — start with a low-stakes agent
   the customer contact (or Eric) can drive personally:

   ```sql
   UPDATE agents SET agentcore_runtime_dispatch = true WHERE id = '<agent-id>';
   ```

   Takes effect on the agent's next turn (per-turn DB read, no deploy, no
   cache).

3. **Drive a smoke turn** on the flagged agent, then a follow-up message in
   the same thread within a few minutes (exercises the warm-session fast
   path). Confirm the turn finalizes in the UI.

4. Widen to remaining agents only after the verification section passes.

## Verification: go/no-go (short observation window)

Run the soak section of the dashboard against the stage, scoped to the
observation window (e.g. `--hours 4` same-day):

```bash
scripts/latency-dashboard.sh --stage <stage> --hours 4 --section soak
```

It reports: dispatcher invoke outcomes by status
(`api.runtime_dispatch.invoke` phase p50/p90/max), near-timeout (>870 s)
invocations, `legacy_lambda_dispatch` sentinel count, DLQ redrive activity
(`dispatch_dlq_redrive` by outcome), `session_reuse` hit rate from the
runtime log group, and current DLQ depth.

R18 thresholds as explicit go/no-go numbers (window-scoped, not week-scoped):

| #   | Check                                                 | Go                                                                                                       | No-go                                                                        |
| --- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| 1   | Turn sample                                           | Every turn in the window sampled; window includes ≥1 first message + ≥1 warm follow-up per flagged agent | Zero follow-up-cohort turns observed                                         |
| 2   | Turn error rate (failed dispatcher phases / total)    | < 1%                                                                                                     | ≥ 1%                                                                         |
| 3   | `legacy_lambda_dispatch` sentinels for flagged agents | 0                                                                                                        | ≥ 1                                                                          |
| 4   | DLQ depth + `dispatch_dlq_redrive` count              | 0 / 0                                                                                                    | any message or redrive                                                       |
| 5   | Dispatcher near-timeout invocations (>870 s)          | 0                                                                                                        | ≥ 1 (turn budget ~870 s is being breached; timeouts strand turns to the DLQ) |
| 6   | `ActiveSessionCount` (AgentCore runtime sessions)     | < 50% of the 5,000-per-account quota (< 2,500)                                                           | ≥ 2,500                                                                      |
| 7   | `session_reuse` hit rate on warm follow-ups           | reuse=true observed on same-thread follow-ups                                                            | all follow-ups miss (warm path dead — investigate before widening)           |
| 8   | First-message p50 (R3)                                | within noise of the U1 baseline for the stage                                                            | regression beyond baseline noise                                             |
| 9   | Harness overhead on follow-ups (R1)                   | < 5 s p50 (`--section report`/`cohort`)                                                                  | ≥ 5 s p50                                                                    |

Any no-go → roll back (below), diagnose, re-flip. Do not widen the per-agent
rollout past the smoke agent while any check is red.

## Rollback

Proven live on dev 2026-08-04: flag off → Lambda path resumes immediately, no
orphaned turns.

1. **Per-agent (first resort, instant):**

   ```sql
   UPDATE agents SET agentcore_runtime_dispatch = false WHERE id = '<agent-id>';
   ```

   Next turn rides the Pi Lambda. No deploy, no cache to wait out.

2. **Stage kill-switch (all agents at once):** set
   `agentcore_runtime_dispatch_enabled: false` in runner-secrets and rerun
   the customer deploy. For an emergency stop ahead of the deploy, edit the
   `/thinkwork/<stage>/runtime-config` SSM parameter directly and remove the
   `AGENTCORE_RUNTIME_DISPATCH_ENABLED` key — handler containers refresh the
   document on a 5-minute TTL (`packages/runtime-config/src/loader.ts`), and
   Terraform re-asserts the parameter on the next apply, so the runner-secrets
   change must follow or the emergency edit will be reverted.

3. **Stranded turns (DLQ redrive):** the redrive consumer
   (`packages/api/src/handlers/agentcore-dispatch-dlq-redrive.ts`) consumes
   the DLQ automatically via its SQS event source mapping and idempotently
   marks each enveloped `thread_turn` failed (guarded on `status='running'
AND finalized_at IS NULL`; already-finalized turns are a no-op). Normally
   there is nothing manual to do beyond confirming depth returns to 0.
   If depth stays > 0: check
   `/aws/lambda/thinkwork-<stage>-api-agentcore-dispatch-dlq-redrive` logs for
   `outcome=unparseable` records, fix or purge those messages explicitly, and
   remember retention is 24 h (R19) — envelopes carry `API_AUTH_SECRET` and
   MCP credentials, so never copy message bodies into tickets or docs.

## Secret-rotation ownership (R19)

The runtime's env is a point-in-time mirror of the Pi Lambda env. Rotating
any secret that rides that env (e.g. `API_AUTH_SECRET`, the capability
signing key material) does **not** propagate to the runtime by itself: after
rotation (via tfvars on dev / runner-secrets on customer stages — never the
console, per `terraform/modules/app/lambda-api/runtime-config.tf`), the
runtime env mirror must be re-run (`scripts/update-agentcore-runtime-image.sh`
on dev; the runner's Pi-runtime reconcile step on customer deploys — a normal
customer deploy covers it). Ownership: whoever rotates the secret owns
confirming the runtime re-mirror happened (the `Mirroring N environment
variables` log line on the same deploy). Env values are never logged — counts
only.

## Evidence checklist (record in the status doc per stage)

- [ ] Preconditions 0–5 pass (paste command outputs, redact ARNs as needed)
- [ ] Stage kill-switch flip: runner-secrets change + post-apply SSM check
- [ ] Smoke agent id + smoke turn thread link
- [ ] `latency-dashboard.sh --section soak` output for the window
- [ ] Go/no-go table filled in with observed numbers
- [ ] Rollback path re-confirmed reachable (who has DB + runner-secrets access)

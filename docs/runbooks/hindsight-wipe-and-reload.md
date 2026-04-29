# Hindsight wipe-and-reload runbook

One-shot operational procedure: after the Hindsight ingest reshape PR
(plan: `docs/plans/2026-04-27-002-feat-hindsight-ingest-and-runtime-cleanup-plan.md`)
merges and Terraform applies, run the legacy wipe so the new shape is the
only shape ingested.

This runbook is operator-triggered, not CI-triggered (per Q4 resolution
2026-04-28 — operator-driven runbook beats CI step for one-shot
destructive work). Re-run safety: the wipe filter targets only
legacy-shape rows (`metadata->>'document_id' IS NULL` OR
`context = 'thread_turn'`); after U3 ships, no new rows match the
filter, so re-running the wipe is a no-op.

## Prerequisites

- The PR carrying U1, U2, U3, U2-Pi, U3-Pi, U8, U9, U10 has merged to `main`.
- Both AgentCore runtime images (`agentcore-strands` and `agentcore-pi`)
  have been rebuilt and pushed.
- Both runtimes' `containerUri` matches the merged SHA via
  `aws bedrock-agentcore-control get-agent-runtime`. AgentCore does not
  auto-repull; an out-of-date container would still serve the old retain
  shape and the wipe would race against it. See
  `docs/solutions/workflow-issues/agentcore-runtime-no-auto-repull-requires-explicit-update-2026-04-24.md`.
- A pre-flight consumer survey has been run for the target stage. Surveyed
  surfaces (none filter on `context = 'thread_turn'`):
  - recall callsites — `HindsightAdapter.recall` + `inspect`
  - eval harness — adapter-mediated, no shape coupling
  - mobile/admin renderers — adapter-mediated, no shape coupling
  - wiki-compile cursor — reads `hindsight.memory_units` but does not
    filter by context literal
- The Hindsight platform team has confirmed a recent Postgres backup
  exists for the wipe stage. Recovery story = backup restore + targeted
  re-ingest from `messages` table via U1's Lambda (the new shape is
  idempotent under `update_mode=replace`).

## AgentCore container repull verification

Before the wipe runs, confirm both runtimes are actually serving the
merged SHA. AgentCore does not auto-repull when an image tag is
overwritten in ECR; both runtimes have to be explicitly updated.

```bash
# Replace <merged-sha> with the SHA at the tip of main after the merge.
MERGED_SHA=<merged-sha>

aws bedrock-agentcore-control get-agent-runtime \
  --agent-runtime-name agentcore-strands-<stage> \
  --query containerUri --output text

aws bedrock-agentcore-control get-agent-runtime \
  --agent-runtime-name agentcore-pi-<stage> \
  --query containerUri --output text
```

Both `containerUri` outputs must end with `:${MERGED_SHA}`. If either
is stale, run the AgentCore update command (see the env-shadowing
runbook for the exact CLI invocation) and re-verify before proceeding.

## Step 1 — Dry-run

```bash
DATABASE_URL=<stage-url> tsx packages/api/scripts/wipe-external-memory-stores.ts \
  --stage <stage>
```

Expected output:

```
[wipe-external-memory-stores] stage=<stage> dry_run=true scope=all-users \
  legacy_total=N bank_count=M
  bank=user_<uuid> would_delete=<n>
  ...
```

Cross-check `legacy_total` against your by-eye expectation (rough order
of magnitude — number of active users × average pre-cutover thread
turns). If the count is wildly off (orders of magnitude higher than
expected), STOP. Investigate before running live; the
`--max-deletes` safeguard caps at 1M but anything above the rough
expectation is a signal something is off.

## Step 2 — Live run

Requires `--surveyed-on YYYY-MM-DD` within 7 days of today. The script
rejects live runs without a fresh survey.

```bash
SURVEY_DATE=$(date -u -v-1d +%Y-%m-%d)  # yesterday in UTC

DATABASE_URL=<stage-url> tsx packages/api/scripts/wipe-external-memory-stores.ts \
  --stage <stage> \
  --dry-run=false \
  --surveyed-on "$SURVEY_DATE"
```

Expected output:

```
[wipe-external-memory-stores] stage=<stage> dry_run=false scope=all-users \
  legacy_total=N bank_count=M
  bank=user_<uuid> deleted=<n>
  ...
[wipe-external-memory-stores] complete deleted_total=N
```

The `deleted_total` should match `legacy_total` from the dry-run (any
new traffic between dry-run and live can only ADD legacy rows if the
container repull verification was wrong — that's a signal to abort).

## Step 3 — Post-deploy observability

Run these queries against the stage's Hindsight Postgres after live
traffic has resumed for at least one chat turn per affected user:

### One Hindsight document per thread (R21 verification)

```sql
SELECT bank_id,
       metadata->>'document_id' AS document_id,
       COUNT(*) AS rows
FROM hindsight.memory_units
WHERE bank_id = 'user_<userId>'
  AND metadata->>'document_id' IS NOT NULL
GROUP BY bank_id, metadata->>'document_id'
ORDER BY rows DESC
LIMIT 20;
```

Each `(bank_id, document_id)` pair should have COUNT >= 1 (Hindsight
extracts multiple memory_units per document but the operator-facing
"one document per thread" invariant holds at the `document_id` level).

### Context literal sampling (legacy-shape elimination)

```sql
SELECT context, COUNT(*) AS rows
FROM hindsight.memory_units
WHERE bank_id LIKE 'user_%'
GROUP BY context;
```

Expected: `thinkwork_thread` dominates; `thread_turn` rows should be
zero (or the lingering count from any in-flight turn that committed
between live wipe and this query).

### Pi parity verification

```sql
SELECT COUNT(*) AS pi_rows
FROM hindsight.memory_units
WHERE bank_id LIKE 'user_%'
  AND metadata->>'runtime' = 'pi';
```

After at least one Pi-served thread, this count must be > 0. Confirms
U2-Pi/U3-Pi are wired end-to-end (the runtime metadata is set by the
Pi adapter path).

### Cost-events flow

```sql
SELECT phase, COUNT(*) AS rows, SUM(input_tokens + output_tokens) AS total_tokens
FROM cost_events
WHERE event_type = 'hindsight_usage'
  AND created_at > NOW() - INTERVAL '1 hour'
GROUP BY phase;
```

Both `retain` and `reflect` phases should have rows. If `retain` rows
flat-line to zero, the in-body `_push` (U8) is not firing for some
registered tool path — investigate before declaring the wipe complete.

## Recovery — if a consumer regression is detected

1. Stop active live wipe runs (Ctrl-C; in-flight transaction will roll
   back automatically).
2. Restore Hindsight Postgres from the most recent pre-wipe backup
   (coordinate with the Hindsight platform team).
3. Re-ingest the affected user(s) from `messages` table by replaying
   recent threads through the chat path. The new ingest path
   (`memory-retain` Lambda → `retainConversation` adapter →
   `update_mode=replace`) is idempotent.

## Post-deploy learning doc

After Step 3 verification passes, write a learning doc at:

```
docs/solutions/workflow-issues/hindsight-ingest-reshape-deploy-YYYY-MM-DD.md
```

Capturing:

- What shipped in the PR (units, commit range)
- Wipe metrics: `legacy_total`, `bank_count`, `deleted_total`,
  per-bank distribution
- Observability spot-checks: one-doc-per-thread sample, context
  literal distribution, Pi parity row count, retain/reflect cost-events
- Whether any consumer surveyed in U11 surfaced an unexpected
  dependency on legacy shape
- How long the wipe took end-to-end; whether the per-bank batched
  approach hit any unexpected lock contention

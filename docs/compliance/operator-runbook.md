# Operator runbook

How to do things to the running compliance module. For background on why the module exists, read [overview.md](./overview.md). For the architectural shape, read [architecture.md](./architecture.md). When an alarm fires, jump to [oncall.md](./oncall.md).

## Procedures

- [Inspect compliance events in admin](#inspect-compliance-events-in-admin)
- [Request a compliance export](#request-a-compliance-export)
- [Apply a hand-rolled compliance migration to dev before merging](#apply-a-hand-rolled-compliance-migration-to-dev-before-merging)
- [Bootstrap or rotate Aurora compliance role passwords](#bootstrap-or-rotate-aurora-compliance-role-passwords)
- [Flip S3 Object Lock GOVERNANCE → COMPLIANCE for an audit engagement](#flip-s3-object-lock-governance--compliance-for-an-audit-engagement)
- [Drain the compliance-anchor DLQ](#drain-the-compliance-anchor-dlq)
- [Drain the compliance-exports DLQ](#drain-the-compliance-exports-dlq)
- [Re-run a failed export](#re-run-a-failed-export)

---

### Inspect compliance events in admin

**When to use this:** You need to see what audit events the platform recorded for a tenant or time window — for an internal review or to prepare for an auditor walkthrough.

1. Sign in to admin as an operator (your email must be in `THINKWORK_PLATFORM_OPERATOR_EMAILS` on the graphql-http Lambda).
2. Click **Compliance** in the sidebar (between Settings and Billing).
3. The list page defaults to the last 7 days. Use the filter bar to narrow by `event_type`, `actor_type`, or a custom `since`/`until` window.
4. Click any row to open the event detail page. The detail page shows:
   - Event metadata (event_id, occurred_at, recorded_at, actor, source).
   - Chain position panel: the event's own hash + previous-event hash (clickable to walk backward).
   - Anchor status: ANCHORED with `cadence_id` once the next 15-minute cadence completes; PENDING in the meantime.
   - Payload (redacted per the per-event-type allow-list at write time; see [developer-guide.md](./developer-guide.md#audit-event-tier-semantics)).
5. To browse cross-tenant (operators only): toggle **Cross-tenant view** in the filter bar. Off by default; the toggle adds the tenant Combobox to the filter row.

The /compliance read API source: [`packages/api/src/graphql/resolvers/compliance/query.ts`](../../packages/api/src/graphql/resolvers/compliance/query.ts).

---

### Request a compliance export

**When to use this:** An auditor asks for a CSV/NDJSON of audit events matching a filter.

1. From the **Compliance** events list, set the filter to the slice the auditor wants (date range + event types).
2. Click **Export this view** in the page header. The Exports dialog opens pre-filled with the current filter; the URL carries `?from=current-filter`.
3. Choose CSV (auditor-friendly default) or JSON (NDJSON wire format).
4. Click **Queue export**. The job appears in the table at `/compliance/exports/` with status `Queued`.
5. The page polls every 3 seconds while any job is `Queued` or `Running`. Status transitions: `Queued → Running → Complete` (or `Failed`).
6. When status flips to `Complete`, click **Download** in the Action column. The file downloads directly from S3 via a 15-minute presigned URL.
7. If the URL expires before download (the `presigned_url_expires_at` column is past `now()`), the action cell shows "Download link expired — re-export." Submit a fresh export with the same filter.

**Hard caps:**

- Max filter window: **90 days** (`until - since`). Wider rejects with `FILTER_RANGE_TOO_WIDE`.
- Max filter byte size: **4 KB** serialized. Larger rejects with `FILTER_TOO_LARGE`.
- Rate limit: **10 exports per hour per operator email**. 11th rejects with `RATE_LIMIT_EXCEEDED`.

The export emits a `data.export_initiated` audit event with the filter as payload — exporting is itself audited.

Resolver source: [`packages/api/src/graphql/resolvers/compliance/exports.ts`](../../packages/api/src/graphql/resolvers/compliance/exports.ts).

---

### Apply a hand-rolled compliance migration to dev before merging

**When to use this:** Your PR adds a hand-rolled SQL file under `packages/database-pg/drizzle/00NN_*.sql` that is not in `meta/_journal.json`. The post-deploy drift gate checks that every `-- creates:` marker in such files resolves on the target DB. Skipping this step fails the deploy.

1. Read your migration carefully. It should declare `-- creates: schema.object` markers in the header for every object it provisions.
2. Resolve the dev `DATABASE_URL`: `aws secretsmanager get-secret-value --region us-east-1 --secret-id thinkwork-dev-db-credentials --query SecretString --output text` (or use the bootstrap helper if rotating roles).
3. Apply: `psql "$DATABASE_URL" -f packages/database-pg/drizzle/00NN_<your-migration>.sql`.
4. Verify with `pnpm db:migrate-manual` — should report APPLIED for the new objects.
5. Open the PR. The `terraform-apply` job's drift-gate step will pass.

If you forget this step, the PR's deploy job fails on the drift gate with a list of missing objects. The fix is to apply the migration to dev and re-run the failed job — no code change needed.

Reference: [feedback_handrolled_migrations_apply_to_dev](../../.claude/projects/-Users-ericodom-Projects-thinkwork/memory/feedback_handrolled_migrations_apply_to_dev.md). Recent compliance migrations applied this way: `0069`, `0070`, `0073`, `0074`.

---

### Bootstrap or rotate Aurora compliance role passwords

**When to use this:** First-time provisioning of a stage's compliance roles, or rotating any of the three role passwords.

1. The bootstrap helper wraps the SQL apply with Secrets Manager population:

   ```bash
   STAGE=dev bash scripts/bootstrap-compliance-roles.sh
   ```

2. The script generates fresh passwords for `compliance_writer`, `compliance_drainer`, `compliance_reader`, runs `0070_compliance_aurora_roles.sql` against the stage's DB, and writes each password to its corresponding Secrets Manager secret (`thinkwork-{stage}-compliance-{role}-credentials`).
3. Re-running the script rotates passwords idempotently — the SQL `DO $$ ... ALTER ROLE ... PASSWORD %L` block updates without breaking existing connections (next connect picks up the new password).
4. After rotation, the graphql-http Lambda + the anchor + drainer Lambdas all pick up the new passwords on cold start. There is no warm-flush API; if you must force a warm pool to refresh immediately, redeploy the affected functions.

Direct apply (advanced — must supply all three passwords explicitly):

```bash
psql "$DATABASE_URL" \
  -v writer_pass="$COMPLIANCE_WRITER_PASS" \
  -v drainer_pass="$COMPLIANCE_DRAINER_PASS" \
  -v reader_pass="$COMPLIANCE_READER_PASS" \
  -f packages/database-pg/drizzle/0070_compliance_aurora_roles.sql
```

Migration: [`packages/database-pg/drizzle/0070_compliance_aurora_roles.sql`](../../packages/database-pg/drizzle/0070_compliance_aurora_roles.sql). Helper: [`scripts/bootstrap-compliance-roles.sh`](../../scripts/bootstrap-compliance-roles.sh).

---

### Flip S3 Object Lock GOVERNANCE → COMPLIANCE for an audit engagement

**When to use this:** A production audit engagement is starting. The anchor bucket needs to be in COMPLIANCE mode to satisfy the auditor's "can anyone bypass this?" question.

> **DANGER — IRREVERSIBLE.** Once any object is written under COMPLIANCE mode with retention X, that object cannot be deleted or shortened by anyone (including AWS root) until X expires. Default retention is 365 days. **Verify the stage twice** before applying.

1. Confirm the stage is `prod` (or a non-prod stage you have explicitly approved for COMPLIANCE — see step 4).
2. Edit the stage's tfvars: `compliance_anchor_object_lock_mode = "COMPLIANCE"`.
3. Run `terraform plan` from the composite root. The plan should show **only** a change on `aws_s3_bucket_object_lock_configuration.anchor` (mode `GOVERNANCE` → `COMPLIANCE`). If the plan shows other resource changes, stop — something else is dirty.
4. **Non-prod safeguard:** the module's `lifecycle.precondition` blocks COMPLIANCE on non-prod stages by default. To intentionally enable on a non-prod stage, also set `allow_compliance_in_non_prod = true` in tfvars. Master plan U7/U8b documented this guard explicitly.
5. Apply with manual confirmation. Do not pipe `yes |` or use `--auto-approve`.
6. After apply, verify in the S3 console that the anchor bucket's Object Lock retention mode reads COMPLIANCE.

The Terraform module README has the full playbook:
[`terraform/modules/data/compliance-audit-bucket/README.md`](../../terraform/modules/data/compliance-audit-bucket/README.md).

---

### Drain the compliance-anchor DLQ

**When to use this:** CloudWatch alarm `thinkwork-{stage}-compliance-anchor-dlq` (or its U8a/U8b equivalent) fires. The anchor Lambda crashed on at least one invocation; messages are sitting in the DLQ.

1. Open the SQS console; locate `thinkwork-{stage}-compliance-anchor-dlq`.
2. Use **Send and receive messages → Poll for messages**. Inspect each message body. Anchor invocations carry no payload (scheduler-triggered) so the body is the raw EventBridge event.
3. Cross-reference with CloudWatch logs for `thinkwork-{stage}-api-compliance-anchor` around the message's `SentTimestamp`. The error in the log is the actionable signal.
4. Decision tree:
   - **Transient infra error** (Aurora connection drop, S3 throttle, KMS rate limit): the next scheduled cadence will produce a fresh anchor; the DLQ message can be **purged**. The chain catches up automatically.
   - **Code regression** (handler panic, unhandled exception): patch first, deploy, then purge.
   - **Configuration error** (env var unset, IAM permission gap): fix terraform first, redeploy, then purge.
5. To purge a single message after handling: select it in the console and click **Delete**. To purge the entire queue (only when you have confirmed every message is recoverable): **Purge queue**.

**Do not** "replay" anchor DLQ messages — the schedule is rate-based, so replaying produces a duplicate cadence at an unintended time. Let the next 15-minute tick re-anchor.

Anchor Lambda: [`packages/lambda/compliance-anchor.ts`](../../packages/lambda/compliance-anchor.ts).

---

### Drain the compliance-exports DLQ

**When to use this:** CloudWatch alarm `thinkwork-{stage}-compliance-exports-dlq-depth` fires.

1. Open the SQS console; locate `thinkwork-{stage}-compliance-exports-dlq`.
2. Each message body is `{"jobId": "<uuidv7>"}`. Look up the job in `compliance.export_jobs` to see what filter the operator requested.
3. Check the job's status:
   - If `running` for >15 minutes: the runner crashed. Mark `failed` with `job_error = 'runner crashed; see DLQ'`, then purge the message. Operator submits a fresh export.
   - If `failed`: the runner already wrote the failure to the DB before exiting; the DLQ message is redundant. Purge.
   - If `queued`: the runner never claimed the job (CAS guard didn't fire). Investigate the Lambda — likely env-var regression. Purge after fix.
4. Replaying the message **is safe** because the runner's CAS guard (`UPDATE … WHERE status='queued'`) makes re-delivery a no-op when the job is no longer queued. But replay is rarely useful — the underlying problem (handler crash) needs a code fix first.

Runner: [`packages/lambda/compliance-export-runner.ts`](../../packages/lambda/compliance-export-runner.ts).

---

### Re-run a failed export

**When to use this:** An operator reports a `Failed` export and wants the same slice again.

1. Open `/compliance/exports/`. The failed job's row shows the truncated `job_error` in the Status column (hover for the full message via the `title` attribute).
2. From the events list page (`/compliance`), reconstruct the original filter (the failed job's `filter` JSON in the table tells you what to set).
3. Click **Export this view** with the reconstructed filter; submit. A fresh job queues; the failed row stays for traceability.

There is no "clone failed job" mutation at v1. Reconstructing the filter from the row keeps the audit trail clean (each `data.export_initiated` event is its own provable request).

---

## Where to escalate

- An alarm fired and the playbook didn't fix it → [oncall.md](./oncall.md).
- A migration failed mid-apply or the drift gate is stuck → [oncall.md](./oncall.md#drift-gate-fails-on-deploy).
- An operator email needs adding to the allowlist → set `THINKWORK_PLATFORM_OPERATOR_EMAILS` on the graphql-http Lambda's environment via Terraform; redeploy graphql-http.
- An auditor needs the verifier CLI run against an attested slice → [`packages/audit-verifier/README.md`](../../packages/audit-verifier/README.md).

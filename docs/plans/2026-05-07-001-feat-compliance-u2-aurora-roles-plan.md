---
title: "feat(compliance): U2 — Aurora roles + Secrets Manager + GRANT migration (focused execution overlay)"
type: feat
status: active
date: 2026-05-07
origin: docs/plans/2026-05-06-011-feat-compliance-audit-event-log-plan.md
---

# feat(compliance): U2 — Aurora roles + Secrets Manager + GRANT migration

## Summary

Focused execution overlay for U2 of the master Phase 3 plan. Provisions three new Aurora users (`compliance_writer`, `compliance_drainer`, `compliance_reader`), three Secrets Manager secrets for their credentials, and a hand-rolled GRANT migration that scopes per-table privileges on the U1 `compliance.*` schema. RDS Proxy + per-Lambda execution-role scoping are explicitly deferred to a follow-up unit (U12) since both are greenfield infrastructure with no existing precedent in the repo.

---

## Problem Frame

Master plan Decision #4 commits to "two distinct DB users + separate RDS Proxy endpoints, no `SET ROLE`." Repo research surfaced two facts that shape U2's scope:

1. **No RDS Proxy exists today.** Lambdas connect direct to Aurora via Secrets Manager. Introducing RDS Proxy is its own non-trivial change (sub-module + IAM auth + SG routing + per-role endpoints).
2. **No precedent exists for in-Terraform Postgres role provisioning.** The `cyrilgdn/postgresql` provider is not a dependency. The only mechanism for creating non-master Postgres roles in this stack is hand-rolled SQL migrations applied via `psql -f` to dev BEFORE merge (the U1 invariant per `feedback_handrolled_migrations_apply_to_dev`).

U2 ships the SOC2-required role separation (writer/drainer/reader Aurora users + GRANTs) and the credentials infrastructure (Secrets Manager). RDS Proxy moves to U12 — separately reviewable, separately deployable, and not strictly required for v1 SOC2 evidence.

(See origin: `docs/plans/2026-05-06-011-feat-compliance-audit-event-log-plan.md` U2 + Decision #4.)

---

## Requirements

Carried from master plan U2 (origin doc):

- R11. Audit data lives in dedicated `compliance` schema. The application database role has write-only access to `compliance.*` tables; a distinct admin role has read access; no other role can read or write the schema.

Master plan Decision #4 elaboration (per-tier role scoping):
- `compliance_writer`: USAGE on schema `compliance`, INSERT only on `compliance.audit_outbox` + `compliance.export_jobs`. No access to `audit_events` (only the drainer writes there).
- `compliance_drainer`: USAGE + SELECT/UPDATE on `compliance.audit_outbox` + `compliance.actor_pseudonym`; INSERT-only on `compliance.audit_events`.
- `compliance_reader`: USAGE + SELECT-only on all four `compliance.*` tables.

---

## Scope Boundaries

- **RDS Proxy provisioning + per-role endpoints.** Defer to U12. No existing RDS Proxy in the repo; introducing one is a multi-file Terraform change with IAM auth + SG + endpoint wiring concerns that deserve their own PR.
- **Per-Lambda execution-role scoping for least-privilege secret access.** Today the shared Lambda execution role has `secretsmanager:GetSecretValue` wildcarded against `arn:aws:secretsmanager:${region}:${account_id}:secret:thinkwork/*` (`terraform/modules/app/lambda-api/main.tf:189-201`). Splitting that into per-Lambda roles is a non-trivial precedent shift documented as deferred in `terraform/modules/app/lambda-api/oauth-secrets.tf:11-18`. U2's three new compliance secrets land under the existing `thinkwork/` prefix and inherit the wildcard — acceptable interim until SOC2 auditor flags it.
- **Cross-stage promotion.** `deploy.yml` hardcodes `STAGE=dev`. Per-stage rollout (staging/prod) for the role + secret bootstrap waits until those stages exist.
- **Secret rotation.** No rotation is configured on any existing thinkwork secret today. The three new compliance secrets follow the same pattern (no `aws_secretsmanager_secret_rotation`); rotation is a future cross-cutting change.

### Deferred to Follow-Up Work

- **U12 — RDS Proxy + separate read/write endpoints**: introduces `aws_db_proxy` + `aws_db_proxy_target_group` + 3× `aws_db_proxy_endpoint` (writer, drainer, reader) + IAM auth from Lambda execution roles + Secrets Manager rotation hooks.
- **Per-Lambda execution role refactor**: splits the shared `aws_iam_role.lambda` into per-handler roles with narrowed `secretsmanager:GetSecretValue` resource ARNs. Cross-cutting; ~30 handlers to retarget. Document gap in U2 README.

---

## Context & Research

### Relevant Code and Patterns

- **Aurora cluster + master role provisioning**: `terraform/modules/data/aurora-postgres/main.tf:17-18` (`cluster_identifier = thinkwork-${stage}-db`, `master_username = thinkwork_admin`); cluster at `main.tf:98-124`; `aws_db_instance` alternative at `main.tf:147-172`; Aurora aws_s3 extension precedent at `main.tf:191-263`.
- **Master DB credentials secret**: `terraform/modules/data/aurora-postgres/main.tf:269-286` — name `thinkwork-${stage}-db-credentials` (hyphen-delimited, grandfathered), JSON shape `{username, password}` only (no host/port/dbname).
- **Documented standard secret naming**: slash-delimited `thinkwork/${stage}/...` per CLAUDE.md "Deployed stack secrets live in Secrets Manager / SSM Parameter Store under `/thinkwork/<stage>/...`". OAuth secrets at `terraform/modules/app/lambda-api/oauth-secrets.tf:23` follow this pattern.
- **`lifecycle.ignore_changes = [secret_string]` precedent**: `terraform/modules/app/lambda-api/oauth-secrets.tf:41-43` — allows operator console rotation without Terraform clobber. The master `db_credentials` secret does NOT have this guard; new compliance secrets WILL have it.
- **Module wiring path**: `terraform/modules/data/aurora-postgres/outputs.tf:11-14` (`graphql_db_secret_arn`) → `terraform/modules/thinkwork/main.tf:200-202` (consumed as `module.database.graphql_db_secret_arn`) → passed to `module "api"` at L202 and `module "agentcore_flue"` at L340.
- **Lambda execution role + secrets policy**: `terraform/modules/app/lambda-api/main.tf:180-204` — single shared `aws_iam_role.lambda` with inline `lambda_secrets` policy wildcarding `thinkwork/*` for `secretsmanager:GetSecretValue`. Three new compliance secrets inherit this access.
- **Hand-rolled SQL migration template**: `packages/database-pg/drizzle/0069_compliance_schema.sql` (just shipped in U1) and `0067_thinkwork_computers_phase_one.sql` — `\set ON_ERROR_STOP on`, `BEGIN; ... COMMIT;`, `SET LOCAL lock_timeout = '5s'`, `current_database()` guard, `-- creates:` markers.
- **Drift gate script**: `scripts/db-migrate-manual.sh` — supports `creates`, `creates-column`, `creates-extension`, `creates-constraint`, `creates-function`, `creates-trigger`, `drops`, `drops-column`. **No `creates-role` or `creates-grant` markers exist.** U2 extends the script.
- **Terraform deploy flow**: `.github/workflows/deploy.yml:428` (`terraform-apply`) → L670 (`migration-drift-check` runs `scripts/db-migrate-manual.sh`). No automatic `psql -f` step between them — drift gate is read-only. L470-516 examples (U3 pi→flue + U4 session_data) embed `psql -f` BEFORE `terraform-apply` for migrations that must precede infra changes.

### Institutional Learnings

- `docs/solutions/workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md` — U1 invariant: hand-rolled migrations apply via `psql -f` to dev BEFORE merge or the post-deploy drift gate fails the deploy.
- `feedback_handrolled_migrations_apply_to_dev` (memory) — U2's GRANT migration follows this rule.
- `project_dev_db_secret_pattern` (memory) — credential resolution path: `aws secretsmanager get-secret-value --region us-east-1 --secret-id thinkwork-${stage}-db-credentials`.
- `feedback_aws_native_preference` (memory) — Secrets Manager + Aurora-native role provisioning, not external secret managers or postgresql-provider.

### External References

- AWS RDS Aurora authentication — IAM-DB-auth vs password auth. https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/UsingWithRDS.IAMDBAuth.html
- PostgreSQL role / GRANT documentation. https://www.postgresql.org/docs/current/sql-grant.html

---

## Key Technical Decisions

1. **Hand-rolled SQL migration creates roles + grants in one file (`0070_compliance_aurora_roles.sql`).** Operator generates 3 random passwords (e.g., `openssl rand -base64 32`), populates the 3 Secrets Manager secrets via `aws secretsmanager put-secret-value`, then runs the migration via `psql -v writer_pass=... -v drainer_pass=... -v reader_pass=... -f migration.sql` BEFORE merge. **Why:** matches U1's `psql -f` invariant; avoids introducing a Terraform `null_resource` + `local-exec` shell-out pattern that has no precedent in the repo; defers `cyrilgdn/postgresql` provider dependency. Idempotent re-runs via `DO $$ ... IF NOT EXISTS ... END $$` blocks for `CREATE ROLE`.

2. **Idempotent role creation pattern.** Use `DO $$` blocks that check `pg_roles` before `CREATE ROLE`; for password rotation, run `ALTER ROLE compliance_writer WITH PASSWORD :'writer_pass';` unconditionally (idempotent). GRANTs are inherently idempotent via PostgreSQL's "grant exists already" no-op behavior.

3. **Drift gate extension: add `probe_role` for `-- creates-role:` markers.** New marker form `-- creates-role: compliance_writer`. Probe: `SELECT 1 FROM pg_roles WHERE rolname = $1`. **Why:** the drift gate's existing probes (table, column, constraint, function, trigger) don't cover Postgres roles; without an extension, the U2 migration would either need to ship without markers (UNVERIFIED status fails the gate) or use a fudged marker that doesn't actually verify role existence. Adding `probe_role` is ~15 lines of bash mirroring the existing `probe_constraint` shape. GRANTs are NOT individually marked — granular grant probes would balloon marker count without commensurate value; trust the integration tests for grant correctness.

4. **Three new Secrets Manager secrets in `aurora-postgres/main.tf`.** Names: `thinkwork/${stage}/compliance/{writer,drainer,reader}-credentials` (slash-delimited per CLAUDE.md standard, NOT the grandfathered hyphen form). JSON shape: `{username, password, host, port, dbname}` (enriched vs master's `{username, password}` so each consumer is self-contained). `lifecycle.ignore_changes = [secret_string]` so operator console / CLI rotation doesn't drift Terraform. **Why:** documented standard naming, enriched shape simplifies consumer Lambda boot, lifecycle guard matches OAuth-secrets precedent.

5. **Operator-supplied passwords, not `random_password` resources.** Operator generates 3 passwords once, puts them into Secrets Manager via `aws secretsmanager put-secret-value`, runs the migration, and merges the PR. Terraform creates the **secret resource** (the container) but does NOT manage the **secret value** for greenfield. **Why:** `random_password` values aren't easily piped into a `psql -v` substitution at apply time without introducing `null_resource` + `local-exec` (no precedent). The "operator pre-merge" pattern matches the U1 invariant exactly. For greenfield bootstrap of new stages, operator runs the same one-shot.

6. **Bootstrap helper script `scripts/bootstrap-compliance-roles.sh`.** Wraps the `psql -v ... -f migration.sql` invocation: pulls operator-supplied passwords from environment OR generates them, populates the 3 Secrets Manager secrets via `aws secretsmanager put-secret-value`, runs the migration, prints next steps. **Why:** without a wrapper script, the per-stage bootstrap is undocumented operator tribal knowledge. Script makes the workflow self-documenting and idempotent.

7. **No tfvars additions for compliance role passwords.** Operator passes them via env vars or interactive prompts in the bootstrap script, never via committed tfvars. **Why:** terraform.tfvars holds plaintext secrets per `project_tfvars_secrets_hygiene` — adding 3 more secrets to that file is a strict regression. Env var path keeps secrets out of git AND out of operator file system.

---

## Open Questions

### Resolved During Planning

- *RDS Proxy in U2 vs follow-up unit*: defer to U12 (Decision #4-deferral above).
- *Per-Lambda IAM role scoping*: defer indefinitely; existing wildcard suffices for v1.
- *Postgres role provisioning mechanism (postgresql provider vs hand-rolled SQL vs null_resource shell-out)*: hand-rolled SQL with operator-supplied passwords (Decision #1, #5).
- *Secret naming convention*: slash-delimited `thinkwork/${stage}/compliance/...` per CLAUDE.md standard (Decision #4).
- *Secret JSON shape (master `{username, password}` vs enriched)*: enriched `{username, password, host, port, dbname}` so each consumer is self-contained (Decision #4).
- *Drift gate marker support for roles*: extend `db-migrate-manual.sh` with `probe_role` (Decision #3).
- *Auto-supplied passwords (random_password) vs operator-supplied*: operator-supplied via env vars (Decision #5, #7).

### Deferred to Implementation

- Exact bootstrap-script CLI flag conventions (e.g., `--writer-pass-from-env=COMPLIANCE_WRITER_PASS`) — implementer matches existing repo helper-script idioms.
- Whether to bundle the migration apply step into `scripts/bootstrap-compliance-roles.sh` or separate it (`bootstrap-compliance-secrets.sh` + run migration manually) — implementer iterates against script ergonomics during U4-U6 work.

---

## Implementation Units

- U1. **Drift gate extension: `probe_role` + `creates-role:` marker support**

**Goal:** Extend `scripts/db-migrate-manual.sh` to recognize `-- creates-role:` markers and probe `pg_roles` for the named role. Without this, U1 below cannot ship markers — the migration would either be UNVERIFIED (fails the deploy gate) or use a fudged marker.

**Requirements:** R11.

**Dependencies:** None.

**Files:**
- Modify: `scripts/db-migrate-manual.sh` (add `probe_role` function + extend the marker-parsing loop + add the marker form to the help block).
- Test: shell-test or manual probe (no vitest harness for bash; manual `--dry-run` against a hand-crafted SQL fixture).

**Approach:**
- Mirror the shape of `probe_constraint` and `probe_function`. Marker form: `-- creates-role: compliance_writer` (bare role name, not schema-qualified — Postgres roles are global, not per-schema).
- Probe: `SELECT 1 FROM pg_roles WHERE rolname = '$name' LIMIT 1`. Returns the role name on success, MISSING on absence.
- Update the help block at the top of the script to document the new marker.

**Patterns to follow:**
- `scripts/db-migrate-manual.sh` `probe_function` function (line range to be confirmed during implementation; bash function near other probes).

**Test scenarios:**
- *Happy path:* `--dry-run` against the U1 below's migration enumerates `creates-role:` markers correctly.
- *Edge case:* role name with hyphens or underscores parses correctly (POSIX `[A-Za-z0-9_-]+`).
- *Error path:* malformed marker (missing role name after `creates-role:`) is silently skipped or logs a warning — match existing script behavior for malformed markers.

**Verification:** `bash scripts/db-migrate-manual.sh --dry-run` against the U1 migration shows the 3 `creates-role:` markers parsed; `pnpm db:migrate-manual` against dev (post-U1 below applied) reports all role markers as APPLIED with exit 0.

---

- U2. **Hand-rolled migration: `0070_compliance_aurora_roles.sql`**

**Goal:** Create the three Aurora roles (`compliance_writer`, `compliance_drainer`, `compliance_reader`) with passwords passed via psql variable substitution; grant per-tier privileges on `compliance.*` tables.

**Requirements:** R11.

**Dependencies:** U1 (drift gate extension must support `creates-role:` markers before this migration ships); U1 from master plan (compliance schema + tables must exist — already merged via PR #880).

**Files:**
- Create: `packages/database-pg/drizzle/0070_compliance_aurora_roles.sql`.
- Test: `packages/database-pg/__tests__/migration-0070.test.ts` (vitest mirror of `migration-0069.test.ts` — verifies markers, idempotent DO $$ blocks, GRANTs on the right tables).

**Approach:**
- Header conventions match `0069_compliance_schema.sql`: `\set ON_ERROR_STOP on`, `BEGIN;`, `SET LOCAL lock_timeout = '5s'`, `SET LOCAL statement_timeout = '60s'`, `current_database() = 'thinkwork'` guard.
- Markers: 3× `creates-role: compliance_writer/drainer/reader` plus a comment block documenting the GRANT contract per role.
- Idempotent role creation:
  ```sql
  DO $$
  BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'compliance_writer') THEN
      CREATE ROLE compliance_writer WITH LOGIN PASSWORD :'writer_pass';
    ELSE
      ALTER ROLE compliance_writer WITH LOGIN PASSWORD :'writer_pass';
    END IF;
  END $$;
  ```
  Same shape for drainer + reader.
- GRANTs (idempotent — Postgres no-ops if grant exists):
  ```sql
  GRANT USAGE ON SCHEMA compliance TO compliance_writer, compliance_drainer, compliance_reader;
  GRANT INSERT ON compliance.audit_outbox, compliance.export_jobs TO compliance_writer;
  GRANT SELECT, UPDATE ON compliance.audit_outbox TO compliance_drainer;
  GRANT SELECT ON compliance.actor_pseudonym TO compliance_drainer;
  GRANT INSERT ON compliance.audit_events TO compliance_drainer;
  GRANT SELECT ON compliance.audit_outbox, compliance.audit_events, compliance.actor_pseudonym, compliance.export_jobs TO compliance_reader;
  ```
- COMMIT at end. No rollback file (rollback would be `REVOKE ALL ... DROP ROLE`; not worth the complexity for v1).
- File header documents bootstrap workflow: operator runs `bash scripts/bootstrap-compliance-roles.sh` (U4 below) which pulls passwords from env, populates secrets, runs this migration with substitution.

**Execution note:** Apply via `psql -f` to dev BEFORE PR merge per the U1 invariant (master plan U1 precedent). The `bootstrap-compliance-roles.sh` script (U4) wraps the apply.

**Patterns to follow:**
- `packages/database-pg/drizzle/0069_compliance_schema.sql` (header + markers + COMMIT pattern).
- `packages/database-pg/__tests__/migration-0069.test.ts` (vitest test pattern).

**Test scenarios:**
- *Happy path:* migration parses cleanly via `bash scripts/db-migrate-manual.sh --dry-run`; drift gate exit 0 against dev post-apply.
- *Idempotency:* Re-applying the migration is a no-op (no errors, all DO blocks see existing roles, GRANTs already exist).
- *Edge case:* psql variable substitution receives a password with special characters (e.g., `$`, `'`); migration uses `:'writer_pass'` quoted form which handles single-quoting correctly.
- *Error path:* Migration applied without `-v writer_pass=...` fails fast with "psql: variable not defined" before any DDL runs (covered by `\set ON_ERROR_STOP on`).
- *Integration:* After applying U2 below + U2 (this unit) to dev, connecting as `compliance_writer` succeeds; `INSERT INTO compliance.audit_outbox (...)` succeeds; `INSERT INTO compliance.audit_events (...)` is rejected (no INSERT grant); `UPDATE compliance.audit_outbox` is rejected (writer has only INSERT); `SELECT FROM compliance.audit_events` is rejected (writer has no SELECT). Same matrix for drainer + reader.

**Verification:** `psql "$DATABASE_URL" -c "\du compliance_*"` shows 3 roles; `pnpm db:migrate-manual` exits 0 with all 3 `creates-role:` markers APPLIED; integration smoke shows correct per-role grant boundaries.

---

- U3. **Three Secrets Manager secrets + outputs in `aurora-postgres/`**

**Goal:** Provision the secret containers (NOT the secret values for greenfield — operator populates via bootstrap script) so consumer Lambdas can reference the ARNs.

**Requirements:** R11.

**Dependencies:** None (parallel-able with U1/U2).

**Files:**
- Modify: `terraform/modules/data/aurora-postgres/main.tf` (add 3× `aws_secretsmanager_secret` blocks).
- Modify: `terraform/modules/data/aurora-postgres/outputs.tf` (add 3 outputs for secret ARNs).
- Modify: `terraform/modules/thinkwork/main.tf` (thread the new outputs through to `module.api` for consumption by U4 drainer Lambda + U10 graphql-http reader path).

**Approach:**
- Three `aws_secretsmanager_secret` resources:
  ```hcl
  resource "aws_secretsmanager_secret" "compliance_writer" {
    count = local.create ? 1 : 0
    name  = "thinkwork/${var.stage}/compliance/writer-credentials"
    tags  = { Name = "thinkwork-${var.stage}-compliance-writer-credentials" }
  }
  ```
  Same for `compliance_drainer` + `compliance_reader`.
- **NO `aws_secretsmanager_secret_version` resources** for greenfield. Operator populates via `aws secretsmanager put-secret-value` in the bootstrap script (U4). Adding `lifecycle.ignore_changes = [secret_string]` is moot when no version resource exists.
- Outputs:
  ```hcl
  output "compliance_writer_secret_arn" {
    value = local.create ? aws_secretsmanager_secret.compliance_writer[0].arn : ""
  }
  ```
  Same for drainer + reader.
- Thread through `terraform/modules/thinkwork/main.tf:200+` — pass to `module.api` and (when U4 lands) to a future `module.compliance_drainer`. For this PR, threading to `module.api` is sufficient — graphql-http will pick up `compliance_reader_secret_arn` in U10.

**Patterns to follow:**
- `terraform/modules/data/aurora-postgres/main.tf:269-286` (master `db_credentials` secret declaration).
- `terraform/modules/app/lambda-api/oauth-secrets.tf:23-43` (slash-delimited naming + `lifecycle.ignore_changes`).
- `terraform/modules/data/aurora-postgres/outputs.tf:11-14` (existing secret ARN output pattern).

**Test scenarios:**
- *Happy path:* `terraform plan` shows 3 new `aws_secretsmanager_secret` resources + 3 new outputs + 0 changes to existing infrastructure.
- *Edge case:* `count = local.create ? 1 : 0` correctly disables resources in environments where `local.create == false`.
- *Manual smoke:* After `terraform apply` against dev (post-merge), `aws secretsmanager describe-secret --secret-id thinkwork/dev/compliance/writer-credentials` returns the new secret with empty `SecretString` (no version yet); operator populates via bootstrap script.

**Verification:** `terraform plan` clean against dev pre-merge (no infra changes yet); post-merge `terraform apply` creates 3 secrets visible in AWS console; operator runs bootstrap script (U4) to populate values.

---

- U4. **Bootstrap script `scripts/bootstrap-compliance-roles.sh`**

**Goal:** Wraps the per-stage one-time bootstrap of compliance roles + secret values. Pulls operator-supplied passwords from environment OR generates them, populates the 3 Secrets Manager secrets, runs the U2 migration with psql variable substitution.

**Requirements:** R11.

**Dependencies:** U1 (drift gate marker), U2 (the migration), U3 (Secrets Manager containers must exist).

**Files:**
- Create: `scripts/bootstrap-compliance-roles.sh` (executable bash).
- Create: `scripts/bootstrap-compliance-roles.md` OR add a README section to `terraform/modules/data/aurora-postgres/README.md` documenting when + how operators run it.

**Approach:**
- Script flow:
  1. Validate `STAGE` env var (default `dev`); abort if not set.
  2. Validate `DATABASE_URL` env var or resolve via `aws secretsmanager get-secret-value --secret-id thinkwork-${STAGE}-db-credentials` (master credentials).
  3. Read `COMPLIANCE_WRITER_PASS`, `COMPLIANCE_DRAINER_PASS`, `COMPLIANCE_READER_PASS` from env. If unset, generate via `openssl rand -base64 32` (mark these as auto-generated in script output so operator captures them).
  4. Populate Secrets Manager via `aws secretsmanager put-secret-value`:
     ```bash
     aws secretsmanager put-secret-value \
       --secret-id "thinkwork/${STAGE}/compliance/writer-credentials" \
       --secret-string "$(jq -n --arg user compliance_writer --arg pass "$COMPLIANCE_WRITER_PASS" \
         --arg host "$DB_HOST" --arg port "$DB_PORT" --arg dbname "$DB_NAME" \
         '{username: $user, password: $pass, host: $host, port: $port, dbname: $dbname}')"
     ```
     Same for drainer + reader.
  5. Apply migration:
     ```bash
     psql "$DATABASE_URL" \
       -v writer_pass="$COMPLIANCE_WRITER_PASS" \
       -v drainer_pass="$COMPLIANCE_DRAINER_PASS" \
       -v reader_pass="$COMPLIANCE_READER_PASS" \
       -f packages/database-pg/drizzle/0070_compliance_aurora_roles.sql
     ```
  6. Verify roles exist via `psql -c "\du compliance_*"`; output "✓ Bootstrap complete for ${STAGE}".
- Idempotent: re-running with the same passwords is a no-op (DO blocks check existence; secret values are overwritten via `put-secret-value` with the same string); re-running with new passwords rotates everything (ALTER ROLE + new secret version).
- Error handling: `set -euo pipefail`; AWS CLI failures abort early; psql failure leaves secrets potentially out-of-sync with roles — document recovery (re-run the script).

**Patterns to follow:**
- Existing helper scripts under `scripts/` — `bootstrap-workspace.sh` (per memory `feedback_bootstrap_script_excludes_dev_artifacts`), `build-lambdas.sh` (bash conventions).

**Test scenarios:**
- *Happy path:* Fresh greenfield bootstrap completes without error; all 3 roles exist; all 3 secrets contain valid JSON with `{username, password, host, port, dbname}`.
- *Edge case:* Re-running with same env vars is a no-op; re-running with new passwords rotates roles + secrets without introducing errors.
- *Error path:* Missing `STAGE` aborts before any AWS or psql calls; missing migration file aborts before secrets are populated; psql connection failure aborts after secrets are written (acceptable — operator re-runs).

**Verification:** Manual run on dev: `STAGE=dev bash scripts/bootstrap-compliance-roles.sh` → 3 roles + 3 secrets populated → `pnpm db:migrate-manual` exit 0.

---

## System-Wide Impact

- **Interaction graph:** U2 introduces three new Aurora roles + three Secrets Manager secrets. No existing resolver, handler, or Lambda changes — the new roles are dormant infrastructure until U3 (write helper) and U4 (drainer Lambda) wire writers and U10 (admin UI) wires the reader path.
- **Error propagation:** Migration failure pre-merge (psql variable substitution miss, password contains unexpected character) surfaces as the drift gate failing the operator's pre-merge verification; PR cannot merge until fixed. Post-merge `terraform-apply` failure on the 3 new secret resources surfaces as deploy.yml failing — investigate via CloudWatch + roll back via `terraform destroy -target=...`.
- **State lifecycle risks:** Operator could populate secret values then fail to run the migration (or vice versa), leaving roles + secrets out of sync. Bootstrap script's `set -euo pipefail` + idempotent re-run mitigate. Document recovery path in script README.
- **API surface parity:** None — U2 is pure infrastructure.
- **Integration coverage:** Per-role grant boundaries verified by integration tests (U2 unit Test scenarios, Integration row).
- **Unchanged invariants:** Master `thinkwork_admin` role + `thinkwork-${stage}-db-credentials` secret are untouched. Existing wildcard `secretsmanager:GetSecretValue` on `thinkwork/*` continues to grant Lambda read access to the new compliance secrets — acceptable interim until per-Lambda role refactor.

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Drift gate marker extension breaks for existing `creates-X:` markers | Mirror existing probe shape exactly; `--dry-run` against existing 0067/0068/0069 migrations as regression check. |
| Operator forgets to populate secrets before U4 drainer Lambda boots | Drainer Lambda's secret fetch fails fast with clear error; CloudWatch alarm on Lambda invocation failure surfaces it. Out of scope for U2 but documented. |
| Per-Lambda IAM scoping deferral leaves the wildcard surface area accessible to all Lambdas | Documented as `Deferred to Follow-Up Work`; SOC2 auditor may flag in Phase 4 — acceptable for v1 evidence-foundation. |
| RDS Proxy deferral means connection pooling is direct-to-Aurora at scale | Acceptable at current 10-tenant scale; U12 introduces Proxy before tenant count grows materially. |
| Operator-supplied passwords end up committed by mistake | Bootstrap script reads from env vars only; no tfvars touched; `gitignore` already excludes `terraform.tfvars`. |
| Bootstrap script run on wrong stage (e.g., generating passwords for prod when STAGE was unset) | `STAGE` env var validated as required, no default; misconfiguration aborts before AWS calls. |
| Idempotent role rotation (ALTER ROLE) is run on dev with stale passwords from a prior bootstrap | Re-running rotates passwords cleanly; mismatch with cached Lambda credentials triggers Lambda 401 and operator-visible failure within ~minutes (Lambda secret fetch is per-cold-start). |
| The deploy.yml drift gate doesn't run psql to apply U2 migration on subsequent stages | Cross-stage promotion is in `Scope Boundaries`; documented as future work. |

---

## Documentation / Operational Notes

- **`terraform/modules/data/aurora-postgres/README.md`** (or new file): document the bootstrap workflow — how to run `scripts/bootstrap-compliance-roles.sh` on a new stage, what env vars to set, where the secrets land, how to verify role grants.
- **PR description**: include the operator runbook for dev: "Before merging, run `STAGE=dev bash scripts/bootstrap-compliance-roles.sh` against dev (passwords auto-generated; capture the script output for the audit log)."
- **Memory update post-merge**: append U2 progress to `project_system_workflows_revert_compliance_reframe.md`; capture the deferred-RDS-Proxy decision in `project_system_workflows_revert_compliance_reframe.md` so future sessions don't re-litigate.
- **Phase 3 progression marker**: U12 (RDS Proxy + endpoints) becomes the new Deferred-to-Follow-Up unit on the master plan.

---

## Sources & References

- **Origin document (master plan):** `docs/plans/2026-05-06-011-feat-compliance-audit-event-log-plan.md`
- **Master plan U2 spec:** see master plan §"Implementation Units / Phase A — Foundation / U2"
- **Decision #4 carryforward:** master plan §"Key Technical Decisions / 4. Postgres role separation"
- **U1 just-shipped reference:** PR #880 (merged 2026-05-07); `packages/database-pg/drizzle/0069_compliance_schema.sql` is the migration template.
- **Drift gate script:** `scripts/db-migrate-manual.sh`; companion doc `docs/solutions/workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md`.
- **Lambda secret-policy precedent:** `terraform/modules/app/lambda-api/main.tf:180-204`, `terraform/modules/app/lambda-api/oauth-secrets.tf:11-43`.
- **Aurora cluster + master role:** `terraform/modules/data/aurora-postgres/main.tf:17-18, 98-124, 269-286`.
- **Module wiring:** `terraform/modules/data/aurora-postgres/outputs.tf:11-14` → `terraform/modules/thinkwork/main.tf:200-202, 340`.

---
title: Hand-rolled migration with a required psql variable bricks customer deploys
date: 2026-07-09
category: integration-issues
module: deployment-control-plane
problem_type: integration_issue
component: database
severity: high
symptoms:
  - "Customer deploy of v0.1.0-canary.334 to TEI failed with runner exit 1 during migration apply"
  - "psql reported ERROR - syntax error at or near \":\" on 0227_analyst_reader_role.sql (psql exit 3 under ON_ERROR_STOP)"
  - "The :'reader_pass' token was left unsubstituted because the CodeBuild runner passes only -v stage=<stage>"
  - "Dev never reproduced it — 0227 was applied there via scripts/bootstrap-analyst-roles.sh which defines the reader_pass psql variable"
root_cause: config_error
resolution_type: migration
related_components:
  - deployment-control-plane-runner
  - packages/database-pg
  - analyst-broker
tags:
  - psql-variables
  - hand-rolled-migrations
  - customer-deploy
  - drizzle
  - analyst-reader-role
  - deployment-runner
  - think-228
---

# Hand-rolled migration with a required psql variable bricks customer deploys

## Problem

Deploying release `v0.1.0-canary.334` to the TEI customer environment failed in the deployment-control-plane runner's migration sweep. The runner (`terraform/modules/app/deployment-control-plane/runner.py`, executed inside customer-account CodeBuild) applies every `packages/database-pg/drizzle/*.sql` file not yet recorded in the customer DB's `public.platform_schema_migrations` ledger. Its generic apply path passes exactly one psql variable — `stage`:

```python
# terraform/modules/app/deployment-control-plane/runner.py:2291 (apply_migration_file)
psql(database_url, file=path, variables={"stage": vars_json["stage"]})
```

with `psql()` (runner.py:2214) building `psql <url> -v ON_ERROR_STOP=1 -v stage=<stage> -f <file>`.

The hand-rolled migration `packages/database-pg/drizzle/0227_analyst_reader_role.sql` (THINK-228 U2, the `analyst_reader` Aurora role) contained:

```sql
SET LOCAL "thinkwork.analyst_reader_pass" = :'reader_pass';
```

`reader_pass` is a psql client-side variable. When psql is invoked without `-v reader_pass=...`, the `:'reader_pass'` token is left **unsubstituted** in the SQL sent to the server, so Postgres sees a literal `:` and errors. The migration author designed for exactly one apply path — the dev bootstrap script `scripts/bootstrap-analyst-roles.sh`, which defines the `reader_pass` psql variable (via a mode-0600 `\set` preamble file, deliberately keeping the password off argv) and stores the password in Secrets Manager — and never for the customer runner's ledger sweep, which is a **second apply path** that runs every unrecorded drizzle file with only `stage`. Dev never hit this because 0227 reached dev via the bootstrap script; TEI hit it the first time the ledger sweep encountered the file.

## Symptoms

- Customer controller update for TEI reported `FAILED` on release `v0.1.0-canary.334`.
- Runner log: `psql:...0227_analyst_reader_role.sql: ERROR:  syntax error at or near ":"` — psql exit code 3 (`ON_ERROR_STOP`), runner exit 1.
- The failure was safe: the runner wrote the status pointer with the prior release (`v0.1.0-canary.332`) carried as active; the customer environment stayed healthy on the previous release.
- Dev environments were unaffected (0227 already recorded there via the bootstrap-script path).

## What Didn't Work

The original migration's implicit assumption: that its documented manual-apply paths (the bootstrap script's preamble-defined variable, or direct apply with `-v reader_pass=...`) were the *only* ways the file would ever be executed. The file even documented the direct-apply invocation in its header — but documentation on the file cannot constrain the runner, whose sweep applies **every** unrecorded `drizzle/*.sql` uniformly with only the `stage` variable. Any migration that hard-requires another psql variable is guaranteed to fail the first time it reaches an environment whose ledger hasn't recorded it.

Note the migration-precheck CI gate (`db:migrate-manual` vs dev) could not catch this: it checks object *existence* against dev, not runner-*applyability* — and dev already had the objects. The first real test of runner-applyability was a customer deploy.

## Solution

PR #3565 (merged to `main`, shipped in `v0.1.0-canary.335`) makes the variable optional using psql's conditional meta-commands. The landed code in `packages/database-pg/drizzle/0227_analyst_reader_role.sql`:

```sql
-- The reader password is OPTIONAL. Supplied (-v reader_pass=...) it is used
-- verbatim (dev bootstrap path, which also stores it in Secrets Manager).
-- Absent — the customer deployment runner's migration sweep passes only
-- `stage` — a random throwaway password is generated instead: since
-- THINK-229 the broker authenticates via RDS IAM tokens (0229 grants
-- rds_iam), the password is a dormant fallback, and operator provisioning
-- (`provisionAnalystConnector`) rotates it with a stored value on demand.
\if :{?reader_pass}
SET LOCAL "thinkwork.analyst_reader_pass" = :'reader_pass';
\else
-- DO block so the generated value never echoes into psql output (runner
-- stdout is shipped to CloudWatch).
DO $$
BEGIN
  PERFORM set_config('thinkwork.analyst_reader_pass',
                     md5(random()::text) || md5(random()::text), true);
END $$;
\endif
```

Verification: the patched file was applied to the dev DB **twice** without `-v reader_pass` — exit 0 both times, idempotent (the re-run path rotates the password and re-applies grants), and no password appeared in output. After canary.335 shipped, both the TEI and McPherson customer deploys succeeded and their ledgers record 0227–0230 as applied.

## Why This Works

- `\if :{?reader_pass}` uses psql's `:{?name}` "is this variable defined?" test (psql ≥ 10), so the same file works under both apply paths: the bootstrap script's variable-supplying invocation takes the `SET LOCAL ... :'reader_pass'` branch; the runner's variable-less invocation takes the generated-password branch. No caller changes needed.
- The generated-password branch deliberately uses `DO $$ ... PERFORM set_config(...) $$` instead of `SELECT set_config(...)`: a SELECT would print the generated password into psql stdout, and the customer runner ships that stdout to CloudWatch logs. `PERFORM` inside a DO block sets the GUC without echoing the value.
- The throwaway password is safe to lose: since THINK-229 the analyst query broker authenticates to Aurora with RDS IAM tokens (`0229_analyst_reader_rds_iam_grant.sql` grants `rds_iam` to `analyst_reader`), so the role password is a dormant fallback; and `provisionAnalystConnector` rotates it with a stored value when an operator provisions the analyst connector. Downstream statements read the GUC via `current_setting('thinkwork.analyst_reader_pass')` inside `format(... %L ...)`, identically in both branches.
- The runner's failure handling was already correct (status pointer carried the prior active release), which is why the incident was a blocked deploy rather than an outage.

## Prevention

1. **Durable rule:** any hand-rolled migration in `packages/database-pg/drizzle/` that consumes a psql variable other than `stage` WILL brick customer deploys the moment it reaches an environment whose `platform_schema_migrations` ledger hasn't recorded it — the runner's sweep (`apply_migration_file`) passes only `stage`. Either avoid psql variables entirely, or guard every non-`stage` variable with `\if :{?var}` plus a safe default branch that works unattended.
2. **When adding a psql-variable migration, audit the tree for siblings:** `grep -rn ":'" packages/database-pg/drizzle/*.sql`. Current state: 0031 and 0070 are special-cased by name in `apply_migration_file` (0031 is replaced with inline SQL; 0070 routes through `ensure_compliance_roles`, which generates and passes the compliance passwords — runner.py:2242–2269); 0076/0114/0212 use variables but are already recorded in both customer ledgers, so the sweep skips them; anything new and unrecorded must be `stage`-only or `\if`-guarded.
3. **Never `SELECT set_config(...)` with secret material in migration SQL** — use `DO $$ BEGIN PERFORM set_config(...); END $$;` so the value doesn't echo into psql stdout (which customer runners ship to CloudWatch).
4. **Know the gate's blind spot:** the migration-precheck CI gate (`db:migrate-manual` vs dev) verifies object existence, not runner-applyability, so it cannot catch this class. Treat "does this file run under `psql -v ON_ERROR_STOP=1 -v stage=<stage> -f <file>` with no other variables?" as a mandatory self-check for every new hand-rolled migration — the first automated test of it is a customer deploy.

## Related Issues

- [Runner guardrail preconditions need a bootstrap fallback](../workflow-issues/runner-guardrail-preconditions-need-bootstrap-fallback-2026-07-04.md) — same failure class: a runner-consumed input that pre-existing customer stacks never supplied; same fix shape (optional input + safe default).
- [Manually applied Drizzle migrations drift from dev](../workflow-issues/manually-applied-drizzle-migrations-drift-from-dev-2026-04-21.md) — the governing hand-rolled-migration convention this incident adds a constraint to (customer runner is a second apply path; variables beyond `stage` must be optional).
- [Analyst external Postgres role provisioning runbook](../security/analyst-external-postgres-role-provisioning-runbook-2026-07.md) — cites 0227's password-rotation pattern; the owned-Aurora migration no longer requires a supplied password.
- [RDS IAM auth, Lambda to Aurora](../security/rds-iam-auth-lambda-to-aurora-2026-07.md) — the safety rationale for the throwaway password (broker auth is RDS IAM).
- [Customer control plane frozen bootstrap incompatibility](./customer-control-plane-frozen-bootstrap-incompatibility.md) — prior customer-runner deploy failure with the same safe-failure semantics.

# Runbook: provisioning `analyst_reader` on an external/customer Postgres

**Context:** THINK-231 (parent THINK-228). When the Analyst connects to a
Postgres database Thinkwork does **not** administer, the read-only role
cannot be created by our migrations (`drizzle/0227` + `0229` only run
against Thinkwork-owned Aurora). This runbook is the DBA-executable
equivalent: it reproduces 0227's KTD7 adversarial-author hardening on a
database where the customer's DBA holds the keys, and defines the
verification handshake that lets our reconciler accept the connection.

Companion design record:
`docs/solutions/architecture-patterns/analyst-external-postgres-dual-plane-2026-07.md`
(network plane — public MCP face → VPC-attached executor clerk Lambda).
This runbook covers only the **database-side ceremony**.

## Threat model recap (why every step exists)

The query author is an LLM. The hard write barrier is the **grant
surface** (SELECT-only, generated from the semantic model); role
attributes and session GUCs are defense-in-depth behind it. The broker
issues `DISCARD ALL` before every query, so USERSET GUC resets by the
model do not persist — but the role-level defaults must still be set so a
fresh session starts hardened.

## Prerequisites

- A semantic model for the customer source must exist first (table +
  column grant surface, secret-bearing tables denied, mixed tables
  column-scoped). The GRANT section below is **generated from it** — never
  hand-enumerated. For the Thinkwork source this is
  `packages/database-pg/src/analyst/semantic-model.ts` → the generated
  section of 0227; an external source needs the same generator run against
  its introspected schema.
- Postgres ≥ 13 (14+ preferred). AWS RDS/Aurora, self-hosted, and other
  clouds all work; the IAM-token step is RDS-only.
- The customer DBA runs everything below from a superuser-equivalent
  (on RDS: the master user, which is `rds_superuser`, _not_ superuser —
  the ceremony is written to stay within that).

## Step 1 — role creation + attribute hardening

```sql
-- One statement; attributes are pinned at creation. On RDS, ALTER ROLE
-- mentioning superuser-class attributes later fails for rds_superuser,
-- so re-runs must only rotate the password (see 0227's DO-block pattern).
CREATE ROLE analyst_reader WITH LOGIN PASSWORD '<generated-32+-char-secret>'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS NOREPLICATION;
```

No role memberships, ever (blocks `SET ROLE` escalation). On RDS with IAM
auth available, `GRANT rds_iam TO analyst_reader` is the **only**
allowlisted membership — and note it _disables_ password login the moment
it is granted (see "Credential posture" below before choosing).

## Step 2 — role-level session defaults

```sql
ALTER ROLE analyst_reader SET default_transaction_read_only = on;
ALTER ROLE analyst_reader SET statement_timeout = '15s';
ALTER ROLE analyst_reader SET idle_in_transaction_session_timeout = '30s';
ALTER ROLE analyst_reader SET search_path = <granted-schema>;
```

`search_path` pins to the schema(s) the semantic model covers (for the
Thinkwork source: `public`).

## Step 3 — database-wide ACL revokes

```sql
REVOKE CREATE ON SCHEMA <granted-schema> FROM PUBLIC;  -- no-op on PG >= 15
REVOKE TEMP ON DATABASE <dbname> FROM PUBLIC;
```

**Customer impact check (do not skip):** these mutate ACLs for _every_
non-owner role in the database. Before applying, the DBA must audit which
of their own roles rely on PUBLIC `CREATE`/`TEMP` and grant those back
explicitly (our own 0227 documents the same audit for `compliance_*`).
If the customer cannot accept the revoke, record the exception in the
connection's design notes — the grant surface remains the hard barrier.

## Step 4 — SECURITY DEFINER audit

A definer function can flip `read_only` inside its own body. Enumerate
them and remove PUBLIC EXECUTE, granting back to the roles that need them:

```sql
SELECT n.nspname, p.proname
FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE p.prosecdef AND n.nspname = '<granted-schema>';
-- for each: REVOKE EXECUTE ON FUNCTION ... FROM PUBLIC;
--           GRANT EXECUTE ... TO <customer roles that need it>;
```

## Step 5 — generated SELECT grants (never hand-written)

Apply the generated grant section for this source's semantic model:
full-table `GRANT SELECT` for clean tables, column-list
`GRANT SELECT (col, ...)` for mixed tables, nothing for denied tables.
Every statement is wrapped in a `to_regclass` guard so schema drift skips
rather than fails. Fail-closed property: a table created after this apply
is unreadable until the model is regenerated and the grants re-applied.

## Step 6 — verification (mirrors the reconciler probe)

The DBA (or we, once connected) runs the same checks
`packages/api/src/lib/analyst/connection-probe.ts` enforces on schedule:

```sql
-- attribute hardening held
SELECT rolsuper OR rolcreatedb OR rolcreaterole OR rolinherit
       OR rolbypassrls OR rolreplication AS any_violation
FROM pg_roles WHERE rolname = 'analyst_reader';           -- expect f

-- zero write privileges anywhere
SELECT count(*) FROM information_schema.role_table_grants
WHERE grantee = 'analyst_reader' AND privilege_type <> 'SELECT';  -- expect 0

-- per-column SELECT on the granted surface (column-level grants do NOT
-- satisfy has_table_privilege — probe checks has_column_privilege;
-- learned live on dev 2026-07-09)
SELECT has_column_privilege('analyst_reader', 'public.<table>', '<col>', 'SELECT');
```

Once the connection is registered, the scheduled reconciler repeats these
plus the schema-drift hash on every run; a failing verdict withholds the
connection from dispatch with a visible reason (fail-closed, THINK-229 U5).

## Credential posture

- **Customer RDS/Aurora with IAM auth**: preferred. Customer grants
  `rds_iam`, provides the cluster resource id; our executor role gets
  `rds-db:connect` cross-account (or the customer runs a proxy identity).
  Password login stops working at grant time — coordinate the cutover.
- **Everything else**: password credential, stored ONLY in Secrets Manager
  under `thinkwork/<stage>/analyst/<source-slug>-reader-credential`,
  referenced by ARN from the connector row (secretRef-only, never a
  value in the row). TLS required with server-cert verification; for
  RDS-family hosts the embedded RDS CA bundle applies
  (`packages/lambda/rds-ca-bundle.ts`), other hosts must supply their CA.
- Rotation: password rotation is a re-run of Step 1's ALTER-password path
  plus a Secrets Manager PutSecretValue; the broker fetches per-invocation
  and needs no deploy.

## Network plane (pointer)

An external DB reachable only inside a customer VPC/allowlist uses the
dual-plane shape from the design record: the public broker validates,
classifies, and audits, then direct-invokes the single VPC-attached
executor Lambda that holds the only security-group route. One stable
egress identity for the customer's allowlist. Until the first such
customer connects, this remains design-only — the runbook above is the
part the customer's DBA can execute today against any reachable Postgres.

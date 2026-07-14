/**
 * Auto-provision a hardened read-only reader role on an internal cluster
 * (THINK-239, schema-scoped by THINK-283).
 *
 * Implements the DBA runbook posture programmatically in ONE connection to the
 * target database, run as the cluster master user:
 *   docs/solutions/security/analyst-external-postgres-role-provisioning-runbook-2026-07.md
 *
 * Role attributes are pinned at creation (NOSUPERUSER … NOREPLICATION); role-
 * level session GUCs are set as defaults. The grant surface is SELECT on the
 * CURRENT ordinary base tables of exactly ONE selected schema — never
 * `ALL TABLES`, and never `ALTER DEFAULT PRIVILEGES` future grants: a table
 * created after registration stays unreadable until an operator refresh
 * re-runs this reconciliation (THINK-283 R7/R8). The reader's own access to
 * every other user schema is revoked (their objects are otherwise untouched),
 * and the legacy pre-THINK-283 default ACL on `public` is repaired on every
 * run.
 *
 * Idempotency: if the role already exists we rotate its password and re-apply
 * the grants (a registration retry must not dead-end). On RDS, ALTER ROLE
 * mentioning superuser-class attributes fails for rds_superuser, so the re-run
 * path only touches the password + grants, never the attributes.
 *
 * Identifiers cannot be parameterized — role/database names are validated
 * against ^[a-z0-9_]+$ and double-quoted before interpolation; schema/table
 * names come from the server's own catalog within this same connection and
 * are rendered through the shared PostgreSQL identifier-quoting boundary
 * (quotePgIdentifier), so mixed-case or punctuation-bearing names stay one
 * identifier. The generated password is base64url (alphanumerics + `-` `_`),
 * so it is safe inside a single-quoted SQL literal.
 */

import { randomBytes } from "node:crypto";

import { quotePgIdentifier } from "@thinkwork/database-pg/analyst";

import {
  AnalystRegistrationInputError,
  AnalystRegistrationPostureError,
} from "./register-data-source.js";

/** Safe unquoted identifier body — validated before interpolation. */
export const READER_IDENTIFIER_PATTERN = /^[a-z0-9_]+$/;

/** Postgres role name for a source slug: `<slug_with_underscores>_reader`. */
export function readerRoleName(slug: string): string {
  return `${slug.replace(/-/g, "_")}_reader`.slice(0, 63);
}

/** A 32-char base64url secret (24 random bytes) — safe in a SQL string literal. */
export function generateReaderPassword(): string {
  return randomBytes(24).toString("base64url");
}

export function assertSafeIdentifier(name: string, label: string): void {
  if (!READER_IDENTIFIER_PATTERN.test(name)) {
    throw new AnalystRegistrationInputError(
      `${label} "${name}" is not a safe SQL identifier (expected ${READER_IDENTIFIER_PATTERN.source})`,
    );
  }
}

/**
 * PostgreSQL-owned schemas are never selectable analyst surfaces
 * (THINK-283). `pg_temp_*`/`pg_toast*` fall under the `pg_` prefix.
 */
export function isSystemPgSchema(schema: string): boolean {
  return schema === "information_schema" || schema.startsWith("pg_");
}

/** Reject NUL bytes, empty names, and system schemas before any SQL renders. */
export function assertSelectableSchemaName(schema: string): void {
  if (!schema || schema.includes("\0")) {
    throw new AnalystRegistrationInputError(
      "schema name is empty or contains invalid characters",
    );
  }
  if (isSystemPgSchema(schema)) {
    throw new AnalystRegistrationInputError(
      `schema "${schema}" is a PostgreSQL system schema and cannot be registered as an analyst source`,
    );
  }
}

/** Minimal pg.Client surface the provisioner needs (mockable in tests). */
export interface ProvisionClient {
  query(
    text: string,
    params?: unknown[],
  ): Promise<{ rows: Record<string, unknown>[] }>;
}

export interface ProvisionReaderRoleParams {
  client: ProvisionClient;
  /** Target database (already the client's connected database). */
  database: string;
  roleName: string;
  password: string;
  /** The ONE selected schema, raw catalog case (THINK-283). */
  schema: string;
}

export interface ProvisionedReaderSurface {
  /** Raw names of the current base tables granted in the selected schema. */
  grantedTables: string[];
}

/**
 * Ordinary base tables (plus partitioned parents) in one schema — the ONLY
 * relation kinds THINK-283 models and grants. Views can read other schemas
 * under their owner's privileges; matviews/foreign tables are likewise
 * unsupported surface.
 */
const ELIGIBLE_BASE_TABLES_SQL = `SELECT c.relname AS name
   FROM pg_class c
   JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = $1 AND c.relkind IN ('r', 'p')
  ORDER BY c.relname`;

/** Non-system schemas other than the selected one (raw catalog names). */
const OTHER_USER_SCHEMAS_SQL = `SELECT n.nspname AS name
   FROM pg_namespace n
  WHERE n.nspname <> $1
    AND n.nspname <> 'information_schema'
    AND n.nspname NOT LIKE 'pg\\_%'
  ORDER BY n.nspname`;

/**
 * Effective SELECT surface outside the contract: any relation the role can
 * read that is NOT an eligible base table of the selected schema. Uses
 * privilege functions (not role_table_grants) so inherited role membership
 * and PUBLIC grants are included.
 */
const UNEXPECTED_SELECT_SQL = `SELECT n.nspname AS schema, c.relname AS name, c.relkind::text AS relkind
   FROM pg_class c
   JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname <> 'information_schema'
    AND n.nspname NOT LIKE 'pg\\_%'
    AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
    AND has_table_privilege($1, c.oid, 'SELECT')
    AND NOT (n.nspname = $2 AND c.relkind IN ('r', 'p'))
  ORDER BY n.nspname, c.relname
  LIMIT 20`;

/** Any effective write privilege anywhere is an isolation failure. */
const EFFECTIVE_WRITE_SQL = `SELECT n.nspname AS schema, c.relname AS name
   FROM pg_class c
   JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname <> 'information_schema'
    AND n.nspname NOT LIKE 'pg\\_%'
    AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
    AND has_table_privilege($1, c.oid, 'INSERT, UPDATE, DELETE, TRUNCATE')
  ORDER BY n.nspname, c.relname
  LIMIT 20`;

/** Schema-creation capability on any user schema breaks the read-only posture. */
const SCHEMA_CREATE_SQL = `SELECT n.nspname AS schema
   FROM pg_namespace n
  WHERE n.nspname <> 'information_schema'
    AND n.nspname NOT LIKE 'pg\\_%'
    AND has_schema_privilege($1, n.oid, 'CREATE')
  ORDER BY n.nspname
  LIMIT 20`;

function formatSurface(
  rows: Record<string, unknown>[],
  render: (row: Record<string, unknown>) => string,
): string {
  return rows.slice(0, 5).map(render).join(", ");
}

/**
 * Apply the runbook posture for one selected schema. The client MUST already
 * be connected to {@link ProvisionReaderRoleParams.database} as a
 * master/rds_superuser user.
 *
 * Order matters: the selected schema is validated against the live catalog
 * BEFORE any role mutation (a missing/empty schema performs no writes), and
 * the effective privilege surface is verified LAST so an inherited or PUBLIC
 * grant that this function cannot revoke fails the provisioning with DBA
 * remediation instead of shipping an over-privileged reader.
 */
export async function provisionReaderRole(
  params: ProvisionReaderRoleParams,
): Promise<ProvisionedReaderSurface> {
  const { client, roleName, database, password, schema } = params;
  assertSafeIdentifier(roleName, "role");
  assertSafeIdentifier(database, "database");
  assertSelectableSchemaName(schema);
  const r = `"${roleName}"`;
  const d = `"${database}"`;
  const s = quotePgIdentifier(schema);

  // Step 0 — validate the selected schema against the live catalog before any
  // role mutation: a missing or empty schema must leave the database untouched.
  const schemaRow = await client.query(
    "SELECT 1 FROM pg_namespace WHERE nspname = $1",
    [schema],
  );
  if (schemaRow.rows.length === 0) {
    throw new AnalystRegistrationInputError(
      `schema "${schema}" does not exist in database "${database}"`,
    );
  }
  const eligible = await client.query(ELIGIBLE_BASE_TABLES_SQL, [schema]);
  const grantedTables = eligible.rows.map((row) => String(row.name));
  if (grantedTables.length === 0) {
    throw new AnalystRegistrationInputError(
      `schema "${schema}" in database "${database}" contains no eligible base tables — ` +
        "select a schema with at least one ordinary table",
    );
  }

  // Step 1 — role creation with attribute hardening, OR password rotation on a
  // re-run (attributes are pinned at creation and must not be re-set on RDS).
  const existing = await client.query(
    "SELECT 1 FROM pg_roles WHERE rolname = $1",
    [roleName],
  );
  if (existing.rows.length === 0) {
    await client.query(
      `CREATE ROLE ${r} WITH LOGIN PASSWORD '${password}' ` +
        "NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS NOREPLICATION",
    );
  } else {
    await client.query(`ALTER ROLE ${r} WITH PASSWORD '${password}'`);
  }

  // Step 2 — role-level session defaults (a fresh session starts hardened,
  // resolving names only in the selected schema).
  await client.query(`ALTER ROLE ${r} SET default_transaction_read_only = on`);
  await client.query(`ALTER ROLE ${r} SET statement_timeout = '15s'`);
  await client.query(
    `ALTER ROLE ${r} SET idle_in_transaction_session_timeout = '30s'`,
  );
  await client.query(`ALTER ROLE ${r} SET search_path = ${s}`);

  // Step 3 — SELECT grants on the CURRENT base tables of the selected schema
  // only. No ALL TABLES, no default privileges: future tables stay unreadable
  // until an operator refresh re-runs this reconciliation (THINK-283 R7/R8).
  await client.query(`GRANT CONNECT ON DATABASE ${d} TO ${r}`);
  await client.query(`GRANT USAGE ON SCHEMA ${s} TO ${r}`);
  for (const table of grantedTables) {
    await client.query(
      `GRANT SELECT ON ${s}.${quotePgIdentifier(table)} TO ${r}`,
    );
  }

  // Step 4 — repair the legacy pre-THINK-283 future-object grant. Earlier
  // provisioning ran `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT`
  // under this same admin user; revoking it here is idempotent and strips
  // automatic future access from retried/legacy readers.
  await client.query(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE SELECT ON TABLES FROM ${r}`,
  );

  // Step 5 — revoke this reader's direct access to every OTHER user schema
  // (including `public` when it is not the selection). Scoped strictly to the
  // provisioned role — never a database-wide REVOKE ... FROM PUBLIC.
  const others = await client.query(OTHER_USER_SCHEMAS_SQL, [schema]);
  for (const row of others.rows) {
    const other = quotePgIdentifier(String(row.name));
    await client.query(
      `REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA ${other} FROM ${r}`,
    );
    await client.query(`REVOKE ALL ON SCHEMA ${other} FROM ${r}`);
  }

  // Step 6 — database-wide ACL revokes from PUBLIC (scoped to this database).
  await client.query("REVOKE CREATE ON SCHEMA public FROM PUBLIC");
  await client.query(`REVOKE TEMP ON DATABASE ${d} FROM PUBLIC`);

  // Step 7 — verify the EFFECTIVE surface (role membership + PUBLIC grants
  // included). Anything readable outside the selected schema's base tables,
  // any write capability, or schema-creation rights means the surface cannot
  // be isolated by this function — fail with DBA remediation rather than
  // changing database-wide policy (THINK-283).
  const unexpected = await client.query(UNEXPECTED_SELECT_SQL, [
    roleName,
    schema,
  ]);
  if (unexpected.rows.length > 0) {
    const sample = formatSurface(
      unexpected.rows,
      (row) =>
        `${String(row.schema)}.${String(row.name)} (${String(row.relkind)})`,
    );
    throw new AnalystRegistrationPostureError(
      `provisioned reader "${roleName}" can still read objects outside the selected ` +
        `schema's base tables (${sample}) — likely an inherited role or PUBLIC grant. ` +
        "Have a DBA revoke those grants and retry; ThinkWork will not alter " +
        "database-wide policy.",
    );
  }
  const writable = await client.query(EFFECTIVE_WRITE_SQL, [roleName]);
  if (writable.rows.length > 0) {
    const sample = formatSurface(
      writable.rows,
      (row) => `${String(row.schema)}.${String(row.name)}`,
    );
    throw new AnalystRegistrationPostureError(
      `provisioned reader "${roleName}" holds effective write privileges (${sample}) — ` +
        "likely an inherited role or PUBLIC grant. Have a DBA revoke them and retry.",
    );
  }
  const creatable = await client.query(SCHEMA_CREATE_SQL, [roleName]);
  if (creatable.rows.length > 0) {
    const sample = formatSurface(creatable.rows, (row) => String(row.schema));
    throw new AnalystRegistrationPostureError(
      `provisioned reader "${roleName}" can CREATE in schema(s) ${sample} — ` +
        "likely a PUBLIC or inherited grant. Have a DBA revoke CREATE and retry.",
    );
  }

  return { grantedTables };
}

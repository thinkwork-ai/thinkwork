/**
 * Auto-provision a hardened read-only reader role on an internal cluster
 * (THINK-239).
 *
 * Implements the DBA runbook posture programmatically in ONE connection to the
 * target database, run as the cluster master user:
 *   docs/solutions/security/analyst-external-postgres-role-provisioning-runbook-2026-07.md
 *
 * Role attributes are pinned at creation (NOSUPERUSER … NOREPLICATION); role-
 * level session GUCs are set as defaults; the grant surface is SELECT-only on
 * the public schema; PUBLIC's CREATE/TEMP are revoked. STRICTLY the `public`
 * schema — never touch symphony.* or any other schema.
 *
 * Idempotency: if the role already exists we rotate its password and re-apply
 * the grants (a registration retry must not dead-end). On RDS, ALTER ROLE
 * mentioning superuser-class attributes fails for rds_superuser, so the re-run
 * path only touches the password + grants, never the attributes.
 *
 * Identifiers cannot be parameterized — role/database names are validated
 * against ^[a-z0-9_]+$ and double-quoted before interpolation. The generated
 * password is base64url (alphanumerics + `-` `_`), so it is safe inside a
 * single-quoted SQL literal.
 */

import { randomBytes } from "node:crypto";

import { AnalystRegistrationInputError } from "./register-data-source.js";

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
}

/**
 * Apply the runbook posture. The client MUST already be connected to
 * {@link ProvisionReaderRoleParams.database} as a master/rds_superuser user.
 */
export async function provisionReaderRole(
  params: ProvisionReaderRoleParams,
): Promise<void> {
  const { client, roleName, database, password } = params;
  assertSafeIdentifier(roleName, "role");
  assertSafeIdentifier(database, "database");
  const r = `"${roleName}"`;
  const d = `"${database}"`;

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

  // Step 2 — role-level session defaults (a fresh session starts hardened).
  await client.query(`ALTER ROLE ${r} SET default_transaction_read_only = on`);
  await client.query(`ALTER ROLE ${r} SET statement_timeout = '15s'`);
  await client.query(
    `ALTER ROLE ${r} SET idle_in_transaction_session_timeout = '30s'`,
  );
  await client.query(`ALTER ROLE ${r} SET search_path = public`);

  // Step 5 — SELECT-only grant surface on the public schema (and future tables).
  await client.query(`GRANT CONNECT ON DATABASE ${d} TO ${r}`);
  await client.query(`GRANT USAGE ON SCHEMA public TO ${r}`);
  await client.query(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${r}`);
  await client.query(
    `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO ${r}`,
  );

  // Step 3 — database-wide ACL revokes from PUBLIC (scoped to this database).
  await client.query("REVOKE CREATE ON SCHEMA public FROM PUBLIC");
  await client.query(`REVOKE TEMP ON DATABASE ${d} FROM PUBLIC`);
}

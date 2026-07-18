/**
 * Deploy-time owner-tenant pre-provision.
 *
 * A fresh self-hosted stack has no code path that creates the first tenant:
 * the web shell deliberately never auto-bootstraps (ADV-9 on PR #959 — an
 * unconditional bootstrapUser would promote any signed-in end user to
 * operator of a fresh empty tenant). Deploy therefore pre-provisions ONE
 * tenant and binds the exact Cognito subject it just created as owner. Email
 * remains profile data and never selects the authorized principal.
 *
 * Guarded to genuinely-first installs: the insert only happens when the
 * tenants table is EMPTY, so established stages (multi-tenant dev/prod,
 * reruns after the claim) are never touched.
 */

import { randomBytes } from "node:crypto";
import {
  isReservedTenantSlug,
  TENANT_SLUG_PATTERN,
} from "@thinkwork/database-pg/utils/reserved-slugs";
import {
  connectPsql,
  type PgConnection,
  type SqlRunner,
} from "./db-migrations.js";

/**
 * Derive the first tenant's slug from the stage name — customer stages are
 * named for the customer (hci, mcpherson) and the platform rule is that a
 * customer deployment's tenant slug matches its delegated domain name.
 * Falls back to a random slug when the stage name can't be a slug (reserved
 * words like "dev"/"prod", or shapes the pattern rejects); the operator can
 * rename it in settings.
 */
export function deriveOwnerTenantSlug(
  stage: string,
  random: () => string = () => randomBytes(3).toString("hex"),
): string {
  const sanitized = stage
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (TENANT_SLUG_PATTERN.test(sanitized) && !isReservedTenantSlug(sanitized)) {
    return sanitized;
  }
  return `workspace-${random()}`;
}

/** Title-case the slug for the tenant's display name (hci → Hci → HCI is a
 * settings rename away; this only needs to be presentable, not perfect). */
export function deriveOwnerTenantName(slug: string): string {
  return slug
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function sqlQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Insert-if-first SQL: atomically creates the tenant, user, membership, and
 * exact native Cognito identity only when no tenant exists yet.
 */
export function buildEnsureOwnerTenantSql(input: {
  name: string;
  slug: string;
  email: string;
  cognitoSub: string;
  cognitoUserPoolId: string;
  cognitoIssuer: string;
}): string {
  const name = sqlQuote(input.name);
  const slug = sqlQuote(input.slug);
  const email = sqlQuote(input.email.toLowerCase());
  const cognitoSub = sqlQuote(input.cognitoSub);
  const cognitoUserPoolId = sqlQuote(input.cognitoUserPoolId);
  const cognitoIssuer = sqlQuote(input.cognitoIssuer);
  return (
    `WITH local_connection AS (\n` +
    `  SELECT id FROM auth_provider_resources\n` +
    `  WHERE cognito_user_pool_id = ${cognitoUserPoolId}\n` +
    `    AND provider_kind = 'local'\n` +
    `    AND cognito_identity_provider_name = 'COGNITO'\n` +
    `    AND lifecycle_state = 'native'\n` +
    `    AND validation_status IN ('valid', 'partially_valid')\n` +
    `  ORDER BY id LIMIT 1\n` +
    `), new_tenant AS (\n` +
    `  INSERT INTO tenants (name, slug, issue_prefix, issue_counter)\n` +
    `  SELECT ${name}, ${slug}, 'TW', 0\n` +
    `  WHERE NOT EXISTS (SELECT 1 FROM tenants)\n` +
    `    AND EXISTS (SELECT 1 FROM local_connection)\n` +
    `  RETURNING id\n` +
    `), new_settings AS (\n` +
    `  INSERT INTO tenant_settings (tenant_id) SELECT id FROM new_tenant\n` +
    `  ON CONFLICT DO NOTHING RETURNING tenant_id\n` +
    `), new_user AS (\n` +
    `  INSERT INTO users (tenant_id, email, cognito_sub, name, workspace_folder_name)\n` +
    `  SELECT id, ${email}, ${cognitoSub}, ${name}, 'owner' FROM new_tenant\n` +
    `  RETURNING id, tenant_id\n` +
    `), new_member AS (\n` +
    `  INSERT INTO tenant_members (tenant_id, principal_type, principal_id, role, status)\n` +
    `  SELECT tenant_id, 'user', id, 'owner', 'active' FROM new_user\n` +
    `  RETURNING tenant_id\n` +
    `), new_identity AS (\n` +
    `  INSERT INTO user_auth_identities (tenant_id, user_id, auth_provider_resource_id, cognito_issuer, cognito_sub, provider_issuer, provider_subject, status, proof_kind, evidence, activated_at)\n` +
    `  SELECT u.tenant_id, u.id, c.id, ${cognitoIssuer}, ${cognitoSub}, ${cognitoIssuer}, ${cognitoSub}, 'active', 'deploy_exact_cognito_sub', jsonb_build_object('source', 'thinkwork_deploy'), now()\n` +
    `  FROM new_user u CROSS JOIN local_connection c\n` +
    `  RETURNING tenant_id\n` +
    `)\n` +
    `SELECT (SELECT tenant_id FROM new_identity LIMIT 1) AS tenant_id,\n` +
    `       EXISTS (SELECT 1 FROM local_connection) AS local_connection_ready;`
  );
}

export interface EnsureOwnerTenantResult {
  created: boolean;
  slug: string;
  email: string;
}

export async function ensureOwnerTenant(options: {
  stage: string;
  email: string;
  cognitoSub: string;
  cognitoUserPoolId: string;
  region: string;
  connection: PgConnection;
  connect?: (connection: PgConnection) => Promise<SqlRunner>;
}): Promise<EnsureOwnerTenantResult> {
  const slug = deriveOwnerTenantSlug(options.stage);
  const cognitoIssuer = `https://cognito-idp.${options.region}.amazonaws.com/${options.cognitoUserPoolId}`;
  const runner = await (options.connect ?? connectPsql)(options.connection);
  try {
    const result = (await runner.query(
      buildEnsureOwnerTenantSql({
        name: deriveOwnerTenantName(slug),
        slug,
        email: options.email,
        cognitoSub: options.cognitoSub,
        cognitoUserPoolId: options.cognitoUserPoolId,
        cognitoIssuer,
      }),
    )) as {
      rows?: Array<{
        tenant_id?: string | null;
        local_connection_ready?: boolean;
      }>;
    };
    const row = result.rows?.[0];
    if (!row?.local_connection_ready) {
      throw new Error(
        "Native Cognito metadata is not reconciled; the local owner route cannot be bound.",
      );
    }
    return {
      created: Boolean(row.tenant_id),
      slug,
      email: options.email.toLowerCase(),
    };
  } finally {
    await runner.end();
  }
}

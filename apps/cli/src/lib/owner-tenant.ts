/**
 * Deploy-time owner-tenant pre-provision.
 *
 * A fresh self-hosted stack has no code path that creates the first tenant:
 * the web shell deliberately never auto-bootstraps (ADV-9 on PR #959 — an
 * unconditional bootstrapUser would promote any signed-in end user to
 * operator of a fresh empty tenant), and the onboarding claim flow only
 * fires for Stripe checkouts. Deploy therefore pre-provisions ONE pending
 * tenant with `pending_owner_email` set to the wizard's operator email —
 * the same mechanism the Stripe webhook uses — and the web shell claims it
 * through bootstrapUser's existing, verified-email claim path on first
 * sign-in.
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
 * Insert-if-first SQL: creates the pending tenant + its settings row only
 * when no tenant exists yet. Returns the new tenant id row when created,
 * zero rows when skipped — the caller messages accordingly.
 */
export function buildEnsureOwnerTenantSql(input: {
  name: string;
  slug: string;
  email: string;
}): string {
  const name = sqlQuote(input.name);
  const slug = sqlQuote(input.slug);
  const email = sqlQuote(input.email.toLowerCase());
  return (
    `WITH new_tenant AS (\n` +
    `  INSERT INTO tenants (name, slug, issue_prefix, issue_counter, pending_owner_email, first_admin_claim_required)\n` +
    `  SELECT ${name}, ${slug}, 'TW', 0, ${email}, true\n` +
    `  WHERE NOT EXISTS (SELECT 1 FROM tenants)\n` +
    `  RETURNING id\n` +
    `)\n` +
    `INSERT INTO tenant_settings (tenant_id)\n` +
    `SELECT id FROM new_tenant\n` +
    `ON CONFLICT DO NOTHING\n` +
    `RETURNING tenant_id;`
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
  connection: PgConnection;
  connect?: (connection: PgConnection) => Promise<SqlRunner>;
}): Promise<EnsureOwnerTenantResult> {
  const slug = deriveOwnerTenantSlug(options.stage);
  const runner = await (options.connect ?? connectPsql)(options.connection);
  try {
    const result = (await runner.query(
      buildEnsureOwnerTenantSql({
        name: deriveOwnerTenantName(slug),
        slug,
        email: options.email,
      }),
    )) as { rows?: unknown[] };
    return {
      created: (result.rows ?? []).length > 0,
      slug,
      email: options.email.toLowerCase(),
    };
  } finally {
    await runner.end();
  }
}

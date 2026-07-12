/**
 * Microsoft Teams tenant install store.
 *
 * Persists the binding between a customer Entra directory (tenant) and a
 * ThinkWork tenant. One Entra tenant binds to exactly one ThinkWork tenant,
 * globally (enforced by uq_msteams_tenant_installs_entra_tenant).
 *
 * This table holds NO secret material (no tokens, no credentials) — bot
 * credentials live in Secrets Manager / SSM. Never add token or credential
 * columns here.
 */

import { and, eq, sql } from "drizzle-orm";
import { schema } from "@thinkwork/database-pg";
import { db } from "../db.js";

const { msteamsTenantInstalls } = schema;

type DbClient = typeof db;

export type MsteamsInstallStatus =
  | "pending"
  | "active"
  | "uninstalled"
  | "revoked";

export type MsteamsConsentStatus =
  | "pending"
  | "granted"
  | "admin_required"
  | "revoked";

/**
 * Thrown when an Entra tenant is already bound to a different ThinkWork
 * tenant. The existing binding is never mutated or replaced.
 */
export class MsteamsTenantConflictError extends Error {
  readonly entraTenantId: string;

  constructor(entraTenantId: string) {
    super(
      "Microsoft Teams (Entra) tenant is already bound to a different ThinkWork tenant"
    );
    this.name = "MsteamsTenantConflictError";
    this.entraTenantId = entraTenantId;
  }
}

export interface UpsertTenantInstallInput {
  tenantId: string;
  entraTenantId: string;
  botAppId: string;
  installedByUserId?: string | null;
}

/**
 * Idempotent install upsert. Replays with the same (tenantId, entraTenantId)
 * update the row and return it. A conflicting binding (same entraTenantId,
 * different tenantId) fails closed with MsteamsTenantConflictError and does
 * not mutate the existing binding.
 */
export async function upsertTenantInstall(
  input: UpsertTenantInstallInput,
  dbClient: DbClient = db
) {
  const [existing] = await dbClient
    .select({ tenant_id: msteamsTenantInstalls.tenant_id })
    .from(msteamsTenantInstalls)
    .where(eq(msteamsTenantInstalls.entra_tenant_id, input.entraTenantId))
    .limit(1);

  if (existing && existing.tenant_id !== input.tenantId) {
    throw new MsteamsTenantConflictError(input.entraTenantId);
  }

  const [row] = await dbClient
    .insert(msteamsTenantInstalls)
    .values({
      tenant_id: input.tenantId,
      entra_tenant_id: input.entraTenantId,
      bot_app_id: input.botAppId,
      installed_by_user_id: input.installedByUserId || null,
      status: "pending",
      consent_status: "pending",
      updated_at: sql`now()`,
    })
    .onConflictDoUpdate({
      target: [msteamsTenantInstalls.entra_tenant_id],
      set: {
        bot_app_id: input.botAppId,
        installed_by_user_id: input.installedByUserId || null,
        updated_at: sql`now()`,
      },
      // Guard against a concurrent insert racing the pre-check above: only
      // update when the existing row already belongs to the same tenant.
      where: eq(msteamsTenantInstalls.tenant_id, input.tenantId),
    })
    .returning();

  if (!row) {
    throw new MsteamsTenantConflictError(input.entraTenantId);
  }
  return row;
}

export async function activateTenantInstall(
  input: {
    entraTenantId: string;
    consentStatus: MsteamsConsentStatus;
  },
  dbClient: DbClient = db
) {
  const [row] = await dbClient
    .update(msteamsTenantInstalls)
    .set({
      status: "active",
      consent_status: input.consentStatus,
      installed_at: sql`now()`,
      uninstalled_at: null,
      updated_at: sql`now()`,
    })
    .where(eq(msteamsTenantInstalls.entra_tenant_id, input.entraTenantId))
    .returning();
  return row ?? null;
}

export async function markConsent(
  input: {
    entraTenantId: string;
    consentStatus: MsteamsConsentStatus;
  },
  dbClient: DbClient = db
) {
  const [row] = await dbClient
    .update(msteamsTenantInstalls)
    .set({
      consent_status: input.consentStatus,
      updated_at: sql`now()`,
    })
    .where(eq(msteamsTenantInstalls.entra_tenant_id, input.entraTenantId))
    .returning();
  return row ?? null;
}

export async function revokeTenantInstall(
  input: { entraTenantId: string },
  dbClient: DbClient = db
) {
  const [row] = await dbClient
    .update(msteamsTenantInstalls)
    .set({
      status: "revoked",
      uninstalled_at: sql`now()`,
      updated_at: sql`now()`,
    })
    .where(eq(msteamsTenantInstalls.entra_tenant_id, input.entraTenantId))
    .returning();
  return row ?? null;
}

export async function findActiveTenantInstall(
  input: { entraTenantId: string },
  dbClient: DbClient = db
) {
  const [row] = await dbClient
    .select()
    .from(msteamsTenantInstalls)
    .where(
      and(
        eq(msteamsTenantInstalls.entra_tenant_id, input.entraTenantId),
        eq(msteamsTenantInstalls.status, "active")
      )
    )
    .limit(1);
  return row ?? null;
}

/**
 * Health view for operator surfaces. The table holds no secret material, so
 * rows are safe to return as-is — keep it that way.
 */
export async function getTenantInstallStatus(
  input: { tenantId: string },
  dbClient: DbClient = db
) {
  return dbClient
    .select()
    .from(msteamsTenantInstalls)
    .where(eq(msteamsTenantInstalls.tenant_id, input.tenantId));
}

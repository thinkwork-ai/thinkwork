/**
 * Microsoft Teams user link store.
 *
 * Links a Teams user (Entra object id within an Entra tenant) to a ThinkWork
 * user. Unlike Slack (whose per-user OAuth proves control of the provider
 * account), Teams linking is redeemed with a possession-based signed token,
 * so an ACTIVE link is first-wins: rebinding it to a different ThinkWork user
 * fails closed with MsteamsLinkConflictError and requires the linked user to
 * unlink first. Relinking the same user is idempotent, and an unlinked row
 * may be reactivated by any valid redemption.
 *
 * Note: a bot/application identity must never be linkable. The webhook and
 * link handlers are responsible for rejecting an aadObjectId that equals the
 * install's bot app id (or any application identity) before calling this
 * store — the store just persists.
 */

import { and, eq, sql } from "drizzle-orm";
import { schema } from "@thinkwork/database-pg";
import { db } from "../db.js";

const { msteamsTenantInstalls, msteamsUserLinks } = schema;

type DbClient = typeof db;

/**
 * Thrown when an ACTIVE Teams identity link already belongs to a different
 * ThinkWork user. The existing link is never silently rebound.
 */
export class MsteamsLinkConflictError extends Error {
  readonly aadObjectId: string;

  constructor(aadObjectId: string) {
    super(
      "This Microsoft Teams identity is already linked to a different ThinkWork user",
    );
    this.name = "MsteamsLinkConflictError";
    this.aadObjectId = aadObjectId;
  }
}

export interface MsteamsUserLinkInput {
  tenantId: string;
  entraTenantId: string;
  aadObjectId: string;
  userId: string;
  displayName?: string | null;
}

export async function upsertUserLink(
  input: MsteamsUserLinkInput,
  dbClient: DbClient = db,
) {
  const [install] = await dbClient
    .select({
      tenant_id: msteamsTenantInstalls.tenant_id,
      status: msteamsTenantInstalls.status,
    })
    .from(msteamsTenantInstalls)
    .where(eq(msteamsTenantInstalls.entra_tenant_id, input.entraTenantId))
    .limit(1);

  if (!install) {
    throw new Error(
      "Microsoft Teams app is not installed for this ThinkWork tenant",
    );
  }
  if (install.tenant_id !== input.tenantId) {
    throw new Error(
      "Microsoft Teams app is installed for a different ThinkWork tenant",
    );
  }
  if (install.status !== "active") {
    throw new Error("Microsoft Teams tenant install is not active");
  }

  const [existing] = await dbClient
    .select({
      user_id: msteamsUserLinks.user_id,
      status: msteamsUserLinks.status,
    })
    .from(msteamsUserLinks)
    .where(
      and(
        eq(msteamsUserLinks.entra_tenant_id, input.entraTenantId),
        eq(msteamsUserLinks.aad_object_id, input.aadObjectId),
      ),
    )
    .limit(1);

  if (
    existing &&
    existing.status === "active" &&
    existing.user_id !== input.userId
  ) {
    throw new MsteamsLinkConflictError(input.aadObjectId);
  }

  const [row] = await dbClient
    .insert(msteamsUserLinks)
    .values({
      tenant_id: input.tenantId,
      entra_tenant_id: input.entraTenantId,
      aad_object_id: input.aadObjectId,
      user_id: input.userId,
      display_name: input.displayName || null,
      status: "active",
      linked_at: sql`now()`,
      unlinked_at: null,
      updated_at: sql`now()`,
    })
    .onConflictDoUpdate({
      target: [
        msteamsUserLinks.entra_tenant_id,
        msteamsUserLinks.aad_object_id,
      ],
      set: {
        tenant_id: input.tenantId,
        user_id: input.userId,
        display_name: input.displayName || null,
        status: "active",
        linked_at: sql`now()`,
        unlinked_at: null,
        updated_at: sql`now()`,
      },
      // Race guard mirroring the pre-check: never rebind a concurrently
      // activated link owned by a different user.
      where: and(
        eq(msteamsUserLinks.entra_tenant_id, input.entraTenantId),
        eq(msteamsUserLinks.aad_object_id, input.aadObjectId),
        eq(msteamsUserLinks.tenant_id, input.tenantId),
        sql`(${msteamsUserLinks.status} <> 'active' OR ${msteamsUserLinks.user_id} = ${input.userId})`,
      ),
    })
    .returning();

  if (!row) {
    throw new MsteamsLinkConflictError(input.aadObjectId);
  }
  return row;
}

export async function findActiveUserLink(
  input: { entraTenantId: string; aadObjectId: string },
  dbClient: DbClient = db,
) {
  const [row] = await dbClient
    .select()
    .from(msteamsUserLinks)
    .where(
      and(
        eq(msteamsUserLinks.entra_tenant_id, input.entraTenantId),
        eq(msteamsUserLinks.aad_object_id, input.aadObjectId),
        eq(msteamsUserLinks.status, "active"),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function unlinkUser(
  input: { entraTenantId: string; aadObjectId: string },
  dbClient: DbClient = db,
) {
  const [row] = await dbClient
    .update(msteamsUserLinks)
    .set({
      status: "unlinked",
      unlinked_at: sql`now()`,
      updated_at: sql`now()`,
    })
    .where(
      and(
        eq(msteamsUserLinks.entra_tenant_id, input.entraTenantId),
        eq(msteamsUserLinks.aad_object_id, input.aadObjectId),
      ),
    )
    .returning();
  return row ?? null;
}

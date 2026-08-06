/**
 * Company Brain per-user claims resolvers (THINK-625).
 *
 * Two reads and three writes, all gated on `requireTenantAdmin` — claims are
 * authorization data, so "any member can look" is not an option.
 *
 * Three properties every write here shares, and each one is deliberate:
 *
 *   1. **Validation before persistence.** Grant lists go through the shared
 *      `parseGrantList` used by the `tkt_` key lane, so a value one lane
 *      rejects can never be stored by the other. Invalid input fails the
 *      mutation with nothing written and nothing published.
 *   2. **Publish AFTER the transaction commits, reading fresh.** The row and
 *      its audit event are one atomic unit; the manifest is a projection of
 *      committed state. Publishing inside the transaction would risk
 *      shipping a document describing a row that then rolled back.
 *   3. **Publish failure does NOT roll back the write.** S3 being down is
 *      not a reason to lose an operator's edit — it is a reason to tell them
 *      the change has not reached the Brain yet, which is exactly what the
 *      `manifest` field in the payload is for. The UI's Retry re-publishes.
 *
 * `toolAllowlist` distinguishes absent from explicitly-null: absent leaves
 * the column untouched, null clears it back to the Brain's surface default,
 * and `[]` means no tools at all. Collapsing those would silently change
 * what a user can do.
 */

import { GraphQLError } from "graphql";
import {
  tenantMembers,
  tenantPolicyEvents,
  userBrainClaims,
} from "@thinkwork/database-pg/schema";
import type { GraphQLContext } from "../../context.js";
import { db, eq, and, snakeToCamel } from "../../utils.js";
import { requireTenantAdmin } from "./authz.js";
import { resolveCallerUserId } from "./resolve-auth-user.js";
import { parseGrantList } from "../../../lib/twin/grants.js";
import {
  publishUserClaimsManifest,
  type PublishUserClaimsManifestResult,
} from "../../../lib/twin/user-claims-manifest.js";

const POLICY_EVENT_TYPE = "user_brain_claims";

type ClaimsRow = typeof userBrainClaims.$inferSelect;

function badInput(message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code: "BAD_USER_INPUT" } });
}

/** The publish outcome the GraphQL `ManifestSyncResult` type exposes. */
function toManifestSyncResult(result: PublishUserClaimsManifestResult) {
  return {
    published: result.published,
    key: result.key ?? null,
    reason: result.reason ?? null,
  };
}

/**
 * Audit payload for tenant_policy_events. Claims carry no secret material,
 * so the whole row is safe to snapshot — and a partial snapshot would make
 * the audit trail unable to answer "what did this user have before?".
 */
function auditSnapshot(row: ClaimsRow | null): string | null {
  if (!row) return null;
  return JSON.stringify({
    userId: row.user_id,
    securityGroups: row.security_groups,
    kbCollections: row.kb_collections,
    kbBundles: row.kb_bundles,
    defaultKbBundle: row.default_kb_bundle,
    toolAllowlist: row.tool_allowlist,
    isOperator: row.is_operator,
    kbTrace: row.kb_trace,
    enabled: row.enabled,
  });
}

function parseKbBundles(raw: unknown): Record<string, string[]> {
  let value: unknown = raw;
  // AWSJSON arrives as a JSON string over the wire.
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      throw badInput("kbBundles: valid JSON object required");
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw badInput("kbBundles: valid JSON object required");
  }
  const out: Record<string, string[]> = {};
  for (const [bundle, collections] of Object.entries(
    value as Record<string, unknown>,
  )) {
    const parsed = parseGrantList(collections, `kbBundles.${bundle}`);
    if ("error" in parsed) throw badInput(parsed.error);
    out[bundle] = parsed.values;
  }
  return out;
}

/**
 * Translate the GraphQL input into a column patch. Only keys PRESENT in the
 * input are touched, so narrowing one grant list never clears another by
 * omission (same contract as the brain-api-keys PATCH route).
 */
export function buildClaimsPatch(input: Record<string, unknown>) {
  const patch: Record<string, unknown> = {};

  for (const [field, column] of [
    ["securityGroups", "security_groups"],
    ["kbCollections", "kb_collections"],
  ] as const) {
    if (input[field] === undefined || input[field] === null) continue;
    const parsed = parseGrantList(input[field], field);
    if ("error" in parsed) throw badInput(parsed.error);
    patch[column] = parsed.values;
  }

  if (input.kbBundles !== undefined && input.kbBundles !== null) {
    patch.kb_bundles = parseKbBundles(input.kbBundles);
  }

  // Present-and-null is meaningful here: it clears the allowlist back to the
  // Brain's surface default. Absent leaves the column alone.
  if ("toolAllowlist" in input) {
    if (input.toolAllowlist === null) {
      patch.tool_allowlist = null;
    } else {
      const parsed = parseGrantList(input.toolAllowlist, "toolAllowlist");
      if ("error" in parsed) throw badInput(parsed.error);
      patch.tool_allowlist = parsed.values;
    }
  }

  if (input.defaultKbBundle !== undefined) {
    const raw = input.defaultKbBundle;
    if (raw === null) {
      patch.default_kb_bundle = null;
    } else if (typeof raw !== "string") {
      throw badInput("defaultKbBundle: string required");
    } else {
      const trimmed = raw.trim();
      patch.default_kb_bundle = trimmed || null;
    }
  }

  for (const [field, column] of [
    ["isOperator", "is_operator"],
    ["kbTrace", "kb_trace"],
    ["enabled", "enabled"],
  ] as const) {
    if (input[field] === undefined || input[field] === null) continue;
    if (typeof input[field] !== "boolean")
      throw badInput(`${field}: boolean required`);
    patch[column] = input[field];
  }

  if (input.notes !== undefined) {
    const raw = input.notes;
    if (raw === null) patch.notes = null;
    else if (typeof raw !== "string") throw badInput("notes: string required");
    else patch.notes = raw;
  }

  // A default bundle nobody was granted is a misconfiguration that would
  // read as "no bundle" in the Brain — reject it at the door.
  const bundles = patch.kb_bundles as Record<string, string[]> | undefined;
  const nextDefault = patch.default_kb_bundle as string | null | undefined;
  if (bundles && nextDefault && !(nextDefault in bundles)) {
    throw badInput(
      `defaultKbBundle: "${nextDefault}" is not one of the configured kbBundles`,
    );
  }

  return patch;
}

async function requireTenantUser(
  tenantId: string,
  userId: string,
): Promise<void> {
  const [row] = await db
    .select({ id: tenantMembers.id })
    .from(tenantMembers)
    .where(
      and(
        eq(tenantMembers.tenant_id, tenantId),
        eq(tenantMembers.principal_id, userId),
        eq(tenantMembers.principal_type, "user"),
      ),
    );
  if (!row) {
    throw new GraphQLError("User is not a member of this tenant", {
      extensions: { code: "NOT_FOUND" },
    });
  }
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export const userBrainClaims_ = async (
  _parent: any,
  args: { tenantId: string; userId: string },
  ctx: GraphQLContext,
) => {
  await requireTenantAdmin(ctx, args.tenantId);
  const [row] = await db
    .select()
    .from(userBrainClaims)
    .where(
      and(
        eq(userBrainClaims.tenant_id, args.tenantId),
        eq(userBrainClaims.user_id, args.userId),
      ),
    );
  return row ? snakeToCamel(row) : null;
};

export const tenantUserBrainClaims = async (
  _parent: any,
  args: { tenantId: string },
  ctx: GraphQLContext,
) => {
  await requireTenantAdmin(ctx, args.tenantId);
  const rows = await db
    .select()
    .from(userBrainClaims)
    .where(eq(userBrainClaims.tenant_id, args.tenantId));
  return rows.map((row) => snakeToCamel(row));
};

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export const setUserBrainClaims = async (
  _parent: any,
  args: { tenantId: string; userId: string; input: Record<string, unknown> },
  ctx: GraphQLContext,
) => {
  await requireTenantAdmin(ctx, args.tenantId);
  await requireTenantUser(args.tenantId, args.userId);

  // Validate before opening a transaction: bad input must leave no trace.
  const patch = buildClaimsPatch(args.input ?? {});
  const actorUserId = await resolveCallerUserId(ctx, args.tenantId);

  const saved = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(userBrainClaims)
      .where(
        and(
          eq(userBrainClaims.tenant_id, args.tenantId),
          eq(userBrainClaims.user_id, args.userId),
        ),
      );

    let row: ClaimsRow;
    if (existing) {
      const [updated] = await tx
        .update(userBrainClaims)
        .set({
          ...patch,
          updated_at: new Date(),
          updated_by_user_id: actorUserId ?? null,
        })
        .where(eq(userBrainClaims.id, existing.id))
        .returning();
      row = updated!;
    } else {
      const [inserted] = await tx
        .insert(userBrainClaims)
        .values({
          tenant_id: args.tenantId,
          user_id: args.userId,
          ...patch,
          updated_by_user_id: actorUserId ?? null,
        })
        .returning();
      row = inserted!;
    }

    await tx.insert(tenantPolicyEvents).values({
      tenant_id: args.tenantId,
      actor_user_id: actorUserId ?? args.userId,
      event_type: POLICY_EVENT_TYPE,
      before_value: auditSnapshot(existing ?? null),
      after_value: auditSnapshot(row),
      source: "graphql" as const,
    });

    return row;
  });

  const manifest = await publishUserClaimsManifest(args.tenantId);
  return {
    claims: snakeToCamel(saved),
    manifest: toManifestSyncResult(manifest),
  };
};

export const clearUserBrainClaims = async (
  _parent: any,
  args: { tenantId: string; userId: string },
  ctx: GraphQLContext,
) => {
  await requireTenantAdmin(ctx, args.tenantId);
  const actorUserId = await resolveCallerUserId(ctx, args.tenantId);

  await db.transaction(async (tx) => {
    const [deleted] = await tx
      .delete(userBrainClaims)
      .where(
        and(
          eq(userBrainClaims.tenant_id, args.tenantId),
          eq(userBrainClaims.user_id, args.userId),
        ),
      )
      .returning();
    // Idempotent: clearing absent claims is a no-op, but it still republishes
    // below so a stale manifest entry cannot outlive the row.
    if (!deleted) return;

    await tx.insert(tenantPolicyEvents).values({
      tenant_id: args.tenantId,
      actor_user_id: actorUserId ?? args.userId,
      event_type: POLICY_EVENT_TYPE,
      before_value: auditSnapshot(deleted),
      after_value: null,
      source: "graphql" as const,
    });
  });

  const manifest = await publishUserClaimsManifest(args.tenantId);
  return { claims: null, manifest: toManifestSyncResult(manifest) };
};

export const republishUserClaimsManifest = async (
  _parent: any,
  args: { tenantId: string },
  ctx: GraphQLContext,
) => {
  await requireTenantAdmin(ctx, args.tenantId);
  const manifest = await publishUserClaimsManifest(args.tenantId);
  return toManifestSyncResult(manifest);
};

/**
 * Fire-and-report republish for mutations that change what the manifest
 * should say without being *about* claims: membership disable/remove
 * (revocation that only lands in tenant_members has revoked nothing the
 * Brain can see) and the tenant enable-flag flip (on = full publish,
 * off = delete the object).
 *
 * Swallows everything. `publishUserClaimsManifest` already returns rather
 * than throws, so this only catches the truly unexpected — and none of the
 * callers have a payload field to report into, nor any business failing
 * because S3 did.
 */
export async function republishUserClaimsQuietly(
  tenantId: string,
): Promise<void> {
  try {
    await publishUserClaimsManifest(tenantId);
  } catch (err: unknown) {
    console.error(
      `user claims manifest: background republish failed for tenant ${tenantId}:`,
      err,
    );
  }
}

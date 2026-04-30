/**
 * updateTenantPolicy — plan Unit 6.
 *
 * Platform-operator-only mutation for sandbox + compliance-tier policy
 * changes. Separate from updateTenant (which tenant admins can call) because
 * changes here are security-boundary shifts:
 *
 *   - `sandbox_enabled` true requires `compliance_tier = 'standard'`
 *     (enforced in app + DB via compound CHECK from Unit 1).
 *   - `compliance_tier` transitions are regulator-visible and audited in
 *     the append-only tenant_policy_events table.
 *
 * Operator gate: the caller's email must be in
 * THINKWORK_PLATFORM_OPERATOR_EMAILS (comma-separated). When formal RBAC
 * lands this is the swap-out point.
 */

import type { GraphQLContext } from "../../context.js";
import {
  db,
  eq,
  tenants,
  snakeToCamel,
  sql,
  tenantPolicyEvents,
  users,
  COMPLIANCE_TIERS,
  type ComplianceTier,
} from "../../utils.js";
import { resolveCallerUserId } from "./resolve-auth-user.js";

const POLICY_EVENT_TYPE = {
  SANDBOX_ENABLED: "sandbox_enabled",
  COMPLIANCE_TIER: "compliance_tier",
} as const;

export const updateTenantPolicy = async (
  _parent: any,
  args: any,
  ctx: GraphQLContext,
) => {
  const { tenantId } = args;
  const input = args.input ?? {};

  await requirePlatformOperator(ctx);

  const actorUserId = await resolvePolicyActorUserId(ctx);
  if (!actorUserId) throw new Error("Unable to resolve caller user id");

  const [current] = await db
    .select()
    .from(tenants)
    .where(eq(tenants.id, tenantId));
  if (!current) throw new Error("Tenant not found");

  const requested = {
    sandboxEnabled: input.sandboxEnabled as boolean | undefined,
    complianceTier: validateComplianceTier(input.complianceTier),
  };

  const { next, events } = computeTransition({
    currentSandboxEnabled: current.sandbox_enabled,
    currentComplianceTier: current.compliance_tier as ComplianceTier,
    requested,
    actorUserId,
  });

  if (events.length === 0) {
    // No-op; return the row as-is.
    return snakeToCamel(current);
  }

  return await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(tenants)
      .set({
        sandbox_enabled: next.sandbox_enabled,
        compliance_tier: next.compliance_tier,
        updated_at: sql`now()`,
      })
      .where(eq(tenants.id, tenantId))
      .returning();

    if (!updated) throw new Error("Tenant not found");

    if (events.length > 0) {
      await tx.insert(tenantPolicyEvents).values(
        events.map((e) => ({
          tenant_id: tenantId,
          actor_user_id: actorUserId,
          event_type: e.event_type,
          before_value: e.before_value,
          after_value: e.after_value,
          source: "graphql" as const,
        })),
      );
    }

    return snakeToCamel(updated);
  });
};

// ---------------------------------------------------------------------------
// Helpers — exported for unit tests
// ---------------------------------------------------------------------------

export interface PolicyEvent {
  event_type: "sandbox_enabled" | "compliance_tier";
  before_value: string | null;
  after_value: string | null;
}

export function computeTransition(args: {
  currentSandboxEnabled: boolean;
  currentComplianceTier: ComplianceTier;
  requested: {
    sandboxEnabled?: boolean;
    complianceTier?: ComplianceTier;
  };
  actorUserId: string;
}): {
  next: { sandbox_enabled: boolean; compliance_tier: ComplianceTier };
  events: PolicyEvent[];
} {
  const next = {
    sandbox_enabled: args.currentSandboxEnabled,
    compliance_tier: args.currentComplianceTier,
  };
  const events: PolicyEvent[] = [];

  // Apply compliance_tier first so the sandbox_enabled invariant can run on
  // the intended final tier.
  if (
    args.requested.complianceTier !== undefined &&
    args.requested.complianceTier !== next.compliance_tier
  ) {
    events.push({
      event_type: POLICY_EVENT_TYPE.COMPLIANCE_TIER,
      before_value: next.compliance_tier,
      after_value: args.requested.complianceTier,
    });
    next.compliance_tier = args.requested.complianceTier;

    // Invariant: regulated/hipaa tenants cannot have sandbox enabled. Coerce
    // sandbox_enabled off when the tier changes to non-standard, producing a
    // paired audit event so the transition is reproducible from
    // tenant_policy_events alone.
    if (next.compliance_tier !== "standard" && next.sandbox_enabled) {
      events.push({
        event_type: POLICY_EVENT_TYPE.SANDBOX_ENABLED,
        before_value: "true",
        after_value: "false",
      });
      next.sandbox_enabled = false;
    }
  }

  if (
    args.requested.sandboxEnabled !== undefined &&
    args.requested.sandboxEnabled !== next.sandbox_enabled
  ) {
    if (
      args.requested.sandboxEnabled === true &&
      next.compliance_tier !== "standard"
    ) {
      throw new Error(
        `Cannot enable sandbox while compliance_tier is '${next.compliance_tier}'. Change compliance_tier to 'standard' first.`,
      );
    }
    events.push({
      event_type: POLICY_EVENT_TYPE.SANDBOX_ENABLED,
      before_value: String(next.sandbox_enabled),
      after_value: String(args.requested.sandboxEnabled),
    });
    next.sandbox_enabled = args.requested.sandboxEnabled;
  }

  return { next, events };
}

function validateComplianceTier(raw: unknown): ComplianceTier | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (
    typeof raw === "string" &&
    (COMPLIANCE_TIERS as readonly string[]).includes(raw)
  ) {
    return raw as ComplianceTier;
  }
  throw new Error(
    `Invalid compliance_tier '${String(raw)}'; must be one of ${COMPLIANCE_TIERS.join(", ")}`,
  );
}

async function requirePlatformOperator(ctx: GraphQLContext): Promise<void> {
  const allowlist = (process.env.THINKWORK_PLATFORM_OPERATOR_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (allowlist.length === 0) {
    throw new Error(
      "updateTenantPolicy is not enabled: THINKWORK_PLATFORM_OPERATOR_EMAILS must be configured",
    );
  }
  const email = (ctx.auth as any)?.email?.toLowerCase?.();
  if (!email || !allowlist.includes(email)) {
    throw new Error("updateTenantPolicy requires platform-operator role");
  }
}

async function resolvePolicyActorUserId(
  ctx: GraphQLContext,
): Promise<string | null> {
  if (ctx.auth.authType !== "apikey") return await resolveCallerUserId(ctx);
  if (ctx.auth.principalId) return ctx.auth.principalId;
  if (!ctx.auth.email) return null;

  const [byEmail] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, ctx.auth.email));
  return byEmail?.id ?? null;
}

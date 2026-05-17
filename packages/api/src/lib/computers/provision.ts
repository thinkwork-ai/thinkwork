/**
 * Auto-provision helper: grants a tenant member access to the tenant's shared
 * Base Computer. Wrapped in best-effort try/catch by every call site
 * (addTenantMember, inviteMember, bootstrapUser, REST handlers) so a
 * provisioning failure never blocks the primary membership insert. Failure
 * modes are surfaced via the `activity_log` audit trail so admins can find and
 * backfill stranded users.
 *
 * Bypasses `requireTenantAdmin` deliberately: at the bootstrapUser call
 * sites the new user is mid-creation and not yet tenant-admin-resolvable.
 * `createComputerCore` handles the shared Computer creation path when a tenant
 * does not have one yet; direct assignment uses `computer_assignments` with
 * `ON CONFLICT DO NOTHING` for idempotency.
 */

import { GraphQLError } from "graphql";
import {
  activityLog,
  agentTemplates,
  and,
  asc,
  computerAssignments,
  computers,
  db,
  eq,
  isNull,
  ne,
} from "../../graphql/utils.js";
import {
  createComputerCore,
  requireTenantUser,
} from "../../graphql/resolvers/computers/shared.js";

/** Slug for the platform-default Computer template seeded by 0085_seed_thinkwork_computer_default_template.sql. */
export const PLATFORM_DEFAULT_COMPUTER_TEMPLATE_SLUG =
  "thinkwork-computer-default";

/**
 * Sentinel actor_id for activity_log rows produced by server-internal
 * provisioning paths where no human caller maps to the action — currently
 * the `bootstrapUser` call sites, which fire under the new user's own JWT
 * but should not audit as "this user did something" to themselves.
 */
export const SYSTEM_ACTOR_ID = "00000000-0000-0000-0000-000000000000";

export type ProvisionCallSite =
  | "addTenantMember"
  | "inviteMember"
  | "bootstrapUser"
  | "restAddMember"
  | "restInvite";

export type ProvisionInput = {
  tenantId: string;
  /** The `principal_id` from the just-inserted tenant_members row. */
  userId: string;
  /** Lowercased before comparison; helper skips when not "user". */
  principalType: string;
  /** Identifies the resolver/handler that called the helper; controls actor attribution. */
  callSite: ProvisionCallSite;
  /**
   * Optional template id to use instead of the platform default. Useful for
   * future tenant-level default overrides; not used by v1 callers.
   */
  templateId?: string | null;
  /**
   * Optional admin user id that initiated the membership add. Used as
   * activity_log `actor_id` for non-bootstrap call sites. For bootstrapUser,
   * the actor is SYSTEM_ACTOR_ID regardless.
   */
  adminUserId?: string | null;
};

export type ProvisionResult =
  | { status: "assigned"; computerId: string }
  | { status: "skipped"; reason: "not_user_principal" }
  | {
      status: "failed";
      reason:
        | "no_default_template"
        | "user_not_in_tenant"
        | "template_not_found"
        | "unknown";
      message?: string;
    };

/**
 * Provision shared Computer access for a tenant member. Never throws — every error path
 * is captured into the discriminated `ProvisionResult` so the caller can
 * decide whether to write a log entry without coupling to thrown errors.
 */
export async function provisionComputerForMember(
  input: ProvisionInput,
): Promise<ProvisionResult> {
  // 1) Skip non-USER principals (teams, services). Case-insensitive because the
  //    codebase mixes 'USER' (inviteMember) and 'user' (bootstrapUser) casings.
  if (input.principalType.toLowerCase() !== "user") {
    return { status: "skipped", reason: "not_user_principal" };
  }

  // 2) Resolve the platform default template. The lookup pins template_kind
  //    AND tenant_id IS NULL in SQL — relying on a downstream
  //    requireComputerTemplate call alone would NOT prevent picking up a
  //    same-slug global template of a different kind.
  let resolvedTemplateId: string | null = input.templateId ?? null;
  if (!resolvedTemplateId) {
    const [defaultTemplate] = await db
      .select({ id: agentTemplates.id })
      .from(agentTemplates)
      .where(
        and(
          eq(agentTemplates.slug, PLATFORM_DEFAULT_COMPUTER_TEMPLATE_SLUG),
          isNull(agentTemplates.tenant_id),
          eq(agentTemplates.template_kind, "computer"),
        ),
      );
    if (!defaultTemplate) {
      await safeWriteActivityLog({
        tenantId: input.tenantId,
        userId: input.userId,
        reason: "no_default_template",
        callSite: input.callSite,
        adminUserId: input.adminUserId,
      });
      return { status: "failed", reason: "no_default_template" };
    }
    resolvedTemplateId = defaultTemplate.id;
  }

  // 3) Ensure the user belongs to the tenant, then assign the tenant's shared
  // Base Computer. Create that shared Computer if this is a new tenant.
  try {
    await requireTenantUser(input.tenantId, input.userId);
    const computerId = await ensureSharedBaseComputer({
      tenantId: input.tenantId,
      templateId: resolvedTemplateId,
      createdBy:
        input.callSite === "bootstrapUser" ? null : (input.adminUserId ?? null),
    });
    await db
      .insert(computerAssignments)
      .values({
        tenant_id: input.tenantId,
        computer_id: computerId,
        subject_type: "user",
        user_id: input.userId,
        role: "member",
        assigned_by_user_id:
          input.callSite === "bootstrapUser"
            ? null
            : (input.adminUserId ?? null),
      })
      .onConflictDoNothing();
    return { status: "assigned", computerId };
  } catch (err) {
    const reason = classifyValidationError(err);
    await safeWriteActivityLog({
      tenantId: input.tenantId,
      userId: input.userId,
      reason,
      callSite: input.callSite,
      adminUserId: input.adminUserId,
      message: errorMessage(err),
    });
    return { status: "failed", reason, message: errorMessage(err) };
  }
}

function classifyValidationError(
  err: unknown,
): "user_not_in_tenant" | "template_not_found" | "unknown" {
  if (err instanceof GraphQLError) {
    const message = err.message.toLowerCase();
    if (message.includes("owner user not found")) return "user_not_in_tenant";
    if (message.includes("template not found")) return "template_not_found";
  }
  return "unknown";
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

async function ensureSharedBaseComputer(input: {
  tenantId: string;
  templateId: string;
  createdBy?: string | null;
}): Promise<string> {
  const [existing] = await db
    .select({ id: computers.id })
    .from(computers)
    .where(
      and(
        eq(computers.tenant_id, input.tenantId),
        eq(computers.scope, "shared"),
        ne(computers.status, "archived"),
      ),
    )
    .orderBy(asc(computers.created_at))
    .limit(1);
  if (existing) return existing.id;

  const row = await createComputerCore({
    tenantId: input.tenantId,
    ownerUserId: null,
    templateId: input.templateId,
    name: "Base Computer",
    scope: "shared",
    createdBy: input.createdBy ?? null,
  });
  return row.id;
}

type FailureReason = Extract<ProvisionResult, { status: "failed" }>["reason"];

type ActivityArgs = {
  tenantId: string;
  userId: string;
  reason: FailureReason;
  callSite: ProvisionCallSite;
  adminUserId?: string | null;
  message?: string;
};

async function safeWriteActivityLog(args: ActivityArgs): Promise<void> {
  try {
    const actorId =
      args.callSite === "bootstrapUser"
        ? SYSTEM_ACTOR_ID
        : (args.adminUserId ?? SYSTEM_ACTOR_ID);
    const actorType = args.callSite === "bootstrapUser" ? "system" : "user";
    await db.insert(activityLog).values({
      tenant_id: args.tenantId,
      actor_type: actorType,
      actor_id: actorId,
      action: "computer_auto_provision_failed",
      entity_type: "user",
      entity_id: args.userId,
      metadata: {
        reason: args.reason,
        callSite: args.callSite,
        message: args.message ?? null,
      },
    });
  } catch (err) {
    console.error(
      "[provisionComputerForMember] activity_log write failed:",
      err,
    );
  }
}

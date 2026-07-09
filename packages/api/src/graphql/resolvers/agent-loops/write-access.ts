/**
 * Role-split automation write access (THINK-227 U11, KTD10).
 *
 * Replaces the bare admin gate on `saveAgentLoop`/`deleteAgentLoop`:
 *
 *   - Admin/owner principals keep today's general automation CRUD
 *     (cognito → requireTenantAdmin; apikey → the same live tenant_members
 *     role check + per-agent operation allowlist as before).
 *   - A plain MEMBER principal passes only for automations that are
 *     member-scoped: owned by the caller, run-as the caller, every delivery
 *     recipient equal to the caller's email as stored on `users` (never
 *     trusted from tool input), and — for existing-mode bindings — a bound
 *     artifact the caller can read.
 *   - Bare `service` classification (no asserted principal) is EXCLUDED for
 *     these two mutations. A headerless service call must not silently hold
 *     general write access on the surface a member-scoped rule guards — the
 *     identity the rule pivots on must exist.
 *
 * The resolver is the wall: the MCP tool descriptions guide the model, but a
 * crafted tool call (third-party recipients, someone else's automation id, a
 * spoofed owner, a mismatched run-as) refuses HERE, with messages that name
 * the operator path so the agent can relay them (AE7).
 */
import { and, eq } from "drizzle-orm";
import { GraphQLError } from "graphql";
import type { TargetSpec } from "@thinkwork/agent-loops-core";
import type { GraphQLContext } from "../../context.js";
import { artifacts, db, tenantMembers, users } from "../../utils.js";
import {
  requireAgentAllowsOperation,
  requireTenantAdmin,
} from "../core/authz.js";
import { assertCanvasAccess } from "../../../lib/artifacts/canvas-access.js";

const OPERATOR_PATH_HINT =
  "Ask an operator to make this change in the Automations editor.";

function forbidden(message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code: "FORBIDDEN" } });
}

export interface AgentLoopWriteAccessInput {
  operationName: "save_agent_loop" | "delete_agent_loop";
  /** Server-resolved users.id of the caller; null when unresolvable. */
  actorId: string | null;
  /** Owner the request submits; undefined = keep existing / default. */
  submittedOwnerUserId?: string | null;
  /** Run-as the request submits; undefined = keep existing / default. */
  submittedRunAsUserId?: string | null;
  /** Normalized target spec being written (save only). */
  targetSpec?: TargetSpec | null;
  /** The stored row's identities, for update/delete. Null on create. */
  existing?: {
    ownerUserId: string | null;
    runAsUserId: string | null;
  } | null;
}

export async function requireAgentLoopWriteAccess(
  ctx: GraphQLContext,
  tenantId: string,
  input: AgentLoopWriteAccessInput,
): Promise<void> {
  if (ctx.auth.authType === "cognito") {
    try {
      await requireTenantAdmin(ctx, tenantId);
      return; // admin/owner: general access, unchanged.
    } catch {
      // Plain member — fall through to the member-scope check.
    }
    await requireMemberScope(ctx, tenantId, input);
    return;
  }

  if (ctx.auth.authType === "apikey") {
    // The per-agent operation allowlist guards BOTH branches — an agent
    // without save/delete in its thinkwork-admin assignment never reaches
    // the role split at all.
    await requireAgentAllowsOperation(ctx, input.operationName);
    const principalId = ctx.auth.principalId;
    if (!principalId) {
      throw forbidden("Invoker identity required (x-principal-id missing)");
    }
    const role = await memberRole(tenantId, principalId);
    if (role === "owner" || role === "admin") return; // general access.
    if (!role) {
      throw forbidden("Invoker is not a member of the target tenant");
    }
    await requireMemberScope(ctx, tenantId, input);
    return;
  }

  // KTD10: bare service classification is excluded from these two mutations —
  // the member-scope rule pivots on an acting identity, so a caller without
  // one cannot hold blanket write access here. Other service paths are
  // untouched (this predicate guards only automation save/delete).
  throw forbidden(
    "Automation changes require an acting user identity; this caller has none. " +
      OPERATOR_PATH_HINT,
  );
}

async function memberRole(
  tenantId: string,
  principalId: string,
): Promise<string | null> {
  // Live DB check — roles must be revocable without caches (R16 discipline).
  const [member] = await db
    .select({ role: tenantMembers.role })
    .from(tenantMembers)
    .where(
      and(
        eq(tenantMembers.tenant_id, tenantId),
        eq(tenantMembers.principal_id, principalId),
      ),
    )
    .limit(1);
  return member?.role ?? null;
}

/**
 * The member-scoped subset (R12): own automation, self as run-as, self as the
 * only delivery recipient, readable bound artifact. Every comparison uses
 * server-resolved identity — nothing here trusts tool-supplied values.
 */
async function requireMemberScope(
  ctx: GraphQLContext,
  tenantId: string,
  input: AgentLoopWriteAccessInput,
): Promise<void> {
  const actorId = input.actorId;
  if (!actorId) {
    throw forbidden(
      "Could not resolve the acting user for this automation change. " +
        OPERATOR_PATH_HINT,
    );
  }

  // Update/delete: the member must already own the row. Load-and-check
  // happens against the STORED owner, so submitting your own id as the new
  // owner cannot capture someone else's automation.
  if (input.existing) {
    if (input.existing.ownerUserId !== actorId) {
      throw forbidden(
        "Members can only change automations they own. " + OPERATOR_PATH_HINT,
      );
    }
  }

  const effectiveOwner =
    input.submittedOwnerUserId === undefined
      ? (input.existing?.ownerUserId ?? actorId)
      : input.submittedOwnerUserId;
  if (effectiveOwner !== actorId) {
    throw forbidden(
      "Members can only create automations they own themselves. " +
        OPERATOR_PATH_HINT,
    );
  }

  const effectiveRunAs =
    input.submittedRunAsUserId ?? input.existing?.runAsUserId ?? actorId;
  if (effectiveRunAs !== actorId) {
    throw forbidden(
      "Member automations must run as the member who owns them. " +
        OPERATOR_PATH_HINT,
    );
  }

  if (input.operationName === "delete_agent_loop") return;

  const spec = input.targetSpec ?? null;
  const recipients = spec?.delivery?.recipients ?? [];
  if (recipients.length > 0) {
    // Compare against the email stored on the caller's users row — the
    // caller cannot assert an email through the tool call.
    const [caller] = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, actorId))
      .limit(1);
    const callerEmail = caller?.email?.trim().toLowerCase() ?? null;
    if (!callerEmail) {
      throw forbidden(
        "Your account has no email address to deliver to. " +
          OPERATOR_PATH_HINT,
      );
    }
    const foreign = recipients.find(
      (recipient) => recipient.trim().toLowerCase() !== callerEmail,
    );
    if (foreign) {
      throw forbidden(
        "Members can only email scheduled reports to themselves — adding other recipients needs an operator. " +
          OPERATOR_PATH_HINT,
      );
    }
  }

  // Existing-mode binding: the member must be able to READ the document they
  // are binding — otherwise delivery would mail them (and publicly share) a
  // document outside their visibility.
  const binding = spec?.documentBinding;
  if (binding?.mode === "existing" && binding.artifactId) {
    const [row] = await db
      .select()
      .from(artifacts)
      .where(
        and(
          eq(artifacts.id, binding.artifactId),
          eq(artifacts.tenant_id, tenantId),
        ),
      )
      .limit(1);
    if (!row) {
      throw forbidden("The document to maintain was not found in this tenant.");
    }
    await assertCanvasAccess(ctx, row, "read");
  }
}

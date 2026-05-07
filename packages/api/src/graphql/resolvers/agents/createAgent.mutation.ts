import type { GraphQLContext } from "../../context.js";
import {
  db,
  eq,
  agents,
  agentTemplates,
  agentCapabilities,
  users,
  agentToCamel,
  generateSlug,
  invokeJobScheduleManager,
} from "../../utils.js";
import { requireTenantAdmin } from "../core/authz.js";
import { resolveCallerUserId } from "../core/resolve-auth-user.js";
import { runWithIdempotency } from "../../../lib/idempotency.js";
import { parseAgentRuntimeInput } from "./runtime.js";
import { emitAuditEvent } from "../../../lib/compliance/emit.js";

interface CreateAgentActor {
  actorId: string;
  actorType: "user" | "system";
}

export async function createAgent(
  _parent: any,
  args: any,
  ctx: GraphQLContext,
) {
  const i = args.input;
  await requireTenantAdmin(ctx, i.tenantId);

  // Resolve the invoker. Apikey callers (thinkwork-admin skill) set
  // principalId directly on ctx.auth; cognito callers go through the
  // users-lookup path. Null userId → runWithIdempotency short-circuits
  // to a plain fn() call, preserving pre-Unit-4 admin SPA behavior.
  const invokerUserId =
    ctx.auth.authType === "apikey"
      ? ctx.auth.principalId
      : await resolveCallerUserId(ctx);

  // Compliance audit actor: branch by auth path. Apikey callers
  // identify as `system` (the x-principal-id header is unverified per
  // packages/api/src/lib/tenant-membership.ts:112-114, so the audit row
  // records a stable platform-credential constant rather than the
  // attacker-controlled header value). Cognito callers identify as
  // `user` with the resolved users.id; falls back to the cognito sub
  // (which Cognito itself signs) when the users-lookup misses.
  const auditActor: CreateAgentActor =
    ctx.auth.authType === "apikey"
      ? { actorId: "platform-credential", actorType: "system" }
      : invokerUserId
        ? { actorId: invokerUserId, actorType: "user" }
        : {
            actorId: ctx.auth.principalId ?? "unknown",
            actorType: "user",
          };

  return runWithIdempotency({
    tenantId: i.tenantId,
    invokerUserId,
    mutationName: "createAgent",
    inputs: i,
    clientKey: i.idempotencyKey ?? null,
    resultCoerce: (raw) => raw as ReturnType<typeof agentToCamel>,
    fn: () => createAgentCore(i, auditActor),
  });
}

async function createAgentCore(
  i: any,
  auditActor: CreateAgentActor,
): Promise<ReturnType<typeof agentToCamel>> {
  let runtime = parseAgentRuntimeInput(i.runtime);
  if (i.runtime == null && i.templateId) {
    const templateRows = await db
      .select({ runtime: agentTemplates.runtime })
      .from(agentTemplates)
      .where(eq(agentTemplates.id, i.templateId));
    const [template] = Array.isArray(templateRows) ? templateRows : [];
    runtime = parseAgentRuntimeInput(template?.runtime);
  }

  // Auto-register heartbeat config for serverless agents
  let runtimeConfig = i.runtimeConfig ? JSON.parse(i.runtimeConfig) : undefined;
  const adapterType = i.adapterType || "strands";
  const isSubAgent = !!i.parentAgentId;
  const SERVERLESS_ADAPTERS = new Set(["strands", "sdk", "pi"]);
  if (SERVERLESS_ADAPTERS.has(adapterType) && !isSubAgent) {
    runtimeConfig = {
      ...runtimeConfig,
      heartbeat: {
        enabled: true,
        intervalSec: 300,
        wakeOnAssignment: true,
        wakeOnComment: true,
        wakeOnApproval: true,
        ...(runtimeConfig?.heartbeat || {}),
      },
    };
  }

  // Wrap the agent insert + audit emit in a single transaction so
  // audit-write failure rolls back the originating mutation
  // (control-evidence tier per master plan U5).
  const [row] = await db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(agents)
      .values({
        tenant_id: i.tenantId,
        name: i.name,
        slug: generateSlug(),
        role: i.role,
        type: i.type?.toLowerCase() ?? "agent",
        template_id: i.templateId,
        runtime,
        system_prompt: i.systemPrompt,
        adapter_type: adapterType,
        adapter_config: i.adapterConfig
          ? JSON.parse(i.adapterConfig)
          : undefined,
        runtime_config: runtimeConfig,
        budget_monthly_cents: i.budgetMonthlyCents,
        avatar_url: i.avatarUrl,
        reports_to: i.reportsTo,
        human_pair_id: i.humanPairId,
        parent_agent_id: i.parentAgentId || null,
      })
      .returning();

    await emitAuditEvent(tx, {
      tenantId: i.tenantId,
      actorId: auditActor.actorId,
      actorType: auditActor.actorType,
      eventType: "agent.created",
      source: "graphql",
      payload: {
        agentId: inserted.id,
        name: inserted.name,
        templateId: inserted.template_id ?? null,
      },
      resourceType: "agent",
      resourceId: inserted.id,
      action: "create",
      outcome: "success",
    });

    return [inserted];
  });

  // PRD-14: Auto-provision email channel capability
  try {
    const defaultAllowedSenders: string[] = [];
    if (i.humanPairId) {
      const [human] = await db
        .select({ email: users.email })
        .from(users)
        .where(eq(users.id, i.humanPairId));
      if (human?.email) defaultAllowedSenders.push(human.email.toLowerCase());
    }
    await db.insert(agentCapabilities).values({
      agent_id: row.id,
      tenant_id: i.tenantId,
      capability: "email_channel",
      config: {
        emailAddress: `${row.slug}@agents.thinkwork.ai`,
        allowedSenders: defaultAllowedSenders,
        replyTokensEnabled: true,
        maxReplyTokenAgeDays: 7,
        maxReplyTokenUses: 3,
        rateLimitPerHour: 50,
      },
      enabled: true,
    });
  } catch (emailCapErr) {
    console.warn(
      `[graphql-resolver] Failed to auto-provision email capability for agent ${row.id}:`,
      emailCapErr,
    );
  }

  // Auto-create scheduled job for serverless agent heartbeat
  if (
    runtimeConfig?.heartbeat?.enabled &&
    SERVERLESS_ADAPTERS.has(adapterType)
  ) {
    const intervalSec = runtimeConfig.heartbeat.intervalSec || 300;
    invokeJobScheduleManager("POST", {
      tenantId: i.tenantId,
      jobType: "agent_heartbeat",
      agentId: row.id,
      name: `Heartbeat: ${i.name}`,
      scheduleType: "rate",
      scheduleExpression: String(intervalSec),
      config: runtimeConfig.heartbeat,
      createdByType: "system",
    });
  }

  return agentToCamel(row);
}

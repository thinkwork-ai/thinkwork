import type { GraphQLContext } from "../../context.js";
import {
  db,
  eq,
  agents,
  agentCapabilities,
  users,
  agentToCamel,
  generateSlug,
  invokeJobScheduleManager,
} from "../../utils.js";
import { requireTenantAdmin } from "../core/authz.js";
import { resolveCallerUserId } from "../core/resolve-auth-user.js";
import { runWithIdempotency } from "../../../lib/idempotency.js";

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

  return runWithIdempotency({
    tenantId: i.tenantId,
    invokerUserId,
    mutationName: "createAgent",
    inputs: i,
    clientKey: i.idempotencyKey ?? null,
    resultCoerce: (raw) => raw as ReturnType<typeof agentToCamel>,
    fn: () => createAgentCore(i),
  });
}

async function createAgentCore(
  i: any,
): Promise<ReturnType<typeof agentToCamel>> {
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

  const [row] = await db
    .insert(agents)
    .values({
      tenant_id: i.tenantId,
      name: i.name,
      slug: generateSlug(),
      role: i.role,
      type: i.type?.toLowerCase() ?? "agent",
      template_id: i.templateId,
      system_prompt: i.systemPrompt,
      adapter_type: adapterType,
      adapter_config: i.adapterConfig ? JSON.parse(i.adapterConfig) : undefined,
      runtime_config: runtimeConfig,
      budget_monthly_cents: i.budgetMonthlyCents,
      avatar_url: i.avatarUrl,
      reports_to: i.reportsTo,
      human_pair_id: i.humanPairId,
      parent_agent_id: i.parentAgentId || null,
    })
    .returning();

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

import type { GraphQLContext } from "../../context.js";
import { agents, and, db, eq } from "../../utils.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";
import { parseAgentRuntimeInput } from "./runtime.js";
import {
  assertTenantGuardrail,
  loadTenantAgentForGraphql,
  parseJsonInput,
} from "./shared.js";

interface UpdateTenantAgentInput {
  name?: string | null;
  role?: string | null;
  systemPrompt?: string | null;
  runtime?: string | null;
  adapterType?: string | null;
  adapterConfig?: unknown;
  runtimeConfig?: unknown;
  model?: string | null;
  guardrailId?: string | null;
  blockedTools?: unknown;
  sandbox?: unknown;
  browser?: unknown;
  webSearch?: unknown;
  sendEmail?: unknown;
  contextEngine?: unknown;
  budgetMonthlyCents?: number | null;
  budgetPaused?: boolean | null;
  avatarUrl?: string | null;
}

export async function updateTenantAgent(
  _parent: unknown,
  args: { tenantId: string; input: UpdateTenantAgentInput },
  ctx: GraphQLContext,
) {
  await requireAdminOrServiceCaller(ctx, args.tenantId, "tenant_agent:update");
  const i = args.input ?? {};
  await assertTenantGuardrail(args.tenantId, i.guardrailId);

  const updates: Record<string, unknown> = { updated_at: new Date() };
  if (i.name !== undefined) updates.name = i.name;
  if (i.role !== undefined) updates.role = i.role;
  if (i.systemPrompt !== undefined) updates.system_prompt = i.systemPrompt;
  if (i.runtime !== undefined)
    updates.runtime = parseAgentRuntimeInput(i.runtime);
  if (i.adapterType !== undefined) updates.adapter_type = i.adapterType;
  if (i.adapterConfig !== undefined)
    updates.adapter_config = parseJsonInput(i.adapterConfig);
  if (i.runtimeConfig !== undefined)
    updates.runtime_config = parseJsonInput(i.runtimeConfig);
  if (i.model !== undefined) updates.model = i.model;
  if (i.guardrailId !== undefined) updates.guardrail_id = i.guardrailId;
  if (i.blockedTools !== undefined)
    updates.blocked_tools = parseJsonInput(i.blockedTools);
  if (i.sandbox !== undefined) updates.sandbox = parseJsonInput(i.sandbox);
  if (i.browser !== undefined) updates.browser = parseJsonInput(i.browser);
  if (i.webSearch !== undefined)
    updates.web_search = parseJsonInput(i.webSearch);
  if (i.sendEmail !== undefined)
    updates.send_email = parseJsonInput(i.sendEmail);
  if (i.contextEngine !== undefined)
    updates.context_engine = parseJsonInput(i.contextEngine);
  if (i.budgetMonthlyCents !== undefined) {
    updates.budget_monthly_cents = i.budgetMonthlyCents;
  }
  if (i.budgetPaused !== undefined) {
    updates.budget_paused = i.budgetPaused ?? false;
    updates.budget_paused_at = i.budgetPaused ? new Date() : null;
    updates.budget_paused_reason = i.budgetPaused
      ? "tenant_agent_update"
      : null;
  }
  if (i.avatarUrl !== undefined) updates.avatar_url = i.avatarUrl;

  const [row] = await db
    .update(agents)
    .set(updates)
    .where(
      and(
        eq(agents.tenant_id, args.tenantId),
        eq(agents.is_platform_default, true),
      ),
    )
    .returning({ id: agents.id });

  if (!row) {
    throw new Error(`Platform agent not found for tenant: ${args.tenantId}`);
  }
  return loadTenantAgentForGraphql(args.tenantId);
}

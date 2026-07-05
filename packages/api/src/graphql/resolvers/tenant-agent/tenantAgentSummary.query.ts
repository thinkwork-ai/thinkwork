import type { GraphQLContext } from "../../context.js";
import { requireTenantMember } from "../core/authz.js";
import { loadTenantAgentForGraphql } from "./shared.js";

/**
 * Member-safe view of the tenant's platform agent. End-user surfaces (the
 * mobile home screen) need the agent's display identity but must not see
 * configuration — the full Agent (systemPrompt, adapter/runtime config,
 * budgets) stays admin-gated behind tenantAgent. The summary type exposes
 * only display fields, so membership is a sufficient gate.
 */
export async function tenantAgentSummary(
  _parent: unknown,
  args: { tenantId: string },
  ctx: GraphQLContext,
) {
  await requireTenantMember(ctx, args.tenantId);
  const agent = (await loadTenantAgentForGraphql(args.tenantId)) as unknown as {
    id: string;
    tenantId: string;
    name: string;
    slug?: string | null;
    role?: string | null;
    type: string;
    status: string;
    runtime: string;
    avatarUrl?: string | null;
  };
  return {
    id: agent.id,
    tenantId: agent.tenantId,
    name: agent.name,
    slug: agent.slug ?? null,
    role: agent.role ?? null,
    type: agent.type,
    status: agent.status,
    runtime: agent.runtime,
    avatarUrl: agent.avatarUrl ?? null,
  };
}

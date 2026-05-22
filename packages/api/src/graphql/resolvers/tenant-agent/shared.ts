import { GraphQLError } from "graphql";
import {
  agentCapabilities,
  agentSkills,
  agentToCamel,
  and,
  budgetPolicies,
  db,
  eq,
  snakeToCamel,
} from "../../utils.js";
import { guardrails } from "@thinkwork/database-pg/schema";
import {
  PlatformAgentNotFoundError,
  resolveTenantPlatformAgent,
} from "../../../lib/agents/tenant-platform-agent.js";

export function forbidden(message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code: "FORBIDDEN" } });
}

export function notFound(message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code: "NOT_FOUND" } });
}

export async function loadTenantAgentForGraphql(tenantId: string) {
  try {
    const row = await resolveTenantPlatformAgent(tenantId, db);
    const [caps, skills, policies] = await Promise.all([
      db
        .select()
        .from(agentCapabilities)
        .where(eq(agentCapabilities.agent_id, row.id)),
      db.select().from(agentSkills).where(eq(agentSkills.agent_id, row.id)),
      db
        .select()
        .from(budgetPolicies)
        .where(
          and(
            eq(budgetPolicies.agent_id, row.id),
            eq(budgetPolicies.scope, "agent"),
          ),
        ),
    ]);
    return {
      ...agentToCamel(row),
      capabilities: caps.map(snakeToCamel),
      skills: skills.map(snakeToCamel),
      budgetPolicy: policies.length > 0 ? snakeToCamel(policies[0]) : null,
    };
  } catch (error) {
    if (error instanceof PlatformAgentNotFoundError) {
      throw notFound("Platform agent not found");
    }
    throw error;
  }
}

export async function assertTenantGuardrail(
  tenantId: string,
  guardrailId: string | null | undefined,
): Promise<void> {
  if (guardrailId === undefined || guardrailId === null) return;
  const [row] = await db
    .select({ id: guardrails.id })
    .from(guardrails)
    .where(
      and(eq(guardrails.id, guardrailId), eq(guardrails.tenant_id, tenantId)),
    );
  if (!row) throw forbidden("Guardrail does not belong to this tenant");
}

export function parseJsonInput(value: unknown): unknown {
  if (value === null || typeof value !== "string") return value;
  return JSON.parse(value);
}

export function sandboxBaselineEnabled(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  return (value as { enabled?: unknown }).enabled === true;
}

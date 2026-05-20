import { randomBytes } from "node:crypto";
import { and, eq, ne } from "drizzle-orm";
import {
  agentCapabilities,
  agents,
  tenants,
} from "@thinkwork/database-pg/schema";
import { generateSlug } from "@thinkwork/database-pg/utils/generate-slug";
import { db } from "../db.js";
import { bootstrapAgentWorkspace } from "../workspace-bootstrap.js";

export async function resolveEvalAgentId(
  tenantId: string,
  requestedAgentId?: string | null,
): Promise<string> {
  if (requestedAgentId) {
    await requireEvalAgentTarget(tenantId, requestedAgentId);
    return requestedAgentId;
  }

  const target = await ensureEvalAgentForTarget({ tenantId });
  return target.agentId;
}

export async function ensureEvalAgentForTarget(input: {
  tenantId: string;
  agentId?: string | null;
}): Promise<{ agentId: string }> {
  const { tenantId, agentId } = input;
  if (agentId) {
    await requireEvalAgentTarget(tenantId, agentId);
    return { agentId };
  }

  const [existing] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(
      and(
        eq(agents.tenant_id, tenantId),
        eq(agents.source, "system"),
        eq(agents.type, "eval"),
        ne(agents.status, "archived"),
      ),
    )
    .limit(1);

  if (existing) {
    await bootstrapAgentWorkspace(existing.id, { mode: "overwrite" });
    return { agentId: existing.id };
  }

  const [tenant] = await db
    .select({ slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);

  const slugBase = `eval-agent-${tenant?.slug || generateSlug()}`;
  const [agent] = await db
    .insert(agents)
    .values({
      tenant_id: tenantId,
      name: "Eval Agent",
      slug: `${slugBase}-${randomBytes(4).toString("hex")}`,
      role: "Evaluation target",
      type: "eval",
      source: "system",
      runtime: "strands",
      status: "idle",
      adapter_type: "strands",
      template_id: null,
      runtime_config: { heartbeat: { enabled: false } },
    })
    .returning();
  if (!agent) throw new Error("Failed to create eval AgentCore target");

  try {
    await db.insert(agentCapabilities).values({
      agent_id: agent.id,
      tenant_id: tenantId,
      capability: "email_channel",
      config: {
        emailAddress: `${agent.slug}@agents.thinkwork.ai`,
        allowedSenders: [],
        replyTokensEnabled: true,
        maxReplyTokenAgeDays: 7,
        maxReplyTokenUses: 3,
        rateLimitPerHour: 50,
      },
      enabled: true,
    });
  } catch (err) {
    console.warn("[eval-agent] Failed to provision email capability:", err);
  }

  await bootstrapAgentWorkspace(agent.id, { mode: "preserve-existing" });

  try {
    const { regenerateWorkspaceMap } =
      await import("../workspace-map-generator.js");
    regenerateWorkspaceMap(agent.id).catch((err: unknown) => {
      console.error("[eval-agent] Failed to regenerate workspace map:", err);
    });
  } catch (err) {
    console.warn("[eval-agent] workspace-map-generator not available:", err);
  }

  return { agentId: agent.id };
}

async function requireEvalAgentTarget(tenantId: string, agentId: string) {
  const [agent] = await db
    .select({ id: agents.id })
    .from(agents)
    .where(
      and(
        eq(agents.id, agentId),
        eq(agents.tenant_id, tenantId),
        ne(agents.status, "archived"),
      ),
    )
    .limit(1);

  if (!agent) throw new Error("Eval Agent target not found");
}

/**
 * Bootstrap Workspaces Migration
 *
 * One-time migration script that:
 * 1. Converts DB-based sub-agents to workspace folders in S3
 * 2. Generates AGENTS.md + CONTEXT.md for all agents with skills
 *
 * Run via: Lambda invoke, or `npx tsx packages/api/src/handlers/bootstrap-workspaces.ts`
 */

import { eq, and, isNotNull, sql } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import { agents, agentSkills } from "@thinkwork/database-pg/schema";
import {
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { regenerateWorkspaceMap } from "../lib/workspace-map-generator.js";

const s3 = new S3Client({
  region: process.env.AWS_REGION || "us-east-1",
});
const BUCKET = process.env.WORKSPACE_BUCKET || "";

const db = getDb();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function slugify(name: string): string {
  return name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}

function generateContextMd(opts: {
  name: string;
  role: string;
  model: string;
  skills: Array<{ skillId: string; mcpServer?: string }>;
}): string {
  const lines: string[] = [];

  lines.push(`# ${opts.name}`);
  lines.push("");
  lines.push("## What This Workspace Is");
  lines.push(opts.role || `Specialized workspace for ${opts.name}.`);
  lines.push("");

  if (opts.model) {
    lines.push("## Config");
    lines.push(`- model: ${opts.model}`);
    lines.push("");
  }

  if (opts.skills.length > 0) {
    lines.push("## Skills & Tools");
    lines.push("");
    lines.push("| Skill | When | Model Override | Purpose |");
    lines.push("|-------|------|---------------|---------|");
    for (const skill of opts.skills) {
      const displayName = skill.skillId
        .split("-")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
      lines.push(`| ${displayName} | As needed | --- | --- |`);
    }
    lines.push("");
  }

  lines.push("## Process");
  lines.push("");
  lines.push("1. Understand the user's request");
  lines.push("2. Use the appropriate tools");
  lines.push("3. Return a clear result");
  lines.push("");

  lines.push("## What NOT to Do");
  lines.push("");
  lines.push("- Don't handle tasks outside this workspace's scope");
  lines.push("");

  return lines.join("\n");
}

async function writeWorkspaceFile(
  tenantSlug: string,
  agentSlug: string,
  path: string,
  content: string,
): Promise<void> {
  const key = `tenants/${tenantSlug}/agents/${agentSlug}/workspace/${path}`;
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key,
      Body: content,
      ContentType: "text/plain; charset=utf-8",
    }),
  );
}

// ---------------------------------------------------------------------------
// Migration
// ---------------------------------------------------------------------------

async function migrateSubAgentsToWorkspaces(): Promise<number> {
  // Find all sub-agents (agents with parent_agent_id set)
  const subAgentRows = await db
    .select({
      id: agents.id,
      name: agents.name,
      slug: agents.slug,
      role: agents.role,
      model: agents.model,
      parent_agent_id: agents.parent_agent_id,
    })
    .from(agents)
    .where(isNotNull(agents.parent_agent_id));

  if (subAgentRows.length === 0) {
    console.log("[bootstrap] No DB sub-agents found to migrate");
    return 0;
  }

  console.log(`[bootstrap] Found ${subAgentRows.length} DB sub-agent(s) to migrate`);

  let migrated = 0;

  for (const sub of subAgentRows) {
    // Look up parent agent's tenant and slug
    const [parent] = await db
      .select({
        slug: agents.slug,
        tenant_id: agents.tenant_id,
      })
      .from(agents)
      .where(eq(agents.id, sub.parent_agent_id!));

    if (!parent?.slug) {
      console.warn(`[bootstrap] Parent agent not found for sub-agent ${sub.name} (${sub.id})`);
      continue;
    }

    // Look up tenant slug
    const { tenants } = await import("@thinkwork/database-pg/schema");
    const [tenant] = await db
      .select({ slug: tenants.slug })
      .from(tenants)
      .where(eq(tenants.id, parent.tenant_id));
    const tenantSlug = tenant?.slug || "";

    if (!tenantSlug) {
      console.warn(`[bootstrap] No tenant slug for parent agent ${parent.slug}`);
      continue;
    }

    // Get sub-agent's assigned skills
    const skillRows = await db
      .select({ skill_id: agentSkills.skill_id, config: agentSkills.config })
      .from(agentSkills)
      .where(and(eq(agentSkills.agent_id, sub.id), eq(agentSkills.enabled, true)));

    const skills = skillRows.map((s) => ({
      skillId: s.skill_id,
      mcpServer: ((s.config as Record<string, unknown>)?.mcpServer as string) || undefined,
    }));

    // Generate workspace folder
    const wsSlug = slugify(sub.name || "workspace");
    const contextMd = generateContextMd({
      name: sub.name,
      role: sub.role || `Specialized in ${sub.name}`,
      model: sub.model || "",
      skills,
    });

    // Write CONTEXT.md to parent's workspace
    await writeWorkspaceFile(tenantSlug, parent.slug, `${wsSlug}/CONTEXT.md`, contextMd);

    console.log(
      `[bootstrap] Migrated sub-agent "${sub.name}" → ${parent.slug}/${wsSlug}/CONTEXT.md (${skills.length} skills)`,
    );
    migrated++;
  }

  return migrated;
}

async function bootstrapAllAgentMaps(): Promise<number> {
  // Find all agents that have skills assigned (these need AGENTS.md)
  const agentRows = await db
    .select({
      id: agents.id,
      name: agents.name,
      slug: agents.slug,
    })
    .from(agents)
    .where(
      // Only parent agents (not sub-agents themselves) and only those with a slug
      and(
        sql`${agents.parent_agent_id} IS NULL`,
        isNotNull(agents.slug),
      ),
    );

  console.log(`[bootstrap] Found ${agentRows.length} parent agent(s) to bootstrap`);

  let bootstrapped = 0;

  for (const agent of agentRows) {
    // Check if this agent has any skills
    const [skillCount] = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(agentSkills)
      .where(eq(agentSkills.agent_id, agent.id));

    if ((skillCount?.count || 0) === 0) {
      console.log(`[bootstrap] Skipping ${agent.slug} — no skills assigned`);
      continue;
    }

    try {
      await regenerateWorkspaceMap(agent.id);
      console.log(`[bootstrap] Generated AGENTS.md + CONTEXT.md for ${agent.slug}`);
      bootstrapped++;
    } catch (err) {
      console.error(`[bootstrap] Failed to generate map for ${agent.slug}:`, err);
    }
  }

  return bootstrapped;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handler(): Promise<{ migrated: number; bootstrapped: number }> {
  if (!BUCKET) {
    throw new Error("WORKSPACE_BUCKET environment variable is required");
  }

  console.log("[bootstrap] Starting workspace bootstrap migration...");
  console.log(`[bootstrap] S3 bucket: ${BUCKET}`);

  // Step 1: Convert DB sub-agents to workspace folders
  const migrated = await migrateSubAgentsToWorkspaces();

  // Step 2: Generate AGENTS.md + CONTEXT.md for all agents
  const bootstrapped = await bootstrapAllAgentMaps();

  console.log(`[bootstrap] Migration complete: ${migrated} sub-agent(s) migrated, ${bootstrapped} agent(s) bootstrapped`);

  return { migrated, bootstrapped };
}

// Allow direct execution: npx tsx packages/api/src/handlers/bootstrap-workspaces.ts
if (process.argv[1]?.endsWith("bootstrap-workspaces.ts") || process.argv[1]?.endsWith("bootstrap-workspaces.js")) {
  handler()
    .then((result) => {
      console.log("[bootstrap] Done:", result);
      process.exit(0);
    })
    .catch((err) => {
      console.error("[bootstrap] Fatal error:", err);
      process.exit(1);
    });
}

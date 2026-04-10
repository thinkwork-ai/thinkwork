/**
 * Workspace Map Generator
 *
 * Generates AGENTS.md (the map) and top-level CONTEXT.md from DB state + S3
 * workspace structure. These two files are always loaded into the parent
 * agent's system prompt.
 *
 * AGENTS.md — The Map
 *   - Folder structure of entire workspace
 *   - Skill catalog with Mode column (tool vs agent per PRD-38)
 *   - KB catalog
 *   - Auto-generated; users don't edit directly
 *
 * CONTEXT.md — Knowledge Overview
 *   - Knowledge domain summary (workspace folders)
 *   - Auto-generated from workspace CONTEXT.md files
 *
 * Called when:
 *   - Skill is assigned/removed from agent
 *   - KB is assigned/removed from agent
 *   - Workspace is created/deleted/modified via wizard
 */

import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { eq, and } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
  agents,
  agentSkills,
  agentKnowledgeBases,
  knowledgeBases,
} from "@thinkwork/database-pg/schema";

const s3 = new S3Client({
  region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1",
});

const BUCKET = process.env.WORKSPACE_BUCKET || "";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SkillInfo {
  skillId: string;
  name: string;
  description: string;
  mcpServer?: string;
  /** PRD-31: Trigger phrases for progressive disclosure tier-1 matching */
  triggers?: string[];
  /** PRD-31: Reference file names available in this skill */
  references?: string[];
  /** PRD-31: Execution type (script, mcp, context) */
  execution?: string;
  /** PRD-38: Skill execution mode — 'tool' (direct parent tools) or 'agent' (sub-agent) */
  mode?: string;
  /** Workspace slugs that use this skill (parsed from workspace CONTEXT.md files) */
  usedIn: string[];
}

interface KBInfo {
  id: string;
  name: string;
  description: string;
  /** Workspace slugs that reference this KB */
  usedIn: string[];
}

interface WorkspaceSummary {
  slug: string;
  name: string;
  purpose: string;
  model: string;
  skills: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function workspacePrefix(tenantSlug: string, agentSlug: string): string {
  return `tenants/${tenantSlug}/agents/${agentSlug}/workspace/`;
}

async function readS3Text(bucket: string, key: string): Promise<string | null> {
  try {
    const resp = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    return (await resp.Body?.transformToString("utf-8")) ?? null;
  } catch {
    return null;
  }
}

async function writeS3Text(bucket: string, key: string, content: string): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: content,
      ContentType: "text/plain; charset=utf-8",
    }),
  );
}

/**
 * Discover workspace folders by listing S3 objects that match {prefix}{slug}/CONTEXT.md.
 */
async function discoverWorkspaceFolders(
  bucket: string,
  prefix: string,
): Promise<string[]> {
  const slugs: string[] = [];
  let continuationToken: string | undefined;

  do {
    const result = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );
    for (const obj of result.Contents ?? []) {
      if (!obj.Key) continue;
      const rel = obj.Key.slice(prefix.length);
      // Match: {slug}/CONTEXT.md (exactly one level deep)
      const match = rel.match(/^([^/]+)\/CONTEXT\.md$/);
      if (match) {
        slugs.push(match[1]);
      }
    }
    continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
  } while (continuationToken);

  return slugs;
}

/**
 * Parse a workspace CONTEXT.md to extract summary info.
 * Lightweight parse — just extracts name, role, model, and skill references.
 */
function parseWorkspaceContext(content: string, slug: string): WorkspaceSummary {
  // Name from H1
  const nameMatch = content.match(/^#\s+(.+)$/m);
  const name = nameMatch ? nameMatch[1].trim() : slug;

  // Role from "What This Workspace Is" section
  let purpose = "";
  const roleMatch = content.match(
    /^##\s+What This Workspace Is\s*\n([\s\S]*?)(?=\n##\s|\n---|\n$)/m,
  );
  if (roleMatch) {
    purpose = roleMatch[1].trim().split("\n")[0]; // First line only
  }

  // Model from "Config" section
  let model = "";
  const configMatch = content.match(/^##\s+Config\s*\n([\s\S]*?)(?=\n##\s|\n---|\n$)/m);
  if (configMatch) {
    const modelMatch = configMatch[1].match(/model:\s*(.+)/);
    if (modelMatch) model = modelMatch[1].trim();
  }

  // Skill names from "Skills & Tools" table
  const skills: string[] = [];
  const skillsMatch = content.match(
    /^##\s+Skills & Tools\s*\n([\s\S]*?)(?=\n##\s|\n---|\n$)/m,
  );
  if (skillsMatch) {
    const tableLines = skillsMatch[1].split("\n").filter((l) => l.trim().startsWith("|"));
    // Skip header + separator
    for (const line of tableLines.slice(2)) {
      const cells = line
        .split("|")
        .map((c) => c.trim())
        .filter(Boolean);
      if (cells[0]) skills.push(cells[0]);
    }
  }

  return { slug, name, purpose, model, skills };
}

// ---------------------------------------------------------------------------
// Main generator
// ---------------------------------------------------------------------------

/**
 * Regenerate AGENTS.md and CONTEXT.md for an agent.
 *
 * Reads:
 *   - agent_skills table → skill catalog
 *   - agent_knowledge_bases + knowledge_bases tables → KB catalog
 *   - S3 workspace folders → workspace discovery + CONTEXT.md parsing
 *
 * Writes:
 *   - AGENTS.md to S3 workspace
 *   - CONTEXT.md to S3 workspace
 */
export async function regenerateWorkspaceMap(agentId: string): Promise<void> {
  const db = getDb();

  // 1. Look up agent
  const [agent] = await db
    .select({
      name: agents.name,
      slug: agents.slug,
      tenant_id: agents.tenant_id,
    })
    .from(agents)
    .where(eq(agents.id, agentId));

  if (!agent || !agent.slug) {
    console.warn(`[workspace-map] Agent not found or no slug: ${agentId}`);
    return;
  }

  // Look up tenant slug
  const { tenants } = await import("@thinkwork/database-pg/schema");
  const [tenant] = await db
    .select({ slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.id, agent.tenant_id));
  const tenantSlug = tenant?.slug || "";
  if (!tenantSlug || !BUCKET) {
    console.warn(`[workspace-map] Missing tenant slug or bucket`);
    return;
  }

  const agentSlug = agent.slug;
  const prefix = workspacePrefix(tenantSlug, agentSlug);

  // 2. Query skills
  const skillRows = await db
    .select({
      skill_id: agentSkills.skill_id,
      config: agentSkills.config,
      enabled: agentSkills.enabled,
    })
    .from(agentSkills)
    .where(and(eq(agentSkills.agent_id, agentId), eq(agentSkills.enabled, true)));

  // 3. Query knowledge bases
  const kbRows = await db
    .select({
      id: knowledgeBases.id,
      name: knowledgeBases.name,
      description: knowledgeBases.description,
    })
    .from(agentKnowledgeBases)
    .innerJoin(knowledgeBases, eq(agentKnowledgeBases.knowledge_base_id, knowledgeBases.id))
    .where(
      and(eq(agentKnowledgeBases.agent_id, agentId), eq(agentKnowledgeBases.enabled, true)),
    );

  // 4. Discover workspace folders from S3
  const workspaceSlugs = await discoverWorkspaceFolders(BUCKET, prefix);
  const workspaces: WorkspaceSummary[] = [];

  for (const ws of workspaceSlugs) {
    const contextContent = await readS3Text(BUCKET, `${prefix}${ws}/CONTEXT.md`);
    if (contextContent) {
      workspaces.push(parseWorkspaceContext(contextContent, ws));
    }
  }

  // 5. Build skill catalog with "Used In" mapping + PRD-31 metadata from DB
  const catalogLookup = new Map<string, {
    name: string; description: string; mcp_server: string | null;
    triggers: string[] | null; execution: string | null; mode: string | null;
  }>();
  try {
    const { skillCatalog } = await import("@thinkwork/database-pg/schema");
    const catalogRows = await db.select({
      slug: skillCatalog.slug,
      name: skillCatalog.display_name,
      description: skillCatalog.description,
      mcp_server: skillCatalog.mcp_server,
      triggers: skillCatalog.triggers,
      execution: skillCatalog.execution,
      mode: skillCatalog.mode,
    }).from(skillCatalog).execute();
    for (const row of catalogRows) {
      catalogLookup.set(row.slug, row);
    }
  } catch (e) {
    console.warn("[workspace-map] Could not load skill_catalog from DB:", e);
  }

  const skillInfos: SkillInfo[] = skillRows.map((s) => {
    const config = (s.config as Record<string, unknown>) || {};
    const usedIn: string[] = [];
    for (const ws of workspaces) {
      if (
        ws.skills.some(
          (sk) =>
            sk.toLowerCase() === s.skill_id.toLowerCase() ||
            sk.toLowerCase().replace(/\s+/g, "-") === s.skill_id.toLowerCase(),
        )
      ) {
        usedIn.push(ws.slug);
      }
    }
    const catalog = catalogLookup.get(s.skill_id);
    return {
      skillId: s.skill_id,
      name: catalog?.name || s.skill_id
        .split("-")
        .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" "),
      description: catalog?.description || "",
      mcpServer: catalog?.mcp_server || (config.mcpServer as string) || undefined,
      triggers: catalog?.triggers || undefined,
      execution: catalog?.execution || undefined,
      mode: catalog?.mode || "tool",
      usedIn,
    };
  });

  // 6. Build KB catalog with "Used In" mapping
  const kbInfos: KBInfo[] = kbRows.map((kb) => ({
    id: kb.id,
    name: kb.name || "Unnamed KB",
    description: kb.description || "",
    usedIn: [], // TODO: parse from workspace CONTEXT.md "Knowledge Bases" section
  }));

  // 7. Render AGENTS.md
  const agentsMap = renderAgentsMap(agent.name, agentSlug, skillInfos, kbInfos, workspaces);

  // 8. Render CONTEXT.md
  const contextRouter = renderContextRouter(agent.name, workspaces);

  // 9. Write to S3
  await writeS3Text(BUCKET, `${prefix}AGENTS.md`, agentsMap);
  await writeS3Text(BUCKET, `${prefix}CONTEXT.md`, contextRouter);

  console.log(
    `[workspace-map] Regenerated AGENTS.md + CONTEXT.md for ${agentSlug}: ${workspaces.length} workspace(s), ${skillInfos.length} skill(s), ${kbInfos.length} KB(s)`,
  );

  // 10. Regenerate manifest so runtime picks up changes on next sync
  try {
    const { regenerateManifest } = await import("./workspace-manifest.js");
    await regenerateManifest(BUCKET, tenantSlug, agentSlug);
  } catch {
    // Manifest regeneration is also available in workspace-files.ts Lambda
    // If import fails (different bundle), it will be regenerated on next workspace write
    console.warn(`[workspace-map] Could not regenerate manifest inline, will sync on next write`);
  }
}

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

function renderAgentsMap(
  agentName: string,
  agentSlug: string,
  skills: SkillInfo[],
  kbs: KBInfo[],
  workspaces: WorkspaceSummary[],
): string {
  const lines: string[] = [];

  lines.push(`# ${agentName} — Workspace Map`);
  lines.push("");
  lines.push("## Folder Structure");
  lines.push("");
  lines.push("```");
  lines.push(`${agentSlug}/`);
  lines.push("├── AGENTS.md                    ← You are here (always loaded)");
  lines.push("├── CONTEXT.md                   ← Task router");
  lines.push("├── SOUL.md, IDENTITY.md, USER.md");

  for (let i = 0; i < workspaces.length; i++) {
    const ws = workspaces[i];
    const isLast = i === workspaces.length - 1;
    const branch = isLast ? "└──" : "├──";
    lines.push(`${branch} ${ws.slug}/`);
    lines.push(`${isLast ? "    " : "│   "}├── CONTEXT.md`);
    lines.push(`${isLast ? "    " : "│   "}└── docs/`);
  }
  lines.push("```");
  lines.push("");

  // Skills & Tools (PRD-38: skills as sub-agents)
  lines.push("## Skills & Tools");
  lines.push("");
  lines.push("**IMPORTANT**: Tools like `create_sub_thread`, `search_users`, `schedule_followup`, `list_sub_threads` etc. are registered directly on you. Always call these tools directly — do NOT delegate to another agent when you already have the required tool.");
  lines.push("");
  lines.push("Skills with **mode: agent** run as sub-agents — only delegate to them for tasks requiring autonomous multi-step reasoning you cannot do yourself.");
  lines.push("Skills with **mode: tool** provide tools already registered on you — call their functions directly, never delegate.");
  lines.push("Use the `skills` tool with a skill name to get detailed instructions before first use.");
  lines.push("");
  if (skills.length > 0) {
    lines.push("| Skill | Mode | Description | Triggers |");
    lines.push("|-------|------|-------------|----------|");
    for (const skill of skills) {
      const desc = skill.description ? skill.description.slice(0, 80) : "—";
      const triggers = skill.triggers?.slice(0, 3).join(", ") || "—";
      const mode = skill.mode || "tool";
      lines.push(`| ${skill.name} | ${mode} | ${desc} | ${triggers} |`);
    }
  } else {
    lines.push("No skills assigned.");
  }
  lines.push("");

  // Knowledge Bases
  if (kbs.length > 0) {
    lines.push("## Knowledge Bases");
    lines.push("");
    lines.push("| KB | Description | Used In |");
    lines.push("|----|-------------|---------|");
    for (const kb of kbs) {
      const usedIn = kb.usedIn.length > 0 ? kb.usedIn.join(", ") : "(all workspaces)";
      lines.push(`| ${kb.name} | ${kb.description} | ${usedIn} |`);
    }
    lines.push("");
  }

  // Delegation guidance
  const agentSkills = skills.filter((s) => s.mode === "agent");
  if (agentSkills.length > 0) {
    lines.push("## Delegation");
    lines.push("");
    lines.push(
      "For complex multi-step tasks, delegate to the appropriate mode:agent skill. " +
      "Include relevant context from your knowledge domains in the query.",
    );
    lines.push("");
  }

  return lines.join("\n");
}

function renderContextRouter(agentName: string, workspaces: WorkspaceSummary[]): string {
  const lines: string[] = [];

  lines.push(`# ${agentName} — Context`);
  lines.push("");
  lines.push(
    "Your workspace contains knowledge domains with specialized context. This information is loaded into your prompt.",
  );
  lines.push("");

  if (workspaces.length > 0) {
    lines.push("## Knowledge Domains");
    lines.push("");
    lines.push("| Domain | Purpose |");
    lines.push("|--------|---------|");
    for (const ws of workspaces) {
      lines.push(`| ${ws.name} | ${ws.purpose} |`);
    }
    lines.push("");
    lines.push(
      "Use your skills (mode: agent or mode: tool) to take actions. Knowledge domains provide context for decision-making.",
    );
  } else {
    lines.push("No knowledge domains configured.");
  }
  lines.push("");

  return lines.join("\n");
}

// regenerateManifest is now in ./workspace-manifest.ts (shared module)

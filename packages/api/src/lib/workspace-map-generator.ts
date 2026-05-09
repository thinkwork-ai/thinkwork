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
import { eq, and, isNotNull, ne, or } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
  agents,
  agentSkills,
  agentKnowledgeBases,
  computers,
  connectors,
  knowledgeBases,
  routines,
  tenantConnectorCatalog,
  tenantWorkflowCatalog,
} from "@thinkwork/database-pg/schema";
import { isBuiltinToolSlug } from "./builtin-tool-slugs.js";

const s3 = new S3Client({
  region: process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1",
});

function getBucket(): string {
  return process.env.WORKSPACE_BUCKET || "";
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SkillInfo {
  skillId: string;
  name: string;
  description: string | null;
  mcpServer?: string;
  /** PRD-31: Trigger phrases for progressive disclosure tier-1 matching */
  triggers?: string[];
  /** PRD-31: Reference file names available in this skill */
  references?: string[];
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

interface ConnectorInfo {
  catalogSlug: string;
  name: string;
  description: string;
  category: string | null;
}

interface WorkflowInfo {
  catalogSlug: string;
  name: string;
  description: string;
  schedule: string | null;
}

interface WorkspaceSummary {
  slug: string;
  name: string;
  purpose: string;
  model: string;
  skills: string[];
}

export interface RoutingRowInsert {
  task: string;
  goTo: string;
  read: string;
  skills: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function workspacePrefix(tenantSlug: string, agentSlug: string): string {
  return `tenants/${tenantSlug}/agents/${agentSlug}/workspace/`;
}

export function appendRoutingRowIfMissing(
  markdown: string,
  row: RoutingRowInsert,
): string {
  const normalizedGoTo = row.goTo.endsWith("/") ? row.goTo : `${row.goTo}/`;
  if (routingTableContainsGoTo(markdown, normalizedGoTo)) return markdown;

  const renderedRow = `| ${row.task} | ${normalizedGoTo} | ${row.read} | ${row.skills.join(",")} |`;
  const lines = markdown.split("\n");
  const routingHeadingIndex = lines.findIndex((line) =>
    /^##\s+Routing(\s+Table)?\s*$/i.test(line.trim()),
  );

  const tableStart =
    routingHeadingIndex === -1
      ? lines.findIndex((line) => line.trim().startsWith("|"))
      : lines.findIndex(
          (line, index) =>
            index > routingHeadingIndex && line.trim().startsWith("|"),
        );

  if (tableStart === -1 || tableStart + 1 >= lines.length) {
    const suffix = markdown.endsWith("\n") ? "" : "\n";
    return `${markdown}${suffix}
## Routing

| Task | Go to | Read | Skills |
| --- | --- | --- | --- |
${renderedRow}
`;
  }

  let insertAt = tableStart + 2;
  while (insertAt < lines.length && lines[insertAt]?.trim().startsWith("|")) {
    insertAt++;
  }
  lines.splice(insertAt, 0, renderedRow);
  return lines.join("\n");
}

function routingTableContainsGoTo(markdown: string, goTo: string): boolean {
  const escaped = goTo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\|[^\\n]*\\|\\s*${escaped}\\s*\\|`, "i").test(markdown);
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
 *   - agent_skills table → skill catalog (built-in tool slugs filtered out)
 *   - agent_knowledge_bases + knowledge_bases tables → KB catalog
 *   - connectors + tenant_connector_catalog → Connectors catalog (Computer-keyed)
 *   - routines + tenant_workflow_catalog → Workflows catalog (agent-keyed)
 *   - S3 workspace folders → workspace discovery + CONTEXT.md parsing
 *
 * Writes:
 *   - AGENTS.md to S3 workspace (skipped when content unchanged)
 *   - CONTEXT.md to S3 workspace (skipped when content unchanged)
 *
 * When `computerId` is omitted, the renderer auto-resolves a Computer via
 * `computers.primary_agent_id` / `migrated_from_agent_id` so non-Customize
 * callers (setAgentSkills, template flows) don't have to know about it.
 * Plan: docs/plans/2026-05-09-011-feat-customize-workspace-renderer-plan.md U7-1.
 */
export async function regenerateWorkspaceMap(
  agentId: string,
  computerId?: string,
): Promise<void> {
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
  const bucket = getBucket();
  if (!tenantSlug || !bucket) {
    console.warn(`[workspace-map] Missing tenant slug or bucket`);
    return;
  }

  const agentSlug = agent.slug;
  const prefix = workspacePrefix(tenantSlug, agentSlug);

  // 2a. Resolve Computer (explicit param wins; otherwise look up by primary
  //     agent). Connectors are Computer-keyed; Skills + Workflows are
  //     agent-keyed, so a missing Computer only suppresses the Connectors
  //     section.
  let computerRow: { id: string; tenant_id: string } | null = null;
  if (computerId) {
    const [row] = await db
      .select({ id: computers.id, tenant_id: computers.tenant_id })
      .from(computers)
      .where(
        and(
          eq(computers.id, computerId),
          ne(computers.status, "archived"),
        ),
      );
    computerRow = row ?? null;
  } else {
    const [row] = await db
      .select({ id: computers.id, tenant_id: computers.tenant_id })
      .from(computers)
      .where(
        and(
          or(
            eq(computers.primary_agent_id, agentId),
            eq(computers.migrated_from_agent_id, agentId),
          ),
          ne(computers.status, "archived"),
        ),
      );
    computerRow = row ?? null;
  }

  // 2. Query skills (filter built-in tool slugs — they're template/runtime
  //    config, not workspace skills, per
  //    docs/solutions/best-practices/injected-built-in-tools-are-not-workspace-skills-2026-04-28.md).
  const skillRowsRaw = await db
    .select({
      skill_id: agentSkills.skill_id,
      config: agentSkills.config,
      enabled: agentSkills.enabled,
    })
    .from(agentSkills)
    .where(and(eq(agentSkills.agent_id, agentId), eq(agentSkills.enabled, true)));
  const skillRows = skillRowsRaw.filter((s) => !isBuiltinToolSlug(s.skill_id));

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

  // 3b. Query active Customize connectors (Computer-keyed). Joined to the
  //     tenant_connector_catalog for display_name + description + category.
  //     Empty when no Computer was resolved — the section still renders in
  //     "no connectors configured" form.
  const connectorRows: Array<{
    catalog_slug: string;
    display_name: string;
    description: string | null;
    category: string | null;
  }> = computerRow
    ? await db
        .select({
          catalog_slug: connectors.catalog_slug,
          display_name: tenantConnectorCatalog.display_name,
          description: tenantConnectorCatalog.description,
          category: tenantConnectorCatalog.category,
        })
        .from(connectors)
        .innerJoin(
          tenantConnectorCatalog,
          and(
            eq(tenantConnectorCatalog.tenant_id, connectors.tenant_id),
            eq(tenantConnectorCatalog.slug, connectors.catalog_slug),
          ),
        )
        .where(
          and(
            eq(connectors.tenant_id, computerRow.tenant_id),
            eq(connectors.dispatch_target_type, "computer"),
            eq(connectors.dispatch_target_id, computerRow.id),
            eq(connectors.enabled, true),
            eq(connectors.status, "active"),
            isNotNull(connectors.catalog_slug),
          ),
        )
        // Drizzle's join row typing leaves catalog_slug as nullable since
        // the source column allows null; the WHERE filter guarantees it.
        .then((rows) =>
          rows
            .filter(
              (r): r is typeof r & { catalog_slug: string } =>
                r.catalog_slug !== null,
            )
            .map((r) => ({
              catalog_slug: r.catalog_slug,
              display_name: r.display_name,
              description: r.description,
              category: r.category,
            })),
        )
    : [];

  // 3c. Query active Customize workflows (agent-keyed). Joined to
  //     tenant_workflow_catalog for display_name + description; schedule
  //     prefers the catalog default_schedule, falls back to the routine row.
  const workflowRowsRaw = await db
    .select({
      catalog_slug: routines.catalog_slug,
      routine_schedule: routines.schedule,
      display_name: tenantWorkflowCatalog.display_name,
      description: tenantWorkflowCatalog.description,
      default_schedule: tenantWorkflowCatalog.default_schedule,
    })
    .from(routines)
    .innerJoin(
      tenantWorkflowCatalog,
      and(
        eq(tenantWorkflowCatalog.tenant_id, routines.tenant_id),
        eq(tenantWorkflowCatalog.slug, routines.catalog_slug),
      ),
    )
    .where(
      and(
        eq(routines.agent_id, agentId),
        eq(routines.status, "active"),
        isNotNull(routines.catalog_slug),
      ),
    );
  const workflowRows = workflowRowsRaw
    .filter(
      (r): r is typeof r & { catalog_slug: string } => r.catalog_slug !== null,
    )
    .map((r) => ({
      catalog_slug: r.catalog_slug,
      display_name: r.display_name,
      description: r.description,
      schedule: r.default_schedule ?? r.routine_schedule ?? null,
    }));

  // 4. Discover workspace folders from S3
  const workspaceSlugs = await discoverWorkspaceFolders(bucket, prefix);
  const workspaces: WorkspaceSummary[] = [];

  for (const ws of workspaceSlugs) {
    const contextContent = await readS3Text(bucket, `${prefix}${ws}/CONTEXT.md`);
    if (contextContent) {
      workspaces.push(parseWorkspaceContext(contextContent, ws));
    }
  }

  // 5. Build skill catalog with "Used In" mapping + PRD-31 metadata from DB
  const catalogLookup = new Map<string, {
    name: string; description: string | null; mcp_server: string | null;
    triggers: string[] | null;
  }>();
  try {
    const { skillCatalog } = await import("@thinkwork/database-pg/schema");
    const catalogRows = await db.select({
      slug: skillCatalog.slug,
      name: skillCatalog.display_name,
      description: skillCatalog.description,
      mcp_server: skillCatalog.mcp_server,
      triggers: skillCatalog.triggers,
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

  // 6b. Build Connectors catalog
  const connectorInfos: ConnectorInfo[] = connectorRows.map((c) => ({
    catalogSlug: c.catalog_slug,
    name: c.display_name,
    description: c.description ?? "",
    category: c.category,
  }));

  // 6c. Build Workflows catalog
  const workflowInfos: WorkflowInfo[] = workflowRows.map((w) => ({
    catalogSlug: w.catalog_slug,
    name: w.display_name,
    description: w.description ?? "",
    schedule: w.schedule,
  }));

  // 7. Render AGENTS.md
  const agentsMap = renderAgentsMap(
    agent.name,
    agentSlug,
    skillInfos,
    kbInfos,
    connectorInfos,
    workflowInfos,
    workspaces,
  );

  // 8. Render CONTEXT.md
  const contextRouter = renderContextRouter(agent.name, workspaces);

  // 9. Idempotent write — skip the S3 PutObject when the rendered content
  //    matches what's already on S3. Saves writes on no-op toggles
  //    (re-clicking Connect on already-active row) and avoids manifest
  //    regen churn.
  const [existingAgentsMap, existingContextRouter] = await Promise.all([
    readS3Text(bucket, `${prefix}AGENTS.md`),
    readS3Text(bucket, `${prefix}CONTEXT.md`),
  ]);
  const agentsMapChanged = existingAgentsMap !== agentsMap;
  const contextRouterChanged = existingContextRouter !== contextRouter;

  if (agentsMapChanged) {
    await writeS3Text(bucket, `${prefix}AGENTS.md`, agentsMap);
  }
  if (contextRouterChanged) {
    await writeS3Text(bucket, `${prefix}CONTEXT.md`, contextRouter);
  }

  if (!agentsMapChanged && !contextRouterChanged) {
    console.log(
      `[workspace-map] Skipped write for ${agentSlug}: content unchanged`,
    );
    return;
  }

  console.log(
    `[workspace-map] Regenerated for ${agentSlug}: ${workspaces.length} workspace(s), ${skillInfos.length} skill(s), ${kbInfos.length} KB(s), ${connectorInfos.length} connector(s), ${workflowInfos.length} workflow(s)`,
  );

  // 10. Regenerate manifest so runtime picks up changes on next sync
  try {
    const { regenerateManifest } = await import("./workspace-manifest.js");
    await regenerateManifest(bucket, tenantSlug, agentSlug);
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
  connectorList: ConnectorInfo[],
  workflowList: WorkflowInfo[],
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

  // Skills & Tools
  lines.push("## Skills & Tools");
  lines.push("");
  lines.push("**IMPORTANT**: Tools like `create_sub_thread`, `search_users`, `schedule_followup`, `list_sub_threads` etc. are registered directly on you. Always call these tools directly — do NOT delegate to another agent when you already have the required tool.");
  lines.push("");
  lines.push("Use the `Skill` meta-tool with a skill name to invoke a skill; nested skills are supported up to the plan's depth budget.");
  lines.push("");
  if (skills.length > 0) {
    lines.push("| Skill | Description | Triggers |");
    lines.push("|-------|-------------|----------|");
    for (const skill of skills) {
      const desc = skill.description ? skill.description.slice(0, 80) : "—";
      const triggers = skill.triggers?.slice(0, 3).join(", ") || "—";
      lines.push(`| ${skill.name} | ${desc} | ${triggers} |`);
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

  // Connectors (Customize-page-driven; Computer-keyed)
  lines.push("## Connectors");
  lines.push("");
  if (connectorList.length > 0) {
    lines.push("| Connector | Description | Category |");
    lines.push("|-----------|-------------|----------|");
    for (const c of connectorList) {
      const desc = c.description ? c.description.slice(0, 80) : "—";
      const category = c.category ?? "—";
      lines.push(`| ${c.name} | ${desc} | ${category} |`);
    }
  } else {
    lines.push("No connectors configured.");
  }
  lines.push("");

  // Workflows (Customize-page-driven; agent-keyed)
  lines.push("## Workflows");
  lines.push("");
  if (workflowList.length > 0) {
    lines.push("| Workflow | Description | Schedule |");
    lines.push("|----------|-------------|----------|");
    for (const w of workflowList) {
      const desc = w.description ? w.description.slice(0, 80) : "—";
      const schedule = w.schedule ?? "on-demand";
      lines.push(`| ${w.name} | ${desc} | ${schedule} |`);
    }
  } else {
    lines.push("No workflows configured.");
  }
  lines.push("");

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
      "Use your skills to take actions. Knowledge domains provide context for decision-making.",
    );
  } else {
    lines.push("No knowledge domains configured.");
  }
  lines.push("");

  return lines.join("\n");
}

// regenerateManifest is now in ./workspace-manifest.ts (shared module)

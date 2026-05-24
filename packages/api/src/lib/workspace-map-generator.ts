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
import { eq, and, asc, isNotNull } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
  agents,
  agentSkills,
  agentKnowledgeBases,
  knowledgeBases,
  routines,
  tenantWorkflowCatalog,
} from "@thinkwork/database-pg/schema";
import { isBuiltinToolSlug } from "./builtin-tool-slugs.js";

const s3 = new S3Client({
  region:
    process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1",
});

function getBucket(): string {
  return process.env.WORKSPACE_BUCKET || "";
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SkillInfo {
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

export interface KBInfo {
  id: string;
  name: string;
  description: string;
  /** Workspace slugs that reference this KB */
  usedIn: string[];
}

export interface WorkflowInfo {
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

interface WorkspaceMapRenderContext {
  agentName: string;
  agentSlug: string;
  tenantSlug: string;
  bucket: string;
  prefix: string;
  skills: SkillInfo[];
  kbs: KBInfo[];
  workflows: WorkflowInfo[];
  workspaceObjectPaths: string[];
  contextByFolder: Map<string, string>;
  workspaces: WorkspaceSummary[];
}

export type DerivedSectionName =
  | "Folder Structure"
  | "Skills & Tools"
  | "Knowledge Bases"
  | "Workflows";

const DERIVED_SECTION_ORDER: DerivedSectionName[] = [
  "Folder Structure",
  "Skills & Tools",
  "Knowledge Bases",
  "Workflows",
];

const ROOT_ANNOTATIONS = new Map<string, string>([
  ["AGENTS.md", "You are here (always loaded)"],
  ["CONTEXT.md", "Task router"],
  ["memory/", "Long-lived agent memory"],
  ["skills/", "Workspace skills"],
  ["review/", "Human review artifacts"],
  ["events/", "Event log"],
]);

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

/**
 * Escape Markdown table-cell content so admin-controlled catalog text
 * (display_name / description / category, and any future user-facing
 * field that lands in AGENTS.md) cannot break out of the cell. Without
 * this, a `|` in the description would break the table layout, and a
 * newline would inject arbitrary markdown — including `## EVIL` headers
 * the LLM would read as instructions.
 *
 * Plan: docs/plans/2026-05-09-011-feat-customize-workspace-renderer-plan.md U7-1.
 */
function escTableCell(value: string | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const trimmed = value.trim();
  if (trimmed === "") return "—";
  return trimmed.replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ");
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
    const resp = await s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    );
    return (await resp.Body?.transformToString("utf-8")) ?? null;
  } catch {
    return null;
  }
}

async function writeS3Text(
  bucket: string,
  key: string,
  content: string,
): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: content,
      ContentType: "text/plain; charset=utf-8",
    }),
  );
}

async function listWorkspaceObjectPaths(
  bucket: string,
  prefix: string,
): Promise<string[]> {
  const paths: string[] = [];
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
      if (rel) paths.push(rel);
    }
    continuationToken = result.IsTruncated
      ? result.NextContinuationToken
      : undefined;
  } while (continuationToken);

  return paths.sort((a, b) => a.localeCompare(b));
}

function isHiddenPathSegment(segment: string): boolean {
  return segment.startsWith(".");
}

function visiblePathForTree(
  path: string,
): { segments: string[]; folderOnly: boolean } | null {
  const rawSegments = path.split("/").filter(Boolean);
  if (rawSegments.length === 0) return null;

  if (path.endsWith("/")) {
    return rawSegments.some(isHiddenPathSegment)
      ? null
      : { segments: rawSegments, folderOnly: true };
  }

  const lastSegment = rawSegments[rawSegments.length - 1];
  const parentSegments = rawSegments.slice(0, -1);
  if (parentSegments.some(isHiddenPathSegment)) return null;
  if (lastSegment && isHiddenPathSegment(lastSegment)) {
    return parentSegments.length > 0
      ? { segments: parentSegments, folderOnly: true }
      : null;
  }
  return { segments: rawSegments, folderOnly: false };
}

interface TreeNode {
  name: string;
  kind: "directory" | "file";
  children: Map<string, TreeNode>;
}

function createTreeNode(name: string, kind: "directory" | "file"): TreeNode {
  return { name, kind, children: new Map() };
}

function addTreePath(root: TreeNode, path: string): void {
  const visiblePath = visiblePathForTree(path);
  if (!visiblePath) return;
  const { segments, folderOnly } = visiblePath;

  let current = root;
  for (let index = 0; index < segments.length; index++) {
    const segment = segments[index];
    const isLast = index === segments.length - 1;
    const kind = isLast && !folderOnly ? "file" : "directory";
    const existing = current.children.get(segment);
    if (existing) {
      if (!isLast) existing.kind = "directory";
      current = existing;
      continue;
    }
    const node = createTreeNode(segment, kind);
    current.children.set(segment, node);
    current = node;
  }
}

function sortedTreeChildren(node: TreeNode): TreeNode[] {
  return [...node.children.values()].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

function contextAnnotation(content: string): string | null {
  const lines = content.split(/\r?\n/);
  const h1 = lines
    .find((line) => /^#\s+/.test(line))
    ?.replace(/^#\s+/, "")
    .trim();
  if (
    h1 &&
    !["context", "workspace context", "context.md"].includes(h1.toLowerCase())
  ) {
    return h1;
  }
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed === "---") continue;
    return trimmed;
  }
  return h1 ?? null;
}

function annotationForTreePath(
  path: string,
  contextByFolder: Map<string, string>,
): string | null {
  const fixed = ROOT_ANNOTATIONS.get(path);
  if (fixed) return fixed;
  const context = contextByFolder.get(path);
  return context ? contextAnnotation(context) : null;
}

function renderTreeLabel(
  node: TreeNode,
  path: string,
  contextByFolder: Map<string, string>,
): string {
  const displayName = node.kind === "directory" ? `${node.name}/` : node.name;
  const annotation = annotationForTreePath(
    node.kind === "directory" ? `${path}/` : path,
    contextByFolder,
  );
  return annotation ? `${displayName} ← ${annotation}` : displayName;
}

function renderWorkspaceTree(
  agentSlug: string,
  objectPaths: string[],
  contextByFolder: Map<string, string>,
): string {
  const root = createTreeNode(agentSlug, "directory");
  for (const path of objectPaths) {
    addTreePath(root, path);
  }

  const lines = [`${agentSlug}/`];
  function walk(node: TreeNode, prefix: string, pathPrefix: string): void {
    const children = sortedTreeChildren(node);
    children.forEach((child, index) => {
      const isLast = index === children.length - 1;
      const branch = isLast ? "└──" : "├──";
      const childPath = pathPrefix ? `${pathPrefix}/${child.name}` : child.name;
      lines.push(
        `${prefix}${branch} ${renderTreeLabel(child, childPath, contextByFolder)}`,
      );
      if (child.kind === "directory") {
        walk(child, `${prefix}${isLast ? "    " : "│   "}`, childPath);
      }
    });
  }
  walk(root, "", "");
  return lines.join("\n");
}

export function replaceDerivedAgentsMdSections(
  markdown: string,
  sections: Record<DerivedSectionName, string>,
): string {
  let rendered = markdown;

  for (const sectionName of DERIVED_SECTION_ORDER) {
    const sectionRange = findSectionBodyRange(rendered, sectionName);
    if (!sectionRange) continue;
    rendered =
      rendered.slice(0, sectionRange.start) +
      sections[sectionName] +
      rendered.slice(sectionRange.end);
  }

  for (const sectionName of DERIVED_SECTION_ORDER) {
    if (findSectionBodyRange(rendered, sectionName)) continue;
    const suffix = rendered.endsWith("\n") ? "" : "\n";
    rendered = `${rendered}${suffix}\n---\n\n## ${sectionName}${sections[sectionName]}`;
  }

  return rendered;
}

function findSectionBodyRange(
  markdown: string,
  sectionName: DerivedSectionName,
): { start: number; end: number } | null {
  const headingPattern = new RegExp(
    `(^|\\n)## ${sectionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*(?:\\r?\\n|$)`,
    "g",
  );
  const match = headingPattern.exec(markdown);
  if (!match) return null;

  const headingStart = match.index + (match[1] === "\n" ? 1 : 0);
  const bodyStart = headingPattern.lastIndex;
  const linePattern = /[^\n]*(?:\n|$)/g;
  linePattern.lastIndex = bodyStart;

  let lineMatch: RegExpExecArray | null;
  while ((lineMatch = linePattern.exec(markdown))) {
    const lineStart = lineMatch.index;
    if (lineStart >= markdown.length) break;
    const line = lineMatch[0];
    const trimmed = line.trim();
    if (
      lineStart > headingStart &&
      (trimmed === "---" || line.startsWith("## "))
    ) {
      return { start: bodyStart, end: lineStart };
    }
    if (linePattern.lastIndex >= markdown.length) break;
  }

  return { start: bodyStart, end: markdown.length };
}

/**
 * Parse a workspace CONTEXT.md to extract summary info.
 * Lightweight parse — just extracts name, role, model, and skill references.
 */
function parseWorkspaceContext(
  content: string,
  slug: string,
): WorkspaceSummary {
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
  const configMatch = content.match(
    /^##\s+Config\s*\n([\s\S]*?)(?=\n##\s|\n---|\n$)/m,
  );
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
    const tableLines = skillsMatch[1]
      .split("\n")
      .filter((l) => l.trim().startsWith("|"));
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

async function loadWorkspaceMapRenderContext(
  agentId: string,
): Promise<WorkspaceMapRenderContext | null> {
  const db = getDb();

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
    return null;
  }

  const { tenants } = await import("@thinkwork/database-pg/schema");
  const [tenant] = await db
    .select({ slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.id, agent.tenant_id));
  const tenantSlug = tenant?.slug || "";
  const bucket = getBucket();
  if (!tenantSlug || !bucket) {
    console.warn(`[workspace-map] Missing tenant slug or bucket`);
    return null;
  }

  const agentSlug = agent.slug;
  const prefix = workspacePrefix(tenantSlug, agentSlug);

  const skillRowsRaw = await db
    .select({
      skill_id: agentSkills.skill_id,
      config: agentSkills.config,
      enabled: agentSkills.enabled,
    })
    .from(agentSkills)
    .where(
      and(eq(agentSkills.agent_id, agentId), eq(agentSkills.enabled, true)),
    )
    .orderBy(asc(agentSkills.skill_id));
  const skillRows = skillRowsRaw.filter((s) => !isBuiltinToolSlug(s.skill_id));

  const kbRows = await db
    .select({
      id: knowledgeBases.id,
      name: knowledgeBases.name,
      description: knowledgeBases.description,
    })
    .from(agentKnowledgeBases)
    .innerJoin(
      knowledgeBases,
      eq(agentKnowledgeBases.knowledge_base_id, knowledgeBases.id),
    )
    .where(
      and(
        eq(agentKnowledgeBases.agent_id, agentId),
        eq(agentKnowledgeBases.enabled, true),
      ),
    )
    .orderBy(asc(knowledgeBases.id));

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
    )
    .orderBy(asc(routines.catalog_slug));
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

  const workspaceObjectPaths = await listWorkspaceObjectPaths(bucket, prefix);
  const workspaceSlugs = workspaceObjectPaths
    .map((rel) => rel.match(/^([^/.][^/]*)\/CONTEXT\.md$/)?.[1])
    .filter((slug): slug is string => Boolean(slug));
  const contextByFolder = new Map<string, string>();
  const workspaces: WorkspaceSummary[] = [];

  for (const ws of workspaceSlugs) {
    const contextContent = await readS3Text(
      bucket,
      `${prefix}${ws}/CONTEXT.md`,
    );
    if (contextContent) {
      contextByFolder.set(`${ws}/`, contextContent);
      workspaces.push(parseWorkspaceContext(contextContent, ws));
    }
  }

  for (const rel of workspaceObjectPaths) {
    if (!rel.endsWith("/CONTEXT.md") || /^([^/]+)\/CONTEXT\.md$/.test(rel)) {
      continue;
    }
    const folder = rel.slice(0, -"CONTEXT.md".length);
    const contextContent = await readS3Text(bucket, `${prefix}${rel}`);
    if (contextContent) contextByFolder.set(folder, contextContent);
  }

  const catalogLookup = new Map<
    string,
    {
      name: string;
      description: string | null;
      mcp_server: string | null;
      triggers: string[] | null;
    }
  >();
  try {
    const { skillCatalog } = await import("@thinkwork/database-pg/schema");
    const catalogRows = await db
      .select({
        slug: skillCatalog.slug,
        name: skillCatalog.display_name,
        description: skillCatalog.description,
        mcp_server: skillCatalog.mcp_server,
        triggers: skillCatalog.triggers,
      })
      .from(skillCatalog)
      .execute();
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
      name:
        catalog?.name ||
        s.skill_id
          .split("-")
          .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(" "),
      description: catalog?.description || "",
      mcpServer:
        catalog?.mcp_server || (config.mcpServer as string) || undefined,
      triggers: catalog?.triggers || undefined,
      usedIn,
    };
  });

  const kbInfos: KBInfo[] = kbRows.map((kb) => ({
    id: kb.id,
    name: kb.name || "Unnamed KB",
    description: kb.description || "",
    usedIn: [],
  }));

  const workflowInfos: WorkflowInfo[] = workflowRows.map((w) => ({
    catalogSlug: w.catalog_slug,
    name: w.display_name,
    description: w.description ?? "",
    schedule: w.schedule,
  }));

  return {
    agentName: agent.name,
    agentSlug,
    tenantSlug,
    bucket,
    prefix,
    skills: skillInfos,
    kbs: kbInfos,
    workflows: workflowInfos,
    workspaceObjectPaths,
    contextByFolder,
    workspaces,
  };
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
 *   - routines + tenant_workflow_catalog → Workflows catalog (agent-keyed)
 *   - S3 workspace folders → workspace discovery + CONTEXT.md parsing
 *
 * Writes:
 *   - AGENTS.md to S3 workspace (skipped when content unchanged)
 *   - CONTEXT.md to S3 workspace (skipped when content unchanged)
 *
 */
export async function regenerateWorkspaceMap(
  agentId: string,
  _computerId?: string,
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

  // 2. Query skills (filter built-in tool slugs — they're template/runtime
  //    config, not workspace skills, per
  //    docs/solutions/best-practices/injected-built-in-tools-are-not-workspace-skills-2026-04-28.md).
  // Deterministic ORDER BY so the rendered Markdown is byte-stable across
  // calls — required for the idempotent-write byte-equal compare to detect
  // no-op renders. Postgres heap order is unspecified and shifts after
  // UPDATEs.
  const skillRowsRaw = await db
    .select({
      skill_id: agentSkills.skill_id,
      config: agentSkills.config,
      enabled: agentSkills.enabled,
    })
    .from(agentSkills)
    .where(
      and(eq(agentSkills.agent_id, agentId), eq(agentSkills.enabled, true)),
    )
    .orderBy(asc(agentSkills.skill_id));
  const skillRows = skillRowsRaw.filter((s) => !isBuiltinToolSlug(s.skill_id));

  // 3. Query knowledge bases
  const kbRows = await db
    .select({
      id: knowledgeBases.id,
      name: knowledgeBases.name,
      description: knowledgeBases.description,
    })
    .from(agentKnowledgeBases)
    .innerJoin(
      knowledgeBases,
      eq(agentKnowledgeBases.knowledge_base_id, knowledgeBases.id),
    )
    .where(
      and(
        eq(agentKnowledgeBases.agent_id, agentId),
        eq(agentKnowledgeBases.enabled, true),
      ),
    )
    .orderBy(asc(knowledgeBases.id));

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
    )
    .orderBy(asc(routines.catalog_slug));
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

  // 4. Discover workspace files/folders from S3
  const workspaceObjectPaths = await listWorkspaceObjectPaths(bucket, prefix);
  const workspaceSlugs = workspaceObjectPaths
    .map((rel) => rel.match(/^([^/.][^/]*)\/CONTEXT\.md$/)?.[1])
    .filter((slug): slug is string => Boolean(slug));
  const contextByFolder = new Map<string, string>();
  const workspaces: WorkspaceSummary[] = [];

  for (const ws of workspaceSlugs) {
    const contextContent = await readS3Text(
      bucket,
      `${prefix}${ws}/CONTEXT.md`,
    );
    if (contextContent) {
      contextByFolder.set(`${ws}/`, contextContent);
      workspaces.push(parseWorkspaceContext(contextContent, ws));
    }
  }

  for (const rel of workspaceObjectPaths) {
    if (!rel.endsWith("/CONTEXT.md") || /^([^/]+)\/CONTEXT\.md$/.test(rel)) {
      continue;
    }
    const folder = rel.slice(0, -"CONTEXT.md".length);
    const contextContent = await readS3Text(bucket, `${prefix}${rel}`);
    if (contextContent) contextByFolder.set(folder, contextContent);
  }

  // 5. Build skill catalog with "Used In" mapping + PRD-31 metadata from DB
  const catalogLookup = new Map<
    string,
    {
      name: string;
      description: string | null;
      mcp_server: string | null;
      triggers: string[] | null;
    }
  >();
  try {
    const { skillCatalog } = await import("@thinkwork/database-pg/schema");
    const catalogRows = await db
      .select({
        slug: skillCatalog.slug,
        name: skillCatalog.display_name,
        description: skillCatalog.description,
        mcp_server: skillCatalog.mcp_server,
        triggers: skillCatalog.triggers,
      })
      .from(skillCatalog)
      .execute();
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
      name:
        catalog?.name ||
        s.skill_id
          .split("-")
          .map((w: string) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(" "),
      description: catalog?.description || "",
      mcpServer:
        catalog?.mcp_server || (config.mcpServer as string) || undefined,
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

  // 6b. Build Workflows catalog
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
    workflowInfos,
    workspaceObjectPaths,
    contextByFolder,
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
    `[workspace-map] Regenerated for ${agentSlug}: ${workspaces.length} workspace(s), ${skillInfos.length} skill(s), ${kbInfos.length} KB(s), ${workflowInfos.length} workflow(s)`,
  );

  // 10. Regenerate manifest so runtime picks up changes on next sync
  try {
    const { regenerateManifest } = await import("./workspace-manifest.js");
    await regenerateManifest(bucket, tenantSlug, agentSlug);
  } catch {
    // Manifest regeneration is also available in workspace-files.ts Lambda
    // If import fails (different bundle), it will be regenerated on next workspace write
    console.warn(
      `[workspace-map] Could not regenerate manifest inline, will sync on next write`,
    );
  }
}

/**
 * Refresh only the derived AGENTS.md sections while preserving operator-owned
 * prose such as routing notes and custom instructions.
 */
export async function regenerateAgentsMdDerivedSections(
  agentId: string,
): Promise<void> {
  const context = await loadWorkspaceMapRenderContext(agentId);
  if (!context) return;

  const existingAgentsMd = await readS3Text(
    context.bucket,
    `${context.prefix}AGENTS.md`,
  );
  const seedAgentsMd =
    existingAgentsMd ?? `# ${context.agentName} — Workspace Map\n`;
  const nextAgentsMd = replaceDerivedAgentsMdSections(
    seedAgentsMd,
    renderDerivedAgentsMdSections({
      agentSlug: context.agentSlug,
      workspaceObjectPaths: context.workspaceObjectPaths,
      contextByFolder: context.contextByFolder,
      skills: context.skills,
      kbs: context.kbs,
      workflows: context.workflows,
    }),
  );

  if (existingAgentsMd === nextAgentsMd) {
    console.log(
      `[workspace-map] Skipped AGENTS.md section refresh for ${context.agentSlug}: content unchanged`,
    );
    return;
  }

  await writeS3Text(context.bucket, `${context.prefix}AGENTS.md`, nextAgentsMd);
  console.log(
    `[workspace-map] Refreshed AGENTS.md derived sections for ${context.agentSlug}: ${context.workspaces.length} workspace(s), ${context.skills.length} skill(s), ${context.kbs.length} KB(s), ${context.workflows.length} workflow(s)`,
  );

  try {
    const { regenerateManifest } = await import("./workspace-manifest.js");
    await regenerateManifest(
      context.bucket,
      context.tenantSlug,
      context.agentSlug,
    );
  } catch {
    console.warn(
      `[workspace-map] Could not regenerate manifest after AGENTS.md section refresh`,
    );
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
  workflowList: WorkflowInfo[],
  workspaceObjectPaths: string[],
  contextByFolder: Map<string, string>,
): string {
  const lines: string[] = [];

  lines.push(`# ${agentName} — Workspace Map`);
  lines.push(
    renderFolderStructureSection(
      agentSlug,
      workspaceObjectPaths,
      contextByFolder,
    ),
  );
  lines.push(renderSkillsSection(skills));
  lines.push(renderKnowledgeBasesSection(kbs));
  lines.push(renderWorkflowsSection(workflowList));

  return lines.join("\n");
}

function renderFolderStructureSection(
  agentSlug: string,
  workspaceObjectPaths: string[],
  contextByFolder: Map<string, string>,
): string {
  return `\n## Folder Structure${renderFolderStructureBody(
    agentSlug,
    workspaceObjectPaths,
    contextByFolder,
  )}`;
}

function renderFolderStructureBody(
  agentSlug: string,
  workspaceObjectPaths: string[],
  contextByFolder: Map<string, string>,
): string {
  return `\n\`\`\`\n${renderWorkspaceTree(
    agentSlug,
    workspaceObjectPaths,
    contextByFolder,
  )}\n\`\`\`\n`;
}

function renderSkillsSection(skills: SkillInfo[]): string {
  return `\n## Skills & Tools${renderSkillsBody(skills)}`;
}

function renderSkillsBody(skills: SkillInfo[]): string {
  const lines: string[] = [];

  lines.push("");
  lines.push("");
  lines.push(
    "**IMPORTANT**: Tools like `create_sub_thread`, `search_users`, `schedule_followup`, `list_sub_threads` etc. are registered directly on you. Always call these tools directly — do NOT delegate to another agent when you already have the required tool.",
  );
  lines.push("");
  lines.push(
    "Use the `Skill` meta-tool with a skill name to invoke a skill; nested skills are supported up to the plan's depth budget.",
  );
  lines.push("");
  if (skills.length > 0) {
    lines.push("| Skill | Description | Triggers |");
    lines.push("|-------|-------------|----------|");
    for (const skill of skills) {
      const desc = escTableCell(skill.description?.slice(0, 80) ?? null);
      const triggers = escTableCell(
        skill.triggers?.slice(0, 3).join(", ") ?? null,
      );
      lines.push(`| ${escTableCell(skill.name)} | ${desc} | ${triggers} |`);
    }
  } else {
    lines.push("No skills assigned.");
  }
  lines.push("");
  return lines.join("\n");
}

function renderKnowledgeBasesSection(kbs: KBInfo[]): string {
  return `\n## Knowledge Bases${renderKnowledgeBasesBody(kbs)}`;
}

function renderKnowledgeBasesBody(kbs: KBInfo[]): string {
  const lines: string[] = [];

  lines.push("");
  lines.push("");
  if (kbs.length > 0) {
    lines.push("| KB | Description | Used In |");
    lines.push("|----|-------------|---------|");
    for (const kb of kbs) {
      const usedIn = escTableCell(
        kb.usedIn.length > 0 ? kb.usedIn.join(", ") : "(all workspaces)",
      );
      lines.push(
        `| ${escTableCell(kb.name)} | ${escTableCell(kb.description)} | ${usedIn} |`,
      );
    }
  } else {
    lines.push("No knowledge bases assigned.");
  }
  lines.push("");
  return lines.join("\n");
}

function renderWorkflowsSection(workflowList: WorkflowInfo[]): string {
  return `\n## Workflows${renderWorkflowsBody(workflowList)}`;
}

function renderWorkflowsBody(workflowList: WorkflowInfo[]): string {
  const lines: string[] = [];

  lines.push("");
  lines.push("");
  if (workflowList.length > 0) {
    lines.push("| Workflow | Description | Schedule |");
    lines.push("|----------|-------------|----------|");
    for (const w of workflowList) {
      const desc = escTableCell(w.description?.slice(0, 80) ?? null);
      const schedule = escTableCell(w.schedule ?? "on-demand");
      lines.push(`| ${escTableCell(w.name)} | ${desc} | ${schedule} |`);
    }
  } else {
    lines.push("No workflows configured.");
  }
  lines.push("");

  return lines.join("\n");
}

export function renderDerivedAgentsMdSections(args: {
  agentSlug: string;
  workspaceObjectPaths: string[];
  contextByFolder?: Map<string, string>;
  skills: SkillInfo[];
  kbs: KBInfo[];
  workflows: WorkflowInfo[];
}): Record<DerivedSectionName, string> {
  const contextByFolder = args.contextByFolder ?? new Map<string, string>();
  return {
    "Folder Structure": renderFolderStructureBody(
      args.agentSlug,
      args.workspaceObjectPaths,
      contextByFolder,
    ),
    "Skills & Tools": renderSkillsBody(args.skills),
    "Knowledge Bases": renderKnowledgeBasesBody(args.kbs),
    Workflows: renderWorkflowsBody(args.workflows),
  };
}

function renderContextRouter(
  agentName: string,
  workspaces: WorkspaceSummary[],
): string {
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

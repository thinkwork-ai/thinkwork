/**
 * Workspace Map Generator
 *
 * Generates AGENTS.md (the map) and top-level CONTEXT.md from S3 workspace
 * structure. These two files are always loaded into the parent agent's system
 * prompt.
 *
 * AGENTS.md — The Map
 *   - Folder structure of entire workspace
 *   - Skill catalog discovered from SKILL.md files in the workspace tree
 *   - Auto-generated; users don't edit directly
 *
 * CONTEXT.md — Knowledge Overview
 *   - Knowledge domain summary (workspace folders)
 *   - Auto-generated from workspace CONTEXT.md files
 *
 * Called when:
 *   - Skill is assigned/removed from agent
 *   - Workspace is created/deleted/modified via wizard
 */

import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { eq } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import { agents, spaces, tenants } from "@thinkwork/database-pg/schema";
import { loadFile } from "@thinkwork/workspace-defaults";
import { isBuiltinToolSlug } from "./builtin-tool-slugs.js";
import { spaceSourcePrefix } from "./spaces/template-migration.js";
import { discoverWorkspaceSkillsFromPaths } from "./skills-tree-walker.js";
import { regenerateManifestForPrefix } from "./workspace-manifest.js";

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
  scope: string;
  skillPath: string;
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
  workspaceObjectPaths: string[];
  contextByFolder: Map<string, string>;
  workspaces: WorkspaceSummary[];
}

export type DerivedSectionName = "Folder Structure" | "Skills & Tools";

const DERIVED_SECTION_ORDER: DerivedSectionName[] = [
  "Folder Structure",
  "Skills & Tools",
];

const ROOT_ANNOTATIONS = new Map<string, string>([
  ["AGENTS.md", "You are here (always loaded)"],
  ["CONTEXT.md", "Task router"],
  ["memory/", "Long-lived agent memory"],
  ["review/", "Human review artifacts"],
  ["events/", "Event log"],
]);

export interface RoutingRowInsert {
  task: string;
  goTo: string;
  read: string;
  skills: string[];
}

interface AgentsMdRenderScope {
  agentsMdPath: string;
  rootLabel: string;
  workspaceObjectPaths: string[];
  contextByFolder: Map<string, string>;
  skills: SkillInfo[];
}

interface WorkspaceContextPath {
  slug: string;
  folder: string;
  contextPath: string;
  layout: "workspaces-parent";
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function workspacePrefix(tenantSlug: string, agentSlug: string): string {
  return `tenants/${tenantSlug}/agents/${agentSlug}/`;
}

function normalizeAgentsMdPath(path = "AGENTS.md"): string {
  const trimmed = path.trim();
  if (!trimmed || trimmed.startsWith("/") || trimmed.includes("\\")) {
    throw new Error(`Invalid AGENTS.md path: ${path}`);
  }
  const segments = trimmed.split("/");
  for (const segment of segments) {
    if (!segment || segment === "." || segment === "..") {
      throw new Error(`Invalid AGENTS.md path: ${path}`);
    }
  }
  if (segments[segments.length - 1] !== "AGENTS.md") {
    throw new Error(`Regenerate map path must end with AGENTS.md: ${path}`);
  }
  return segments.join("/");
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
    return await readS3TextIfExists(bucket, key);
  } catch {
    return null;
  }
}

async function readS3TextIfExists(
  bucket: string,
  key: string,
): Promise<string | null> {
  try {
    const resp = await s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    );
    return (await resp.Body?.transformToString("utf-8")) ?? null;
  } catch (err) {
    if (isS3NotFound(err)) return null;
    throw err;
  }
}

function isS3NotFound(err: unknown): boolean {
  const name = (err as { name?: string })?.name;
  const status = (err as { $metadata?: { httpStatusCode?: number } })?.$metadata
    ?.httpStatusCode;
  return (
    name === "NoSuchKey" ||
    name === "NotFound" ||
    name === "NoSuchBucket" ||
    status === 404
  );
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

function getWorkspaceContextPath(path: string): WorkspaceContextPath | null {
  const nested = path.match(/^workspaces\/([^/.][^/]*)\/CONTEXT\.md$/);
  if (nested?.[1]) {
    return {
      slug: nested[1],
      folder: `workspaces/${nested[1]}/`,
      contextPath: path,
      layout: "workspaces-parent",
    };
  }

  return null;
}

function collectWorkspaceContextPaths(paths: string[]): WorkspaceContextPath[] {
  const bySlug = new Map<string, WorkspaceContextPath>();
  for (const path of paths) {
    const parsed = getWorkspaceContextPath(path);
    if (!parsed) continue;
    const existing = bySlug.get(parsed.slug);
    if (!existing) {
      bySlug.set(parsed.slug, parsed);
    }
  }
  return Array.from(bySlug.values()).sort((a, b) =>
    a.slug.localeCompare(b.slug),
  );
}

function isHiddenPathSegment(segment: string): boolean {
  return segment.startsWith(".");
}

function visiblePathForTree(
  path: string,
): { segments: string[]; folderOnly: boolean } | null {
  const rawSegments = path.split("/").filter(Boolean);
  if (rawSegments.length === 0) return null;
  if (rawSegments.includes("skills")) return null;

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
  annotationOverrides: Map<string, string> = new Map(),
): string | null {
  const override = annotationOverrides.get(path);
  if (override) return override;
  const fixed = ROOT_ANNOTATIONS.get(path);
  if (fixed) return fixed;
  const context = contextByFolder.get(path);
  return context ? contextAnnotation(context) : null;
}

function renderTreeLabel(
  node: TreeNode,
  path: string,
  contextByFolder: Map<string, string>,
  annotationOverrides: Map<string, string>,
): string {
  const displayName = node.kind === "directory" ? `${node.name}/` : node.name;
  const annotation = annotationForTreePath(
    node.kind === "directory" ? `${path}/` : path,
    contextByFolder,
    annotationOverrides,
  );
  return annotation ? `${displayName} ← ${annotation}` : displayName;
}

function renderWorkspaceTree(
  rootLabel: string,
  objectPaths: string[],
  contextByFolder: Map<string, string>,
  annotationOverrides: Map<string, string> = new Map(),
): string {
  const root = createTreeNode(rootLabel, "directory");
  for (const path of objectPaths) {
    addTreePath(root, path);
  }

  const lines = [`${rootLabel}/`];
  function walk(node: TreeNode, prefix: string, pathPrefix: string): void {
    const children = sortedTreeChildren(node);
    children.forEach((child, index) => {
      const isLast = index === children.length - 1;
      const branch = isLast ? "└──" : "├──";
      const childPath = pathPrefix ? `${pathPrefix}/${child.name}` : child.name;
      lines.push(
        `${prefix}${branch} ${renderTreeLabel(
          child,
          childPath,
          contextByFolder,
          annotationOverrides,
        )}`,
      );
      if (child.kind === "directory") {
        walk(child, `${prefix}${isLast ? "    " : "│   "}`, childPath);
      }
    });
  }
  walk(root, "", "");
  return lines.join("\n");
}

function scopedAgentsMdRenderContext(
  context: WorkspaceMapRenderContext,
  agentsMdPathInput = "AGENTS.md",
): AgentsMdRenderScope {
  const agentsMdPath = normalizeAgentsMdPath(agentsMdPathInput);
  const folderPath =
    agentsMdPath === "AGENTS.md"
      ? ""
      : agentsMdPath.slice(0, -"/AGENTS.md".length);
  const folderPrefix = folderPath ? `${folderPath}/` : "";
  const rootLabel = folderPath
    ? (folderPath.split("/").filter(Boolean).at(-1) ?? context.agentSlug)
    : context.agentSlug;

  const workspaceObjectPaths = folderPrefix
    ? context.workspaceObjectPaths
        .filter((path) => path.startsWith(folderPrefix))
        .map((path) => path.slice(folderPrefix.length))
        .filter(Boolean)
    : context.workspaceObjectPaths;

  const contextByFolder = new Map<string, string>();
  for (const [folder, content] of context.contextByFolder.entries()) {
    if (!folderPrefix) {
      contextByFolder.set(folder, content);
      continue;
    }
    if (!folder.startsWith(folderPrefix)) continue;
    const scopedFolder = folder.slice(folderPrefix.length);
    if (scopedFolder) contextByFolder.set(scopedFolder, content);
  }

  const skills = folderPrefix
    ? context.skills
        .filter((skill) => skill.skillPath.startsWith(folderPrefix))
        .map((skill) => {
          const skillPath = skill.skillPath.slice(folderPrefix.length);
          const scopePath =
            skillPath.match(/^(?:(.+)\/)?skills\/[^/]+\/SKILL\.md$/)?.[1] ??
            null;
          return {
            ...skill,
            skillPath,
            scope: scopePath ? `${scopePath}/` : "baseline",
          };
        })
    : context.skills;

  return {
    agentsMdPath,
    rootLabel,
    workspaceObjectPaths,
    contextByFolder,
    skills,
  };
}

export function replaceDerivedAgentsMdSections(
  markdown: string,
  sections: Record<DerivedSectionName, string>,
): string {
  let rendered = markdown;
  for (const sectionName of ["Knowledge Bases", "Workflows"]) {
    rendered = removeMarkdownSection(rendered, sectionName);
  }

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
    rendered = `${rendered}${suffix}---\n\n## ${sectionName}\n${sections[sectionName]}`;
  }

  return rendered;
}

function removeMarkdownSection(markdown: string, sectionName: string): string {
  const sectionRange = findMarkdownSectionRange(markdown, sectionName);
  if (!sectionRange) return markdown;

  let start = sectionRange.headingStart;
  const before = markdown.slice(0, start);
  const leadingDivider = before.match(/(?:^|\n)---[ \t]*(?:\r?\n){1,2}$/);
  if (leadingDivider) {
    start =
      before.length -
      leadingDivider[0].length +
      (leadingDivider[0].startsWith("\n") ? 1 : 0);
  }

  return markdown.slice(0, start) + markdown.slice(sectionRange.end);
}

export function replaceMarkdownSection(
  markdown: string,
  sectionName: string,
  body: string,
): string {
  const sectionRange = findSectionBodyRange(markdown, sectionName);
  if (sectionRange) {
    return (
      markdown.slice(0, sectionRange.start) +
      body +
      markdown.slice(sectionRange.end)
    );
  }

  const suffix = markdown.endsWith("\n") ? "" : "\n";
  return `${markdown}${suffix}\n---\n\n## ${sectionName}${body}`;
}

function findSectionBodyRange(
  markdown: string,
  sectionName: string,
): { start: number; end: number } | null {
  const sectionRange = findMarkdownSectionRange(markdown, sectionName);
  if (!sectionRange) return null;
  return { start: sectionRange.bodyStart, end: sectionRange.end };
}

function findMarkdownSectionRange(
  markdown: string,
  sectionName: string,
): { headingStart: number; bodyStart: number; end: number } | null {
  const headingPattern = new RegExp(
    `(^|\\n)## ${sectionName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[ \\t]*(?:\\r?\\n|$)`,
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
      return { headingStart, bodyStart, end: lineStart };
    }
    if (linePattern.lastIndex >= markdown.length) break;
  }

  return { headingStart, bodyStart, end: markdown.length };
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

  const workspaceObjectPaths = await listWorkspaceObjectPaths(bucket, prefix);
  const workspaceContextPaths =
    collectWorkspaceContextPaths(workspaceObjectPaths);
  const contextByFolder = new Map<string, string>();
  const workspaces: WorkspaceSummary[] = [];

  for (const ws of workspaceContextPaths) {
    const contextContent = await readS3Text(
      bucket,
      `${prefix}${ws.contextPath}`,
    );
    if (contextContent) {
      contextByFolder.set(ws.folder, contextContent);
      workspaces.push(parseWorkspaceContext(contextContent, ws.slug));
    }
  }

  for (const rel of workspaceObjectPaths) {
    if (!rel.endsWith("/CONTEXT.md") || getWorkspaceContextPath(rel)) {
      continue;
    }
    const folder = rel.slice(0, -"CONTEXT.md".length);
    const contextContent = await readS3Text(bucket, `${prefix}${rel}`);
    if (contextContent) contextByFolder.set(folder, contextContent);
  }

  const skillInfos: SkillInfo[] = (
    await discoverWorkspaceSkillsFromPaths(workspaceObjectPaths, (path) =>
      readS3Text(bucket, `${prefix}${path}`),
    )
  )
    .filter((skill) => !isBuiltinToolSlug(skill.slug))
    .map((skill) => ({
      skillId: skill.slug,
      name: skill.name,
      description: skill.description,
      scope: skill.scopeLabel,
      skillPath: skill.skillPath,
    }));

  return {
    agentName: agent.name,
    agentSlug,
    tenantSlug,
    bucket,
    prefix,
    skills: skillInfos,
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
 *   - S3 workspace folders → workspace discovery, CONTEXT.md parsing,
 *     and SKILL.md tree-walk catalog
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
  const context = await loadWorkspaceMapRenderContext(agentId);
  if (!context) return;

  const agentsMap = renderAgentsMap(
    context.agentName,
    context.agentSlug,
    context.skills,
    context.workspaceObjectPaths,
    context.contextByFolder,
  );
  const contextRouter = renderContextRouter(
    context.agentName,
    context.workspaces,
  );

  // Idempotent write — skip the S3 PutObject when the rendered content
  //    matches what's already on S3. Saves writes on no-op toggles
  //    (re-clicking Connect on already-active row) and avoids manifest
  //    regen churn.
  const [existingAgentsMap, existingContextRouter] = await Promise.all([
    readS3Text(context.bucket, `${context.prefix}AGENTS.md`),
    readS3Text(context.bucket, `${context.prefix}CONTEXT.md`),
  ]);
  const agentsMapChanged = existingAgentsMap !== agentsMap;
  const contextRouterChanged = existingContextRouter !== contextRouter;

  if (agentsMapChanged) {
    await writeS3Text(context.bucket, `${context.prefix}AGENTS.md`, agentsMap);
  }
  if (contextRouterChanged) {
    await writeS3Text(
      context.bucket,
      `${context.prefix}CONTEXT.md`,
      contextRouter,
    );
  }

  if (!agentsMapChanged && !contextRouterChanged) {
    console.log(
      `[workspace-map] Skipped write for ${context.agentSlug}: content unchanged`,
    );
    return;
  }

  console.log(
    `[workspace-map] Regenerated for ${context.agentSlug}: ${context.workspaces.length} workspace(s), ${context.skills.length} skill(s)`,
  );

  // Regenerate manifest so runtime picks up changes on next sync
  try {
    const { regenerateManifest } = await import("./workspace-manifest.js");
    await regenerateManifest(
      context.bucket,
      context.tenantSlug,
      context.agentSlug,
    );
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
  agentsMdPathInput = "AGENTS.md",
): Promise<void> {
  const context = await loadWorkspaceMapRenderContext(agentId);
  if (!context) return;
  const scope = scopedAgentsMdRenderContext(context, agentsMdPathInput);
  const targetKey = `${context.prefix}${scope.agentsMdPath}`;

  const existingAgentsMd = await readS3Text(context.bucket, targetKey);
  const seedAgentsMd =
    existingAgentsMd && existingAgentsMd.trim() !== ""
      ? existingAgentsMd
      : `# ${scope.rootLabel} — Workspace Map\n`;
  const nextAgentsMd = replaceDerivedAgentsMdSections(
    seedAgentsMd,
    renderDerivedAgentsMdSections({
      agentSlug: scope.rootLabel,
      workspaceObjectPaths: scope.workspaceObjectPaths,
      contextByFolder: scope.contextByFolder,
      skills: scope.skills,
    }),
  );

  if (existingAgentsMd === nextAgentsMd) {
    console.log(
      `[workspace-map] Skipped ${scope.agentsMdPath} section refresh for ${context.agentSlug}: content unchanged`,
    );
    return;
  }

  await writeS3Text(context.bucket, targetKey, nextAgentsMd);
  console.log(
    `[workspace-map] Refreshed ${scope.agentsMdPath} derived sections for ${context.agentSlug}: ${scope.workspaceObjectPaths.length} object(s), ${scope.skills.length} skill(s)`,
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

/**
 * Repair AGENTS.md from the canonical workspace-defaults template, then render
 * the same derived sections into it. This is intentionally stronger than the
 * section refresh helper above: operator-triggered normalization replaces
 * malformed custom prose with a known-good map skeleton.
 */
export async function normalizeAgentsMd(agentId: string): Promise<void> {
  const context = await loadWorkspaceMapRenderContext(agentId);
  if (!context) return;

  const nextAgentsMd = replaceDerivedAgentsMdSections(
    loadFile("AGENTS.md"),
    renderDerivedAgentsMdSections({
      agentSlug: context.agentSlug,
      workspaceObjectPaths: context.workspaceObjectPaths,
      contextByFolder: context.contextByFolder,
      skills: context.skills,
    }),
  );
  const existingAgentsMd = await readS3Text(
    context.bucket,
    `${context.prefix}AGENTS.md`,
  );
  if (existingAgentsMd === nextAgentsMd) {
    console.log(
      `[workspace-map] Skipped AGENTS.md normalization for ${context.agentSlug}: content unchanged`,
    );
    return;
  }

  await writeS3Text(context.bucket, `${context.prefix}AGENTS.md`, nextAgentsMd);
  try {
    const { regenerateManifest } = await import("./workspace-manifest.js");
    await regenerateManifest(
      context.bucket,
      context.tenantSlug,
      context.agentSlug,
    );
  } catch {
    console.warn(
      `[workspace-map] Could not regenerate manifest after AGENTS.md normalization`,
    );
  }
  console.log(
    `[workspace-map] Normalized AGENTS.md for ${context.agentSlug}: ${context.workspaces.length} workspace(s), ${context.skills.length} skill(s)`,
  );
}

/**
 * Refresh only the `## Folder Structure` section of a selected CONTEXT.md,
 * scoped to the clicked file's containing folder.
 */
export async function generateContextFolderStructure(
  agentId: string,
  contextPath: string,
): Promise<void> {
  if (!isContextMdPath(contextPath)) {
    throw new Error("generate-folder-structure requires a CONTEXT.md path");
  }

  const context = await loadWorkspaceMapRenderContext(agentId);
  if (!context) return;

  const changed = await renderAndWriteContextFolderStructure({
    bucket: context.bucket,
    prefix: context.prefix,
    rootSlug: context.agentSlug,
    rootDisplayName: context.agentName,
    contextPath,
    workspaceObjectPaths: context.workspaceObjectPaths,
    contextByFolder: context.contextByFolder,
  });

  if (!changed) {
    console.log(
      `[workspace-map] Skipped CONTEXT.md folder structure refresh for ${contextPath}: content unchanged`,
    );
    return;
  }

  await regenerateAgentsMdDerivedSections(agentId);
  const { regenerateManifest } = await import("./workspace-manifest.js");
  await regenerateManifest(
    context.bucket,
    context.tenantSlug,
    context.agentSlug,
  );
  console.log(
    `[workspace-map] Refreshed CONTEXT.md folder structure for ${context.agentSlug}/${contextPath}`,
  );
}

/**
 * Refresh the `## Folder Structure` section of a Space's CONTEXT.md.
 *
 * Mirrors the agent-target generator but uses the Space's S3 prefix and skips
 * the AGENTS.md derived-section refresh (Spaces don't have AGENTS.md).
 */
export async function generateContextFolderStructureForSpace(
  spaceId: string,
  contextPath: string,
): Promise<void> {
  if (!isContextMdPath(contextPath)) {
    throw new Error("generate-folder-structure requires a CONTEXT.md path");
  }

  const context = await loadSpaceFolderStructureContext(spaceId);
  if (!context) return;

  const changed = await renderAndWriteContextFolderStructure({
    bucket: context.bucket,
    prefix: context.prefix,
    rootSlug: context.spaceSlug,
    rootDisplayName: context.spaceName,
    contextPath,
    workspaceObjectPaths: context.workspaceObjectPaths,
    contextByFolder: context.contextByFolder,
  });

  if (!changed) {
    console.log(
      `[workspace-map] Skipped Space CONTEXT.md folder structure refresh for ${contextPath}: content unchanged`,
    );
    return;
  }

  await regenerateManifestForPrefix(context.bucket, context.prefix);
  console.log(
    `[workspace-map] Refreshed CONTEXT.md folder structure for space ${context.spaceSlug}/${contextPath}`,
  );
}

interface FolderStructureRenderArgs {
  bucket: string;
  prefix: string;
  rootSlug: string;
  rootDisplayName: string;
  contextPath: string;
  workspaceObjectPaths: string[];
  contextByFolder: Map<string, string>;
}

/**
 * Read the target CONTEXT.md, replace its `## Folder Structure` body with the
 * scoped tree render, and write it back. Returns true when the file changed.
 */
async function renderAndWriteContextFolderStructure(
  args: FolderStructureRenderArgs,
): Promise<boolean> {
  const existingContextMd = await readS3TextIfExists(
    args.bucket,
    `${args.prefix}${args.contextPath}`,
  );
  const seedContextMd =
    existingContextMd && existingContextMd.trim()
      ? existingContextMd
      : seedContextMarkdown(args.rootDisplayName, args.contextPath);
  const nextContextMd = replaceMarkdownSection(
    seedContextMd,
    "Folder Structure",
    renderScopedContextFolderStructureBody({
      rootSlug: args.rootSlug,
      contextPath: args.contextPath,
      workspaceObjectPaths: args.workspaceObjectPaths,
      contextByFolder: args.contextByFolder,
    }),
  );

  if (existingContextMd === nextContextMd) return false;

  await writeS3Text(
    args.bucket,
    `${args.prefix}${args.contextPath}`,
    nextContextMd,
  );
  return true;
}

interface SpaceFolderStructureContext {
  bucket: string;
  prefix: string;
  tenantSlug: string;
  spaceSlug: string;
  spaceName: string;
  workspaceObjectPaths: string[];
  contextByFolder: Map<string, string>;
}

async function loadSpaceFolderStructureContext(
  spaceId: string,
): Promise<SpaceFolderStructureContext | null> {
  const db = getDb();
  const [space] = await db
    .select({
      name: spaces.name,
      slug: spaces.slug,
      tenant_id: spaces.tenant_id,
    })
    .from(spaces)
    .where(eq(spaces.id, spaceId));
  if (!space || !space.slug) {
    console.warn(`[workspace-map] Space not found or no slug: ${spaceId}`);
    return null;
  }

  const [tenant] = await db
    .select({ slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.id, space.tenant_id));
  const tenantSlug = tenant?.slug || "";
  const bucket = getBucket();
  if (!tenantSlug || !bucket) {
    console.warn(
      `[workspace-map] Missing tenant slug or bucket for space ${spaceId}`,
    );
    return null;
  }

  const prefix = spaceSourcePrefix(tenantSlug, space.slug);
  const workspaceObjectPaths = await listWorkspaceObjectPaths(bucket, prefix);
  const contextByFolder = new Map<string, string>();
  for (const rel of workspaceObjectPaths) {
    if (!rel.endsWith("/CONTEXT.md")) continue;
    const folder = rel.slice(0, -"CONTEXT.md".length);
    const contextContent = await readS3Text(bucket, `${prefix}${rel}`);
    if (contextContent) contextByFolder.set(folder, contextContent);
  }

  return {
    bucket,
    prefix,
    tenantSlug,
    spaceSlug: space.slug,
    spaceName: space.name,
    workspaceObjectPaths,
    contextByFolder,
  };
}

function isContextMdPath(path: string): boolean {
  return path.split("/").filter(Boolean).at(-1) === "CONTEXT.md";
}

function parentFolder(path: string): string {
  const parts = path.split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

function humanizeFolderName(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function seedContextMarkdown(rootName: string, contextPath: string): string {
  const folder = parentFolder(contextPath);
  const title = folder
    ? humanizeFolderName(folder.split("/").at(-1) ?? folder)
    : `${rootName} — Context`;
  return `# ${title}\n`;
}

function renderScopedContextFolderStructureBody(args: {
  rootSlug: string;
  contextPath: string;
  workspaceObjectPaths: string[];
  contextByFolder: Map<string, string>;
}): string {
  const folder = parentFolder(args.contextPath);
  const rootLabel = folder
    ? (folder.split("/").at(-1) ?? folder)
    : args.rootSlug;
  const scopedObjectPaths = scopeWorkspaceObjectPaths(
    args.workspaceObjectPaths,
    folder,
  );
  if (!scopedObjectPaths.includes("CONTEXT.md")) {
    scopedObjectPaths.push("CONTEXT.md");
  }
  const scopedContextByFolder = scopeContextAnnotations(
    args.contextByFolder,
    folder,
  );
  return renderFolderStructureBody(
    rootLabel,
    scopedObjectPaths,
    scopedContextByFolder,
    new Map([["CONTEXT.md", "You are here"]]),
  );
}

function scopeWorkspaceObjectPaths(paths: string[], folder: string): string[] {
  if (!folder) return paths;
  const prefix = `${folder}/`;
  return paths
    .filter((path) => path.startsWith(prefix))
    .map((path) => path.slice(prefix.length))
    .filter(Boolean);
}

function scopeContextAnnotations(
  contextByFolder: Map<string, string>,
  folder: string,
): Map<string, string> {
  if (!folder) return contextByFolder;
  const scoped = new Map<string, string>();
  const prefix = `${folder}/`;
  for (const [contextFolder, content] of contextByFolder) {
    if (!contextFolder.startsWith(prefix)) continue;
    const relative = contextFolder.slice(prefix.length);
    if (relative) scoped.set(relative, content);
  }
  return scoped;
}

// ---------------------------------------------------------------------------
// Renderers
// ---------------------------------------------------------------------------

function renderAgentsMap(
  agentName: string,
  agentSlug: string,
  skills: SkillInfo[],
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
  annotationOverrides: Map<string, string> = new Map(),
): string {
  return `\n\`\`\`\n${renderWorkspaceTree(
    agentSlug,
    workspaceObjectPaths,
    contextByFolder,
    annotationOverrides,
  )}\n\`\`\`\n`;
}

function renderSkillsSection(skills: SkillInfo[]): string {
  return `\n## Skills & Tools${renderSkillsBody(skills)}`;
}

function renderSkillsBody(skills: SkillInfo[]): string {
  const lines: string[] = [""];
  lines.push(
    "**IMPORTANT**: Tools like `create_sub_thread`, `search_users`, `schedule_followup`, `list_sub_threads` etc. are registered directly on you. Always call these tools directly — do NOT delegate to another agent when you already have the required tool.",
  );
  lines.push("");
  lines.push("### Tool selection");
  lines.push("");
  lines.push(
    "- **Information lookup** — Prefer `web_search` (Exa) for ordinary factual questions: locations, business hours, current events, prices, schedules, news, definitions. It's fast, cheap, and indexed.",
  );
  lines.push(
    "- **Browser automation** — Use `browser_automation` only when the task genuinely requires interacting with a page: filling forms, clicking through auth flows, scraping JS-rendered content that search engines don't index, or following a multi-step user journey. It is expensive and slow; do not reach for it as a default search tool.",
  );
  lines.push(
    "- **When both are available** — Start with `web_search`. Only escalate to `browser_automation` if the search results are insufficient and you can articulate why navigation is required.",
  );
  lines.push(
    "- **Code execution** — Use `execute_code` for Python execution, data analysis, calculations, and validation. Do not simulate code results in chat.",
  );
  lines.push(
    "- **Memory** — `recall()` first for prior conversations, preferences, and past decisions. Don't call `remember()` on every turn; post-turn retention is automatic.",
  );
  lines.push("");
  lines.push(
    "Use the `Skill` meta-tool with a skill name to invoke a skill; nested skills are supported up to the plan's depth budget.",
  );
  lines.push("");
  if (skills.length > 0) {
    lines.push("| Skill | Scope | Description |");
    lines.push("|-------|-------|-------------|");
    for (const skill of skills) {
      const desc = escTableCell(skill.description?.slice(0, 80) ?? null);
      lines.push(
        `| ${escTableCell(skill.name)} | ${escTableCell(skill.scope)} | ${desc} |`,
      );
    }
  } else {
    lines.push("No skills assigned.");
  }
  lines.push("");
  return lines.join("\n");
}

export function renderDerivedAgentsMdSections(args: {
  agentSlug: string;
  workspaceObjectPaths: string[];
  contextByFolder?: Map<string, string>;
  skills: SkillInfo[];
}): Record<DerivedSectionName, string> {
  const contextByFolder = args.contextByFolder ?? new Map<string, string>();
  return {
    "Folder Structure": renderFolderStructureBody(
      args.agentSlug,
      args.workspaceObjectPaths,
      contextByFolder,
    ),
    "Skills & Tools": renderSkillsBody(args.skills),
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

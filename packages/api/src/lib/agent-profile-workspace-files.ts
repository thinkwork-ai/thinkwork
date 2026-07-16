import { getConfig } from "@thinkwork/runtime-config";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { resolveTenantPlatformAgent } from "./agents/tenant-platform-agent.js";
import { db, eq, tenants } from "../graphql/utils.js";
import { normalizeExecutionControlsForStorage } from "./agent-profile-loop-policy.js";
import {
  agentFolderInstructionsPath,
  applyAgentFolderSidecar,
  parseAgentFolderInstructions,
  serializeAgentFolderInstructions,
  type AgentFolderConfig,
  type AgentFolderExecutionInput,
} from "./agent-folder-format.js";

const PROFILE_PATH_RE = /^agents\/([a-z0-9][a-z0-9-]*)\.md$/;
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

const s3 = new S3Client({
  region:
    process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1",
});

interface AgentProfileFileInput {
  slug: string;
  name: string;
  description?: string | null;
  routingGuidance?: string | null;
  instructions: string;
  modelId: string;
  enabled?: boolean | null;
  builtInKey?: string | null;
  toolPolicy?: unknown;
  skillPolicy?: unknown;
  executionControls?: unknown;
  spaceIds?: string[] | null;
}

interface ParsedAgentProfileFile {
  slug: string;
  name: string;
  description: string | null;
  routingGuidance: string | null;
  instructions: string;
  modelId: string;
  enabled: boolean;
  builtInKey: string | null;
  toolPolicy: Record<string, unknown>;
  skillPolicy: Record<string, unknown>;
  executionControls: Record<string, unknown>;
  spaceRefs: string[];
}

export function agentProfileWorkspacePath(slug: string): string {
  return `agents/${slug}.md`;
}

export function agentProfileSlugFromWorkspacePath(path: string): string | null {
  return path.replace(/^\/+/, "").match(PROFILE_PATH_RE)?.[1] ?? null;
}

export function isAgentProfileWorkspacePath(path: string): boolean {
  return agentProfileSlugFromWorkspacePath(path) !== null;
}

/**
 * Space-local profile files (plan 2026-06-12-002 U7) live under a Space
 * source's `agents/` folder. The workspace-files API addresses Space targets
 * with source-relative paths, so the on-the-wire shape is identical to the
 * central form (`agents/<slug>.md`) — the Space scope comes from the request
 * target, not the path. Separate helpers keep call sites explicit about which
 * origin they are projecting.
 */
export function spaceAgentProfileSlugFromWorkspacePath(
  path: string,
): string | null {
  return agentProfileSlugFromWorkspacePath(path);
}

export function isSpaceAgentProfileWorkspacePath(path: string): boolean {
  return spaceAgentProfileSlugFromWorkspacePath(path) !== null;
}

export function serializeAgentProfileFile(
  input: AgentProfileFileInput,
): string {
  const toolPolicy = asRecord(input.toolPolicy);
  const skillPolicy = asRecord(input.skillPolicy);
  const executionControls = normalizeExecutionControlsForStorage(
    input.executionControls,
  );
  const frontmatter: Record<string, unknown> = {
    name: input.name.trim(),
    model: input.modelId,
    enabled: input.enabled ?? true,
  };
  if (input.builtInKey) frontmatter.builtInKey = input.builtInKey;
  if (input.description?.trim()) {
    frontmatter.description = input.description.trim();
  }
  if (input.routingGuidance?.trim()) {
    frontmatter.routingGuidance = input.routingGuidance.trim();
  }
  if (input.spaceIds && input.spaceIds.length > 0) {
    frontmatter.spaces = input.spaceIds;
  }
  frontmatter.tools = {
    builtInTools: stringArray(toolPolicy.builtInTools),
    mcpServers: stringArray(toolPolicy.mcpServers),
  };
  frontmatter.skills = stringArray(skillPolicy.skillSlugs);
  frontmatter.execution = compactRecord({
    foreground: executionControls.foreground ?? true,
    clarify: executionControls.clarify ?? false,
    maxSubagentDepth: executionControls.maxSubagentDepth ?? 0,
    maxRuntimeMs: executionControls.maxRuntimeMs ?? null,
    maxTokens: executionControls.maxTokens ?? null,
    costBudgetUsd: executionControls.costBudgetUsd ?? null,
    thinking: executionControls.thinking ?? null,
    reviewGate: executionControls.reviewGate ?? null,
    maxReviewLoops: executionControls.maxReviewLoops ?? null,
    loopPolicy: executionControls.loopPolicy ?? null,
  });

  const yaml = stringifyYaml(frontmatter, { collectionStyle: "block" }).trim();
  const instructions = input.instructions.trim();
  return `---\n${yaml}\n---\n\n# Instructions\n\n${instructions}\n`;
}

export function parseAgentProfileFile(input: {
  path: string;
  content: string;
}): ParsedAgentProfileFile | null {
  const slug = agentProfileSlugFromWorkspacePath(input.path);
  if (!slug) return null;
  const match = input.content.match(FRONTMATTER_RE);
  if (!match) {
    throw new Error(`Agent Profile file ${input.path} requires frontmatter`);
  }
  const frontmatter = asRecord(parseYaml(match[1] ?? "") ?? {});
  const body = match[2] ?? "";
  const tools = asRecord(frontmatter.tools ?? frontmatter.toolPolicy);
  const skillPolicy = asRecord(frontmatter.skillPolicy);
  const execution = asRecord(
    frontmatter.execution ?? frontmatter.executionControls,
  );
  const modelId = stringValue(frontmatter.model ?? frontmatter.modelId);
  if (!modelId) throw new Error(`Agent Profile file ${input.path} needs model`);
  const name = stringValue(frontmatter.name) || titleize(slug);
  const skills = stringArray(
    frontmatter.skills ?? skillPolicy.skillSlugs ?? skillPolicy.skills,
  );
  const instructions =
    stringValue(frontmatter.instructions) || stripInstructionsHeading(body);

  return {
    slug,
    name,
    description: nullableString(frontmatter.description),
    routingGuidance: nullableString(
      frontmatter.routingGuidance ?? frontmatter.routing_guidance,
    ),
    instructions,
    modelId,
    enabled: frontmatter.enabled !== false,
    builtInKey: nullableString(frontmatter.builtInKey),
    toolPolicy: {
      builtInTools: stringArray(
        tools.builtInTools ?? tools.builtIn ?? frontmatter.builtInTools,
      ),
      mcpServers: stringArray(
        tools.mcpServers ?? tools.mcp ?? frontmatter.mcpServers,
      ),
    },
    skillPolicy: { skillSlugs: skills },
    executionControls: normalizeExecutionControlsForStorage(execution),
    spaceRefs: stringArray(frontmatter.spaces ?? frontmatter.spaceIds),
  };
}

export async function writeAgentProfileFileForTenant(input: {
  tenantId: string;
  slug: string;
  content: string;
}): Promise<boolean> {
  const workspaceBucket = getConfig("WORKSPACE_BUCKET");
  if (!workspaceBucket) return false;
  const target = await resolveAgentWorkspaceTarget(input.tenantId);
  if (!target) return false;
  await s3.send(
    new PutObjectCommand({
      Bucket: workspaceBucket,
      Key: `${target.prefix}${agentProfileWorkspacePath(input.slug)}`,
      Body: input.content,
      ContentType: "text/plain; charset=utf-8",
    }),
  );
  return true;
}

export async function deleteAgentProfileFileForTenant(input: {
  tenantId: string;
  slug: string;
}): Promise<boolean> {
  const workspaceBucket = getConfig("WORKSPACE_BUCKET");
  if (!workspaceBucket) return false;
  const target = await resolveAgentWorkspaceTarget(input.tenantId);
  if (!target) return false;
  await s3.send(
    new DeleteObjectCommand({
      Bucket: workspaceBucket,
      Key: `${target.prefix}${agentProfileWorkspacePath(input.slug)}`,
    }),
  );
  return true;
}

// ---------------------------------------------------------------------------
// Folder-form write/projection boundary (subagent-folders U12 — R22/R23).
// The legacy parser above stays FROZEN; these helpers are the only bridge
// between the two representations on the API side. During the migration
// window every profile write emits BOTH forms (legacy file + folder
// INSTRUCTIONS.md); the legacy file is deleted only by a later
// delete-on-write cleanup once all four path gates are deployed dual-read.
// ---------------------------------------------------------------------------

interface AgentProfileFolderSource {
  slug: string;
  name: string;
  description?: string | null;
  routingGuidance?: string | null;
  instructions: string;
  modelId: string;
  enabled?: boolean | null;
  toolPolicy?: unknown;
  executionControls?: unknown;
}

const FOLDER_EXECUTION_KEYS = [
  "clarify",
  "maxRuntimeMs",
  "maxTokens",
  "costBudgetUsd",
  "maxQueriesPerRun",
  "thinking",
  "reviewGate",
  "maxReviewLoops",
  "loopPolicy",
] as const;

/**
 * Serialize a profile row into the strict folder form. `description`
 * absorbs `routingGuidance` (the folder format has no routing field);
 * when both are absent the display name stands in — deterministic and
 * operator-visible, unlike the AE4 converter which flags instead (a
 * mutation caller is interactively creating the profile and sees the
 * result immediately).
 */
export function serializeAgentProfileFolderForm(
  source: AgentProfileFolderSource,
): string {
  const description =
    [source.description, source.routingGuidance]
      .map((value) => (typeof value === "string" ? value.trim() : ""))
      .filter(Boolean)
      .join(" ") || source.name.trim();
  const toolPolicy = asRecord(source.toolPolicy);
  const builtInTools = stringArray(toolPolicy.builtInTools);
  const storedExecution = asRecord(source.executionControls);
  const execution: Record<string, unknown> = {};
  for (const key of FOLDER_EXECUTION_KEYS) {
    if (storedExecution[key] !== undefined && storedExecution[key] !== null) {
      execution[key] = storedExecution[key];
    }
  }
  return serializeAgentFolderInstructions({
    slug: source.slug,
    description,
    model: source.modelId,
    enabled: source.enabled !== false,
    ...(builtInTools.length > 0 ? { builtInTools } : {}),
    ...(Object.keys(execution).length > 0
      ? { execution: execution as AgentFolderExecutionInput }
      : {}),
    instructions: source.instructions,
  });
}

export async function writeAgentProfileFolderForTenant(input: {
  tenantId: string;
  slug: string;
  source: AgentProfileFolderSource;
}): Promise<boolean> {
  const workspaceBucket = getConfig("WORKSPACE_BUCKET");
  if (!workspaceBucket) return false;
  const target = await resolveAgentWorkspaceTarget(input.tenantId);
  if (!target) return false;
  await s3.send(
    new PutObjectCommand({
      Bucket: workspaceBucket,
      Key: `${target.prefix}${agentFolderInstructionsPath(input.slug)}`,
      Body: serializeAgentProfileFolderForm(input.source),
      ContentType: "text/plain; charset=utf-8",
    }),
  );
  return true;
}

export async function deleteAgentProfileFolderInstructionsForTenant(input: {
  tenantId: string;
  slug: string;
}): Promise<boolean> {
  const workspaceBucket = getConfig("WORKSPACE_BUCKET");
  if (!workspaceBucket) return false;
  const target = await resolveAgentWorkspaceTarget(input.tenantId);
  if (!target) return false;
  await s3.send(
    new DeleteObjectCommand({
      Bucket: workspaceBucket,
      Key: `${target.prefix}${agentFolderInstructionsPath(input.slug)}`,
    }),
  );
  return true;
}

// ---------------------------------------------------------------------------
// Workspace agent-folder index (subagent-folders U11).
//
// With `agent_profiles` retired as a mirror store, profile readers resolve
// sub-agents from the workspace tree itself: presence = an
// `agents/<slug>/INSTRUCTIONS.md` folder file (strict U3 format), state =
// the optional `.assignment.json` sidecar. Mirrors the workspace skill
// index pattern (`lib/skills/workspace-skill-index.ts`): all reads fail
// soft — an unresolvable bucket/prefix returns null so callers pick their
// own degraded behavior.
// ---------------------------------------------------------------------------

export interface WorkspaceAgentFolderProfile {
  slug: string;
  config: AgentFolderConfig;
  /** S3 LastModified of INSTRUCTIONS.md; null when unknown. */
  updatedAt: Date | null;
}

const AGENT_FOLDER_INSTRUCTIONS_KEY_RE = /^agents\/([^/]+)\/INSTRUCTIONS\.md$/;

/**
 * List the tenant's central sub-agent folder profiles. Invalid folder
 * files (strict-parse failures) are skipped with a warning — the render
 * path reports them as withheld manifest entries; the listing surface
 * only shows admissible profiles.
 */
export async function listAgentFolderProfilesForTenant(
  tenantId: string,
): Promise<WorkspaceAgentFolderProfile[] | null> {
  const workspaceBucket = workspaceBucketOrNull();
  if (!workspaceBucket) return null;
  const target = await resolveAgentWorkspaceTarget(tenantId);
  if (!target) return null;

  const listing: Array<{ slug: string; lastModified: Date | null }> = [];
  let continuationToken: string | undefined;
  do {
    const resp = await s3.send(
      new ListObjectsV2Command({
        Bucket: workspaceBucket,
        Prefix: `${target.prefix}agents/`,
        ContinuationToken: continuationToken,
      }),
    );
    for (const obj of resp.Contents ?? []) {
      if (!obj.Key?.startsWith(target.prefix)) continue;
      const rel = obj.Key.slice(target.prefix.length);
      const slug = rel.match(AGENT_FOLDER_INSTRUCTIONS_KEY_RE)?.[1];
      if (slug) listing.push({ slug, lastModified: obj.LastModified ?? null });
    }
    continuationToken = resp.IsTruncated
      ? resp.NextContinuationToken
      : undefined;
  } while (continuationToken);

  const profiles: WorkspaceAgentFolderProfile[] = [];
  for (const entry of listing.sort((a, b) => a.slug.localeCompare(b.slug))) {
    const profile = await readAgentFolderProfile(
      workspaceBucket,
      target.prefix,
      entry.slug,
      entry.lastModified,
    );
    if (profile) profiles.push(profile);
  }
  return profiles;
}

/** Resolve one sub-agent folder profile; null = absent or invalid. */
export async function getAgentFolderProfileForTenant(
  tenantId: string,
  slug: string,
): Promise<WorkspaceAgentFolderProfile | null> {
  const workspaceBucket = workspaceBucketOrNull();
  if (!workspaceBucket) return null;
  const target = await resolveAgentWorkspaceTarget(tenantId);
  if (!target) return null;
  return readAgentFolderProfile(workspaceBucket, target.prefix, slug, null);
}

async function readAgentFolderProfile(
  bucket: string,
  prefix: string,
  slug: string,
  lastModified: Date | null,
): Promise<WorkspaceAgentFolderProfile | null> {
  const path = agentFolderInstructionsPath(slug);
  const content = await getObjectText(bucket, `${prefix}${path}`);
  if (content === null) return null;
  const parsed = parseAgentFolderInstructions(content, path);
  if (!parsed.valid) {
    console.warn(
      `[agent-folder-index] skipping invalid ${path}: ${parsed.errors[0]?.message}`,
    );
    return null;
  }
  let config = parsed.parsed;
  const sidecarRaw = await getObjectText(
    bucket,
    `${prefix}agents/${slug}/.assignment.json`,
  );
  if (sidecarRaw !== null) {
    let sidecar: { enabled?: boolean; policy?: Record<string, unknown> };
    try {
      sidecar = JSON.parse(sidecarRaw) as typeof sidecar;
    } catch {
      sidecar = {};
    }
    const overlaid = applyAgentFolderSidecar(config, sidecar, path);
    if (overlaid.valid) config = overlaid.parsed;
  }
  return { slug, config, updatedAt: lastModified };
}

async function getObjectText(
  bucket: string,
  key: string,
): Promise<string | null> {
  try {
    const resp = await s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    );
    return (await resp.Body?.transformToString()) ?? null;
  } catch (err) {
    const name = (err as { name?: string }).name;
    if (name === "NoSuchKey" || name === "NotFound") return null;
    throw err;
  }
}

function workspaceBucketOrNull(): string | null {
  try {
    return getConfig("WORKSPACE_BUCKET") || null;
  } catch {
    return null;
  }
}

async function resolveAgentWorkspaceTarget(
  tenantId: string,
): Promise<{ prefix: string } | null> {
  const agent = await resolveTenantPlatformAgent(tenantId, db);
  const [tenant] = await db
    .select({ slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.id, tenantId));
  if (!tenant?.slug || !agent.slug) return null;
  const agentSlug = agent.workspace_folder_name ?? agent.slug;
  return { prefix: `tenants/${tenant.slug}/agents/${agentSlug}/` };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function nullableString(value: unknown): string | null {
  const text = stringValue(value);
  return text ? text : null;
}

function compactRecord(
  value: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== null),
  );
}

function stripInstructionsHeading(value: string): string {
  return value.replace(/^\s*#\s+Instructions\s*/i, "").trim();
}

function titleize(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

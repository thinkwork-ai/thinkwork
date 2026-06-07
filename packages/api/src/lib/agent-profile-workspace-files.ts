import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { resolveTenantPlatformAgent } from "./agents/tenant-platform-agent.js";
import {
  agentProfileSpaceAssignments,
  agentProfiles,
  and,
  db,
  eq,
  modelCatalog,
  spaces,
  tenants,
} from "../graphql/utils.js";

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

export function serializeAgentProfileFile(
  input: AgentProfileFileInput,
): string {
  const toolPolicy = asRecord(input.toolPolicy);
  const skillPolicy = asRecord(input.skillPolicy);
  const executionControls = asRecord(input.executionControls);
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
    thinking: executionControls.thinking ?? null,
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
    executionControls: compactRecord({
      foreground: execution.foreground ?? true,
      clarify: execution.clarify ?? false,
      maxSubagentDepth: execution.maxSubagentDepth ?? 0,
      maxRuntimeMs: execution.maxRuntimeMs ?? execution.maxRunTimeMs ?? null,
      maxTokens: execution.maxTokens ?? null,
      thinking: execution.thinking ?? null,
    }),
    spaceRefs: stringArray(frontmatter.spaces ?? frontmatter.spaceIds),
  };
}

export async function upsertAgentProfileProjectionFromFile(input: {
  tenantId: string;
  path: string;
  content: string;
}) {
  const parsed = parseAgentProfileFile(input);
  if (!parsed) return null;
  await assertProfileModelAvailable(parsed.modelId);
  const spaceIds = await resolveProfileSpaceIds(
    input.tenantId,
    parsed.spaceRefs,
  );
  const [existing] = await db
    .select()
    .from(agentProfiles)
    .where(
      and(
        eq(agentProfiles.tenant_id, input.tenantId),
        eq(agentProfiles.slug, parsed.slug),
      ),
    );

  const values = {
    tenant_id: input.tenantId,
    slug: parsed.slug,
    name: parsed.name,
    description: parsed.description,
    routing_guidance: parsed.routingGuidance,
    instructions: parsed.instructions,
    model_id: parsed.modelId,
    enabled: parsed.enabled,
    built_in_key: existing?.built_in_key ?? parsed.builtInKey,
    tool_policy: parsed.toolPolicy,
    skill_policy: parsed.skillPolicy,
    execution_controls: parsed.executionControls,
    updated_at: new Date(),
  };

  const [row] = existing
    ? await db
        .update(agentProfiles)
        .set(values)
        .where(eq(agentProfiles.id, existing.id))
        .returning()
    : await db.insert(agentProfiles).values(values).returning();

  await replaceProjectionSpaceAssignments({
    tenantId: input.tenantId,
    profileId: row.id,
    spaceIds,
  });

  return row;
}

export async function deleteAgentProfileProjectionForFile(input: {
  tenantId: string;
  path: string;
}) {
  const slug = agentProfileSlugFromWorkspacePath(input.path);
  if (!slug) return false;
  await db
    .delete(agentProfiles)
    .where(
      and(
        eq(agentProfiles.tenant_id, input.tenantId),
        eq(agentProfiles.slug, slug),
      ),
    );
  return true;
}

export async function writeAgentProfileFileForTenant(input: {
  tenantId: string;
  slug: string;
  content: string;
}): Promise<boolean> {
  const workspaceBucket = process.env.WORKSPACE_BUCKET;
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
  const workspaceBucket = process.env.WORKSPACE_BUCKET;
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

async function assertProfileModelAvailable(modelId: string): Promise<void> {
  const [row] = await db
    .select({ modelId: modelCatalog.model_id })
    .from(modelCatalog)
    .where(
      and(
        eq(modelCatalog.model_id, modelId),
        eq(modelCatalog.is_available, true),
      ),
    );
  if (!row) throw new Error(`Model is not available: ${modelId}`);
}

async function resolveProfileSpaceIds(
  tenantId: string,
  refs: readonly string[],
): Promise<string[]> {
  if (refs.length === 0) return [];
  const rows = await db
    .select({ id: spaces.id, slug: spaces.slug, name: spaces.name })
    .from(spaces)
    .where(eq(spaces.tenant_id, tenantId));
  const byRef = new Map<string, string>();
  for (const row of rows) {
    byRef.set(row.id, row.id);
    if (row.slug) byRef.set(row.slug, row.id);
    if (row.name) byRef.set(row.name, row.id);
  }
  const ids = refs.map((ref) => byRef.get(ref) ?? ref);
  const valid = new Set(rows.map((row) => row.id));
  const missing = ids.filter((id) => !valid.has(id));
  if (missing.length > 0) {
    throw new Error("One or more Spaces do not belong to this tenant");
  }
  return Array.from(new Set(ids));
}

async function replaceProjectionSpaceAssignments(input: {
  tenantId: string;
  profileId: string;
  spaceIds: readonly string[];
}) {
  await db
    .delete(agentProfileSpaceAssignments)
    .where(eq(agentProfileSpaceAssignments.profile_id, input.profileId));
  if (input.spaceIds.length === 0) return;
  await db.insert(agentProfileSpaceAssignments).values(
    input.spaceIds.map((spaceId) => ({
      tenant_id: input.tenantId,
      profile_id: input.profileId,
      space_id: spaceId,
    })),
  );
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

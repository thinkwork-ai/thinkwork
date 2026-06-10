import { GraphQLError } from "graphql";
import {
  agentProfiles,
  agentProfileSpaceAssignments,
  agents,
  and,
  asc,
  db,
  eq,
  inArray,
  spaces,
  snakeToCamel,
} from "../../utils.js";
import {
  getTenantModelCatalogEntry,
  listTenantModelCatalog,
} from "../../../lib/model-catalog/tenant-catalog.js";
import {
  BUILT_IN_AGENT_PROFILE_KEYS,
  BUILT_IN_PROFILE_SEEDS,
  DEFAULT_PROFILE_MODEL_ID,
} from "./built-in-agent-profiles.js";

export function badInput(message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code: "BAD_USER_INPUT" } });
}

export function notFound(message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code: "NOT_FOUND" } });
}

export function parseJsonInput(value: unknown): unknown {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") return value;
  return JSON.parse(value);
}

export function normalizeProfileSlug(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) throw badInput("Agent Profile slug is required");
  return slug;
}

export function toAgentProfileGraphql(row: Record<string, unknown>) {
  return snakeToCamel(row);
}

export function toProfileAssignmentGraphql(row: Record<string, unknown>) {
  return snakeToCamel(row);
}

export async function ensureBuiltInAgentProfiles(tenantId: string) {
  const rows = await db
    .select({
      id: agentProfiles.id,
      builtInKey: agentProfiles.built_in_key,
      toolPolicy: agentProfiles.tool_policy,
    })
    .from(agentProfiles)
    .where(eq(agentProfiles.tenant_id, tenantId));
  const existingRows = rows.filter((row) => typeof row.builtInKey === "string");
  const existing = new Map(
    existingRows.map((row) => [row.builtInKey, row] as const),
  );
  const missing = BUILT_IN_PROFILE_SEEDS.filter(
    (seed) => !existing.has(seed.built_in_key),
  );
  const now = new Date();

  if (missing.length > 0) {
    const modelId = await resolveDefaultProfileModelId(tenantId);
    await db.insert(agentProfiles).values(
      missing.map((seed) => ({
        tenant_id: tenantId,
        slug: seed.slug,
        name: seed.name,
        description: seed.description,
        routing_guidance: seed.routing_guidance,
        instructions: seed.instructions,
        model_id: modelId,
        enabled: true,
        built_in_key: seed.built_in_key,
        tool_policy: seed.tool_policy,
        skill_policy: seed.skill_policy,
        execution_controls: seed.execution_controls,
        updated_at: now,
      })),
    );
  }

  await syncBuiltInAgentProfileTools({
    tenantId,
    rows: existingRows,
    now,
  });
}

async function syncBuiltInAgentProfileTools(input: {
  tenantId: string;
  rows: Array<{
    id: string;
    builtInKey: string | null;
    toolPolicy: Record<string, unknown>;
  }>;
  now: Date;
}) {
  const seedByKey = new Map(
    BUILT_IN_PROFILE_SEEDS.map((seed) => [seed.built_in_key, seed] as const),
  );

  for (const row of input.rows) {
    if (typeof row.id !== "string") continue;
    if (typeof row.builtInKey !== "string") continue;
    const seed = seedByKey.get(row.builtInKey as BuiltInProfileSeedKey);
    if (!seed) continue;
    const nextPolicy = mergeBuiltInToolPolicy(row.toolPolicy, seed.tool_policy);
    if (nextPolicy === row.toolPolicy) continue;

    await db
      .update(agentProfiles)
      .set({ tool_policy: nextPolicy, updated_at: input.now })
      .where(
        and(
          eq(agentProfiles.tenant_id, input.tenantId),
          eq(agentProfiles.id, row.id),
        ),
      );
  }
}

type BuiltInProfileSeedKey =
  (typeof BUILT_IN_PROFILE_SEEDS)[number]["built_in_key"];

function mergeBuiltInToolPolicy(
  currentValue: unknown,
  seedValue: Record<string, unknown>,
): Record<string, unknown> {
  const current =
    currentValue &&
    typeof currentValue === "object" &&
    !Array.isArray(currentValue)
      ? (currentValue as Record<string, unknown>)
      : {};
  const seedTools = stringArray(
    (seedValue as { builtInTools?: unknown }).builtInTools,
  );
  if (seedTools.length === 0) return current;

  const currentTools = stringArray(current.builtInTools);
  const mergedTools = [...new Set([...currentTools, ...seedTools])];
  if (mergedTools.length === currentTools.length) return current;
  return { ...current, builtInTools: mergedTools };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((item) =>
        typeof item === "string" && item.trim() ? [item.trim()] : [],
      )
    : [];
}

async function resolveDefaultProfileModelId(tenantId: string): Promise<string> {
  const [agent] = await db
    .select({ model: agents.model })
    .from(agents)
    .where(
      and(eq(agents.tenant_id, tenantId), eq(agents.is_platform_default, true)),
    );
  if (agent?.model) {
    const row = await getTenantModelCatalogEntry({
      tenantId,
      modelId: agent.model,
    });
    if (row) return agent.model;
  }

  const [catalogRow] = await listTenantModelCatalog({ tenantId });
  return catalogRow?.modelId ?? DEFAULT_PROFILE_MODEL_ID;
}

export async function assertAvailableModel(
  tenantId: string,
  modelId: string,
): Promise<void> {
  const row = await getTenantModelCatalogEntry({ tenantId, modelId });
  if (!row) {
    throw badInput("Model is not enabled in the tenant model catalog");
  }
}

export async function assertSpacesBelongToTenant(
  tenantId: string,
  spaceIds: readonly string[] | undefined | null,
): Promise<string[]> {
  if (!spaceIds) return [];
  const uniqueSpaceIds = Array.from(new Set(spaceIds));
  if (uniqueSpaceIds.length === 0) return [];
  const rows = await db
    .select({ id: spaces.id })
    .from(spaces)
    .where(
      and(eq(spaces.tenant_id, tenantId), inArray(spaces.id, uniqueSpaceIds)),
    );
  const found = new Set(rows.map((row) => row.id));
  const missing = uniqueSpaceIds.filter((id) => !found.has(id));
  if (missing.length > 0) {
    throw badInput("One or more Spaces do not belong to this tenant");
  }
  return uniqueSpaceIds;
}

export async function loadAgentProfileRow(tenantId: string, id: string) {
  const [row] = await db
    .select()
    .from(agentProfiles)
    .where(
      and(eq(agentProfiles.tenant_id, tenantId), eq(agentProfiles.id, id)),
    );
  if (!row) throw notFound("Agent Profile not found");
  return row;
}

export async function replaceAgentProfileSpaceAssignments(input: {
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

export function assertCustomProfileSlugAvailable(slug: string): void {
  if ((BUILT_IN_AGENT_PROFILE_KEYS as readonly string[]).includes(slug)) {
    throw badInput("Agent Profile slug is reserved for a built-in profile");
  }
}

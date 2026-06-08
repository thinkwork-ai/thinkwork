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
  modelCatalog,
  spaces,
  snakeToCamel,
} from "../../utils.js";
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
    .select({ builtInKey: agentProfiles.built_in_key })
    .from(agentProfiles)
    .where(eq(agentProfiles.tenant_id, tenantId));
  const existing = new Set(
    rows
      .map((row) => row.builtInKey)
      .filter((key): key is string => typeof key === "string"),
  );
  const missing = BUILT_IN_PROFILE_SEEDS.filter(
    (seed) => !existing.has(seed.built_in_key),
  );
  if (missing.length === 0) return;

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
      updated_at: new Date(),
    })),
  );
}

async function resolveDefaultProfileModelId(tenantId: string): Promise<string> {
  const [agent] = await db
    .select({ model: agents.model })
    .from(agents)
    .where(
      and(eq(agents.tenant_id, tenantId), eq(agents.is_platform_default, true)),
    );
  if (agent?.model) return agent.model;

  const [catalogRow] = await db
    .select({ modelId: modelCatalog.model_id })
    .from(modelCatalog)
    .where(eq(modelCatalog.is_available, true))
    .orderBy(asc(modelCatalog.display_name));
  return catalogRow?.modelId ?? DEFAULT_PROFILE_MODEL_ID;
}

export async function assertAvailableModel(modelId: string): Promise<void> {
  const [row] = await db
    .select({ modelId: modelCatalog.model_id })
    .from(modelCatalog)
    .where(
      and(
        eq(modelCatalog.model_id, modelId),
        eq(modelCatalog.is_available, true),
      ),
    );
  if (!row) throw badInput("Model is not available in the model catalog");
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

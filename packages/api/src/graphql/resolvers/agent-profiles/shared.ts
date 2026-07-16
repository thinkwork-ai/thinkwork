/**
 * Shared helpers for the Agent Profile resolvers (subagent-folders U11).
 *
 * The `agent_profiles` table is retired as a read/write store: sub-agent
 * profiles are workspace `agents/<slug>/INSTRUCTIONS.md` folders (strict
 * U3 format) compiled into the capabilities manifest. These resolvers
 * read the folder index and write folder files — no DB rows. The GraphQL
 * `AgentProfile.id` is the folder slug (the folder IS the identity).
 */

import { GraphQLError } from "graphql";
import { snakeToCamel } from "../../utils.js";
import { getTenantModelCatalogEntry } from "../../../lib/model-catalog/tenant-catalog.js";
import type { WorkspaceAgentFolderProfile } from "../../../lib/agent-profile-workspace-files.js";
import {
  BUILT_IN_AGENT_PROFILE_KEYS,
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

export function titleizeProfileSlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

/**
 * Map a workspace agent-folder profile onto the GraphQL `AgentProfile`
 * shape. `id` is the slug; space assignment fields are always empty
 * (space-scoped sub-agents are a future folder-based arc); a model-less
 * folder (inherit-parent) reports the platform default so the non-null
 * `modelId` contract holds.
 */
export function folderProfileToGraphql(
  tenantId: string,
  profile: WorkspaceAgentFolderProfile,
) {
  const { slug, config, updatedAt } = profile;
  const timestamp = (updatedAt ?? new Date(0)).toISOString();
  return {
    id: slug,
    tenantId,
    slug,
    name: titleizeProfileSlug(slug),
    description: config.description,
    routingGuidance: null,
    instructions: config.instructions,
    modelId: config.model ?? DEFAULT_PROFILE_MODEL_ID,
    enabled: config.enabled,
    builtInKey: (BUILT_IN_AGENT_PROFILE_KEYS as readonly string[]).includes(
      slug,
    )
      ? slug
      : null,
    toolPolicy: { builtInTools: config.builtInTools ?? [] },
    skillPolicy: { skillSlugs: [] },
    executionControls: config.execution,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
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

export function assertCustomProfileSlugAvailable(slug: string): void {
  if ((BUILT_IN_AGENT_PROFILE_KEYS as readonly string[]).includes(slug)) {
    throw badInput("Agent Profile slug is reserved for a built-in profile");
  }
}

/**
 * Resolve a slug that is free within the tenant's agent-folder index,
 * deriving from `seed` and appending `-2`, `-3`, … on collision so a
 * generic default name ("New Agent Profile") can be created repeatedly.
 * Built-in slugs are rejected up front.
 */
export function resolveAvailableCustomSlug(
  existingSlugs: readonly string[],
  seed: string,
): string {
  const base = normalizeProfileSlug(seed);
  assertCustomProfileSlugAvailable(base);
  const taken = new Set(existingSlugs);
  if (!taken.has(base)) return base;
  for (let suffix = 2; ; suffix++) {
    const candidate = `${base}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

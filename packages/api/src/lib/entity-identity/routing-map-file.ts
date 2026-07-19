/**
 * Routing-map workspace projection (THINK-321 U4, KTD-4 — R5/R6/AE6).
 *
 * Materializes ONE server-managed `ROUTING_MAP.md` at the ROOT of every
 * tenant agent workspace (`tenants/<tenant-slug>/agents/<folder>/`),
 * mirroring the `analyst/connection-folder.ts` materialization pattern:
 * resolve each non-archived agent's workspace prefix and PutObject the
 * rendered markdown, skipping the write when the content is unchanged
 * (byte-compare against the existing object, the
 * `workspace-map-generator.ts` idempotent-write convention).
 *
 * Placement choice (documented per plan U4): the file lands at the
 * workspace ROOT beside the other server-managed governance/context files
 * (INSTRUCTIONS.md, CONTEXT.md, GUARDRAILS.md, TOOLS.md, USER.md) — NOT
 * under `connectors/<slug>/`, because the map spans every connector and
 * declares type-level routing, so no single capability folder owns it.
 * What we mirror from connection-folder.ts is the write MECHANICS
 * (per-agent prefix resolution + S3 put + best-effort posture), not its
 * per-slug folder location.
 *
 * Content (KTD-4): per entity type with a non-empty `system_map`, a
 * facet → source system → connector table (connector slug joined from
 * `identity.source_system_connectors`; an absent link renders
 * "(no connector registered)" — fail-closed, KTD-5), plus the standing
 * instruction prose: instance keys come ONLY from `resolve_entities`
 * (never guess keys), and facets with no declared system must be refused
 * plainly (AE6's context source). Output is deterministic — entity types
 * sort by slug, entries by (facet, source system) — so unchanged ontology
 * state always renders identical bytes and skips the write.
 *
 * Regeneration triggers:
 *   (a) `identity_map` change-set apply — `reprocess.ts` post-apply hook
 *       (best-effort, never fails the reprocess job);
 *   (b) identity-source/connector registration — U7's registration path
 *       calls the exported `refreshRoutingMapFile` directly;
 *   (c) connector grant/deregistration — the capability grant/detach
 *       mutation spine (`capabilityAssignment.mutations.ts`) and the
 *       connector-folder reconcile choke points
 *       (`reconcile-connection-folders.ts`) refresh best-effort.
 *   Connector slug RENAME has no mutation path today
 *   (`mcp-server-update.ts` cannot change `slug`); the DB link follows
 *   automatically via the `source_system_connectors` FK `ON UPDATE
 *   CASCADE`. TODO(THINK-321-U7): if a slug-rename path lands with the
 *   registration flow, attach `refreshRoutingMapFile` there too.
 *
 * Noise guard: when a tenant has NO system-map entries, NO connector
 * links, and NO existing ROUTING_MAP.md anywhere, the refresh is a no-op
 * ("nothing_declared") — identity routing isn't in use, so the empty
 * shell is not sprayed into every workspace by unrelated connector
 * provisioning. Once any declaration (or a previously written file)
 * exists, an emptied map DOES rewrite the explicit "No systems declared"
 * shell so stale routing prose never lingers.
 */

import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getConfig } from "@thinkwork/runtime-config";
import { and, eq, sql } from "drizzle-orm";
import {
  agents,
  ontologyEntityTypes,
  sourceSystemConnectors,
} from "@thinkwork/database-pg/schema";
import type { IdentityDbClient } from "./matcher.js";
import { resolveAgentWorkspacePrefix } from "../skills/assignment-state.js";
import { regenerateManifestForPrefix } from "../workspace-manifest.js";

const LOG_PREFIX = "[routing-map-file]";

export const ROUTING_MAP_FILE = "ROUTING_MAP.md";

/** Rendered when a source system has no source_system_connectors link. */
export const NO_CONNECTOR_LINE = "(no connector registered)";

/** Rendered when no entity type declares any system (the AE6 shell). */
export const NO_SYSTEMS_DECLARED_LINE =
  "No systems declared. No entity type has an approved system map yet — " +
  "treat every externally-held facet as having no declared system and " +
  "refuse plainly rather than guessing a connector.";

/** The standing instruction prose (KTD-4 — AE6's context source). */
export const ROUTING_MAP_STANDING_INSTRUCTION = `## How to use this map

- This map declares, per entity type, which attached SYSTEM holds which
  FACET. It is type-level knowledge only — it never contains instance keys.
- Instance keys (external ids, natural keys) come ONLY from the
  \`resolve_entities\` tool. Never guess, construct, or recall keys from
  memory or prior conversations.
- If the facet you need is NOT declared for the entity type below, there
  is no declared system for it: say so plainly — "the routing map declares
  no system for <facet> on <entity type>" — and stop. Do not guess a
  connector or query one on a hunch.
- "${NO_CONNECTOR_LINE}" means the declared system currently has no
  connector link: report the mapping as unroutable instead of inventing a
  connector.`;

export interface RoutingMapSystemEntry {
  facet: string;
  sourceSystem: string;
  note?: string;
}

export interface RoutingMapEntityType {
  slug: string;
  name: string;
  entries: RoutingMapSystemEntry[];
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

function coerceSystemMapEntries(raw: unknown): RoutingMapSystemEntry[] {
  if (!Array.isArray(raw)) return [];
  const entries: RoutingMapSystemEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const facet = typeof record.facet === "string" ? record.facet.trim() : "";
    const sourceSystem =
      typeof record.sourceSystem === "string" ? record.sourceSystem.trim() : "";
    if (!facet || !sourceSystem) continue;
    const note = typeof record.note === "string" ? record.note.trim() : "";
    entries.push({ facet, sourceSystem, ...(note ? { note } : {}) });
  }
  return entries;
}

/**
 * Render the routing-map markdown. Pure and deterministic: entity types
 * sort by slug, entries by (facet, source system), so identical inputs
 * always produce identical bytes (the skip-when-unchanged contract).
 */
export function renderRoutingMapMarkdown(input: {
  entityTypes: RoutingMapEntityType[];
  /** source_system → connector slug (from identity.source_system_connectors). */
  connectorBySourceSystem: ReadonlyMap<string, string>;
}): string {
  const lines: string[] = [
    "# Entity Routing Map",
    "",
    "Server-managed projection of the ontology's type-level system map",
    "(which attached systems hold which facets of each entity type). Do not",
    "edit — it is regenerated when identity-map change sets apply and when",
    "connector registrations change.",
    "",
    ROUTING_MAP_STANDING_INSTRUCTION,
    "",
    "## Declared systems",
    "",
  ];

  const declared = input.entityTypes
    .filter((entityType) => entityType.entries.length > 0)
    .sort((a, b) => a.slug.localeCompare(b.slug));

  if (declared.length === 0) {
    lines.push(NO_SYSTEMS_DECLARED_LINE, "");
    return lines.join("\n");
  }

  for (const entityType of declared) {
    const sortedEntries = [...entityType.entries].sort(
      (a, b) =>
        a.facet.localeCompare(b.facet) ||
        a.sourceSystem.localeCompare(b.sourceSystem),
    );
    lines.push(
      `### ${escapeCell(entityType.name)} (\`${entityType.slug}\`)`,
      "",
      "| Facet | Source system | Connector | Note |",
      "| ----- | ------------- | --------- | ---- |",
    );
    for (const entry of sortedEntries) {
      const connectorSlug = input.connectorBySourceSystem.get(
        entry.sourceSystem,
      );
      const connectorCell = connectorSlug
        ? `\`${connectorSlug}\``
        : NO_CONNECTOR_LINE;
      lines.push(
        `| ${escapeCell(entry.facet)} | ${escapeCell(entry.sourceSystem)} | ${connectorCell} | ${escapeCell(entry.note ?? "")} |`,
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Refresh (the exported trigger — U7's registration path calls this)
// ---------------------------------------------------------------------------

let sharedClient: S3Client | null = null;
function s3Client(): Pick<S3Client, "send"> {
  sharedClient ??= new S3Client({
    region:
      process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1",
  });
  return sharedClient;
}

function workspaceBucket(): string | null {
  try {
    return getConfig("WORKSPACE_BUCKET") || null;
  } catch {
    return null;
  }
}

export interface RoutingMapRefreshDeps {
  s3?: Pick<S3Client, "send">;
  bucket?: string;
  /** Test seam — defaults to the shared workspace-prefix resolver. */
  resolvePrefix?: (agentId: string) => Promise<string | null>;
  /** Test seam — defaults to the shared manifest regenerator. */
  regenerateManifest?: (bucket: string, prefix: string) => Promise<void>;
}

export interface RoutingMapRefreshResult {
  /** The rendered markdown (empty string when the refresh was a no-op). */
  content: string;
  agents: number;
  written: number;
  skipped: Array<{ agentId: string; reason: string }>;
}

async function readS3Text(
  s3: Pick<S3Client, "send">,
  bucket: string,
  key: string,
): Promise<string | null> {
  try {
    const resp = await s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    );
    return (
      (await (
        resp as { Body?: { transformToString: () => Promise<string> } }
      ).Body?.transformToString()) ?? null
    );
  } catch {
    return null;
  }
}

/**
 * Re-project the tenant's routing map into every non-archived agent
 * workspace. Best-effort per agent (a failed put logs and moves on) and
 * idempotent: unchanged content skips the S3 write and the manifest regen.
 */
export async function refreshRoutingMapFile(
  db: IdentityDbClient,
  tenantId: string,
  deps: RoutingMapRefreshDeps = {},
): Promise<RoutingMapRefreshResult> {
  const bucket = deps.bucket ?? workspaceBucket();
  if (!bucket) {
    return {
      content: "",
      agents: 0,
      written: 0,
      skipped: [{ agentId: "*", reason: "no_workspace_bucket" }],
    };
  }
  const s3 = deps.s3 ?? s3Client();
  const resolvePrefix = deps.resolvePrefix ?? resolveAgentWorkspacePrefix;
  const regenerateManifest =
    deps.regenerateManifest ?? regenerateManifestForPrefix;

  const typeRows = await db
    .select({
      slug: ontologyEntityTypes.slug,
      name: ontologyEntityTypes.name,
      system_map: ontologyEntityTypes.system_map,
    })
    .from(ontologyEntityTypes)
    .where(
      and(
        eq(ontologyEntityTypes.tenant_id, tenantId),
        eq(ontologyEntityTypes.lifecycle_status, "approved"),
      ),
    );

  const linkRows = await db
    .select({
      source_system: sourceSystemConnectors.source_system,
      connector_slug: sourceSystemConnectors.connector_slug,
    })
    .from(sourceSystemConnectors)
    .where(eq(sourceSystemConnectors.tenant_id, tenantId));

  const entityTypes: RoutingMapEntityType[] = typeRows.map((row) => ({
    slug: row.slug,
    name: row.name,
    entries: coerceSystemMapEntries(row.system_map),
  }));
  const connectorBySourceSystem = new Map<string, string>();
  for (const link of linkRows) {
    if (link.source_system && link.connector_slug) {
      connectorBySourceSystem.set(link.source_system, link.connector_slug);
    }
  }

  const content = renderRoutingMapMarkdown({
    entityTypes,
    connectorBySourceSystem,
  });
  const hasDeclarations =
    entityTypes.some((entityType) => entityType.entries.length > 0) ||
    connectorBySourceSystem.size > 0;

  const agentRows = await db
    .select({ id: agents.id })
    .from(agents)
    .where(
      and(eq(agents.tenant_id, tenantId), sql`${agents.status} <> 'archived'`),
    );

  const skipped: RoutingMapRefreshResult["skipped"] = [];
  let written = 0;
  for (const agent of agentRows) {
    try {
      const targetPrefix = await resolvePrefix(agent.id);
      if (!targetPrefix) {
        skipped.push({ agentId: agent.id, reason: "no_workspace_prefix" });
        continue;
      }
      const key = `${targetPrefix}${ROUTING_MAP_FILE}`;
      const existing = await readS3Text(s3, bucket, key);
      if (existing === content) {
        skipped.push({ agentId: agent.id, reason: "unchanged" });
        continue;
      }
      // Noise guard: never CREATE the empty shell in a workspace that has
      // no file yet while the tenant has zero declarations — identity
      // routing isn't in use there. An existing file always converges.
      if (!hasDeclarations && existing === null) {
        skipped.push({ agentId: agent.id, reason: "nothing_declared" });
        continue;
      }
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: content,
          ContentType: "text/markdown; charset=utf-8",
        }),
      );
      written += 1;
      try {
        await regenerateManifest(bucket, targetPrefix);
      } catch (err) {
        console.warn(
          `${LOG_PREFIX} manifest regen failed for ${targetPrefix}:`,
          err instanceof Error ? err.message : err,
        );
      }
    } catch (err) {
      skipped.push({ agentId: agent.id, reason: "write_failed" });
      console.warn(
        `${LOG_PREFIX} write failed for agent ${agent.id}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return { content, agents: agentRows.length, written, skipped };
}

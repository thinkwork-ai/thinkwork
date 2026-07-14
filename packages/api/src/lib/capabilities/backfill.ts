/**
 * Capability-folder backfill (THINK-173 plan U11 — R13, R15, R17, R19,
 * R20; AE4).
 *
 * DEPRECATION BOUNDARY: this module is the SOLE remaining reader of
 * `agent_mcp_servers` (see the retired-table note in
 * packages/database-pg/src/schema/mcp-servers.ts). It migrates
 * pre-retirement rows into workspace folders on stages that have not cut
 * over yet. Once every customer stage has run `--apply --flip`, delete
 * this read, the Drizzle def, and then (deploy-first) the table.
 *
 * One idempotent, re-runnable per-tenant pipeline with explicitly gated
 * phases, always returning a single structured report:
 *
 *   1. DRY-RUN (always): enumerate every agent's attached MCP servers
 *      and built-in tool opt-ins, derive the folders the backfill would
 *      write, and run every derived name through the shared collision
 *      registry (R19 — builtins + platform names seeded; collisions are
 *      reported, colliding folders are never written).
 *   2. APPLY (`apply: true`): compare-and-write `connections/<slug>/`
 *      folders (signedBy "backfill", refs only — auth_config values
 *      never leave the DB) and platform-kind `tools/<slug>/`
 *      declarations for the Tool Library reclassification (R15).
 *      Definitions are byte-stable across re-runs: an unchanged
 *      definition only re-signs the sidecar.
 *   3. FLIP (`flip: true`): per-agent divergence check — the
 *      folder-derived connection surface (read back from S3) must equal
 *      the DB-derived surface before `capability_folder_dispatch`
 *      flips, atomically per agent (R20). Apply errors or divergence
 *      block the flip; a re-run completes it (AE4). Flipped agents (this
 *      run or a prior one) also get their superseded legacy `mcp/<slug>/`
 *      mirror folders scrubbed (THINK-190) — the connection sidecar is
 *      their single assignment record.
 *   4. SCRUB (`scrub: true`, requires flip): once EVERY agent in the
 *      tenant is flipped, inline secret values in
 *      `tenantMcpServers.auth_config` are replaced with a
 *      `secretsmanager:MIGRATED` marker so plaintext credentials do not
 *      linger in the demoted index table. Ref-shaped values are left
 *      untouched; the report carries key paths only, never values.
 *
 * Authorized signer: this module is the `backfill` provenance call site
 * (KTD-3).
 */

import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getConfig } from "@thinkwork/runtime-config";
import {
  BUILTIN_TOOL_NAMES,
  resolveAgainstReserved,
  type ToolNameClaim,
} from "@thinkwork/pi-runtime-core";
import { db, eq, and } from "../../graphql/utils.js";
import { agents, tenants } from "../../graphql/utils.js";
import {
  agentMcpServers,
  tenantMcpServers,
} from "@thinkwork/database-pg/schema";
import {
  connectionDefinitionFromRegistryRow,
  putCapabilityFolder,
  signExistingCapabilityFolder,
  capabilityDefinitionKey,
  capabilitySidecarKey,
  type CapabilityFolderWriteDeps,
} from "./folder-write.js";
import { removeLegacyMcpFolders } from "../mcp/assignment-state.js";

const LOG_PREFIX = "[capability-backfill]";

/** Platform tool names the runtime implements (seeded as reserved). */
export const PLATFORM_TOOL_NAMES = [
  "send_email",
  "web_search",
  "web_extract",
  "browser_automation",
  "execute_code",
  "emit_json_render_ui",
] as const;

/** Tool Library reclassification map: agent jsonb column → declaration. */
const PLATFORM_TOOL_DECLARATIONS: ReadonlyArray<{
  column:
    | "send_email"
    | "web_search"
    | "web_extract"
    | "browser"
    | "sandbox"
    | "json_render_ui";
  slug: string;
  platformTool: (typeof PLATFORM_TOOL_NAMES)[number];
  description: string;
}> = [
  {
    column: "send_email",
    slug: "send-email",
    platformTool: "send_email",
    description: "Send email through the platform's outbound mail built-in.",
  },
  {
    column: "web_search",
    slug: "web-search",
    platformTool: "web_search",
    description: "Search the web through the platform's search built-in.",
  },
  {
    column: "web_extract",
    slug: "web-extract",
    platformTool: "web_extract",
    description: "Extract page content through the platform's built-in.",
  },
  {
    column: "browser",
    slug: "browser-automation",
    platformTool: "browser_automation",
    description: "Drive a cloud browser through the platform's built-in.",
  },
  {
    column: "sandbox",
    slug: "code-sandbox",
    platformTool: "execute_code",
    description: "Run code in the platform sandbox built-in.",
  },
  {
    column: "json_render_ui",
    slug: "json-render-ui",
    platformTool: "emit_json_render_ui",
    description:
      "Answer with generated UI (charts, tables, rich result chunks) rendered in the thread.",
  },
];

// Copied from definition-schemas.ts (deliberately not exported there).
const SECRET_KEY_RE =
  /(?:^|_)(?:token|secret|password|apikey|api_key|client_secret|private_key|credentials?|authorization)$/i;
const ALLOWED_REF_RE =
  /^(?:secretsmanager:|ssm:|ref:|arn:aws:secretsmanager:|arn:aws:ssm:|[A-Z][A-Z0-9_]*$)/;
const SCRUB_MARKER = "secretsmanager:MIGRATED";

export interface BackfillOptions {
  tenantId: string;
  apply?: boolean;
  flip?: boolean;
  /** Only honored together with `flip`. */
  scrub?: boolean;
  deps?: CapabilityFolderWriteDeps;
}

export interface BackfillProposedConnection {
  slug: string;
  registryServerId: string;
  operations: string[];
}

export interface BackfillAgentReport {
  agentId: string;
  agentSlug: string;
  targetPrefix: string | null;
  alreadyFlipped: boolean;
  proposedConnections: BackfillProposedConnection[];
  proposedPlatformTools: string[];
  collisions: Array<{ name: string; winner: string }>;
  applied?: {
    written: string[];
    unchanged: string[];
    errors: Array<{ slug: string; reason: string }>;
  };
  divergence?: {
    equal: boolean;
    folderOnly: string[];
    dbOnly: string[];
    changed: string[];
  };
  flipped?: boolean;
  /**
   * THINK-190: legacy `mcp/<slug>/` mirror folders scrubbed after this
   * agent's flip — the connection sidecar is the single assignment record
   * for flipped agents. Present only in flip mode for flipped agents.
   */
  legacyMcpRemoved?: string[];
}

export interface BackfillReport {
  tenantId: string;
  tenantSlug: string | null;
  mode: { apply: boolean; flip: boolean; scrub: boolean };
  agents: BackfillAgentReport[];
  scrub?: {
    ran: boolean;
    blockedReason?: string;
    servers: Array<{ serverId: string; scrubbedPaths: string[] }>;
  };
  summary: {
    agents: number;
    proposedConnections: number;
    proposedPlatformTools: number;
    collisions: number;
    applied: number;
    applyErrors: number;
    flipped: number;
    divergent: number;
    legacyMcpRemoved: number;
  };
}

interface S3Reader {
  send: Pick<S3Client, "send">["send"];
}

let sharedClient: S3Client | null = null;
function s3Client(): S3Reader {
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

async function readObject(
  s3: S3Reader,
  bucket: string,
  key: string,
): Promise<string | null> {
  try {
    const resp = await s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    );
    return (await resp.Body?.transformToString()) ?? null;
  } catch {
    return null;
  }
}

function platformToolDefinition(declaration: {
  slug: string;
  platformTool: string;
  description: string;
}): string {
  return `---
name: ${declaration.slug}
description: ${declaration.description}
kind: platform
platform_tool: ${declaration.platformTool}
---

${declaration.description} Implementation lives in the Pi runtime; this
declaration makes the built-in a first-class workspace capability
(THINK-173 Tool Library reclassification).
`;
}

function builtinOptInEnabled(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  return (value as { enabled?: unknown }).enabled !== false;
}

function surfaceKey(entry: BackfillProposedConnection): string {
  return `${entry.slug}|${entry.registryServerId}|${[...entry.operations]
    .sort()
    .join(",")}`;
}

export async function runCapabilityFolderBackfill(
  options: BackfillOptions,
): Promise<BackfillReport> {
  const apply = options.apply === true;
  const flip = options.flip === true;
  const scrub = options.scrub === true && flip;
  const deps = options.deps ?? {};
  const bucket = deps.bucket ?? workspaceBucket();
  const s3: S3Reader = (deps.s3 as S3Reader | undefined) ?? s3Client();

  const [tenant] = await db
    .select({ slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.id, options.tenantId))
    .limit(1);
  const tenantSlug = tenant?.slug ?? null;

  const agentRows = await db
    .select({
      id: agents.id,
      slug: agents.slug,
      workspace_folder_name: agents.workspace_folder_name,
      capability_folder_dispatch: agents.capability_folder_dispatch,
      send_email: agents.send_email,
      web_search: agents.web_search,
      web_extract: agents.web_extract,
      browser: agents.browser,
      sandbox: agents.sandbox,
      json_render_ui: agents.json_render_ui,
    })
    .from(agents)
    .where(eq(agents.tenant_id, options.tenantId));

  const reports: BackfillAgentReport[] = [];
  for (const agent of agentRows) {
    if (!agent.slug) continue;
    const targetPrefix = tenantSlug
      ? `tenants/${tenantSlug}/agents/${agent.workspace_folder_name ?? agent.slug}/`
      : null;

    // ── Phase 1: dry-run enumeration ────────────────────────────────
    const attachRows = await db
      .select({
        enabled: agentMcpServers.enabled,
        config: agentMcpServers.config,
        server_id: tenantMcpServers.id,
        slug: tenantMcpServers.slug,
        name: tenantMcpServers.name,
        url: tenantMcpServers.url,
        transport: tenantMcpServers.transport,
        tools: tenantMcpServers.tools,
        status: tenantMcpServers.status,
        server_enabled: tenantMcpServers.enabled,
      })
      .from(agentMcpServers)
      .innerJoin(
        tenantMcpServers,
        eq(agentMcpServers.mcp_server_id, tenantMcpServers.id),
      )
      .where(
        and(
          eq(agentMcpServers.agent_id, agent.id),
          eq(agentMcpServers.tenant_id, options.tenantId),
        ),
      );

    const proposedConnections: BackfillProposedConnection[] = [];
    const generatedBySlug = new Map<
      string,
      { definition: string; registryServerId: string; operations: string[] }
    >();
    for (const row of attachRows) {
      if (row.enabled === false) continue;
      if (row.status !== "approved" || row.server_enabled === false) continue;
      const generated = connectionDefinitionFromRegistryRow(row);
      const allowlist = (row.config as { toolAllowlist?: unknown } | null)
        ?.toolAllowlist;
      const operations = Array.isArray(allowlist)
        ? allowlist.filter((op): op is string => typeof op === "string")
        : [];
      proposedConnections.push({
        slug: generated.slug,
        registryServerId: row.server_id,
        operations,
      });
      generatedBySlug.set(generated.slug, {
        definition: generated.definition,
        registryServerId: row.server_id,
        operations,
      });
    }

    const proposedPlatform = PLATFORM_TOOL_DECLARATIONS.filter((declaration) =>
      builtinOptInEnabled(agent[declaration.column]),
    );

    const claims: ToolNameClaim[] = [
      ...proposedConnections.map((connection) => ({
        name: connection.slug,
        source: "binding" as const,
        origin: connection.slug,
      })),
      ...proposedPlatform.map((declaration) => ({
        name: declaration.slug,
        source: "platform" as const,
        origin: declaration.slug,
      })),
    ];
    const verdicts = resolveAgainstReserved(
      {
        builtinNames: BUILTIN_TOOL_NAMES,
        platformNames: PLATFORM_TOOL_NAMES,
      },
      claims,
    );
    const collisions = verdicts
      .filter((verdict) => !verdict.ok)
      .map((verdict) => ({
        name: verdict.name,
        winner:
          verdict.ok === false && verdict.reason === "collision"
            ? `${verdict.winner?.source ?? "unknown"}${
                verdict.winner?.origin ? `:${verdict.winner.origin}` : ""
              }`
            : "malformed_name",
      }));
    const collidingNames = new Set(collisions.map((entry) => entry.name));

    const report: BackfillAgentReport = {
      agentId: agent.id,
      agentSlug: agent.slug,
      targetPrefix,
      alreadyFlipped: agent.capability_folder_dispatch === true,
      proposedConnections,
      proposedPlatformTools: proposedPlatform.map((entry) => entry.slug),
      collisions,
    };
    reports.push(report);

    if (!targetPrefix || !bucket) continue;

    // ── Phase 2: compare-and-write apply (skipped unless `apply`) ───
    const applied = {
      written: [] as string[],
      unchanged: [] as string[],
      errors: [] as Array<{ slug: string; reason: string }>,
    };
    if (apply) report.applied = applied;

    for (const [slug, entry] of apply ? generatedBySlug : []) {
      if (collidingNames.has(slug)) {
        applied.errors.push({ slug, reason: "collision" });
        continue;
      }
      const sidecar = {
        enabled: true,
        ...(entry.operations.length > 0
          ? { permissions: { operations: entry.operations } }
          : {}),
        config: { registryServerId: entry.registryServerId },
      };
      const existing = await readObject(
        s3,
        bucket,
        capabilityDefinitionKey(targetPrefix, "connection", slug),
      );
      const result =
        existing === entry.definition
          ? await signExistingCapabilityFolder({
              targetPrefix,
              klass: "connection",
              slug,
              sidecar,
              signedBy: "backfill",
              deps,
            })
          : await putCapabilityFolder({
              targetPrefix,
              klass: "connection",
              slug,
              definition: entry.definition,
              sidecar,
              signedBy: "backfill",
              deps,
            });
      if (result.ok) {
        (existing === entry.definition
          ? applied.unchanged
          : applied.written
        ).push(`connections/${slug}`);
      } else {
        applied.errors.push({ slug, reason: result.reason });
      }
    }

    for (const declaration of apply ? proposedPlatform : []) {
      if (collidingNames.has(declaration.slug)) {
        applied.errors.push({ slug: declaration.slug, reason: "collision" });
        continue;
      }
      const definition = platformToolDefinition(declaration);
      const existing = await readObject(
        s3,
        bucket,
        capabilityDefinitionKey(targetPrefix, "tool", declaration.slug),
      );
      const result =
        existing === definition
          ? await signExistingCapabilityFolder({
              targetPrefix,
              klass: "tool",
              slug: declaration.slug,
              sidecar: { enabled: true },
              signedBy: "backfill",
              deps,
            })
          : await putCapabilityFolder({
              targetPrefix,
              klass: "tool",
              slug: declaration.slug,
              definition,
              sidecar: { enabled: true },
              signedBy: "backfill",
              deps,
            });
      if (result.ok) {
        (existing === definition ? applied.unchanged : applied.written).push(
          `tools/${declaration.slug}`,
        );
      } else {
        applied.errors.push({ slug: declaration.slug, reason: result.reason });
      }
    }

    if (!flip) continue;

    // ── Phase 3: divergence check + per-agent atomic flip (R20) ─────
    if (applied.errors.length > 0) {
      report.divergence = {
        equal: false,
        folderOnly: [],
        dbOnly: applied.errors.map((entry) => entry.slug),
        changed: [],
      };
      report.flipped = false;
      continue;
    }

    const folderSurface = new Map<string, string>();
    for (const [slug, entry] of generatedBySlug) {
      const sidecarRaw = await readObject(
        s3,
        bucket,
        capabilitySidecarKey(targetPrefix, "connection", slug),
      );
      if (!sidecarRaw) continue;
      try {
        const sidecar = JSON.parse(sidecarRaw) as {
          enabled?: unknown;
          permissions?: { operations?: unknown };
          config?: { registryServerId?: unknown };
        };
        if (sidecar.enabled === false) continue;
        const operations = Array.isArray(sidecar.permissions?.operations)
          ? (sidecar.permissions.operations as unknown[]).filter(
              (op): op is string => typeof op === "string",
            )
          : [];
        folderSurface.set(
          slug,
          surfaceKey({
            slug,
            registryServerId:
              typeof sidecar.config?.registryServerId === "string"
                ? sidecar.config.registryServerId
                : "",
            operations,
          }),
        );
      } catch {
        // unreadable sidecar = divergent below
      }
      void entry;
    }

    const dbSurface = new Map<string, string>(
      proposedConnections.map((entry) => [entry.slug, surfaceKey(entry)]),
    );
    const folderOnly = [...folderSurface.keys()].filter(
      (slug) => !dbSurface.has(slug),
    );
    const dbOnly = [...dbSurface.keys()].filter(
      (slug) => !folderSurface.has(slug),
    );
    const changed = [...dbSurface.keys()].filter(
      (slug) =>
        folderSurface.has(slug) &&
        folderSurface.get(slug) !== dbSurface.get(slug),
    );
    const equal =
      folderOnly.length === 0 && dbOnly.length === 0 && changed.length === 0;
    report.divergence = { equal, folderOnly, dbOnly, changed };

    if (equal) {
      await db
        .update(agents)
        .set({ capability_folder_dispatch: true })
        .where(eq(agents.id, agent.id));
      report.flipped = true;
    } else {
      console.warn(
        `${LOG_PREFIX} divergence blocks flip agent=${agent.slug} folderOnly=[${folderOnly}] dbOnly=[${dbOnly}] changed=[${changed}]`,
      );
      report.flipped = false;
    }

    // ── Flip follow-up (THINK-190): scrub the superseded mcp/ mirror ──
    // A flipped agent (this run or a prior one) holds its assignment
    // record in the connection sidecars — every reader/writer forks on
    // the flag — so the legacy folders are dead weight that duplicate-
    // render in Composer. Idempotent: a clean workspace returns [].
    if (report.alreadyFlipped || report.flipped === true) {
      report.legacyMcpRemoved = await removeLegacyMcpFolders(targetPrefix, {
        s3,
        bucket,
      });
    }
  }

  // ── Phase 4: secret scrub (tenant-wide, only when fully flipped) ──
  const scrubReport: BackfillReport["scrub"] = scrub
    ? { ran: false, servers: [] }
    : undefined;
  if (scrub && scrubReport) {
    const allFlipped = reports.every(
      (report) => report.alreadyFlipped || report.flipped === true,
    );
    if (!allFlipped || reports.length === 0) {
      scrubReport.blockedReason =
        "not every agent in the tenant is flipped — scrub requires a fully migrated tenant";
    } else {
      scrubReport.ran = true;
      const serverRows = await db
        .select({
          id: tenantMcpServers.id,
          auth_config: tenantMcpServers.auth_config,
        })
        .from(tenantMcpServers)
        .where(eq(tenantMcpServers.tenant_id, options.tenantId));
      for (const server of serverRows) {
        const scrubbedPaths: string[] = [];
        const scrubbed = scrubSecretValues(
          server.auth_config,
          "",
          scrubbedPaths,
        );
        if (scrubbedPaths.length === 0) continue;
        await db
          .update(tenantMcpServers)
          .set({ auth_config: scrubbed })
          .where(eq(tenantMcpServers.id, server.id));
        scrubReport.servers.push({ serverId: server.id, scrubbedPaths });
      }
    }
  }

  const summary = {
    agents: reports.length,
    proposedConnections: reports.reduce(
      (sum, report) => sum + report.proposedConnections.length,
      0,
    ),
    proposedPlatformTools: reports.reduce(
      (sum, report) => sum + report.proposedPlatformTools.length,
      0,
    ),
    collisions: reports.reduce(
      (sum, report) => sum + report.collisions.length,
      0,
    ),
    applied: reports.reduce(
      (sum, report) =>
        sum +
        (report.applied
          ? report.applied.written.length + report.applied.unchanged.length
          : 0),
      0,
    ),
    applyErrors: reports.reduce(
      (sum, report) => sum + (report.applied?.errors.length ?? 0),
      0,
    ),
    flipped: reports.filter((report) => report.flipped === true).length,
    divergent: reports.filter(
      (report) => report.divergence && !report.divergence.equal,
    ).length,
    legacyMcpRemoved: reports.reduce(
      (sum, report) => sum + (report.legacyMcpRemoved?.length ?? 0),
      0,
    ),
  };

  return {
    tenantId: options.tenantId,
    tenantSlug,
    mode: { apply, flip, scrub },
    agents: reports,
    ...(scrubReport ? { scrub: scrubReport } : {}),
    summary,
  };
}

/**
 * Recursively replace inline secret values with the migration marker.
 * Returns a new object; records scrubbed key paths (never values).
 */
export function scrubSecretValues(
  value: unknown,
  keyPath: string,
  scrubbedPaths: string[],
): unknown {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((item, index) =>
      scrubSecretValues(item, `${keyPath}[${index}]`, scrubbedPaths),
    );
  }
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = keyPath ? `${keyPath}.${key}` : key;
    if (
      SECRET_KEY_RE.test(key) &&
      typeof child === "string" &&
      child !== "" &&
      child !== SCRUB_MARKER &&
      !ALLOWED_REF_RE.test(child)
    ) {
      out[key] = SCRUB_MARKER;
      scrubbedPaths.push(childPath);
      continue;
    }
    out[key] =
      child && typeof child === "object"
        ? scrubSecretValues(child, childPath, scrubbedPaths)
        : child;
  }
  return out;
}

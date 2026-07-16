/**
 * grantCapability / detachCapability — the Phase B assignment write surface
 * (capability-mapping plan U7, KTD-5).
 *
 * API-first by contract: the Capabilities UI, the legacy settings pages, and
 * the CLI are all clients of these two mutations — there is no UI-only write
 * path. The mutations WRAP the existing per-class machinery rather than
 * reimplementing it:
 *
 *   - skill @ agent          → `installCatalogSkill` / `uninstallCatalogSkill`
 *                              (S3 workspace materialization + CONTEXT.md
 *                              wiring) + workspace manifest regeneration;
 *   - skill @ profile        → signed `agents/<slug>/skills/<child>/` child
 *                              grant folder (subagent-folders U11);
 *   - mcp_server @ agent     → workspace file + signed connection folder;
 *   - mcp_server @ profile   → signed `agents/<slug>/connectors/<child>/`
 *                              child grant folder (the agent-level server
 *                              config's allowlist passes through);
 *   - pi_extension @ both    → delegates to THINK-114's
 *                              `updatePiExtensionAssignment` (adapt, don't
 *                              fork).
 *
 * R2 enforcement point: `assertAssignableCell` rejects every class × scope
 * cell the capability matrix marks unassignable, before any read or write.
 *
 * Every state-changing call emits a compliance audit event — inside the same
 * transaction for the DB-backed classes; immediately after the delegate
 * commits for pi_extension (the THINK-114 mutation owns its transaction) and
 * after the S3 materialization for agent-scope skills (their substrate is S3,
 * not the DB — the audit tx wraps the only DB write). A failed mutation
 * leaves no event; an idempotent no-op emits none either.
 *
 * Every response ends on the touched item's FRESH inspector state (R12):
 * the U3 `capabilityInspector` recomputes the selection after the write —
 * the mutation never hand-assembles what the inspector would say.
 */

import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import {
  db,
  eq,
  and,
  agents,
  tenants,
  skillCatalog,
  tenantMcpServers,
} from "../../utils.js";
import { piExtensionAssignments } from "@thinkwork/database-pg/schema";
import { requireAdminOrServiceCaller } from "../core/authz.js";
import { resolveCallerUserId } from "../core/resolve-auth-user.js";
import { emitAuditEvent } from "../../../lib/compliance/emit.js";
import type { ComplianceEventType } from "@thinkwork/database-pg/schema";
import {
  assertAssignableCell,
  CapabilityMatrixViolationError,
  type CapabilityGrantClass,
  type CapabilityGrantScope,
} from "../../../lib/capability-matrix.js";
import { capabilityInspector } from "./capabilityInspector.query.js";
import { updatePiExtensionAssignment } from "../pi-extensions/updatePiExtensionAssignment.mutation.js";

const LOG_PREFIX = "[capability-mutations]";

function badInput(message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code: "BAD_USER_INPUT" } });
}

function notFound(message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code: "NOT_FOUND" } });
}

function matrixViolation(err: CapabilityMatrixViolationError): GraphQLError {
  return new GraphQLError(err.message, {
    extensions: { code: "MATRIX_VIOLATION" },
  });
}

interface CapabilityMutationGqlInput {
  tenantId: string;
  capabilityClass: string;
  scope: string;
  agentId?: string | null;
  agentProfileId?: string | null;
  capabilityRef: string;
  wiringChoice?: string | null;
  toolAllowlist?: string[] | null;
  grantedPermissions?: string[] | null;
}

interface CapabilityMutationResultOut {
  outcome: "applied" | "noop";
  item: unknown | null;
  computedAt: string;
  configFingerprint: string | null;
  inspectionState: string;
}

type MutationMode = "grant" | "detach";

/** GraphQL enum → matrix vocabulary. */
function normalizeClass(value: string): CapabilityGrantClass {
  const map: Record<string, CapabilityGrantClass> = {
    SKILL: "skill",
    MCP_SERVER: "mcp_server",
    PI_EXTENSION: "pi_extension",
    CONNECTION: "connection",
    TOOL: "tool",
  };
  const normalized = map[value];
  if (!normalized) throw badInput(`unknown capability class '${value}'`);
  return normalized;
}

function normalizeScope(value: string): CapabilityGrantScope {
  const map: Record<string, CapabilityGrantScope> = {
    AGENT: "agent",
    AGENT_PROFILE: "agent_profile",
    SPACE: "space",
    USER: "user",
  };
  const normalized = map[value];
  if (!normalized) throw badInput(`unknown capability scope '${value}'`);
  return normalized;
}

function normalizeStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

interface AgentTarget {
  agentId: string;
  tenantSlug: string;
  workspaceFolder: string;
  targetPrefix: string;
}

/**
 * Resolve the agent target (defaulting to the tenant's platform agent) and
 * its workspace prefix. Cross-tenant ids fail closed as NOT_FOUND.
 */
async function resolveAgentTarget(
  tenantId: string,
  agentId: string | null | undefined,
): Promise<AgentTarget> {
  const where = agentId
    ? and(eq(agents.id, agentId), eq(agents.tenant_id, tenantId))
    : and(eq(agents.tenant_id, tenantId), eq(agents.is_platform_default, true));
  const [agent] = await db
    .select({
      id: agents.id,
      slug: agents.slug,
      workspace_folder_name: agents.workspace_folder_name,
    })
    .from(agents)
    .where(where)
    .limit(1);
  if (!agent?.slug) {
    throw notFound(
      agentId
        ? "agent not found in tenant"
        : "tenant has no platform default agent",
    );
  }
  const [tenant] = await db
    .select({ slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  if (!tenant?.slug) throw notFound("tenant not found");
  const workspaceFolder = agent.workspace_folder_name ?? agent.slug;
  return {
    agentId: agent.id,
    tenantSlug: tenant.slug,
    workspaceFolder,
    targetPrefix: `tenants/${tenant.slug}/agents/${workspaceFolder}/`,
  };
}

/**
 * Subagent-folders U11: an agent-profile grant target is a workspace
 * `agents/<slug>/` folder — `agentProfileId` IS the folder slug (the
 * legacy row UUIDs no longer resolve). Validates the folder exists under
 * the tenant's platform agent workspace.
 */
async function requireProfileFolder(
  tenantId: string,
  agentProfileId: string | null | undefined,
): Promise<{ slug: string }> {
  if (!agentProfileId) {
    throw badInput("agent-profile scope requires agentProfileId");
  }
  const slug = agentProfileId.trim();
  const { getAgentFolderProfileForTenant } =
    await import("../../../lib/agent-profile-workspace-files.js");
  const profile = await getAgentFolderProfileForTenant(tenantId, slug);
  if (!profile) throw notFound("agent profile not found in tenant");
  return { slug };
}

interface AuditSpec {
  eventType: ComplianceEventType;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}

interface ClassOutcome {
  outcome: "applied" | "noop";
  /** Populated on "applied"; a no-op emits no audit event. */
  audit?: AuditSpec;
  /**
   * True when the class handler already emitted the audit event inside its
   * own transaction (the DB-backed classes). False → the shared driver
   * emits it in a dedicated transaction after the write (S3-backed skills,
   * the THINK-114 delegate).
   */
  auditEmitted: boolean;
  /** Inspector item id, when it differs from capabilityRef (extensions). */
  itemId?: string | null;
}

const AUDIT_EVENT_TYPES: Record<
  CapabilityGrantClass,
  Record<MutationMode, ComplianceEventType>
> = {
  skill: { grant: "skill.granted", detach: "skill.detached" },
  mcp_server: { grant: "mcp.granted", detach: "mcp.detached" },
  pi_extension: {
    grant: "agent.extension_granted",
    detach: "agent.extension_detached",
  },
  connection: {
    grant: "agent.connection_granted",
    detach: "agent.connection_detached",
  },
  tool: { grant: "agent.tool_granted", detach: "agent.tool_detached" },
};

// ─── skill @ agent: S3 catalog install / uninstall ─────────────────────────

async function skillAgentMutation(
  mode: MutationMode,
  input: CapabilityMutationGqlInput,
  target: AgentTarget,
): Promise<ClassOutcome> {
  // Heavy deps are dynamic-imported so partially-mocked test suites that
  // stub the resolver graph never load the S3 client (same pattern as the
  // evaluations applySkillUpdate swap).
  const { getConfig } = await import("@thinkwork/runtime-config");
  const { S3Client, GetObjectCommand } = await import("@aws-sdk/client-s3");
  const bucket = getConfig("WORKSPACE_BUCKET");
  if (!bucket) throw new Error("WORKSPACE_BUCKET is not configured");
  const s3 = new S3Client({
    region:
      process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1",
  });
  const slug = input.capabilityRef.trim();

  if (mode === "grant") {
    const {
      installCatalogSkill,
      CatalogInstallError,
      DEFAULT_WIRING_CHOICE_ID,
    } = await import("../../../lib/catalog-install.js");
    let wiringChoice = input.wiringChoice?.trim() ?? "";
    if (!wiringChoice) {
      // Default to the skill's first WIRING.md suggestion (the eval-install
      // convention) so simple grants need no wiring knowledge. Post-Composer-U5
      // WIRING.md is metadata-only and optional: a missing WIRING.md is NOT a
      // not-found — fall through to the synthesized "default" wiring choice so
      // a SKILL.md-only skill installs (installCatalogSkill owns the genuine
      // catalog-empty 404). A real (non-404) S3 error still propagates.
      const { parseWiringMd } = await import("../../../lib/wiring-md.js");
      const wiringKey = `tenants/${target.tenantSlug}/skill-catalog/${slug}/WIRING.md`;
      let wiringMd: string | null;
      try {
        const resp = await s3.send(
          new GetObjectCommand({ Bucket: bucket, Key: wiringKey }),
        );
        wiringMd = (await resp.Body?.transformToString()) ?? "";
      } catch (err) {
        const name = (err as { name?: string } | null)?.name;
        const status = (
          err as { $metadata?: { httpStatusCode?: number } } | null
        )?.$metadata?.httpStatusCode;
        if (name === "NoSuchKey" || name === "NotFound" || status === 404) {
          wiringMd = null;
        } else {
          throw err;
        }
      }
      if (wiringMd === null) {
        wiringChoice = DEFAULT_WIRING_CHOICE_ID;
      } else {
        const first = parseWiringMd(wiringMd).suggestions[0];
        if (!first) {
          throw badInput(
            `catalog skill '${slug}' has no wiring suggestions — pass wiringChoice explicitly`,
          );
        }
        wiringChoice = first.id;
      }
    }
    try {
      await installCatalogSkill({
        s3,
        bucket,
        tenantSlug: target.tenantSlug,
        targetPrefix: target.targetPrefix,
        slug,
        wiringChoice,
      });
    } catch (err) {
      if (err instanceof CatalogInstallError) {
        if (err.code === "already_installed") {
          return { outcome: "noop", auditEmitted: false };
        }
        if (err.status === 404) throw notFound(err.message);
        throw badInput(err.message);
      }
      throw err;
    }
    const { regenerateManifest } =
      await import("../../../lib/workspace-manifest.js");
    await regenerateManifest(bucket, target.tenantSlug, target.workspaceFolder);
    return {
      outcome: "applied",
      auditEmitted: false,
      audit: {
        eventType: AUDIT_EVENT_TYPES.skill.grant,
        before: { installed: false },
        after: { installed: true, wiringChoice },
      },
    };
  }

  const { uninstallCatalogSkill, CatalogUninstallError } =
    await import("../../../lib/catalog-uninstall.js");
  let deletedPaths: string[];
  try {
    const result = await uninstallCatalogSkill({
      s3,
      bucket,
      targetPrefix: target.targetPrefix,
      slug,
    });
    deletedPaths = result.deleted_paths;
  } catch (err) {
    if (err instanceof CatalogUninstallError) throw badInput(err.message);
    throw err;
  }
  if (deletedPaths.length === 0) {
    return { outcome: "noop", auditEmitted: false };
  }
  const { regenerateManifest } =
    await import("../../../lib/workspace-manifest.js");
  await regenerateManifest(bucket, target.tenantSlug, target.workspaceFolder);
  return {
    outcome: "applied",
    auditEmitted: false,
    audit: {
      eventType: AUDIT_EVENT_TYPES.skill.detach,
      before: { installed: true },
      after: { installed: false, deletedPaths: deletedPaths.length },
    },
  };
}

// ─── skill @ profile: agents/<slug>/skills/<child>/ grant folder ───────────
// (subagent-folders U11 — grants are folder presence with a platform-
// signed sidecar; agent_profiles.skill_policy is retired.)

async function skillProfileMutation(
  mode: MutationMode,
  input: CapabilityMutationGqlInput,
  signedBy: `operator:${string}`,
): Promise<ClassOutcome> {
  const {
    agentChildGrantExists,
    putAgentChildGrantSidecar,
    removeAgentChildGrantSidecar,
  } = await import("../../../lib/capabilities/folder-write.js");
  const slug = input.capabilityRef.trim();
  if (mode === "grant") {
    const [catalogRow] = await db
      .select({ slug: skillCatalog.slug })
      .from(skillCatalog)
      .where(
        and(
          eq(skillCatalog.tenant_id, input.tenantId),
          eq(skillCatalog.slug, slug),
        ),
      )
      .limit(1);
    if (!catalogRow) {
      throw notFound(`skill '${slug}' is not in the tenant catalog`);
    }
  }

  const profile = await requireProfileFolder(
    input.tenantId,
    input.agentProfileId,
  );
  const target = await resolveAgentTarget(input.tenantId, input.agentId);
  const grantInput = {
    targetPrefix: target.targetPrefix,
    agentProfileSlug: profile.slug,
    childClass: "skill" as const,
    slug,
  };
  const exists = await agentChildGrantExists(grantInput);
  if (exists === null) throw new Error("WORKSPACE_BUCKET is not configured");
  if (mode === "grant" ? exists : !exists) {
    return { outcome: "noop", auditEmitted: false };
  }
  const result =
    mode === "grant"
      ? await putAgentChildGrantSidecar({ ...grantInput, signedBy })
      : await removeAgentChildGrantSidecar(grantInput);
  if (!result.ok) {
    throw new Error(
      `agent-profile skill ${mode} failed: ${result.reason}${
        "detail" in result && result.detail ? ` (${result.detail})` : ""
      }`,
    );
  }
  return {
    outcome: "applied",
    auditEmitted: false,
    audit: {
      eventType: AUDIT_EVENT_TYPES.skill[mode],
      before: { granted: mode !== "grant" },
      after: { granted: mode === "grant" },
    },
  };
}

// ─── mcp_server @ agent: workspace file + signed connection folder ─────────
// (agent_mcp_servers is retired — the files are the assignment state.)

interface TenantMcpServerRow {
  id: string;
  slug: string | null;
  name: string;
  url: string;
  transport: string | null;
  tools: unknown;
}

async function resolveTenantMcpServer(
  tenantId: string,
  ref: string,
): Promise<TenantMcpServerRow> {
  // Accept the row id or the slug — the inspector and the runtime key
  // servers by slug, while the legacy REST surface used ids.
  const rows = (await db
    .select({
      id: tenantMcpServers.id,
      slug: tenantMcpServers.slug,
      name: tenantMcpServers.name,
      url: tenantMcpServers.url,
      transport: tenantMcpServers.transport,
      tools: tenantMcpServers.tools,
    })
    .from(tenantMcpServers)
    .where(eq(tenantMcpServers.tenant_id, tenantId))) as TenantMcpServerRow[];
  const match = rows.find(
    (row) => row.id === ref || row.slug === ref || row.name === ref,
  );
  if (!match) throw notFound(`MCP server '${ref}' not found in tenant`);
  return match;
}

async function mcpAgentMutation(
  mode: MutationMode,
  input: CapabilityMutationGqlInput,
  target: AgentTarget,
  audit: (spec: AuditSpec) => Parameters<typeof emitAuditEvent>[1],
  signedBy: `operator:${string}`,
): Promise<ClassOutcome> {
  const server = await resolveTenantMcpServer(
    input.tenantId,
    input.capabilityRef.trim(),
  );
  const itemId = server.slug ?? server.name;

  // Post-retirement (THINK-173 U11 follow-up) the workspace files ARE the
  // assignment state — no `agent_mcp_servers` row exists behind them. The
  // S3 writes are the mutation itself, so a failed write is a failed
  // mutation (thrown), exactly like the connection/tool folder classes.
  // The shared driver emits the audit event after the write commits.
  //
  // THINK-190: WHICH file is the record forks on the agent's migration
  // flag. Flipped agents hold ONE record — the signed connection sidecar
  // (the legacy mcp/ mirror is retired for them: never written, removed
  // best-effort on detach). Un-flipped agents keep the mcp/ file as the
  // record plus the connection dual-write.
  const {
    agentUsesFolderDispatch,
    materializeMcpAssignmentFolder,
    readMcpAssignmentState,
    removeMcpAssignmentFolder,
  } = await import("../../../lib/mcp/assignment-state.js");
  const {
    connectionDefinitionFromRegistryRow,
    putCapabilityFolder,
    removeCapabilityFolder,
  } = await import("../../../lib/capabilities/folder-write.js");

  const generated = connectionDefinitionFromRegistryRow(server);
  const flipped = await agentUsesFolderDispatch(target.agentId);

  /** Normalized prior state: null = not attached. */
  let existing: { enabled: boolean; enabledTools: string[] | null } | null;
  if (flipped) {
    const { readConnectionAssignment } =
      await import("../../../lib/capabilities/connection-assignments.js");
    const record = await readConnectionAssignment(
      target.targetPrefix,
      generated.slug,
    );
    existing = record
      ? {
          enabled: record.enabled,
          enabledTools: record.operations.length > 0 ? record.operations : null,
        }
      : null;
  } else {
    const state = await readMcpAssignmentState(target.targetPrefix, itemId);
    existing = state
      ? {
          enabled: state.enabled !== false,
          enabledTools:
            state.enabledTools && state.enabledTools.length > 0
              ? state.enabledTools
              : null,
        }
      : null;
  }

  if (mode === "detach") {
    if (!existing) {
      return { outcome: "noop" as const, auditEmitted: false, itemId };
    }
    // Legacy mcp/ record: the record itself for un-flipped agents (a failed
    // removal fails the detach); a stale-mirror cleanup for flipped agents
    // (best-effort — their record is the connection folder below).
    const folderRemoved = await removeMcpAssignmentFolder(
      target.targetPrefix,
      itemId,
    );
    if (!folderRemoved && !flipped) {
      throw new GraphQLError(
        `failed to detach MCP server '${itemId}': workspace folder removal failed`,
        { extensions: { code: "INTERNAL_SERVER_ERROR" } },
      );
    }
    const removed = await removeCapabilityFolder({
      targetPrefix: target.targetPrefix,
      klass: "connection",
      slug: generated.slug,
    });
    if (!removed.ok) {
      throw new GraphQLError(
        `failed to detach MCP server '${itemId}': connection folder removal failed (${removed.reason})`,
        { extensions: { code: "INTERNAL_SERVER_ERROR" } },
      );
    }
    return {
      outcome: "applied" as const,
      auditEmitted: false,
      itemId,
      audit: {
        eventType: AUDIT_EVENT_TYPES.mcp_server.detach,
        before: {
          assigned: true,
          enabled: existing.enabled !== false,
          config:
            existing.enabledTools && existing.enabledTools.length > 0
              ? { toolAllowlist: existing.enabledTools }
              : null,
        },
        after: { assigned: false },
      },
    };
  }

  const nextAllowlist =
    input.toolAllowlist && input.toolAllowlist.length > 0
      ? input.toolAllowlist
      : (existing?.enabledTools ?? null);
  const nextConfig =
    nextAllowlist && nextAllowlist.length > 0
      ? { toolAllowlist: nextAllowlist }
      : null;
  if (
    existing &&
    existing.enabled !== false &&
    JSON.stringify(existing.enabledTools ?? null) ===
      JSON.stringify(
        nextAllowlist && nextAllowlist.length > 0 ? nextAllowlist : null,
      )
  ) {
    return { outcome: "noop" as const, auditEmitted: false, itemId };
  }

  // Legacy mcp/ record: written only for un-flipped agents — a flipped
  // agent's single record is the signed connection sidecar, and writing
  // the mirror would resurrect folders the THINK-190 migration removed.
  if (!flipped) {
    const materialized = await materializeMcpAssignmentFolder({
      targetPrefix: target.targetPrefix,
      registryServerId: server.id,
      tenantId: input.tenantId,
      agentConfig: nextConfig,
    });
    if (!materialized) {
      throw new GraphQLError(
        `failed to grant MCP server '${itemId}': workspace assignment write failed`,
        { extensions: { code: "INTERNAL_SERVER_ERROR" } },
      );
    }
  }
  const written = await putCapabilityFolder({
    targetPrefix: target.targetPrefix,
    klass: "connection",
    slug: generated.slug,
    definition: generated.definition,
    sidecar: {
      enabled: true,
      ...(nextAllowlist && nextAllowlist.length > 0
        ? {
            permissions: {
              operations: nextAllowlist.filter(
                (op): op is string => typeof op === "string",
              ),
            },
          }
        : {}),
      config: { registryServerId: server.id },
    },
    signedBy,
  });
  if (!written.ok) {
    throw new GraphQLError(
      `failed to grant MCP server '${itemId}': connection folder write failed (${written.reason})`,
      { extensions: { code: "INTERNAL_SERVER_ERROR" } },
    );
  }
  return {
    outcome: "applied" as const,
    auditEmitted: false,
    itemId,
    audit: {
      eventType: AUDIT_EVENT_TYPES.mcp_server.grant,
      before: existing
        ? {
            assigned: true,
            enabled: existing.enabled !== false,
            config:
              existing.enabledTools && existing.enabledTools.length > 0
                ? { toolAllowlist: existing.enabledTools }
                : null,
          }
        : { assigned: false },
      after: { assigned: true, enabled: true, config: nextConfig },
    },
  };
}

// ─── connection/tool @ agent: signed workspace-folder sidecars ─────────────
// THINK-173 U7 (R3, R4, R18). Grant IS approve: the sidecar signs over the
// definition bytes read at this moment, so an agent draft (or any
// definition folder) becomes registration-grade only through this path —
// and a rewrite between review and sign surfaces as `definition_drift` at
// the next render, never as a blessed unreviewed capability. Detach
// removes only the sidecar; the definition remains an inert proposal.
// Unlike the DB-backed classes, the substrate is S3: a failed write is a
// failed mutation (thrown), not a best-effort shadow.

async function folderCapabilityMutation(
  mode: MutationMode,
  input: CapabilityMutationGqlInput,
  target: AgentTarget,
  klass: "connection" | "tool",
  signedBy: `operator:${string}`,
): Promise<ClassOutcome> {
  const slug = input.capabilityRef.trim();
  if (!slug) throw badInput("capabilityRef (folder slug) is required");
  const { signExistingCapabilityFolder, removeCapabilitySidecar } =
    await import("../../../lib/capabilities/folder-write.js");

  if (mode === "detach") {
    const removed = await removeCapabilitySidecar({
      targetPrefix: target.targetPrefix,
      klass,
      slug,
    });
    if (!removed.ok) {
      throw new GraphQLError(
        `failed to detach ${klass} '${slug}': ${removed.reason}`,
        { extensions: { code: "INTERNAL_SERVER_ERROR" } },
      );
    }
    return {
      outcome: "applied",
      auditEmitted: false,
      itemId: slug,
      audit: {
        eventType: AUDIT_EVENT_TYPES[klass].detach,
        before: { registered: true },
        after: { registered: false, proposal: true },
      },
    };
  }

  const operations =
    input.toolAllowlist && input.toolAllowlist.length > 0
      ? input.toolAllowlist
      : (input.grantedPermissions ?? undefined);

  // R8 (U8): script-kind tools must pass the SkillSpector-class trust
  // gate BEFORE signing, so the trust verdict rides the same signature
  // as the rest of the sidecar. Non-script kinds skip the scan.
  let trust: Record<string, unknown> | undefined;
  if (klass === "tool") {
    const [{ readCapabilityDefinitionKind }, { runScriptToolTrustGate }] =
      await Promise.all([
        import("../../../lib/capabilities/definition-kind.js"),
        import("../../../lib/capabilities/script-trust.js"),
      ]);
    const kind = await readCapabilityDefinitionKind({
      targetPrefix: target.targetPrefix,
      slug,
    });
    if (kind === "script") {
      const gate = await runScriptToolTrustGate({
        targetPrefix: target.targetPrefix,
        slug,
      });
      if (!gate.ok) {
        throw new GraphQLError(
          `script tool '${slug}' failed the trust gate: ${gate.reason}${gate.detail ? ` — ${gate.detail}` : ""}`,
          { extensions: { code: "TRUST_GATE_FAILED" } },
        );
      }
      trust = gate.trust as unknown as Record<string, unknown>;
    }
  }

  const signed = await signExistingCapabilityFolder({
    targetPrefix: target.targetPrefix,
    klass,
    slug,
    sidecar: {
      enabled: true,
      ...(operations ? { permissions: { operations } } : {}),
      ...(trust ? { trust } : {}),
    },
    signedBy,
  });
  if (!signed.ok) {
    if (signed.reason === "definition_missing") {
      throw notFound(
        `no ${klass} definition folder '${klass}s/${slug}/' exists in the agent workspace — author (or let the agent draft) the definition first; grant signs it`,
      );
    }
    throw new GraphQLError(
      `failed to grant ${klass} '${slug}': ${signed.reason}${signed.detail ? ` (${signed.detail})` : ""}`,
      { extensions: { code: "INTERNAL_SERVER_ERROR" } },
    );
  }
  return {
    outcome: "applied",
    auditEmitted: false,
    itemId: slug,
    audit: {
      eventType: AUDIT_EVENT_TYPES[klass].grant,
      before: { registered: false },
      after: {
        registered: true,
        signedBy,
        permissions: operations ?? null,
      },
    },
  };
}

// ─── mcp_server @ profile: agents/<slug>/connectors/<child>/ grant folder ──
// (subagent-folders U11 — grants are folder presence with a platform-
// signed sidecar; agent_profiles.tool_policy.mcpServers is retired. The
// root grant's effective surface applies — no per-child narrowing here.)

async function mcpProfileMutation(
  mode: MutationMode,
  input: CapabilityMutationGqlInput,
  signedBy: `operator:${string}`,
): Promise<ClassOutcome> {
  const {
    agentChildGrantExists,
    putAgentChildGrantSidecar,
    removeAgentChildGrantSidecar,
  } = await import("../../../lib/capabilities/folder-write.js");
  if (input.toolAllowlist && input.toolAllowlist.length > 0) {
    throw badInput(
      "per-server tool allowlists live on the agent-level server assignment and pass through to profiles — grant the allowlist at agent scope",
    );
  }
  const server = await resolveTenantMcpServer(
    input.tenantId,
    input.capabilityRef.trim(),
  );
  const slug = server.slug ?? server.name;

  const profile = await requireProfileFolder(
    input.tenantId,
    input.agentProfileId,
  );
  const target = await resolveAgentTarget(input.tenantId, input.agentId);
  const grantInput = {
    targetPrefix: target.targetPrefix,
    agentProfileSlug: profile.slug,
    childClass: "connection" as const,
    slug,
  };
  const exists = await agentChildGrantExists(grantInput);
  if (exists === null) throw new Error("WORKSPACE_BUCKET is not configured");
  if (mode === "grant" ? exists : !exists) {
    return { outcome: "noop", auditEmitted: false, itemId: slug };
  }
  const result =
    mode === "grant"
      ? await putAgentChildGrantSidecar({ ...grantInput, signedBy })
      : await removeAgentChildGrantSidecar(grantInput);
  if (!result.ok) {
    throw new Error(
      `agent-profile mcp_server ${mode} failed: ${result.reason}${
        "detail" in result && result.detail ? ` (${result.detail})` : ""
      }`,
    );
  }
  return {
    outcome: "applied",
    auditEmitted: false,
    itemId: slug,
    audit: {
      eventType: AUDIT_EVENT_TYPES.mcp_server[mode],
      before: { granted: mode !== "grant" },
      after: { granted: mode === "grant" },
    },
  };
}

// ─── pi_extension: delegate to THINK-114's assignment mutation ──────────────

async function piExtensionMutation(
  mode: MutationMode,
  input: CapabilityMutationGqlInput,
  scope: CapabilityGrantScope,
  ctx: GraphQLContext,
): Promise<ClassOutcome> {
  const versionId = input.capabilityRef.trim();
  const targetType = scope === "agent" ? "default_agent" : "agent_profile";

  // Pre-read for no-op detection + before-state — the delegate's
  // enabled:false path updates zero rows silently on an absent assignment.
  const [existing] = await db
    .select({
      id: piExtensionAssignments.id,
      enabled: piExtensionAssignments.enabled,
      granted_permissions: piExtensionAssignments.granted_permissions,
    })
    .from(piExtensionAssignments)
    .where(
      and(
        eq(piExtensionAssignments.tenant_id, input.tenantId),
        eq(piExtensionAssignments.version_id, versionId),
        eq(piExtensionAssignments.target_type, targetType),
        ...(targetType === "agent_profile"
          ? [
              eq(
                piExtensionAssignments.agent_profile_id,
                input.agentProfileId ?? "",
              ),
            ]
          : []),
      ),
    )
    .limit(1);

  if (mode === "detach" && (!existing || !existing.enabled)) {
    return { outcome: "noop", auditEmitted: true, itemId: existing?.id };
  }
  if (
    mode === "grant" &&
    existing?.enabled &&
    input.grantedPermissions == null
  ) {
    return { outcome: "noop", auditEmitted: true, itemId: existing.id };
  }

  // Adapt, don't fork (plan assumption): the THINK-114 mutation owns the
  // assignment semantics (version assignability, space-local rejection,
  // prior-version disable, permission normalization) AND its transaction —
  // so the audit event is emitted right after it commits, not inside it.
  await updatePiExtensionAssignment(
    null,
    {
      input: {
        tenantId: input.tenantId,
        versionId,
        targetType,
        agentProfileId:
          targetType === "agent_profile" ? input.agentProfileId : null,
        enabled: mode === "grant",
        // The delegate's normalizeGrantedPermissions expects the THINK-114
        // object shape { permissionClasses } — a bare array is rejected.
        grantedPermissions: input.grantedPermissions
          ? { permissionClasses: input.grantedPermissions }
          : undefined,
      },
    },
    ctx,
  );

  const [assignment] = await db
    .select({
      id: piExtensionAssignments.id,
      granted_permissions: piExtensionAssignments.granted_permissions,
    })
    .from(piExtensionAssignments)
    .where(
      and(
        eq(piExtensionAssignments.tenant_id, input.tenantId),
        eq(piExtensionAssignments.version_id, versionId),
        eq(piExtensionAssignments.target_type, targetType),
        ...(targetType === "agent_profile"
          ? [
              eq(
                piExtensionAssignments.agent_profile_id,
                input.agentProfileId ?? "",
              ),
            ]
          : []),
      ),
    )
    .limit(1);

  return {
    outcome: "applied",
    auditEmitted: false,
    itemId: assignment?.id ?? existing?.id ?? null,
    audit: {
      eventType: AUDIT_EVENT_TYPES.pi_extension[mode],
      before: existing
        ? {
            enabled: existing.enabled,
            grantedPermissions: existing.granted_permissions ?? null,
          }
        : { enabled: false },
      after: {
        enabled: mode === "grant",
        grantedPermissions:
          mode === "grant" ? (assignment?.granted_permissions ?? null) : null,
      },
    },
  };
}

// ─── Shared driver ──────────────────────────────────────────────────────────

async function executeCapabilityMutation(
  mode: MutationMode,
  rawInput: CapabilityMutationGqlInput,
  ctx: GraphQLContext,
): Promise<CapabilityMutationResultOut> {
  await requireAdminOrServiceCaller(
    ctx,
    rawInput.tenantId,
    "capabilities:grant",
  );
  const capabilityClass = normalizeClass(rawInput.capabilityClass);
  const scope = normalizeScope(rawInput.scope);

  // R2: the matrix decides before anything is read or written.
  try {
    assertAssignableCell(capabilityClass, scope);
  } catch (err) {
    if (err instanceof CapabilityMatrixViolationError) {
      throw matrixViolation(err);
    }
    throw err;
  }

  const actorId = (await resolveCallerUserId(ctx)) ?? "service";
  const agentTarget =
    scope === "agent"
      ? await resolveAgentTarget(rawInput.tenantId, rawInput.agentId)
      : null;

  const auditBase = (spec: AuditSpec) => ({
    tenantId: rawInput.tenantId,
    actorId,
    actorType: (actorId === "service" ? "system" : "user") as "system" | "user",
    eventType: spec.eventType,
    source: "graphql" as const,
    resourceType: "capability_assignment",
    resourceId: `${capabilityClass}:${scope}:${rawInput.capabilityRef}`,
    action: mode,
    outcome: "success",
    agentId: agentTarget?.agentId,
    payload: {
      capabilityClass,
      scope,
      capabilityRef: rawInput.capabilityRef,
      agentId: agentTarget?.agentId ?? null,
      agentProfileId: rawInput.agentProfileId ?? null,
      before: spec.before,
      after: spec.after,
    },
  });

  let result: ClassOutcome;
  if (capabilityClass === "skill" && scope === "agent") {
    result = await skillAgentMutation(mode, rawInput, agentTarget!);
  } else if (capabilityClass === "skill") {
    result = await skillProfileMutation(mode, rawInput, `operator:${actorId}`);
  } else if (capabilityClass === "mcp_server" && scope === "agent") {
    result = await mcpAgentMutation(
      mode,
      rawInput,
      agentTarget!,
      auditBase,
      `operator:${actorId}`,
    );
  } else if (capabilityClass === "mcp_server") {
    result = await mcpProfileMutation(mode, rawInput, `operator:${actorId}`);
  } else if (capabilityClass === "connection" || capabilityClass === "tool") {
    result = await folderCapabilityMutation(
      mode,
      rawInput,
      agentTarget!,
      capabilityClass,
      `operator:${actorId}`,
    );
  } else {
    result = await piExtensionMutation(mode, rawInput, scope, ctx);
  }

  // Applied writes whose class handler could not emit in-transaction get
  // their event now, in a dedicated transaction. A failure here is loud —
  // the grant landed, so losing its trail must not be silent.
  if (result.outcome === "applied" && !result.auditEmitted && result.audit) {
    await db.transaction(async (tx) => {
      await emitAuditEvent(tx, auditBase(result.audit!));
    });
  }

  // R12 substrate: recompute the selection through the U3 inspector and
  // return the touched item's fresh state.
  const inspection = await capabilityInspector(
    null,
    {
      tenantId: rawInput.tenantId,
      agentId: scope === "agent" ? (agentTarget?.agentId ?? null) : null,
      agentProfileId:
        scope === "agent_profile" ? (rawInput.agentProfileId ?? null) : null,
    },
    ctx,
  );

  const itemId = result.itemId ?? rawInput.capabilityRef;
  const itemClass = capabilityClass;
  const items =
    (inspection.predicted?.items as
      | Array<{ capabilityClass: string; capabilityId: string }>
      | undefined) ?? [];
  const item =
    items.find(
      (candidate) =>
        candidate.capabilityClass === itemClass &&
        (candidate.capabilityId === itemId ||
          candidate.capabilityId === rawInput.capabilityRef),
    ) ?? null;
  if (!item && result.outcome === "applied" && mode === "grant") {
    console.warn(
      `${LOG_PREFIX} grant applied but the inspector shows no ${itemClass} row for '${itemId}' — S3 materialization may still be syncing`,
    );
  }

  return {
    outcome: result.outcome,
    item,
    computedAt: inspection.predicted?.computedAt ?? new Date().toISOString(),
    configFingerprint: inspection.predicted?.configFingerprint ?? null,
    inspectionState: inspection.state,
  };
}

export async function grantCapability(
  _parent: unknown,
  args: { input: CapabilityMutationGqlInput },
  ctx: GraphQLContext,
): Promise<CapabilityMutationResultOut> {
  return executeCapabilityMutation("grant", args.input, ctx);
}

export async function detachCapability(
  _parent: unknown,
  args: { input: CapabilityMutationGqlInput },
  ctx: GraphQLContext,
): Promise<CapabilityMutationResultOut> {
  return executeCapabilityMutation("detach", args.input, ctx);
}

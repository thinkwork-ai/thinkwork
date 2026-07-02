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
 *   - skill @ profile        → `agent_profiles.skill_policy.skillSlugs`;
 *   - mcp_server @ agent     → `agent_mcp_servers` upsert/delete;
 *   - mcp_server @ profile   → `agent_profiles.tool_policy.mcpServers`
 *                              (slugs only — the per-server allowlist passes
 *                              through from the agent-level server config);
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
  agentProfiles,
  skillCatalog,
  tenantMcpServers,
} from "../../utils.js";
import {
  agentMcpServers,
  piExtensionAssignments,
} from "@thinkwork/database-pg/schema";
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

interface ProfileRow {
  id: string;
  slug: string;
  source_space_id: string | null;
  tool_policy: Record<string, unknown>;
  skill_policy: Record<string, unknown>;
}

async function requireCentralProfile(
  client: Pick<typeof db, "select">,
  tenantId: string,
  agentProfileId: string | null | undefined,
): Promise<ProfileRow> {
  if (!agentProfileId) {
    throw badInput("agent-profile scope requires agentProfileId");
  }
  const [profile] = await client
    .select({
      id: agentProfiles.id,
      slug: agentProfiles.slug,
      source_space_id: agentProfiles.source_space_id,
      tool_policy: agentProfiles.tool_policy,
      skill_policy: agentProfiles.skill_policy,
    })
    .from(agentProfiles)
    .where(
      and(
        eq(agentProfiles.id, agentProfileId),
        eq(agentProfiles.tenant_id, tenantId),
      ),
    )
    .limit(1);
  if (!profile) throw notFound("agent profile not found in tenant");
  if (profile.source_space_id != null) {
    throw badInput(
      "space-local agent profiles are file-authoritative — edit the Space source's agents/ folder instead",
    );
  }
  return profile as ProfileRow;
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
    const { installCatalogSkill, CatalogInstallError } =
      await import("../../../lib/catalog-install.js");
    let wiringChoice = input.wiringChoice?.trim() ?? "";
    if (!wiringChoice) {
      // Default to the skill's first WIRING.md suggestion (the eval-install
      // convention) so simple grants need no wiring knowledge.
      const { parseWiringMd } = await import("../../../lib/wiring-md.js");
      const wiringKey = `tenants/${target.tenantSlug}/skill-catalog/${slug}/WIRING.md`;
      let wiringMd: string;
      try {
        const resp = await s3.send(
          new GetObjectCommand({ Bucket: bucket, Key: wiringKey }),
        );
        wiringMd = (await resp.Body?.transformToString()) ?? "";
      } catch {
        throw notFound(
          `catalog skill '${slug}' not found (no WIRING.md in the tenant catalog)`,
        );
      }
      const first = parseWiringMd(wiringMd).suggestions[0];
      if (!first) {
        throw badInput(
          `catalog skill '${slug}' has no wiring suggestions — pass wiringChoice explicitly`,
        );
      }
      wiringChoice = first.id;
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

// ─── skill @ profile: skill_policy.skillSlugs subset ───────────────────────

async function skillProfileMutation(
  mode: MutationMode,
  input: CapabilityMutationGqlInput,
  audit: (spec: AuditSpec) => Parameters<typeof emitAuditEvent>[1],
): Promise<ClassOutcome> {
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

  return db.transaction(async (tx) => {
    const profile = await requireCentralProfile(
      tx,
      input.tenantId,
      input.agentProfileId,
    );
    const skillPolicy = { ...(profile.skill_policy ?? {}) };
    const slugs = normalizeStringArray(skillPolicy.skillSlugs);
    const has = slugs.includes(slug);
    if (mode === "grant" ? has : !has) {
      return { outcome: "noop" as const, auditEmitted: true };
    }
    const nextSlugs =
      mode === "grant"
        ? [...slugs, slug]
        : slugs.filter((entry) => entry !== slug);
    await tx
      .update(agentProfiles)
      .set({
        skill_policy: { ...skillPolicy, skillSlugs: nextSlugs },
        updated_at: new Date(),
      })
      .where(eq(agentProfiles.id, profile.id));
    await emitAuditEvent(
      tx,
      audit({
        eventType: AUDIT_EVENT_TYPES.skill[mode],
        before: { skillSlugs: slugs },
        after: { skillSlugs: nextSlugs },
      }),
    );
    return { outcome: "applied" as const, auditEmitted: true };
  });
}

// ─── mcp_server @ agent: agent_mcp_servers upsert / delete ─────────────────

interface TenantMcpServerRow {
  id: string;
  slug: string | null;
  name: string;
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
): Promise<ClassOutcome> {
  const server = await resolveTenantMcpServer(
    input.tenantId,
    input.capabilityRef.trim(),
  );
  const itemId = server.slug ?? server.name;

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({
        id: agentMcpServers.id,
        enabled: agentMcpServers.enabled,
        config: agentMcpServers.config,
      })
      .from(agentMcpServers)
      .where(
        and(
          eq(agentMcpServers.agent_id, target.agentId),
          eq(agentMcpServers.mcp_server_id, server.id),
        ),
      )
      .limit(1);

    if (mode === "detach") {
      if (!existing) {
        return { outcome: "noop" as const, auditEmitted: true, itemId };
      }
      await tx
        .delete(agentMcpServers)
        .where(eq(agentMcpServers.id, existing.id));
      await emitAuditEvent(
        tx,
        audit({
          eventType: AUDIT_EVENT_TYPES.mcp_server.detach,
          before: {
            assigned: true,
            enabled: existing.enabled,
            config: existing.config ?? null,
          },
          after: { assigned: false },
        }),
      );
      return { outcome: "applied" as const, auditEmitted: true, itemId };
    }

    const nextConfig =
      input.toolAllowlist && input.toolAllowlist.length > 0
        ? { toolAllowlist: input.toolAllowlist }
        : ((existing?.config as Record<string, unknown> | null) ?? null);
    if (
      existing?.enabled &&
      JSON.stringify(existing.config ?? null) === JSON.stringify(nextConfig)
    ) {
      return { outcome: "noop" as const, auditEmitted: true, itemId };
    }
    if (existing) {
      await tx
        .update(agentMcpServers)
        .set({ enabled: true, config: nextConfig, updated_at: new Date() })
        .where(eq(agentMcpServers.id, existing.id));
    } else {
      await tx.insert(agentMcpServers).values({
        agent_id: target.agentId,
        tenant_id: input.tenantId,
        mcp_server_id: server.id,
        config: nextConfig,
      });
    }
    await emitAuditEvent(
      tx,
      audit({
        eventType: AUDIT_EVENT_TYPES.mcp_server.grant,
        before: existing
          ? {
              assigned: true,
              enabled: existing.enabled,
              config: existing.config ?? null,
            }
          : { assigned: false },
        after: { assigned: true, enabled: true, config: nextConfig },
      }),
    );
    return { outcome: "applied" as const, auditEmitted: true, itemId };
  });
}

// ─── mcp_server @ profile: tool_policy.mcpServers subset ───────────────────

async function mcpProfileMutation(
  mode: MutationMode,
  input: CapabilityMutationGqlInput,
  audit: (spec: AuditSpec) => Parameters<typeof emitAuditEvent>[1],
): Promise<ClassOutcome> {
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

  return db.transaction(async (tx) => {
    const profile = await requireCentralProfile(
      tx,
      input.tenantId,
      input.agentProfileId,
    );
    const toolPolicy = { ...(profile.tool_policy ?? {}) };
    const slugs = normalizeStringArray(toolPolicy.mcpServers);
    const has = slugs.includes(slug);
    if (mode === "grant" ? has : !has) {
      return { outcome: "noop" as const, auditEmitted: true, itemId: slug };
    }
    const nextSlugs =
      mode === "grant"
        ? [...slugs, slug]
        : slugs.filter((entry) => entry !== slug);
    await tx
      .update(agentProfiles)
      .set({
        tool_policy: { ...toolPolicy, mcpServers: nextSlugs },
        updated_at: new Date(),
      })
      .where(eq(agentProfiles.id, profile.id));
    await emitAuditEvent(
      tx,
      audit({
        eventType: AUDIT_EVENT_TYPES.mcp_server[mode],
        before: { mcpServers: slugs },
        after: { mcpServers: nextSlugs },
      }),
    );
    return { outcome: "applied" as const, auditEmitted: true, itemId: slug };
  });
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
    result = await skillProfileMutation(mode, rawInput, auditBase);
  } else if (capabilityClass === "mcp_server" && scope === "agent") {
    result = await mcpAgentMutation(mode, rawInput, agentTarget!, auditBase);
  } else if (capabilityClass === "mcp_server") {
    result = await mcpProfileMutation(mode, rawInput, auditBase);
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
      Array<{ capabilityClass: string; capabilityId: string }> | undefined) ??
    [];
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

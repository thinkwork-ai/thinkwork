/**
 * capabilityInspector — the effective merged capability set for an
 * agent × Space × Agent Profile × perspective-user selection
 * (capability-mapping plan U3).
 *
 * Composes through the runtime's OWN paths — never a parallel
 * implementation (R8):
 *
 *   - `resolveAgentRuntimeConfig` with `collectDiagnostics` (U1) supplies the
 *     injected config plus every gate's dropped-with-reason rows;
 *   - MCP token resolution runs in probe mode (KTD-1): token status comes
 *     from stored metadata, never a Secrets Manager read or refresh —
 *     inspection must not mutate the state it observes;
 *   - `renderWorkspaceTuple` with `persist: false` (U2) supplies the
 *     effective TOOLS.md policy without writing a byte to S3;
 *   - `resolvePluginGate` supplies per-requester plugin skill exclusions
 *     with the exact fail-closed semantics both dispatch paths use.
 *
 * Perspective semantics (KTD-4): no `perspectiveUserId` = exactly what a
 * scheduled/wakeup turn gets — plugin per-user servers excluded (fail
 * closed), direct OAuth resolved via the agent's human pair, private-Space
 * access via the space-trigger service identity.
 *
 * "Not installed" rows come from a tenant inventory diff (skill catalog +
 * MCP registry) — the diagnostics channel only sees capabilities that
 * entered resolution.
 */

import type { GraphQLContext } from "../../context.js";
import {
  db,
  eq,
  and,
  desc,
  isNull,
  agents,
  spaces,
  users,
  agentProfiles,
  skillCatalog,
  tenantMcpServers,
  resolvedCapabilityManifests,
} from "../../utils.js";
import { pluginInstalls } from "@thinkwork/database-pg/schema";
import { requireAdminOrServiceCaller } from "../core/authz.js";
import {
  resolveAgentRuntimeConfig,
  type AgentRuntimeConfig,
} from "../../../lib/resolve-agent-runtime-config.js";
import {
  pluginGateCapabilityDiagnostics,
  type CapabilityDiagnostic,
} from "../../../lib/capability-diagnostics.js";
import { resolvePluginGate } from "../../../lib/plugins/gating.js";
import {
  computeConfigFingerprint,
  fingerprintInputsFromRuntimeConfig,
} from "../../../lib/capability-fingerprint.js";
import { isBuiltinToolSlug } from "../../../lib/builtin-tool-slugs.js";
import { renderWorkspaceTuple } from "../../../lib/workspace-renderer/compose-tuple.js";
import { spaceTriggerServiceIdentity } from "../../../lib/workspace-renderer/space-membership-check.js";
import type { EffectiveWorkspacePolicy } from "../../../lib/workspace-renderer/effective-policy-composer.js";

const LOG_PREFIX = "[capability-inspector]";

export interface CapabilityInspectorArgs {
  tenantId: string;
  agentId?: string | null;
  spaceId?: string | null;
  agentProfileId?: string | null;
  perspectiveUserId?: string | null;
}

interface CapabilityItemOut {
  capabilityClass: string;
  capabilityId: string;
  displayName?: string | null;
  active: boolean;
  provenance?: string | null;
  reason?: string | null;
  detail?: string | null;
  tokenStatus?: string | null;
}

interface CapabilityInspectionOut {
  state: "ok" | "invalid_selection" | "resolution_fault";
  stateDetail?: string | null;
  agentId?: string | null;
  spaceId?: string | null;
  agentProfileId?: string | null;
  perspectiveUserId?: string | null;
  noUserBaseline: boolean;
  predicted?: {
    variant: "PREDICTED";
    computedAt: string;
    configFingerprint: string;
    items: CapabilityItemOut[];
  } | null;
  observed?: {
    variant: "OBSERVED";
    computedAt: string;
    configFingerprint: string;
    items: CapabilityItemOut[];
  } | null;
  divergence?: {
    state:
      "no_manifest_yet" | "config_changed_since_turn" | "in_sync" | "divergent";
    manifestId?: string | null;
    manifestCreatedAt?: string | null;
    manifestFingerprint?: string | null;
    deltas?: Array<{
      capabilityClass: string;
      capabilityId: string;
      kind: "missing_in_observed" | "extra_in_observed";
    }> | null;
  } | null;
}

/**
 * U13: project the latest matching turn's capability manifest into the
 * shared EffectiveCapabilitySet shape (KTD-9) and compute the divergence
 * state. Divergence is asserted ONLY on fingerprint equality (KTD-3).
 *
 * Comparison covers the classes whose vocabularies align between the
 * predicted set and the container's loaded record: skills, MCP servers, and
 * Pi extensions. Built-in tools are excluded — the container reports host
 * tool names (bash, file_read, ...) while prediction speaks catalog slugs.
 */
async function loadObservedAndDivergence(args: {
  tenantId: string;
  agentId: string;
  spaceId: string | null;
  agentProfileId: string | null;
  predictedFingerprint: string;
  predictedItems: CapabilityItemOut[];
}): Promise<{
  observed: CapabilityInspectionOut["observed"];
  divergence: NonNullable<CapabilityInspectionOut["divergence"]>;
}> {
  const predicates = [
    eq(resolvedCapabilityManifests.tenant_id, args.tenantId),
    eq(resolvedCapabilityManifests.agent_id, args.agentId),
    args.spaceId
      ? eq(resolvedCapabilityManifests.space_id, args.spaceId)
      : isNull(resolvedCapabilityManifests.space_id),
    args.agentProfileId
      ? eq(resolvedCapabilityManifests.agent_profile_id, args.agentProfileId)
      : isNull(resolvedCapabilityManifests.agent_profile_id),
  ];
  const [row] = await db
    .select()
    .from(resolvedCapabilityManifests)
    .where(and(...predicates))
    .orderBy(desc(resolvedCapabilityManifests.created_at))
    .limit(1);

  if (!row) {
    return { observed: null, divergence: { state: "no_manifest_yet" } };
  }

  const manifest = (row.manifest_json ?? {}) as Record<string, unknown>;
  const section = (name: string): Record<string, unknown> =>
    manifest[name] && typeof manifest[name] === "object"
      ? (manifest[name] as Record<string, unknown>)
      : {};
  const stringList = (value: unknown): string[] =>
    Array.isArray(value)
      ? value.filter((entry): entry is string => typeof entry === "string")
      : [];
  const loaded = section("loaded");
  const gated = Array.isArray(manifest.gated) ? manifest.gated : [];

  const observedItems: CapabilityItemOut[] = [
    ...stringList(loaded.skills).map((skillId) => ({
      capabilityClass: "skill",
      capabilityId: skillId,
      active: true,
    })),
    ...stringList(loaded.builtInTools).map((tool) => ({
      capabilityClass: "builtin_tool",
      capabilityId: tool,
      active: true,
    })),
    ...stringList(loaded.mcpServers).map((server) => ({
      capabilityClass: "mcp_server",
      capabilityId: server,
      active: true,
    })),
    ...stringList(loaded.piExtensions).map((extension) => ({
      capabilityClass: "pi_extension",
      capabilityId: extension,
      active: true,
    })),
    ...gated.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const record = entry as Record<string, unknown>;
      if (
        typeof record.capabilityClass !== "string" ||
        typeof record.capabilityId !== "string"
      ) {
        return [];
      }
      return [
        {
          capabilityClass: record.capabilityClass,
          capabilityId: record.capabilityId,
          active: false,
          reason: typeof record.reason === "string" ? record.reason : null,
          detail: typeof record.detail === "string" ? record.detail : null,
        },
      ];
    }),
  ];

  const observed = {
    variant: "OBSERVED" as const,
    computedAt: row.created_at.toISOString(),
    configFingerprint: row.config_fingerprint ?? "",
    items: observedItems,
  };

  if (
    !row.config_fingerprint ||
    row.config_fingerprint !== args.predictedFingerprint
  ) {
    return {
      observed,
      divergence: {
        state: "config_changed_since_turn",
        manifestId: row.id,
        manifestCreatedAt: observed.computedAt,
        manifestFingerprint: row.config_fingerprint ?? null,
      },
    };
  }

  const COMPARED_CLASSES = ["skill", "mcp_server", "pi_extension"];
  const observedActive = new Set(
    observedItems
      .filter(
        (item) =>
          item.active && COMPARED_CLASSES.includes(item.capabilityClass),
      )
      .map((item) => `${item.capabilityClass} ${item.capabilityId}`),
  );
  const predictedActive = new Set(
    args.predictedItems
      .filter(
        (item) =>
          item.active && COMPARED_CLASSES.includes(item.capabilityClass),
      )
      .map((item) => `${item.capabilityClass} ${item.capabilityId}`),
  );
  const deltas: NonNullable<
    NonNullable<CapabilityInspectionOut["divergence"]>["deltas"]
  > = [];
  for (const key of predictedActive) {
    if (!observedActive.has(key)) {
      const [capabilityClass, capabilityId] = key.split(" ");
      deltas.push({
        capabilityClass,
        capabilityId,
        kind: "missing_in_observed",
      });
    }
  }
  for (const key of observedActive) {
    if (!predictedActive.has(key)) {
      const [capabilityClass, capabilityId] = key.split(" ");
      deltas.push({ capabilityClass, capabilityId, kind: "extra_in_observed" });
    }
  }

  return {
    observed,
    divergence: {
      state: deltas.length === 0 ? "in_sync" : "divergent",
      manifestId: row.id,
      manifestCreatedAt: observed.computedAt,
      manifestFingerprint: row.config_fingerprint,
      deltas: deltas.length > 0 ? deltas : null,
    },
  };
}

export async function capabilityInspector(
  _parent: unknown,
  args: CapabilityInspectorArgs,
  ctx: GraphQLContext,
): Promise<CapabilityInspectionOut> {
  await requireAdminOrServiceCaller(ctx, args.tenantId, "capabilities:read");

  const perspectiveUserId = args.perspectiveUserId ?? null;
  const noUserBaseline = !perspectiveUserId;
  const invalid = (detail: string): CapabilityInspectionOut => ({
    state: "invalid_selection",
    stateDetail: detail,
    agentId: args.agentId ?? null,
    spaceId: args.spaceId ?? null,
    agentProfileId: args.agentProfileId ?? null,
    perspectiveUserId,
    noUserBaseline,
    predicted: null,
  });

  // ── Selection resolution — every id must belong to the caller's tenant.
  // Cross-tenant ids fail closed as invalid_selection without confirming
  // whether the foreign row exists.
  let agentId = args.agentId ?? null;
  if (agentId) {
    const [agent] = await db
      .select({ id: agents.id })
      .from(agents)
      .where(and(eq(agents.id, agentId), eq(agents.tenant_id, args.tenantId)))
      .limit(1);
    if (!agent) return invalid("agent not found in tenant");
  } else {
    const [platformAgent] = await db
      .select({ id: agents.id })
      .from(agents)
      .where(
        and(
          eq(agents.tenant_id, args.tenantId),
          eq(agents.is_platform_default, true),
        ),
      )
      .limit(1);
    if (!platformAgent) {
      return invalid("tenant has no platform default agent");
    }
    agentId = platformAgent.id;
  }

  let spaceRow: { id: string; name: string } | null = null;
  if (args.spaceId) {
    const [space] = await db
      .select({ id: spaces.id, name: spaces.name })
      .from(spaces)
      .where(
        and(eq(spaces.id, args.spaceId), eq(spaces.tenant_id, args.tenantId)),
      )
      .limit(1);
    if (!space) return invalid("space not found in tenant");
    spaceRow = space;
  }

  let selectedProfile: { id: string; slug: string; name: string } | null = null;
  if (args.agentProfileId) {
    const [profile] = await db
      .select({
        id: agentProfiles.id,
        slug: agentProfiles.slug,
        name: agentProfiles.name,
      })
      .from(agentProfiles)
      .where(
        and(
          eq(agentProfiles.id, args.agentProfileId),
          eq(agentProfiles.tenant_id, args.tenantId),
        ),
      )
      .limit(1);
    if (!profile) return invalid("agent profile not found in tenant");
    selectedProfile = profile;
  }

  if (perspectiveUserId) {
    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.id, perspectiveUserId),
          eq(users.tenant_id, args.tenantId),
        ),
      )
      .limit(1);
    if (!user) return invalid("perspective user not found in tenant");
  }

  // ── Compose through the runtime's own resolver (U1 diagnostics, probe
  // tokens). A thrown resolution is a first-class fault state, not a 500.
  let config: AgentRuntimeConfig;
  try {
    config = await resolveAgentRuntimeConfig({
      tenantId: args.tenantId,
      agentId,
      spaceId: args.spaceId ?? null,
      currentUserId: perspectiveUserId ?? undefined,
      allowHumanPairEmailFallback: true,
      collectDiagnostics: true,
      mcpTokenMode: "probe",
      logPrefix: LOG_PREFIX,
    });
  } catch (err) {
    return {
      state: "resolution_fault",
      stateDetail: err instanceof Error ? err.message : String(err),
      agentId,
      spaceId: args.spaceId ?? null,
      agentProfileId: args.agentProfileId ?? null,
      perspectiveUserId,
      noUserBaseline,
      predicted: null,
    };
  }
  const diagnostics = config.capabilityDiagnostics ?? [];

  // Selected profile must be visible in the resolution (active or dropped
  // with a reason). A profile that is neither — e.g. assigned to a different
  // Space than the selected one — is an invalid selection (KTD-4).
  const activeProfile = selectedProfile
    ? (config.agentProfilesConfig.find(
        (profile) => profile.id === selectedProfile.id,
      ) ?? null)
    : null;
  const selectedProfileDrops = selectedProfile
    ? diagnostics.filter(
        (drop) =>
          drop.capabilityClass === "agent_profile" &&
          drop.capabilityId === selectedProfile.slug,
      )
    : [];
  if (selectedProfile && !activeProfile && selectedProfileDrops.length === 0) {
    return invalid(
      "agent profile is not part of this selection's resolution (is it assigned to the selected Space?)",
    );
  }

  // ── Renderer half (U2 seam): effective TOOLS.md policy, zero writes.
  // Failures degrade to a policy-less view rather than failing inspection.
  let effectivePolicy: EffectiveWorkspacePolicy | null = null;
  if (args.spaceId) {
    try {
      const rendered = await renderWorkspaceTuple(
        {
          tenantId: args.tenantId,
          agentId,
          spaceId: args.spaceId,
          userId: perspectiveUserId,
          invokingServiceIdentity: noUserBaseline
            ? spaceTriggerServiceIdentity({
                tenantId: args.tenantId,
                spaceId: args.spaceId,
              })
            : null,
          agentBlockedTools: config.blockedTools,
        },
        { persist: false },
      );
      effectivePolicy = rendered.effectivePolicy;
    } catch (err) {
      console.warn(`${LOG_PREFIX} read-only render unavailable:`, err);
      diagnostics.push({
        capabilityClass: "context",
        capabilityId: "workspace-policy",
        reason: "resolution_fault",
        detail: `workspace policy unavailable: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  // ── Plugin gate: same module, same fail-closed requester semantics both
  // dispatch paths use.
  const pluginGate = await resolvePluginGate({
    tenantId: args.tenantId,
    requesterUserId: perspectiveUserId,
  });
  const pluginDrops = pluginGateCapabilityDiagnostics(pluginGate);

  // ── Tenant inventory (for not_installed rows + plugin install names).
  const [catalogRows, mcpInventoryRows, pluginInstallRows] = await Promise.all([
    db
      .select({
        slug: skillCatalog.slug,
        display_name: skillCatalog.display_name,
      })
      .from(skillCatalog)
      .where(eq(skillCatalog.tenant_id, args.tenantId)),
    db
      .select({
        slug: tenantMcpServers.slug,
        name: tenantMcpServers.name,
        status: tenantMcpServers.status,
        enabled: tenantMcpServers.enabled,
      })
      .from(tenantMcpServers)
      .where(eq(tenantMcpServers.tenant_id, args.tenantId)),
    db
      .select({
        id: pluginInstalls.id,
        plugin_key: pluginInstalls.plugin_key,
        state: pluginInstalls.state,
      })
      .from(pluginInstalls)
      .where(eq(pluginInstalls.tenant_id, args.tenantId)),
  ]);

  // ── Item construction.
  const items: CapabilityItemOut[] = [];
  const seen = new Set<string>();
  const key = (capabilityClass: string, capabilityId: string) =>
    `${capabilityClass} ${capabilityId}`;
  const push = (item: CapabilityItemOut) => {
    const itemKey = key(item.capabilityClass, item.capabilityId);
    if (seen.has(itemKey)) return;
    seen.add(itemKey);
    items.push(item);
  };
  const diagnosticsByKey = new Map<string, CapabilityDiagnostic[]>();
  for (const drop of diagnostics) {
    const dropKey = key(drop.capabilityClass, drop.capabilityId);
    diagnosticsByKey.set(dropKey, [
      ...(diagnosticsByKey.get(dropKey) ?? []),
      drop,
    ]);
  }

  const provenanceForSkill = (s3Key: string): string => {
    if (s3Key.includes("/spaces/")) return "space: skills folder";
    if (s3Key.includes("/skill-catalog/")) return "agent: catalog default";
    return "agent: workspace folder";
  };

  if (activeProfile) {
    // Profile-scoped view: the selected profile's granted subset.
    const profileLabel = `agent profile ${activeProfile.slug}`;
    const resolvedSkillIds = new Set(
      config.skillsConfig.map((skill) => skill.skillId),
    );
    for (const tool of activeProfile.builtInTools) {
      push({
        capabilityClass: "builtin_tool",
        capabilityId: tool,
        active: true,
        provenance: `${profileLabel}: tool_policy`,
      });
    }
    for (const server of activeProfile.mcpServers) {
      push({
        capabilityClass: "mcp_server",
        capabilityId: server.slug,
        displayName: server.name,
        active: true,
        provenance: `${profileLabel}: tool_policy`,
        detail:
          server.allowedTools.length < server.availableTools.length
            ? `allowed tools: ${server.allowedTools.join(", ")}`
            : null,
      });
    }
    for (const slug of activeProfile.skillSlugs) {
      const available = resolvedSkillIds.has(slug);
      push({
        capabilityClass: "skill",
        capabilityId: slug,
        active: available,
        provenance: `${profileLabel}: skill_policy`,
        reason: available ? null : "not_installed",
        detail: available
          ? null
          : "skill_policy references a skill the agent's resolution does not include (SKILL_NOT_AVAILABLE at runtime)",
      });
    }
    for (const extension of activeProfile.piExtensions) {
      push({
        capabilityClass: "pi_extension",
        capabilityId: extension.assignmentId,
        displayName: extension.displayName ?? extension.name,
        active: true,
        provenance: `${profileLabel}: extension assignment`,
      });
    }
    push({
      capabilityClass: "agent_profile",
      capabilityId: activeProfile.slug,
      displayName: activeProfile.name,
      active: true,
      provenance:
        activeProfile.availability.scope === "global"
          ? "tenant-global profile"
          : "space-restricted profile",
    });
  } else if (selectedProfile) {
    // Selected profile was dropped: the set is its drop-reason rows.
    for (const drop of selectedProfileDrops) {
      push({
        capabilityClass: drop.capabilityClass,
        capabilityId: drop.capabilityId,
        displayName: drop.displayName ?? null,
        active: false,
        reason: drop.reason,
        detail: drop.detail ?? null,
      });
    }
  } else {
    // Full default-agent view.
    for (const skill of config.skillsConfig) {
      const capabilityClass = isBuiltinToolSlug(skill.skillId)
        ? "builtin_tool"
        : "skill";
      const degraded = (
        diagnosticsByKey.get(key("skill", skill.skillId)) ?? []
      ).find((drop) => drop.reason === "oauth_missing");
      push({
        capabilityClass,
        capabilityId: skill.skillId,
        active: true,
        provenance: provenanceForSkill(skill.s3Key),
        detail: degraded?.detail ?? null,
      });
    }
    for (const server of config.mcpConfigs) {
      const blocked = effectivePolicy?.mcpBlockedServers.includes(server.name);
      const allowlistMiss =
        !blocked &&
        Boolean(
          effectivePolicy?.mcpAllowedServers &&
          !effectivePolicy.mcpAllowedServers.includes(server.name),
        );
      push({
        capabilityClass: "mcp_server",
        capabilityId: server.name,
        active: !blocked && !allowlistMiss,
        provenance: "tenant MCP registry",
        reason: blocked
          ? "blocked_by_policy"
          : allowlistMiss
            ? "allowlist_miss"
            : null,
        detail: blocked
          ? "blocked by the effective workspace MCP policy"
          : allowlistMiss
            ? "the effective workspace MCP allowlist omits this server"
            : null,
        tokenStatus: server.tokenStatus ?? null,
      });
    }
    for (const extension of config.piExtensions) {
      push({
        capabilityClass: "pi_extension",
        capabilityId: extension.assignmentId,
        displayName: extension.displayName ?? extension.name,
        active: true,
        provenance: "agent: extension assignment",
      });
    }
    for (const profile of config.agentProfilesConfig) {
      push({
        capabilityClass: "agent_profile",
        capabilityId: profile.slug,
        displayName: profile.name,
        active: true,
        provenance:
          profile.availability.scope === "global"
            ? "tenant-global profile"
            : "space-restricted profile",
      });
      for (const extension of profile.piExtensions) {
        push({
          capabilityClass: "pi_extension",
          capabilityId: extension.assignmentId,
          displayName: extension.displayName ?? extension.name,
          active: true,
          provenance: `agent profile ${profile.slug}: extension assignment`,
        });
      }
    }
    for (const install of pluginInstallRows) {
      const gatedOff =
        pluginGate.hasPluginInstalls &&
        !pluginGate.allowedInstallIds.has(install.id);
      if (!gatedOff) {
        push({
          capabilityClass: "plugin",
          capabilityId: install.plugin_key,
          active: install.state === "installed" || install.state === "active",
          provenance: "tenant plugin install",
          reason: null,
          detail: `install state: ${install.state}`,
        });
      }
    }

    // Every gate drop that didn't merge into an active item renders as an
    // inactive row with its verbatim reason (R6, R9).
    for (const drop of diagnostics) {
      push({
        capabilityClass: drop.capabilityClass,
        capabilityId: drop.capabilityId,
        displayName: drop.displayName ?? null,
        active: false,
        reason: drop.reason,
        detail: drop.detail ?? null,
      });
    }
    for (const drop of pluginDrops) {
      push({
        capabilityClass: drop.capabilityClass,
        capabilityId: drop.capabilityId,
        active: false,
        reason: drop.reason,
        detail: drop.detail ?? null,
        provenance: "plugin activation gate",
      });
    }

    // Inventory diff: catalog skills that never entered resolution.
    const resolvedSkillIds = new Set(
      config.skillsConfig.map((skill) => skill.skillId),
    );
    for (const row of catalogRows) {
      if (resolvedSkillIds.has(row.slug)) continue;
      if (seen.has(key("skill", row.slug))) continue;
      push({
        capabilityClass: "skill",
        capabilityId: row.slug,
        displayName: row.display_name,
        active: false,
        provenance: "tenant catalog",
        reason: "not_installed",
        detail: "in the tenant skill catalog but not installed to this agent",
      });
    }
    const resolvedServerNames = new Set(
      config.mcpConfigs.map((server) => server.name),
    );
    for (const row of mcpInventoryRows) {
      const serverId = row.slug ?? row.name;
      if (resolvedServerNames.has(serverId)) continue;
      if (seen.has(key("mcp_server", serverId))) continue;
      push({
        capabilityClass: "mcp_server",
        capabilityId: serverId,
        displayName: row.name,
        active: false,
        provenance: "tenant MCP registry",
        reason: "not_installed",
        detail: !row.enabled
          ? "server is disabled"
          : row.status !== "approved"
            ? `server status is ${row.status}`
            : "approved and enabled but excluded from this agent's resolution (agent assignment disabled?)",
      });
    }
  }

  items.sort((a, b) =>
    a.capabilityClass === b.capabilityClass
      ? a.capabilityId.localeCompare(b.capabilityId)
      : a.capabilityClass.localeCompare(b.capabilityClass),
  );

  const configFingerprint = computeConfigFingerprint(
    {
      tenantId: args.tenantId,
      agentId,
      spaceId: args.spaceId ?? null,
      agentProfileId: selectedProfile?.id ?? null,
      perspectiveUserId,
    },
    fingerprintInputsFromRuntimeConfig(config),
  );

  // U13: runtime truth beside the prediction, divergence gated on the
  // fingerprint. A lookup fault degrades to "no manifest yet" semantics.
  const { observed, divergence } = await loadObservedAndDivergence({
    tenantId: args.tenantId,
    agentId,
    spaceId: args.spaceId ?? null,
    agentProfileId: selectedProfile?.id ?? null,
    predictedFingerprint: configFingerprint,
    predictedItems: items,
  }).catch((err) => {
    console.warn(`${LOG_PREFIX} manifest lookup failed:`, err);
    return {
      observed: null,
      divergence: { state: "no_manifest_yet" as const },
    };
  });

  return {
    state: "ok",
    stateDetail: null,
    agentId,
    spaceId: spaceRow?.id ?? null,
    agentProfileId: selectedProfile?.id ?? null,
    perspectiveUserId,
    noUserBaseline,
    predicted: {
      variant: "PREDICTED",
      computedAt: new Date().toISOString(),
      configFingerprint,
      items,
    },
    observed,
    divergence,
  };
}

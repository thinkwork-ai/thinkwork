/**
 * Resolved-config fingerprint (capability-mapping plan U3/U12, KTD-3).
 *
 * ONE deterministic hash over the inputs that shape an agent context's
 * effective CAPABILITY set. The inspector stamps it on every predicted set;
 * both dispatch payload builders forward the same value opaquely
 * (`config_fingerprint`) so the runtime's per-turn manifest (U12) carries
 * it; divergence (R15) is asserted only when the two fingerprints match.
 *
 * The input interface is deliberately NARROW — only capability-set-shaping
 * inputs — because the wakeup dispatch path assembles its config piecemeal
 * (it never holds a full AgentRuntimeConfig). A fingerprint mismatch between
 * the inspector and a wakeup turn on identical stored config would indicate
 * real dispatch-parity drift, which is exactly what R15 should surface.
 *
 * Documented input list — settled here per the plan's Open Questions:
 *
 *   IN:  selection identity (tenantId, agentId, spaceId, agentProfileId,
 *        perspective mode: perspectiveUserId or the no-invoker baseline),
 *        blockedTools, skills (skillId + s3Key + secretRef/mcpServer refs —
 *        never env override VALUES), MCP servers (name, url, transport,
 *        sorted allowed + available tools), Pi extensions (assignmentId,
 *        versionId, artifactHash, sorted granted permission classes), and
 *        agent profiles (id, slug, modelId, sorted builtInTools/skillSlugs,
 *        mcpToolAllowlist, availability scope, extension assignment ids).
 *
 *   OUT: thread-scoped sources (thread goal/notes files — per-thread content,
 *        not capability config), env override VALUES (rotating tokens must
 *        not change config identity), OAuth token statuses/expiries,
 *        computedAt, diagnostics rows (derived, not input), and
 *        model/guardrail/budget governance (they shape behavior, not the
 *        capability set; capability-visible effects like an injected
 *        web-search skill already appear through `skills`).
 */

import { createHash } from "node:crypto";
import type { AgentRuntimeConfig } from "./resolve-agent-runtime-config.js";

export const CAPABILITY_FINGERPRINT_VERSION = 2;

export interface CapabilityFingerprintSelection {
  tenantId: string;
  agentId: string;
  spaceId: string | null;
  agentProfileId: string | null;
  perspectiveUserId: string | null;
}

/** The narrow, path-agnostic capability inputs the fingerprint hashes. */
export interface CapabilityFingerprintInputs {
  blockedTools: string[];
  skills: Array<{
    skillId: string;
    s3Key: string;
    secretRef?: string | null;
    mcpServer?: string | null;
  }>;
  mcpServers: Array<{
    name: string;
    url: string;
    transport?: string | null;
    tools?: string[] | null;
    availableTools?: string[] | null;
  }>;
  piExtensions: Array<{
    assignmentId: string;
    versionId: string;
    artifactHash: string;
    grantedPermissionClasses: string[];
  }>;
  agentProfiles: Array<{
    id: string;
    slug: string;
    modelId: string;
    builtInTools: string[];
    skillSlugs: string[];
    mcpToolAllowlist: Record<string, string[]>;
    availabilityScope: string;
    piExtensionAssignmentIds: string[];
  }>;
}

/** Project a full resolved runtime config onto the fingerprint inputs. */
export function fingerprintInputsFromRuntimeConfig(
  config: AgentRuntimeConfig,
): CapabilityFingerprintInputs {
  return {
    blockedTools: config.blockedTools ?? [],
    skills: (config.skillsConfig ?? []).map((skill) => ({
      skillId: skill.skillId,
      s3Key: skill.s3Key,
      secretRef: skill.secretRef ?? null,
      mcpServer: skill.mcpServer ?? null,
    })),
    mcpServers: (config.mcpConfigs ?? []).map((server) => ({
      name: server.name,
      url: server.url,
      transport: server.transport ?? null,
      tools: server.tools ?? null,
      availableTools: server.availableTools ?? null,
    })),
    piExtensions: (config.piExtensions ?? []).map((extension) => ({
      assignmentId: extension.assignmentId,
      versionId: extension.versionId,
      artifactHash: extension.artifactHash,
      grantedPermissionClasses: extension.grantedPermissionClasses,
    })),
    agentProfiles: (config.agentProfilesConfig ?? []).map((profile) => ({
      id: profile.id,
      slug: profile.slug,
      modelId: profile.modelId,
      builtInTools: profile.builtInTools,
      skillSlugs: profile.skillSlugs,
      mcpToolAllowlist: profile.mcpToolAllowlist,
      availabilityScope: profile.availability?.scope ?? "global",
      piExtensionAssignmentIds: (profile.piExtensions ?? []).map(
        (extension) => extension.assignmentId,
      ),
    })),
  };
}

export function computeConfigFingerprint(
  selection: CapabilityFingerprintSelection,
  inputs: CapabilityFingerprintInputs,
): string {
  const canonical = {
    v: CAPABILITY_FINGERPRINT_VERSION,
    selection: {
      tenantId: selection.tenantId,
      agentId: selection.agentId,
      spaceId: selection.spaceId,
      agentProfileId: selection.agentProfileId,
      perspective: selection.perspectiveUserId ?? "__no_invoker_baseline__",
    },
    blockedTools: [...inputs.blockedTools].sort(),
    skills: inputs.skills
      .map((skill) => ({
        skillId: skill.skillId,
        s3Key: skill.s3Key,
        secretRef: skill.secretRef ?? null,
        mcpServer: skill.mcpServer ?? null,
      }))
      .sort((a, b) => a.skillId.localeCompare(b.skillId)),
    mcpServers: inputs.mcpServers
      .map((server) => ({
        name: server.name,
        url: server.url,
        transport: server.transport ?? null,
        tools: [...(server.tools ?? [])].sort(),
        availableTools: [...(server.availableTools ?? [])].sort(),
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    piExtensions: inputs.piExtensions
      .map((extension) => ({
        assignmentId: extension.assignmentId,
        versionId: extension.versionId,
        artifactHash: extension.artifactHash,
        granted: [...extension.grantedPermissionClasses].sort(),
      }))
      .sort((a, b) => a.assignmentId.localeCompare(b.assignmentId)),
    agentProfiles: inputs.agentProfiles
      .map((profile) => ({
        id: profile.id,
        slug: profile.slug,
        modelId: profile.modelId,
        builtInTools: [...profile.builtInTools].sort(),
        skillSlugs: [...profile.skillSlugs].sort(),
        mcpToolAllowlist: Object.fromEntries(
          Object.entries(profile.mcpToolAllowlist)
            .map(([slug, tools]) => [slug, [...tools].sort()] as const)
            .sort(([a], [b]) => a.localeCompare(b)),
        ),
        availabilityScope: profile.availabilityScope,
        piExtensions: [...profile.piExtensionAssignmentIds].sort(),
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
  return createHash("sha256")
    .update(JSON.stringify(canonical), "utf8")
    .digest("hex");
}

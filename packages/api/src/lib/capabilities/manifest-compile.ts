/**
 * Capabilities manifest compiler (THINK-173 plan U2 — R9, R10, R18;
 * KTD-1, KTD-5).
 *
 * Compiles the agent workspace's capability state — Pi built-ins,
 * installed skills, `connections/<slug>/` folders, and `tools/<slug>/`
 * folders — into one manifest the runtime registers from and Composer
 * reads. Entries that fail signature, drift, collision, approval, or
 * trust checks land in the `withheld` section with a typed reason
 * (Composer renders these; the runtime ignores them).
 *
 * The manifest is content-addressed (KTD-1): `fingerprint` hashes only
 * the meaningful body (version + agent + active + withheld), so the
 * `capabilities/<fingerprint>.json` key changes iff the capability
 * surface changes. `input_signature` hashes the compile INPUTS that are
 * known without reading definition bytes (object keys + etags, skill
 * entries, extension names) — the renderer uses it to skip
 * recompilation entirely when nothing capability-shaped changed
 * (KTD-7's no-read-amplification guarantee).
 *
 * Collision pass (R10/KTD-5): builtins, platform-kind declarations,
 * extension-kind declarations, bindings, and scripts all pass through
 * the shared registry from @thinkwork/pi-runtime-core. Dynamically
 * loaded extensions that have no folder declaration are not visible at
 * render time; the runtime's second-line check (U6) covers them.
 */

import { createHash } from "node:crypto";
import { filesEtagSignature } from "./script-trust.js";
import {
  BUILTIN_TOOL_NAMES,
  resolveToolNameClaims,
  type CapabilityToolSource,
  type ToolNameClaim,
} from "@thinkwork/pi-runtime-core";
import {
  parseConnectionDefinition,
  parseToolDefinition,
  parseCapabilitySidecar,
  type CapabilityAssignmentSidecar,
  type ConnectionDefinition,
  type ToolDefinition,
  type ToolKind,
} from "./definition-schemas.js";
import {
  canonicalizePayload,
  verifyCapabilitySidecar,
  type CapabilitySignatureEnvelope,
  type CapabilitySigner,
  type CapabilityVerifier,
} from "./sidecar-signing.js";
import {
  applyAgentFolderSidecar,
  parseAgentFolderInstructions,
  type AgentFolderConfig,
} from "../agent-folder-format.js";

export const CAPABILITIES_MANIFEST_VERSION = 1;
/**
 * Compiler behavior revision — part of the INPUT signature only (never
 * the manifest body). Bump when compile logic changes so previously
 * rendered manifests recompile even though no capability file changed
 * (e.g. rev 2: capability slugs allow consecutive hyphens, fixing the
 * plugin-namespaced `<key>--<slug>` backfill folders that compiled as
 * invalid_definition under rev 1).
 */
// rev 3: connection entries carry the signed sidecar `policy` block
// (THINK-229 U3) — previously rendered manifests must recompile so the
// block reaches dispatch.
// rev 4: agents/<slug>/ folders are admitted as class "agent" entries
// (subagent-folders U4) — previously rendered manifests must recompile
// so existing agent folders reach the manifest.
export const CAPABILITY_COMPILE_REVISION = 4;
export const CAPABILITIES_LATEST_PATH = "capabilities.json";

export function capabilitiesManifestPath(fingerprint: string): string {
  return `capabilities/${fingerprint}.json`;
}

export type WithheldReason =
  | "unsigned"
  | "invalid_signature"
  | "definition_drift"
  | "invalid_definition"
  | "collision"
  | "approval_gated"
  | "disabled"
  | "trust_gate"
  | "missing_connection"
  | "operation_not_permitted"
  | "policy_blocked"
  | "nested_agent_folder";

export interface CapabilityManifestEntry {
  /** Tool-registration name (definition `name`; slug for connections). */
  name: string;
  /** Folder slug (identity). */
  slug: string;
  class: "builtin" | "skill" | "connection" | "tool" | "agent";
  description?: string;
  /** Tool entries only. */
  kind?: ToolKind;
  target?: string;
  connection?: string;
  operation?: string;
  presetArgs?: Record<string, unknown>;
  output?: { model?: string; thread?: string };
  platformTool?: string;
  extension?: string;
  extensionTool?: string;
  entry?: string;
  /** Connection entries only. */
  type?: string;
  url?: string;
  principalType?: string;
  operations?: string[];
  permittedOperations?: string[] | null;
  /** Sidecar credential wiring — references only, never values (R2). */
  credentialRefs?: Record<string, unknown>;
  /**
   * Signed sidecar policy block (THINK-229 U3): budgets, retain_sql,
   * reserved role_tier — carried through so dispatch can shadow-compare
   * and (post-flip) enforce from the sidecar source.
   */
  policy?: Record<string, unknown>;
  /** Agent entries only (subagent-folders U4). */
  model?: string;
  execution?: Record<string, unknown>;
  /**
   * Etag of the compiled INSTRUCTIONS.md (KTD-10 pinning). Pi verifies
   * the synced file against it before spawn and skips the profile
   * loudly on mismatch — the run's fingerprint must be truthful.
   */
  instructionsEtag?: string | null;
  /**
   * Shadow descriptor identity (THINK-280 U1b), copied verbatim from
   * the definition's `capability_ref` frontmatter. Shadow-read only —
   * downstream consumers (Inspector, working search) may read these;
   * live dispatch never does in this slice. Absent on folders that do
   * not declare the new fields, so their manifest body (and therefore
   * fingerprint) is byte-identical to pre-U1b compiles.
   */
  twcap?: string;
  descriptor_fingerprint?: string;
}

export interface WithheldCapabilityEntry {
  slug: string;
  class: "connection" | "tool" | "agent";
  reason: WithheldReason;
  detail?: string;
}

export interface CapabilitiesManifest {
  version: number;
  /** sha256 over the canonical meaningful body — the content address. */
  fingerprint: string;
  /** Compile-input signature for recompile skipping (not identity). */
  input_signature: string;
  generated_at: string;
  agent: { tenant_id: string; agent_slug: string };
  active: CapabilityManifestEntry[];
  withheld: WithheldCapabilityEntry[];
  /** Platform envelope over the meaningful body; null = signer absent. */
  signature: CapabilitySignatureEnvelope | null;
}

export interface CapabilityFolderInput {
  class: "connection" | "tool" | "agent";
  slug: string;
  definitionPath: string;
  definitionRaw: string | null;
  /**
   * Definition-file etag from the workspace scan. Agent entries pin it
   * into the manifest (KTD-10) so Pi can verify the synced
   * INSTRUCTIONS.md is the compiled content before spawning.
   */
  definitionEtag?: string | null;
  sidecarRaw: string | null;
  /**
   * All folder files as (path, etag) pairs, sidecar excluded (U8). Lets
   * the script trust check invalidate on ANY folder-file edit without
   * reading script bytes — compared against the trust report's
   * `files_etag_signature`.
   */
  files?: Array<{ path: string; etag?: string | null }>;
}

export interface CompileCapabilitiesManifestInput {
  agent: { tenantId: string; agentSlug: string };
  folders: CapabilityFolderInput[];
  /** From the render's existing skill scan (enabled + trust-gated). */
  skills: Array<{ slug: string; enabled: boolean; active: boolean }>;
  /** Folder-external extension tool names known to the caller. */
  extensionToolNames?: readonly string[];
  /**
   * Workspace TOOLS.md MCP policy (KTD-6 fold): the manifest carries the
   * policy verdict at render time so the folder dispatch path does not
   * re-apply it. `allowedServers: null` = no allowlist configured.
   */
  mcpPolicy?: {
    allowedServers: string[] | null;
    blockedServers: string[];
  } | null;
  verifier: CapabilityVerifier | null;
  signer: CapabilitySigner | null;
  inputSignature: string;
  generatedAt: string;
}

/**
 * Signature over compile inputs knowable WITHOUT reading definition
 * bytes. The renderer compares this against the previous manifest's
 * `input_signature` and reuses the old bytes on match — scratch/memory
 * writes therefore never trigger capability reads or recompiles.
 */
export function computeCapabilityInputSignature(input: {
  capabilityObjects: Array<{ key: string; etag?: string | null }>;
  skills: Array<{ slug: string; enabled: boolean; active: boolean }>;
  extensionToolNames?: readonly string[];
  mcpPolicy?: {
    allowedServers: string[] | null;
    blockedServers: string[];
  } | null;
}): string {
  const canonical = canonicalizePayload({
    v: CAPABILITIES_MANIFEST_VERSION,
    rev: CAPABILITY_COMPILE_REVISION,
    objects: input.capabilityObjects
      .map((object) => [object.key, object.etag ?? ""])
      .sort((a, b) => (a[0]! < b[0]! ? -1 : 1)),
    skills: [...input.skills].sort((a, b) => a.slug.localeCompare(b.slug)),
    extensionToolNames: [...(input.extensionToolNames ?? [])].sort(),
    mcpPolicy: input.mcpPolicy
      ? {
          allowedServers: input.mcpPolicy.allowedServers
            ? [...input.mcpPolicy.allowedServers].sort()
            : null,
          blockedServers: [...input.mcpPolicy.blockedServers].sort(),
        }
      : null,
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

export function compileCapabilitiesManifest(
  input: CompileCapabilitiesManifestInput,
): { manifest: CapabilitiesManifest; json: string } {
  const withheld: WithheldCapabilityEntry[] = [];
  const activeConnections: Array<{
    definition: ConnectionDefinition;
    sidecar: CapabilityAssignmentSidecar;
  }> = [];
  const candidateTools: Array<{
    definition: ToolDefinition;
    sidecar: CapabilityAssignmentSidecar;
  }> = [];

  // Pass 1 — per-folder admission: definition validity, sidecar
  // signature + drift (R3/R18), enabled, approval (v1 blunt gate), and
  // the script trust precondition (R8; U8 wires the real report check).
  const activeAgents: Array<{
    config: AgentFolderConfig;
    instructionsEtag: string | null;
  }> = [];
  for (const folder of input.folders) {
    if (folder.class === "agent") {
      const admittedAgent = admitAgentFolder(folder, input.verifier, withheld);
      if (admittedAgent) activeAgents.push(admittedAgent);
      continue;
    }
    const admitted = admitFolder(folder, input.verifier, withheld);
    if (!admitted) continue;
    if (folder.class === "connection") {
      activeConnections.push(
        admitted as {
          definition: ConnectionDefinition;
          sidecar: CapabilityAssignmentSidecar;
        },
      );
    } else {
      candidateTools.push(
        admitted as {
          definition: ToolDefinition;
          sidecar: CapabilityAssignmentSidecar;
        },
      );
    }
  }

  // Policy pass (KTD-6): the workspace MCP policy withholds connections
  // at render so dispatch does not re-filter on the folder path.
  const policy = input.mcpPolicy ?? null;
  const policyAllows = (slug: string): boolean => {
    if (!policy) return true;
    if (policy.blockedServers.includes(slug)) return false;
    if (policy.allowedServers && !policy.allowedServers.includes(slug)) {
      return false;
    }
    return true;
  };
  for (let i = activeConnections.length - 1; i >= 0; i--) {
    const slug = activeConnections[i]!.definition.name;
    if (policyAllows(slug)) continue;
    withheld.push({
      slug,
      class: "connection",
      reason: "policy_blocked",
      detail: "excluded by workspace TOOLS.md MCP policy",
    });
    activeConnections.splice(i, 1);
  }

  // Pass 2 — binding resolution against ACTIVE connections (a binding
  // over a withheld connection is itself withheld).
  const connectionsBySlug = new Map(
    activeConnections.map((connection) => [
      connection.definition.name,
      connection,
    ]),
  );
  const resolvedTools = candidateTools.filter((tool) => {
    if (tool.definition.kind !== "binding") return true;
    const connection = connectionsBySlug.get(tool.definition.connection);
    if (!connection) {
      withheld.push({
        slug: tool.definition.name,
        class: "tool",
        reason: "missing_connection",
        detail: `connection '${tool.definition.connection}' is not active`,
      });
      return false;
    }
    const declared = connection.definition.operations;
    if (declared.length > 0 && !declared.includes(tool.definition.operation)) {
      withheld.push({
        slug: tool.definition.name,
        class: "tool",
        reason: "operation_not_permitted",
        detail: `operation '${tool.definition.operation}' not declared by '${tool.definition.connection}'`,
      });
      return false;
    }
    const permitted = connection.sidecar.permissions?.operations;
    if (
      Array.isArray(permitted) &&
      !permitted.includes(tool.definition.operation)
    ) {
      withheld.push({
        slug: tool.definition.name,
        class: "tool",
        reason: "operation_not_permitted",
        detail: `operation '${tool.definition.operation}' not granted on '${tool.definition.connection}'`,
      });
      return false;
    }
    return true;
  });

  // Pass 3 — one collision pass across every tool-name source (R10).
  const claims: ToolNameClaim[] = [
    ...BUILTIN_TOOL_NAMES.map((name) => ({
      name,
      source: "builtin" as const,
      origin: "pi",
    })),
    ...(input.extensionToolNames ?? []).map((name) => ({
      name,
      source: "extension" as const,
      origin: "loaded-extension",
    })),
    ...resolvedTools.map((tool) => ({
      name: tool.definition.name,
      source: toolClaimSource(tool.definition.kind),
      origin: tool.definition.name,
    })),
  ];
  const verdicts = resolveToolNameClaims(claims);
  const offset =
    BUILTIN_TOOL_NAMES.length + (input.extensionToolNames?.length ?? 0);
  const survivingTools: typeof resolvedTools = [];
  resolvedTools.forEach((tool, index) => {
    const verdict = verdicts[offset + index]!;
    if (verdict.ok) {
      survivingTools.push(tool);
      return;
    }
    withheld.push({
      slug: tool.definition.name,
      class: "tool",
      reason:
        verdict.reason === "collision" ? "collision" : "invalid_definition",
      detail:
        verdict.reason === "collision"
          ? `name '${tool.definition.name}' is held by ${verdict.winner?.source}${
              verdict.winner?.origin ? ` (${verdict.winner.origin})` : ""
            }`
          : `tool name '${tool.definition.name}' is malformed`,
    });
  });

  const active: CapabilityManifestEntry[] = [
    ...BUILTIN_TOOL_NAMES.map((name) => ({
      name,
      slug: name,
      class: "builtin" as const,
    })),
    ...input.skills
      .filter((skill) => skill.enabled && skill.active)
      .map((skill) => ({
        name: skill.slug,
        slug: skill.slug,
        class: "skill" as const,
      })),
    ...activeConnections.map((connection) =>
      connectionEntry(connection.definition, connection.sidecar),
    ),
    ...survivingTools.map((tool) => toolEntry(tool.definition)),
    ...activeAgents.map((agent) =>
      agentEntry(agent.config, agent.instructionsEtag),
    ),
  ];

  const body = {
    version: CAPABILITIES_MANIFEST_VERSION,
    agent: {
      tenant_id: input.agent.tenantId,
      agent_slug: input.agent.agentSlug,
    },
    active,
    withheld,
  };
  const fingerprint = createHash("sha256")
    .update(canonicalizePayload(body), "utf8")
    .digest("hex");
  const signature = input.signer
    ? input.signer.signPayload(body, { signedBy: "render" })
    : null;
  const manifest: CapabilitiesManifest = {
    ...body,
    fingerprint,
    input_signature: input.inputSignature,
    generated_at: input.generatedAt,
    signature,
  };
  return { manifest, json: `${JSON.stringify(manifest, null, 2)}\n` };
}

/** Parse a previously rendered manifest; null on any malformation. */
export function parseCapabilitiesManifest(
  raw: string | null,
): CapabilitiesManifest | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<CapabilitiesManifest>;
    if (parsed.version !== CAPABILITIES_MANIFEST_VERSION) return null;
    if (typeof parsed.fingerprint !== "string") return null;
    if (typeof parsed.input_signature !== "string") return null;
    if (!Array.isArray(parsed.active) || !Array.isArray(parsed.withheld)) {
      return null;
    }
    return parsed as CapabilitiesManifest;
  } catch {
    return null;
  }
}

function toolClaimSource(kind: ToolKind): CapabilityToolSource {
  switch (kind) {
    case "platform":
      return "platform";
    case "extension":
      return "extension";
    case "binding":
      return "binding";
    case "script":
      return "script";
  }
}

function admitFolder(
  folder: CapabilityFolderInput,
  verifier: CapabilityVerifier | null,
  withheld: WithheldCapabilityEntry[],
): {
  definition: ConnectionDefinition | ToolDefinition;
  sidecar: CapabilityAssignmentSidecar;
} | null {
  const reject = (reason: WithheldReason, detail?: string) => {
    withheld.push({
      slug: folder.slug,
      class: folder.class,
      reason,
      ...(detail ? { detail } : {}),
    });
    return null;
  };

  if (folder.definitionRaw === null) {
    return reject("invalid_definition", "definition file unreadable");
  }
  const parsed =
    folder.class === "connection"
      ? parseConnectionDefinition(folder.definitionRaw, folder.definitionPath)
      : parseToolDefinition(folder.definitionRaw, folder.definitionPath);
  if (!parsed.valid) {
    return reject(
      "invalid_definition",
      parsed.errors[0]?.message ?? "definition failed validation",
    );
  }
  const definition = parsed.parsed;
  if (definition.name !== folder.slug) {
    return reject(
      "invalid_definition",
      `definition name '${definition.name}' does not match folder slug '${folder.slug}'`,
    );
  }

  // R3: registration-grade state is a platform-signed sidecar. No
  // sidecar, unparseable sidecar, or sidecar without a signature is an
  // inert proposal (AE1).
  if (folder.sidecarRaw === null) return reject("unsigned");
  const sidecarResult = parseCapabilitySidecar(
    folder.sidecarRaw,
    `${folder.class}s/${folder.slug}/.assignment.json`,
  );
  if (!sidecarResult.valid) {
    return reject(
      "invalid_definition",
      sidecarResult.errors[0]?.message ?? "sidecar failed validation",
    );
  }
  const sidecar = sidecarResult.parsed;
  if (sidecar.slug !== folder.slug || sidecar.class !== folder.class) {
    return reject(
      "invalid_definition",
      "sidecar slug/class does not match its folder",
    );
  }
  if (!sidecar.signature) return reject("unsigned");
  if (!verifier) {
    return reject("unsigned", "signature verification unavailable");
  }
  const verdict = verifyCapabilitySidecar({
    verifier,
    sidecar: sidecar as unknown as Record<string, unknown>,
    definitionBytes: folder.definitionRaw,
  });
  if (!verdict.ok) return reject(verdict.reason);

  if (sidecar.enabled === false) return reject("disabled");
  // v1 blunt approval enforcement (AE3): a declared gate with no
  // enforcement primitive withholds the entry until THINK-174 lands
  // parked-turn approvals.
  if (sidecar.approval !== undefined && sidecar.approval !== "never") {
    return reject("approval_gated", `approval policy '${sidecar.approval}'`);
  }
  // R8: script kinds additionally need a current passed trust report.
  // U8 wires the report check; the precondition shape (a `trust` ref in
  // the sidecar pinning the definition sha) is enforced from day one.
  if (
    folder.class === "tool" &&
    (definition as ToolDefinition).kind === "script"
  ) {
    const trust = (sidecar as unknown as Record<string, unknown>).trust as
      | {
          content_sha?: unknown;
          status?: unknown;
          files_etag_signature?: unknown;
        }
      | undefined;
    const currentSha = sidecar.signed_content_sha;
    if (
      !trust ||
      trust.status !== "passed" ||
      typeof trust.content_sha !== "string" ||
      !currentSha ||
      trust.content_sha.toLowerCase() !== currentSha.toLowerCase()
    ) {
      return reject("trust_gate", "no current passed trust report");
    }
    // U8: any folder-file edit (entry script, support files) since the
    // scan invalidates the report — recomputed from the listing, zero
    // content reads.
    if (folder.files && typeof trust.files_etag_signature === "string") {
      const current = filesEtagSignature(folder.files);
      if (current !== trust.files_etag_signature) {
        return reject(
          "trust_gate",
          "folder contents changed since the trust scan — re-run required",
        );
      }
    } else if (folder.files && trust.files_etag_signature === undefined) {
      return reject("trust_gate", "trust report lacks a files signature");
    }
  }
  return { definition, sidecar };
}

/**
 * Admit an `agents/<slug>/` folder (subagent-folders U4 — R6/R7/R9).
 * Divergences from connection/tool admission: the definition file is
 * INSTRUCTIONS.md (strict U3 schema), the sidecar is OPTIONAL (missing =
 * enabled, operator-authored — the skills convention; the R9 provenance
 * guard lives at the write path, not here), and nested `agents/` folders
 * are rejected structurally (the depth-0 invariant, replacing the
 * deleted maxSubagentDepth literals).
 */
function admitAgentFolder(
  folder: CapabilityFolderInput,
  verifier: CapabilityVerifier | null,
  withheld: WithheldCapabilityEntry[],
): { config: AgentFolderConfig; instructionsEtag: string | null } | null {
  const reject = (reason: WithheldReason, detail?: string) => {
    withheld.push({
      slug: folder.slug,
      class: "agent",
      reason,
      ...(detail ? { detail } : {}),
    });
    return null;
  };

  if (folder.definitionRaw === null) {
    return reject("invalid_definition", "INSTRUCTIONS.md unreadable");
  }
  const nested = (folder.files ?? []).find((file) =>
    file.path.startsWith("agents/"),
  );
  if (nested) {
    return reject(
      "nested_agent_folder",
      `nested sub-agent folders are not supported (found '${nested.path}')`,
    );
  }
  const parsed = parseAgentFolderInstructions(
    folder.definitionRaw,
    folder.definitionPath,
  );
  if (!parsed.valid) {
    return reject(
      "invalid_definition",
      parsed.errors[0]?.message ?? "INSTRUCTIONS.md failed validation",
    );
  }
  let config = parsed.parsed;
  if (config.slug !== folder.slug) {
    return reject(
      "invalid_definition",
      `instructions path slug '${config.slug}' does not match folder slug '${folder.slug}'`,
    );
  }

  // Optional sidecar (R7): absent = enabled, operator-authored, nothing
  // pending. Present = platform state; signature + drift checks engage.
  if (folder.sidecarRaw !== null) {
    const sidecarResult = parseCapabilitySidecar(
      folder.sidecarRaw,
      `agents/${folder.slug}/.assignment.json`,
    );
    if (!sidecarResult.valid) {
      return reject(
        "invalid_definition",
        sidecarResult.errors[0]?.message ?? "sidecar failed validation",
      );
    }
    const sidecar = sidecarResult.parsed;
    if (sidecar.slug !== folder.slug || sidecar.class !== "agent") {
      return reject(
        "invalid_definition",
        "sidecar slug/class does not match its folder",
      );
    }
    // An unsigned sidecar is an agent-authored proposal awaiting
    // approval (AE1) — withheld, never dispatched.
    if (!sidecar.signature) return reject("unsigned");
    if (!verifier) {
      return reject("unsigned", "signature verification unavailable");
    }
    const verdict = verifyCapabilitySidecar({
      verifier,
      sidecar: sidecar as unknown as Record<string, unknown>,
      definitionBytes: folder.definitionRaw,
    });
    if (!verdict.ok) return reject(verdict.reason);
    if (sidecar.enabled === false) return reject("disabled");
    if (sidecar.approval !== undefined && sidecar.approval !== "never") {
      return reject("approval_gated", `approval policy '${sidecar.approval}'`);
    }
    const overlaid = applyAgentFolderSidecar(
      config,
      sidecar as unknown as {
        enabled?: boolean;
        policy?: Record<string, unknown>;
      },
      folder.definitionPath,
    );
    if (!overlaid.valid) {
      return reject(
        "invalid_definition",
        overlaid.errors[0]?.message ?? "sidecar overrides failed validation",
      );
    }
    config = overlaid.parsed;
  }

  if (!config.enabled) return reject("disabled");
  return { config, instructionsEtag: folder.definitionEtag ?? null };
}

function agentEntry(
  config: AgentFolderConfig,
  instructionsEtag: string | null,
): CapabilityManifestEntry {
  return {
    name: config.slug,
    slug: config.slug,
    class: "agent",
    description: config.description,
    ...(config.model ? { model: config.model } : {}),
    execution: config.execution as unknown as Record<string, unknown>,
    instructionsEtag,
  };
}

function connectionEntry(
  definition: ConnectionDefinition,
  sidecar: CapabilityAssignmentSidecar,
): CapabilityManifestEntry {
  return {
    name: definition.name,
    slug: definition.name,
    class: "connection",
    description: definition.description,
    type: definition.type,
    ...(definition.url ? { url: definition.url } : {}),
    principalType: definition.principalType,
    operations: definition.operations,
    permittedOperations: Array.isArray(sidecar.permissions?.operations)
      ? (sidecar.permissions.operations as string[])
      : null,
    ...(sidecar.config ? { credentialRefs: sidecar.config } : {}),
    ...(sidecar.policy ? { policy: sidecar.policy } : {}),
    ...(definition.descriptor_identity?.twcap
      ? { twcap: definition.descriptor_identity.twcap }
      : {}),
    ...(definition.descriptor_identity?.descriptor_fingerprint
      ? {
          descriptor_fingerprint:
            definition.descriptor_identity.descriptor_fingerprint,
        }
      : {}),
  };
}

function toolEntry(definition: ToolDefinition): CapabilityManifestEntry {
  const base = {
    name: definition.name,
    slug: definition.name,
    class: "tool" as const,
    description: definition.description,
    kind: definition.kind,
  };
  switch (definition.kind) {
    case "binding":
      return {
        ...base,
        target: `binding:${definition.connection}/${definition.operation}`,
        connection: definition.connection,
        operation: definition.operation,
        presetArgs: definition.presetArgs,
        ...(definition.output ? { output: definition.output } : {}),
      };
    case "platform":
      return {
        ...base,
        target: `platform:${definition.platformTool}`,
        platformTool: definition.platformTool,
      };
    case "extension":
      return {
        ...base,
        target: `extension:${definition.extension}/${definition.tool}`,
        extension: definition.extension,
        extensionTool: definition.tool,
      };
    case "script":
      return {
        ...base,
        target: `script:${definition.entry}`,
        entry: definition.entry,
      };
  }
}

/**
 * Project a compiled manifest onto the capability-fingerprint inputs
 * (U4/U5): both dispatch builders call this so the `connections`/`tools`
 * slices can never drift between the chat and wakeup paths.
 */
export function fingerprintInputsFromCapabilitiesManifest(
  manifest: CapabilitiesManifest | null,
): {
  connections: Array<{
    slug: string;
    type: string;
    url?: string | null;
    principalType: string;
    operations: string[];
    enabled: boolean;
    permittedOperations?: string[] | null;
    signedContentSha?: string | null;
  }>;
  tools: Array<{
    slug: string;
    kind: string;
    target: string;
    enabled: boolean;
    signedContentSha?: string | null;
  }>;
} {
  if (!manifest) return { connections: [], tools: [] };
  return {
    connections: manifest.active
      .filter((entry) => entry.class === "connection")
      .map((entry) => ({
        slug: entry.slug,
        type: entry.type ?? "mcp",
        url: entry.url ?? null,
        principalType: entry.principalType ?? "app",
        operations: entry.operations ?? [],
        enabled: true,
        permittedOperations: entry.permittedOperations ?? null,
        signedContentSha: null,
      })),
    tools: manifest.active
      .filter((entry) => entry.class === "tool")
      .map((entry) => ({
        slug: entry.slug,
        kind: entry.kind ?? "binding",
        target: entry.target ?? "",
        enabled: true,
        signedContentSha: null,
      })),
  };
}

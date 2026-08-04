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
  definitionContentSha,
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
import type { CapabilityApprovalRow } from "./approval-registry.js";
import {
  parseMcpDefinition,
  type McpMarkerDefinition,
} from "./marker-frontmatter.js";

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
// rev 5: connections/ → connectors/ root rename (subagent-folders U15,
// R18/R19) — the renderer scans both spellings during the dual-read
// window and writers emit connectors/; previously rendered manifests
// must recompile so folders resolve under either spelling post-flip.
// rev 6: registry-trust admission (THINK-302 U3) — trust moves from the
// per-folder signed sidecar to scope-qualified `capability_approvals`
// bindings (marker sha + folder etag attestation); active entries carry
// source_scope, and the input signature folds in the bound shas so a
// DB-only approval busts the S3-etag recompile-skip cache. Gated behind
// the per-tenant registryTrust flag; off = the rev-5 sidecar path
// (dual-read window, binding-absence fallback).
export const CAPABILITY_COMPILE_REVISION = 6;
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
  | "nested_agent_folder"
  | "missing_skill";

export interface CapabilityManifestEntry {
  /** Tool-registration name (definition `name`; slug for connections). */
  name: string;
  /** Folder slug (identity). */
  slug: string;
  class: "builtin" | "skill" | "connection" | "tool" | "agent" | "mcp";
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
  /** Built-in tool surface config from INSTRUCTIONS.md frontmatter (U7). */
  builtInTools?: string[];
  /**
   * Resolved child grant surface (subagent-folders U5 — R10-R13).
   * Presence-based: `agents/<slug>/skills|connectors/<child>/` folders,
   * each carrying its own platform-signed narrowing sidecar. Withheld
   * child grants stay on the entry (visible absence for the child
   * prompt), never as runtime spawn errors.
   */
  grants?: AgentChildGrant[];
  withheldGrants?: AgentWithheldGrant[];
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
  /**
   * Winning scope for this entry (THINK-302 U3/U5, R16). `agent:<id>` is
   * the agent root; sub-agent/space/user scopes arrive with U5. Absent on
   * a rev-5 (sidecar-path) compile so pre-U3 manifest bodies stay
   * byte-identical; present under registry trust.
   */
  source_scope?: string;
  /**
   * mcp entries only (THINK-302 U4). The tenant MCP registry reference
   * (`tenant_mcp_servers` row id or slug) the dispatch bridge resolves the
   * endpoint + credential from — secrets never enter the tree (R10). The
   * `mcp/<slug>/` folder IS the grant, replacing the compiled connector→mcp
   * mirror (R3).
   */
  server?: string;
  /** mcp entries only: enabled tool allowlist. Absent = every server tool. */
  enabledTools?: string[];
}

export interface AgentChildGrant {
  class: "skill" | "connector";
  slug: string;
  /**
   * Connector grants: the granted operation set — the child sidecar's
   * narrowing list when present (subset-validated against the root
   * grant), else the root's effective surface.
   */
  operations?: string[];
}

export interface AgentWithheldGrant {
  class: "skill" | "connector";
  slug: string;
  reason: WithheldReason;
  detail?: string;
}

export interface AgentChildGrantInput {
  kind: "skill" | "connector";
  slug: string;
  /** Workspace-relative sidecar path (for error messages). */
  path: string;
  sidecarRaw: string | null;
}

export interface WithheldCapabilityEntry {
  slug: string;
  class: "connection" | "tool" | "agent" | "mcp";
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
  class: "connection" | "tool" | "agent" | "mcp";
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
   * Agent folders only (subagent-folders U5): the child grant sidecars
   * found under `agents/<slug>/skills|connectors/<child>/`.
   */
  childGrants?: AgentChildGrantInput[];
  /**
   * All folder files as (path, etag) pairs, sidecar excluded (U8). Lets
   * the script trust check invalidate on ANY folder-file edit without
   * reading script bytes — compared against the trust report's
   * `files_etag_signature`.
   */
  files?: Array<{ path: string; etag?: string | null }>;
  /**
   * Binding location for registry-trust admission (THINK-302 U3, KTD-1).
   * `agent:<id>` at the agent root; sub-agent/space/user scopes arrive
   * with U5. Absent = agent-root default resolved by the compiler from
   * the `agent` input.
   */
  scopeRef?: string;
}

/**
 * Registry-trust inputs (THINK-302 U3). When `registryTrust` is on, the
 * compiler admits from scope-qualified `capability_approvals` bindings
 * instead of per-folder sidecar signatures. `bindings` is the batched
 * latest-per-key lookup resolved BEFORE the render transaction (pg-pool
 * held-connection precedent), keyed `${scopeRef}:${class}:${slug}`. A
 * lookup that failed upstream sets `bindingsUnavailable` so the compiler
 * fails closed (every registry-trust entry withheld `unsigned`) instead
 * of silently activating nothing OR crashing the whole render.
 */
/**
 * The binding fields the compiler actually reads (THINK-302 U3b). A minimal
 * structural subset of `CapabilityApprovalRow` so the renderer can supply
 * lookup results without materializing the full DB row. `ReadonlyMap` keeps
 * the value type covariant — a `Map<string, CapabilityApprovalRow>` (tests)
 * assigns cleanly to `ReadonlyMap<string, CompileBindingRow>`.
 */
export interface CompileBindingRow {
  marker_sha: string;
  folder_attestation_sha: string;
  files_etag_signature: string | null;
}

export interface RegistryTrustInput {
  registryTrust: boolean;
  bindings: ReadonlyMap<string, CompileBindingRow>;
  bindingsUnavailable?: boolean;
}

/** Stamp an entry's winning `source_scope` (omitted when there is none). */
function withScope(
  entry: CapabilityManifestEntry,
  sourceScope: string | undefined,
): CapabilityManifestEntry {
  return sourceScope ? { ...entry, source_scope: sourceScope } : entry;
}

/**
 * Scope specificity for most-specific-wins (THINK-302 R16): a `user:` grant
 * beats `space:`, which beats a sub-agent (`agent:<id>/sub:<slug>`), which
 * beats the agent root (`agent:<id>`). Unknown/absent scopes rank lowest.
 */
export function scopeSpecificity(sourceScope: string | undefined): number {
  if (!sourceScope) return -1;
  if (sourceScope.startsWith("user:")) return 3;
  if (sourceScope.startsWith("space:")) return 2;
  if (sourceScope.includes("/sub:")) return 1;
  if (sourceScope.startsWith("agent:")) return 0;
  return -1;
}

/**
 * Most-specific-scope-wins dedup (THINK-302 R16/KTD-4). Among entries that
 * share a `(class, slug)` identity AND carry a `source_scope`, keep only the
 * most specific; drop the rest (superseded, not withheld). Entries without a
 * `source_scope` — builtins, skills, the legacy sidecar path — never
 * participate, so a single-scope manifest is unchanged.
 */
export function selectMostSpecificScope(
  active: CapabilityManifestEntry[],
): CapabilityManifestEntry[] {
  const bestByKey = new Map<string, number>();
  for (const entry of active) {
    if (!entry.source_scope) continue;
    const key = `${entry.class}:${entry.slug}`;
    const spec = scopeSpecificity(entry.source_scope);
    const prev = bestByKey.get(key);
    if (prev === undefined || spec > prev) bestByKey.set(key, spec);
  }
  const emittedWinnerKeys = new Set<string>();
  return active.filter((entry) => {
    if (!entry.source_scope) return true;
    const key = `${entry.class}:${entry.slug}`;
    if (scopeSpecificity(entry.source_scope) !== bestByKey.get(key)) {
      return false;
    }
    // Guard against two folders that tie at the same winning scope (should
    // not happen — scan keys are unique per scope): keep the first only.
    if (emittedWinnerKeys.has(key)) return false;
    emittedWinnerKeys.add(key);
    return true;
  });
}

/** Map key for a scope-qualified binding lookup — shared by compile + signature. */
export function bindingScanKey(
  scopeRef: string,
  klass: string,
  slug: string,
): string {
  return `${scopeRef} ${klass} ${slug}`;
}

/**
 * Whether the folder's current marker sha + folder etag signature match
 * the bound shas. The marker sha is a true content check (definition
 * bytes are always in hand); the etag signature is the zero-read folder
 * check (flips on any folder-file change — a pure re-upload of identical
 * bytes is the rare fail-closed false positive, re-approved once). The
 * content-sha `folder_attestation_sha` is the stored authority, bound at
 * write/backfill time; compile's hot path uses the etag fast path.
 */
function bindingMatches(
  binding: CompileBindingRow,
  markerSha: string,
  files: Array<{ path: string; etag?: string | null }> | undefined,
): { ok: true } | { ok: false; detail: string } {
  if (binding.marker_sha.toLowerCase() !== markerSha.toLowerCase()) {
    return { ok: false, detail: "marker bytes changed since approval" };
  }
  if (files && binding.files_etag_signature) {
    const current = filesEtagSignature(files);
    if (current !== binding.files_etag_signature) {
      return {
        ok: false,
        detail: "folder contents changed since approval",
      };
    }
  }
  return { ok: true };
}

export interface CompileCapabilitiesManifestInput {
  agent: { tenantId: string; agentSlug: string };
  folders: CapabilityFolderInput[];
  /**
   * From the render's existing skill scan (enabled + trust-gated). THINK-302
   * U5: `sourceScope` is the winning grant scope when the four-scope union is
   * active; omitted (agent-only) tenants leave it undefined and their skill
   * entries carry no `source_scope`.
   */
  skills: Array<{
    slug: string;
    enabled: boolean;
    active: boolean;
    sourceScope?: string;
  }>;
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
  /**
   * Registry-trust admission (THINK-302 U3). Absent = the rev-5 sidecar
   * path unchanged. Present with `registryTrust: true` = admit from
   * scope-qualified bindings; binding-absence with a sidecar present
   * falls back to sidecar verification (dual-read, logged loudly).
   */
  registry?: RegistryTrustInput;
}

/**
 * Signature over compile inputs knowable WITHOUT reading definition
 * bytes. The renderer compares this against the previous manifest's
 * `input_signature` and reuses the old bytes on match — scratch/memory
 * writes therefore never trigger capability reads or recompiles.
 */
export function computeCapabilityInputSignature(input: {
  capabilityObjects: Array<{ key: string; etag?: string | null }>;
  skills: Array<{
    slug: string;
    enabled: boolean;
    active: boolean;
    sourceScope?: string;
  }>;
  extensionToolNames?: readonly string[];
  mcpPolicy?: {
    allowedServers: string[] | null;
    blockedServers: string[];
  } | null;
  /**
   * Latest bound (marker sha, folder attestation sha) per scanned
   * `${scopeRef}:${class}:${slug}` (THINK-302 U3). Folds registry state
   * into the recompile-skip cache key so a DB-only approval — which
   * changes no S3 object — still busts the etag-only skip and recompiles.
   * Absent/empty under the rev-5 sidecar path (byte-identical signature).
   */
  bindings?: Array<{
    key: string;
    markerSha: string;
    attestationSha: string;
  }>;
}): string {
  const canonical = canonicalizePayload({
    v: CAPABILITIES_MANIFEST_VERSION,
    rev: CAPABILITY_COMPILE_REVISION,
    objects: input.capabilityObjects
      .map((object) => [object.key, object.etag ?? ""])
      .sort((a, b) => (a[0]! < b[0]! ? -1 : 1)),
    skills: [...input.skills].sort((a, b) => a.slug.localeCompare(b.slug)),
    extensionToolNames: [...(input.extensionToolNames ?? [])].sort(),
    ...(input.bindings && input.bindings.length > 0
      ? {
          bindings: [...input.bindings]
            .map((binding) => [
              binding.key,
              binding.markerSha,
              binding.attestationSha,
            ])
            .sort((a, b) => (a[0]! < b[0]! ? -1 : 1)),
        }
      : {}),
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
    sourceScope?: string;
  }> = [];
  const candidateTools: Array<{
    definition: ToolDefinition;
    sidecar: CapabilityAssignmentSidecar;
    sourceScope?: string;
  }> = [];
  const activeMcp: Array<{
    definition: McpMarkerDefinition;
    sourceScope?: string;
  }> = [];

  // Pass 1 — per-folder admission: definition validity, sidecar
  // signature + drift (R3/R18), enabled, approval (v1 blunt gate), and
  // the script trust precondition (R8; U8 wires the real report check).
  const activeAgents: Array<{
    config: AgentFolderConfig;
    instructionsEtag: string | null;
    childGrants: AgentChildGrantInput[];
    sourceScope?: string;
  }> = [];
  for (const folder of input.folders) {
    if (folder.class === "agent") {
      const admittedAgent = admitAgentFolder(
        folder,
        input.verifier,
        withheld,
        input.registry,
      );
      if (admittedAgent) {
        activeAgents.push({
          config: admittedAgent.config,
          instructionsEtag: admittedAgent.instructionsEtag,
          childGrants: folder.childGrants ?? [],
          ...(admittedAgent.sourceScope
            ? { sourceScope: admittedAgent.sourceScope }
            : {}),
        });
      }
      continue;
    }
    if (folder.class === "mcp") {
      const admittedMcp = admitMcpFolder(folder, withheld, input.registry);
      if (admittedMcp) {
        activeMcp.push({
          definition: admittedMcp.definition,
          ...(admittedMcp.sourceScope
            ? { sourceScope: admittedMcp.sourceScope }
            : {}),
        });
      }
      continue;
    }
    const admitted = admitFolder(
      folder,
      input.verifier,
      withheld,
      input.registry,
      input.generatedAt,
    );
    if (!admitted) continue;
    if (folder.class === "connection") {
      activeConnections.push(
        admitted as {
          definition: ConnectionDefinition;
          sidecar: CapabilityAssignmentSidecar;
          sourceScope?: string;
        },
      );
    } else {
      candidateTools.push(
        admitted as {
          definition: ToolDefinition;
          sidecar: CapabilityAssignmentSidecar;
          sourceScope?: string;
        },
      );
    }
  }

  // THINK-302 U5 (R16/KTD-4): resolve same-slug cross-scope grants by
  // most-specific-wins BEFORE the collision/name-claim and binding passes.
  // Two grants of the same (class, slug) at different scopes are the SAME
  // capability — the more specific scope supersedes; without this the R10
  // tool-name collision pass would wrongly withhold one as a `collision`.
  // Applied per admitted-item list (each list is a single class); items
  // with no sourceScope (legacy sidecar path) never collide across scopes.
  const dedupByScope = <T extends { sourceScope?: string }>(
    items: T[],
    nameOf: (item: T) => string,
  ): T[] => {
    const bestSpec = new Map<string, number>();
    for (const item of items) {
      if (!item.sourceScope) continue;
      const name = nameOf(item);
      const spec = scopeSpecificity(item.sourceScope);
      const prev = bestSpec.get(name);
      if (prev === undefined || spec > prev) bestSpec.set(name, spec);
    }
    const emitted = new Set<string>();
    return items.filter((item) => {
      if (!item.sourceScope) return true;
      const name = nameOf(item);
      if (scopeSpecificity(item.sourceScope) !== bestSpec.get(name)) {
        return false;
      }
      if (emitted.has(name)) return false;
      emitted.add(name);
      return true;
    });
  };
  {
    const dedupedConnections = dedupByScope(
      activeConnections,
      (c) => c.definition.name,
    );
    activeConnections.length = 0;
    activeConnections.push(...dedupedConnections);
    const dedupedTools = dedupByScope(candidateTools, (t) => t.definition.name);
    candidateTools.length = 0;
    candidateTools.push(...dedupedTools);
    const dedupedMcp = dedupByScope(activeMcp, (m) => m.definition.name);
    activeMcp.length = 0;
    activeMcp.push(...dedupedMcp);
    const dedupedAgents = dedupByScope(activeAgents, (a) => a.config.slug);
    activeAgents.length = 0;
    activeAgents.push(...dedupedAgents);
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
      .map((skill) =>
        withScope(
          {
            name: skill.slug,
            slug: skill.slug,
            class: "skill" as const,
          },
          skill.sourceScope,
        ),
      ),
    ...activeConnections.map((connection) =>
      withScope(
        connectionEntry(connection.definition, connection.sidecar),
        connection.sourceScope,
      ),
    ),
    ...survivingTools.map((tool) =>
      withScope(toolEntry(tool.definition), tool.sourceScope),
    ),
    // THINK-302 U4: mcp/<slug>/ grants as first-class `mcp` entries.
    ...activeMcp.map((mcp) =>
      withScope(mcpEntry(mcp.definition), mcp.sourceScope),
    ),
    // Pass 2b (subagent-folders U5): resolve each agent's child grant
    // surface against the post-policy ACTIVE connections and the skill
    // scan — grant failures become visible absence on the entry, never
    // runtime spawn errors (R13).
    ...activeAgents.map((agent) =>
      withScope(
        agentEntry(
          agent.config,
          agent.instructionsEtag,
          resolveAgentChildGrants({
            childGrants: agent.childGrants,
            connectionsBySlug,
            skills: input.skills,
            verifier: input.verifier,
          }),
        ),
        agent.sourceScope,
      ),
    ),
  ];

  // THINK-302 U5 (R16/KTD-4): most-specific scope wins on slug collision.
  // When the same (class, slug) is granted at multiple scopes, keep the
  // entry from the most specific scope (user > space > sub-agent > root)
  // and drop the less-specific duplicates — they are the SAME capability
  // superseded by a more specific grant, not a withheld failure. Entries
  // with no `source_scope` (legacy sidecar path / builtins / skills) never
  // collide across scopes and pass through untouched, so a single-scope
  // manifest body is byte-identical (KTD-3).
  const deduped = selectMostSpecificScope(active);

  const body = {
    version: CAPABILITIES_MANIFEST_VERSION,
    agent: {
      tenant_id: input.agent.tenantId,
      agent_slug: input.agent.agentSlug,
    },
    active: deduped,
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

/**
 * Read a marker frontmatter field bagged in the definition's `internal`
 * record (the connection/tool parsers stash unknown keys there). Under
 * registry trust the retired sidecar fields (`approval`, `operations`,
 * `config`) live on the marker; U9 backfill populates them for existing
 * grants, so a pre-backfill marker simply has no field and defaults apply.
 */
function markerInternal(
  definition: ConnectionDefinition | ToolDefinition,
): Record<string, unknown> {
  const internal = (definition as { internal?: unknown }).internal;
  return internal && typeof internal === "object"
    ? (internal as Record<string, unknown>)
    : {};
}

function readMarkerApproval(
  definition: ConnectionDefinition | ToolDefinition,
): "never" | "once" | "always" | undefined {
  const raw = markerInternal(definition).approval;
  if (raw === "never" || raw === "once" || raw === "always") return raw;
  return undefined;
}

/**
 * Synthesize a sidecar-shaped record from a registry-approved marker so
 * the downstream entry builders (which read sidecar.permissions/config/
 * approval) work unchanged. Minimal by design: U9 backfill merges the full
 * retired-sidecar field set into markers; U3 carries approval + operations
 * + config, which is all the flag-on state needs before U8/U9.
 */
function synthesizeRegistrySidecar(
  definition: ConnectionDefinition | ToolDefinition,
  klass: "connection" | "tool",
  approval: "never" | "once" | "always" | undefined,
  generatedAt: string,
): CapabilityAssignmentSidecar {
  const internal = markerInternal(definition);
  const operations =
    klass === "connection"
      ? (definition as ConnectionDefinition).operations
      : Array.isArray(internal.operations)
        ? (internal.operations as unknown[]).filter(
            (op): op is string => typeof op === "string",
          )
        : undefined;
  const config =
    internal.config && typeof internal.config === "object"
      ? (internal.config as Record<string, unknown>)
      : undefined;
  return {
    slug: definition.name,
    class: klass,
    ...(approval ? { approval } : {}),
    ...(operations && operations.length > 0
      ? { permissions: { operations } }
      : {}),
    ...(config ? { config } : {}),
    updated_at: generatedAt,
  } as CapabilityAssignmentSidecar;
}

function admitFolder(
  folder: CapabilityFolderInput,
  verifier: CapabilityVerifier | null,
  withheld: WithheldCapabilityEntry[],
  registry: RegistryTrustInput | undefined,
  generatedAt: string,
): {
  definition: ConnectionDefinition | ToolDefinition;
  sidecar: CapabilityAssignmentSidecar;
  sourceScope?: string;
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

  // Registry-trust admission (THINK-302 U3, KTD-1/KTD-2). Trust comes from
  // a scope-qualified `capability_approvals` binding over marker sha +
  // folder attestation, NOT the sidecar signature. Binding-absence with a
  // sidecar present falls through to the sidecar path (dual-read window).
  if (registry?.registryTrust) {
    if (registry.bindingsUnavailable) {
      return reject("unsigned", "approval registry lookup unavailable");
    }
    const scopeRef = folder.scopeRef;
    if (!scopeRef) {
      return reject("unsigned", "no scope reference for registry admission");
    }
    const binding = registry.bindings.get(
      bindingScanKey(scopeRef, folder.class, folder.slug),
    );
    if (binding) {
      const match = bindingMatches(
        binding,
        definitionContentSha(folder.definitionRaw),
        folder.files,
      );
      if (!match.ok) return reject("definition_drift", match.detail);
      const approval = readMarkerApproval(definition);
      if (approval && approval !== "never") {
        return reject("approval_gated", `approval policy '${approval}'`);
      }
      return {
        definition,
        sidecar: synthesizeRegistrySidecar(
          definition,
          folder.class as "connection" | "tool",
          approval,
          generatedAt,
        ),
        sourceScope: scopeRef,
      };
    }
    // No binding: an unbound folder with no sidecar is an unapproved
    // proposal (AE1) — withheld. A sidecar present means a not-yet-
    // backfilled grant; fall through to the sidecar path (dual-read).
    if (folder.sidecarRaw === null) return reject("unsigned");
    console.warn(
      `[capability-compile] sidecar_fallback scope=${scopeRef} class=${folder.class} slug=${folder.slug} — no registry binding, verifying legacy sidecar`,
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
  return {
    definition,
    sidecar,
    ...(registry?.registryTrust ? { sourceScope: folder.scopeRef } : {}),
  };
}

/**
 * Admit an `mcp/<slug>/MCP.md` folder (THINK-302 U4 — R1/R2/R3). mcp is a
 * first-class registry-trusted capability class: the folder IS the grant,
 * replacing the compiled connector→mcp mirror. Admission is registry-only
 * (a bound MCP.md over marker sha + folder attestation) — there is no
 * legacy signed-sidecar path for mcp folders; the old `McpAssignmentState`
 * mirror is dual-read at dispatch (buildMcpConfigs), not here, until U9.
 */
function admitMcpFolder(
  folder: CapabilityFolderInput,
  withheld: WithheldCapabilityEntry[],
  registry: RegistryTrustInput | undefined,
): { definition: McpMarkerDefinition; sourceScope?: string } | null {
  const reject = (reason: WithheldReason, detail?: string) => {
    withheld.push({
      slug: folder.slug,
      class: "mcp",
      reason,
      ...(detail ? { detail } : {}),
    });
    return null;
  };

  if (folder.definitionRaw === null) {
    return reject("invalid_definition", "MCP.md unreadable");
  }
  const parsed = parseMcpDefinition(
    folder.definitionRaw,
    folder.definitionPath,
  );
  if (!parsed.valid) {
    return reject(
      "invalid_definition",
      parsed.errors[0]?.message ?? "MCP.md failed validation",
    );
  }
  const definition = parsed.parsed;
  if (definition.name !== folder.slug) {
    return reject(
      "invalid_definition",
      `MCP.md name '${definition.name}' does not match folder slug '${folder.slug}'`,
    );
  }

  // Registry-only admission (no legacy sidecar path for mcp).
  if (!registry?.registryTrust)
    return reject("unsigned", "mcp requires registry trust");
  if (registry.bindingsUnavailable) {
    return reject("unsigned", "approval registry lookup unavailable");
  }
  const scopeRef = folder.scopeRef;
  if (!scopeRef) {
    return reject("unsigned", "no scope reference for registry admission");
  }
  const binding = registry.bindings.get(
    bindingScanKey(scopeRef, "mcp", folder.slug),
  );
  if (!binding) return reject("unsigned");
  const match = bindingMatches(
    binding,
    definitionContentSha(folder.definitionRaw),
    folder.files,
  );
  if (!match.ok) return reject("definition_drift", match.detail);
  if (definition.approval && definition.approval !== "never") {
    return reject("approval_gated", `approval policy '${definition.approval}'`);
  }
  return { definition, sourceScope: scopeRef };
}

function mcpEntry(definition: McpMarkerDefinition): CapabilityManifestEntry {
  return {
    name: definition.name,
    slug: definition.name,
    class: "mcp",
    description: definition.description,
    server: definition.server,
    ...(definition.enabledTools && definition.enabledTools.length > 0
      ? { enabledTools: definition.enabledTools }
      : {}),
    ...(definition.operations && definition.operations.length > 0
      ? { operations: definition.operations }
      : {}),
  };
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
  registry: RegistryTrustInput | undefined,
): {
  config: AgentFolderConfig;
  instructionsEtag: string | null;
  sourceScope?: string;
} | null {
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

  // Registry-trust admission (THINK-302 U3): an `agents/<slug>/` folder is
  // trusted by a scope-qualified binding over INSTRUCTIONS.md + folder
  // attestation. When a binding EXISTS it decides active/drift/gated; when
  // ABSENT the folder falls through to the legacy optional-sidecar path
  // (which also carries the "no sidecar = operator-authored, enabled"
  // convention) so the dual-read window never withholds an existing
  // sub-agent that has not been backfilled yet.
  if (registry?.registryTrust) {
    if (registry.bindingsUnavailable) {
      return reject("unsigned", "approval registry lookup unavailable");
    }
    const scopeRef = folder.scopeRef;
    if (!scopeRef) {
      return reject("unsigned", "no scope reference for registry admission");
    }
    const binding = registry.bindings.get(
      bindingScanKey(scopeRef, "agent", folder.slug),
    );
    if (binding) {
      const match = bindingMatches(
        binding,
        definitionContentSha(folder.definitionRaw),
        folder.files,
      );
      if (!match.ok) return reject("definition_drift", match.detail);
      if (config.approval && config.approval !== "never") {
        return reject("approval_gated", `approval policy '${config.approval}'`);
      }
      if (!config.enabled) return reject("disabled");
      return {
        config,
        instructionsEtag: folder.definitionEtag ?? null,
        sourceScope: scopeRef,
      };
    }
    if (folder.sidecarRaw !== null) {
      console.warn(
        `[capability-compile] sidecar_fallback scope=${scopeRef} class=agent slug=${folder.slug} — no registry binding, verifying legacy sidecar`,
      );
    }
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
  return {
    config,
    instructionsEtag: folder.definitionEtag ?? null,
    ...(registry?.registryTrust ? { sourceScope: folder.scopeRef } : {}),
  };
}

function agentEntry(
  config: AgentFolderConfig,
  instructionsEtag: string | null,
  grantSurface: {
    grants: AgentChildGrant[];
    withheldGrants: AgentWithheldGrant[];
  },
): CapabilityManifestEntry {
  return {
    name: config.slug,
    slug: config.slug,
    class: "agent",
    description: config.description,
    ...(config.model ? { model: config.model } : {}),
    ...(config.builtInTools && config.builtInTools.length > 0
      ? { builtInTools: config.builtInTools }
      : {}),
    execution: config.execution as unknown as Record<string, unknown>,
    instructionsEtag,
    grants: grantSurface.grants,
    ...(grantSurface.withheldGrants.length > 0
      ? { withheldGrants: grantSurface.withheldGrants }
      : {}),
  };
}

/**
 * The signing convention for child grant sidecars: there is no
 * definition file inside a grant folder (definitions never copy down —
 * R11), so the platform signs the sidecar payload over EMPTY definition
 * bytes. The sidecar itself is the whole grant; the envelope makes it
 * tamper-evident, and `signed_content_sha` pins sha256("").
 */
export const AGENT_CHILD_GRANT_SIGNING_BYTES = "";

function resolveAgentChildGrants(input: {
  childGrants: AgentChildGrantInput[];
  connectionsBySlug: Map<
    string,
    { definition: ConnectionDefinition; sidecar: CapabilityAssignmentSidecar }
  >;
  skills: Array<{ slug: string; enabled: boolean; active: boolean }>;
  verifier: CapabilityVerifier | null;
}): { grants: AgentChildGrant[]; withheldGrants: AgentWithheldGrant[] } {
  const grants: AgentChildGrant[] = [];
  const withheldGrants: AgentWithheldGrant[] = [];
  const skillState = new Map(input.skills.map((skill) => [skill.slug, skill]));

  for (const child of input.childGrants) {
    const klass = child.kind === "skill" ? "skill" : "connector";
    const withhold = (reason: WithheldReason, detail?: string) => {
      withheldGrants.push({
        class: klass,
        slug: child.slug,
        reason,
        ...(detail ? { detail } : {}),
      });
    };

    // R6/R12: every grant folder carries its own platform-signed
    // sidecar — presence alone activates nothing.
    if (child.sidecarRaw === null) {
      withhold("unsigned", "grant folder has no .assignment.json");
      continue;
    }
    let sidecar: Record<string, unknown>;
    try {
      const parsed = JSON.parse(child.sidecarRaw) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        withhold("invalid_definition", "grant sidecar must be a JSON object");
        continue;
      }
      sidecar = parsed as Record<string, unknown>;
    } catch {
      withhold(
        "invalid_definition",
        `grant sidecar at ${child.path} is not valid JSON`,
      );
      continue;
    }
    if (sidecar.slug !== child.slug) {
      withhold(
        "invalid_definition",
        "grant sidecar slug does not match its folder",
      );
      continue;
    }
    if (!sidecar.signature) {
      withhold("unsigned");
      continue;
    }
    if (!input.verifier) {
      withhold("unsigned", "signature verification unavailable");
      continue;
    }
    const verdict = verifyCapabilitySidecar({
      verifier: input.verifier,
      sidecar,
      definitionBytes: AGENT_CHILD_GRANT_SIGNING_BYTES,
    });
    if (!verdict.ok) {
      withhold(verdict.reason);
      continue;
    }
    if (sidecar.enabled === false) {
      withhold("disabled");
      continue;
    }

    if (child.kind === "skill") {
      const rootSkill = skillState.get(child.slug);
      if (!rootSkill || !rootSkill.enabled || !rootSkill.active) {
        withhold(
          "missing_skill",
          `root skill '${child.slug}' is not installed and active`,
        );
        continue;
      }
      grants.push({ class: "skill", slug: child.slug });
      continue;
    }

    // Connector grant: the root connection must be ACTIVE (a withheld
    // or revoked root withers every child grant with no child edit —
    // R11 cascade), and the narrowed operations must be a subset of the
    // root's effective surface (R10, compile-time).
    const root = input.connectionsBySlug.get(child.slug);
    if (!root) {
      withhold(
        "missing_connection",
        `root connection '${child.slug}' is not active`,
      );
      continue;
    }
    const rootPermitted = Array.isArray(root.sidecar.permissions?.operations)
      ? (root.sidecar.permissions.operations as string[])
      : null;
    const rootSurface =
      rootPermitted ??
      (root.definition.operations.length > 0
        ? root.definition.operations
        : null);
    const permissions = sidecar.permissions as
      | { operations?: unknown }
      | undefined;
    const requested = Array.isArray(permissions?.operations)
      ? (permissions.operations as string[])
      : null;
    if (requested) {
      const denied = rootSurface
        ? requested.filter((op) => !rootSurface.includes(op))
        : [];
      if (denied.length > 0) {
        withhold(
          "operation_not_permitted",
          `operations [${denied.join(", ")}] exceed the root grant on '${child.slug}'`,
        );
        continue;
      }
      grants.push({
        class: "connector",
        slug: child.slug,
        operations: requested,
      });
      continue;
    }
    grants.push({
      class: "connector",
      slug: child.slug,
      ...(rootSurface ? { operations: rootSurface } : {}),
    });
  }

  return { grants, withheldGrants };
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

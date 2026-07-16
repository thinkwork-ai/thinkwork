/**
 * Sidecar-retirement backfill mover (THINK-302 U9 — R8/R18/KTD-8).
 *
 * Migrates the legacy `.assignment.json` sidecars that live beside every
 * capability marker into the new trust substrate — `capability_approvals`
 * DB bindings + per-grant behavioral config merged into the marker
 * frontmatter (U2 grammar) — so a tenant can be flipped to registry-trust
 * (`tenants.capability_registry_trust = true`) WITHOUT losing grants.
 *
 * Dry-run by default; `--apply` mutates. Per capability folder the order is
 * always: (1) write the config-merged marker, (2) record the binding (only
 * for clean/backfill dispositions), (3) delete the `.assignment.json`
 * sidecar LAST — never before the binding decision is committed, so a crash
 * mid-folder can only ever leave the sidecar in place (re-runnable), never a
 * grant with neither sidecar nor binding.
 *
 * The clean-vs-drift rule is deliberately NOT "record the sidecar's old
 * sha": merging the sidecar's config fields into the marker frontmatter
 * CHANGES the marker bytes, so the binding must pin the POST-merge sha (and
 * the post-merge whole-folder attestation), not the pre-merge sha the
 * envelope signed. See {@link classifyPair} for the full ladder.
 *
 * Pure/testable: the object store, the identity-resolving DB seam, the
 * binding-writer seam, and the signature verifier are all injected. The
 * command wires the real S3/psql/secret-backed implementations; the tests
 * drive it with in-memory fakes and a throwaway Ed25519 keypair. The U8
 * serializers (`mergeMarkerConfig`, `serializeMcpDefinition`,
 * `computeFolderAttestation`, `verifyCapabilitySidecar`) are reused verbatim
 * so the marker bytes this mover writes are byte-identical to what a live
 * registry-trust grant would have written.
 *
 * NOTE (follow-up, intentionally NOT in this PR): the U3 compile still keeps
 * a sidecar fallback so un-migrated folders keep compiling during the
 * window. Retiring that fallback is a separate compile-side change; this
 * unit is the CLI mover only, to stay reviewable.
 */

import {
  mergeMarkerConfig,
  serializeMcpDefinition,
  type MarkerClass,
  type MarkerConfigMerge,
} from "@thinkwork/api/src/lib/capabilities/marker-frontmatter.js";
import { computeFolderAttestation } from "@thinkwork/api/src/lib/capabilities/approval-registry.js";
import {
  verifyCapabilitySidecar,
  type CapabilityVerifier,
} from "@thinkwork/api/src/lib/capabilities/sidecar-signing.js";
import type { CapabilityScopeRef } from "@thinkwork/api/src/lib/capabilities/approval-registry.js";
import { createHash } from "node:crypto";
import type { WorkspaceObjectStore } from "./folder-canon-migrator.js";

export type { WorkspaceObjectStore };

export type SidecarRetirementMode = "dry-run" | "apply";

/** Capability classes a `.assignment.json` can sit beside. */
export type SidecarClass = "skill" | "connection" | "tool" | "mcp" | "agent";

/** How the mover decided to treat one capability folder. */
export type SidecarDisposition =
  /** Clean signed (or skill) pair → config merged, binding at post-merge sha. */
  | "clean-binding"
  /** Drifted/unsigned → config merged into frontmatter, NO binding (withheld). */
  | "drift-no-binding"
  /** Legacy MCP mirror → MCP.md generated, agent-root binding recorded. */
  | "mcp-backfill"
  /** Nothing to do (no marker to work with / unrecognized). */
  | "skip";

/** Reason annotation for the drift/skip dispositions. */
export type SidecarDriftReason =
  | "definition_drift"
  | "invalid_signature"
  | "unsigned"
  | "no_verifier"
  | "no_marker";

/**
 * Identity + provenance seam (the "DB seam"). Resolves the tenant/agent
 * folder names the mover sees on S3 into the `tenant_id` + scope_ref a
 * binding row is keyed on, and annotates an MCP mirror's origin.
 */
export interface SidecarRetirementScopeDb {
  /**
   * `tenants/<tenantSlug>/agents/<agentFolder>/` (+ optional `sub`) → the
   * binding scope. `null` = the identity can't be resolved (agent/tenant
   * gone); the folder is skipped rather than bound to a guessed id.
   */
  resolveScope(input: {
    tenantSlug: string;
    agentFolder: string;
    subAgentSlug?: string;
  }): Promise<{ tenantId: string; scopeRef: CapabilityScopeRef } | null>;
  /**
   * Provenance of a legacy MCP mirror (`tenant_mcp_servers` row): whether it
   * was operator-installed or reconciled from a plugin. Annotated onto the
   * backfilled binding's `origin`. Optional — omitted → `null`.
   */
  mcpOrigin?(input: {
    tenantSlug: string;
    agentFolder: string;
    slug: string;
    registryServerId?: string;
  }): Promise<"operator-installed" | "plugin-reconciler" | null>;
}

/** The binding a backfill records (mirrors `RecordBindingInput`, no `db`). */
export interface SidecarBindingInput {
  tenantId: string;
  scopeRef: CapabilityScopeRef;
  class: string;
  slug: string;
  markerSha: string;
  folderAttestationSha: string;
  /** Envelope authority preserved verbatim, or "backfill" for the carrier. */
  signedBy: string;
  signedAt?: string;
  /** MCP provenance annotation; absent for non-MCP classes. */
  origin?: string | null;
}

/** The binding-writer seam — prod calls `recordBinding(db, …)`. */
export type SidecarBindingWriter = (
  input: SidecarBindingInput,
) => Promise<void>;

export interface SidecarRetirementOptions {
  store: WorkspaceObjectStore;
  db: SidecarRetirementScopeDb;
  recordBinding: SidecarBindingWriter;
  /**
   * Verifies enveloped connection/tool sidecars over the current marker
   * bytes. `null` = no public key available → every enveloped pair is
   * treated as unverifiable (withheld), never optimistically bound.
   */
  verifier: CapabilityVerifier | null;
  tenantSlug?: string;
  agentSlug?: string;
  mode: SidecarRetirementMode;
  /** Deterministic clock for `signed_at` on skill/mcp backfills. */
  now?: string;
}

export interface SidecarFolderPlan {
  tenantSlug: string;
  agentFolder: string;
  subAgentSlug?: string;
  class: SidecarClass;
  slug: string;
  /** The capability folder prefix (ends with `/`). */
  prefix: string;
  disposition: SidecarDisposition;
  reason?: SidecarDriftReason;
  scopeRef?: CapabilityScopeRef;
  /** sha of the marker bytes as they were before the config merge. */
  markerShaBefore?: string;
  /** sha of the marker bytes after the config merge (what a binding pins). */
  markerShaAfter?: string;
  signedBy?: string;
  origin?: string | null;
  message: string;
}

export interface SidecarRetirementSummary {
  mode: SidecarRetirementMode;
  plans: SidecarFolderPlan[];
  counts: Record<SidecarDisposition, number>;
  /** Number of `.assignment.json` files that would be / were deleted. */
  sidecarsDeleted: number;
  /** Number of bindings that would be / were recorded. */
  bindingsRecorded: number;
}

const SIDECAR_FILE = ".assignment.json";

/** Marker filename for a marker-bearing capability class (mcp/agent excluded). */
const MARKER_FILE: Record<"skill" | "connection" | "tool", string> = {
  skill: "SKILL.md",
  connection: "CONNECTION.md",
  tool: "TOOL.md",
};

interface DiscoveredFolder {
  tenantSlug: string;
  agentFolder: string;
  subAgentSlug?: string;
  class: SidecarClass;
  slug: string;
  /** Capability folder prefix (absolute S3 key prefix, ends with `/`). */
  prefix: string;
  /** The `.assignment.json` key. */
  sidecarKey: string;
}

export async function migrateSidecarRetirement(
  options: SidecarRetirementOptions,
): Promise<SidecarRetirementSummary> {
  const folders = await discoverSidecarFolders(options);
  const plans: SidecarFolderPlan[] = [];
  for (const folder of folders) {
    plans.push(await processFolder(folder, options));
  }
  const counts: Record<SidecarDisposition, number> = {
    "clean-binding": 0,
    "drift-no-binding": 0,
    "mcp-backfill": 0,
    skip: 0,
  };
  let sidecarsDeleted = 0;
  let bindingsRecorded = 0;
  for (const plan of plans) {
    counts[plan.disposition] += 1;
    if (plan.disposition !== "skip") sidecarsDeleted += 1;
    if (
      plan.disposition === "clean-binding" ||
      plan.disposition === "mcp-backfill"
    ) {
      bindingsRecorded += 1;
    }
  }
  return {
    mode: options.mode,
    plans,
    counts,
    sidecarsDeleted,
    bindingsRecorded,
  };
}

// ── Discovery ──────────────────────────────────────────────────────────────

async function discoverSidecarFolders(
  options: SidecarRetirementOptions,
): Promise<DiscoveredFolder[]> {
  const prefixes = await discoverAgentWorkspacePrefixes(options);
  const folders: DiscoveredFolder[] = [];
  for (const prefix of prefixes) {
    const { tenantSlug, agentFolder } = parseWorkspacePrefix(prefix);
    const keys = await options.store.list(prefix);
    for (const key of keys) {
      if (!key.endsWith(`/${SIDECAR_FILE}`)) continue;
      const rel = key.slice(prefix.length);
      const classified = classifyRelativePath(rel);
      if (!classified) continue;
      folders.push({
        tenantSlug,
        agentFolder,
        subAgentSlug: classified.subAgentSlug,
        class: classified.class,
        slug: classified.slug,
        prefix: key.slice(0, key.length - SIDECAR_FILE.length),
        sidecarKey: key,
      });
    }
  }
  // Deterministic order for stable dry-run output.
  return folders.sort((a, b) => a.sidecarKey.localeCompare(b.sidecarKey));
}

/**
 * Map a workspace-relative key to its capability class + slug. Recognizes
 * root `skills|tools|connectors|connections|mcp/<slug>/` and sub-agent
 * `agents/<sub>/{skills|connectors|connections}/<slug>/`. Unknown shapes
 * (e.g. `agents/<sub>/tools/` which never carried grants) return null.
 */
function classifyRelativePath(
  rel: string,
): { class: SidecarClass; slug: string; subAgentSlug?: string } | null {
  const rootMap: Record<string, SidecarClass> = {
    skills: "skill",
    tools: "tool",
    connectors: "connection",
    connections: "connection",
    mcp: "mcp",
  };

  const rootMatch = rel.match(/^([^/]+)\/([^/]+)\/\.assignment\.json$/);
  if (rootMatch) {
    const folder = rootMatch[1];
    const cls = rootMap[folder];
    if (!cls) return null;
    return { class: cls, slug: rootMatch[2] };
  }

  const subMatch = rel.match(
    /^agents\/([^/]+)\/(skills|connectors|connections)\/([^/]+)\/\.assignment\.json$/,
  );
  if (subMatch) {
    const childFolder = subMatch[2];
    const cls: SidecarClass = childFolder === "skills" ? "skill" : "connection";
    return { class: cls, slug: subMatch[3], subAgentSlug: subMatch[1] };
  }
  return null;
}

async function discoverAgentWorkspacePrefixes(
  options: SidecarRetirementOptions,
): Promise<string[]> {
  if (options.agentSlug) {
    if (!options.tenantSlug) {
      throw new Error("--tenant is required when --agent is provided");
    }
    return [`tenants/${options.tenantSlug}/agents/${options.agentSlug}/`];
  }
  const scanPrefix = options.tenantSlug
    ? `tenants/${options.tenantSlug}/agents/`
    : "tenants/";
  const keys = await options.store.list(scanPrefix);
  const prefixes = new Set<string>();
  for (const key of keys) {
    const relative = key.slice(scanPrefix.length);
    const match = options.tenantSlug
      ? relative.match(/^([^/]+)\/./)
      : relative.match(/^([^/]+)\/agents\/([^/]+)\/./);
    const tenantSlug = options.tenantSlug ?? match?.[1];
    const agentSlug = options.tenantSlug ? match?.[1] : match?.[2];
    if (!tenantSlug || !agentSlug || agentSlug === "_catalog") continue;
    prefixes.add(`tenants/${tenantSlug}/agents/${agentSlug}/`);
  }
  return [...prefixes].sort((a, b) => a.localeCompare(b));
}

function parseWorkspacePrefix(prefix: string): {
  tenantSlug: string;
  agentFolder: string;
} {
  const match = prefix.match(/^tenants\/([^/]+)\/agents\/([^/]+)\/$/);
  if (!match?.[1] || !match[2]) {
    return { tenantSlug: "(unknown)", agentFolder: "(unknown)" };
  }
  return { tenantSlug: match[1], agentFolder: match[2] };
}

// ── Per-folder processing ────────────────────────────────────────────────────

interface ParsedSidecar {
  raw: Record<string, unknown>;
  /** The signature envelope when the sidecar was signed; null for skill/mcp. */
  envelope: {
    signed_by: string;
    signed_at: string;
  } | null;
}

async function processFolder(
  folder: DiscoveredFolder,
  options: SidecarRetirementOptions,
): Promise<SidecarFolderPlan> {
  const base = {
    tenantSlug: folder.tenantSlug,
    agentFolder: folder.agentFolder,
    subAgentSlug: folder.subAgentSlug,
    class: folder.class,
    slug: folder.slug,
    prefix: folder.prefix,
  };

  const sidecarRaw = await options.store.read(folder.sidecarKey);
  if (sidecarRaw === null) {
    // Raced away between listing and read — nothing to migrate.
    return {
      ...base,
      disposition: "skip",
      reason: "no_marker",
      message: "Sidecar disappeared before read",
    };
  }
  const parsed = parseSidecar(sidecarRaw);

  const scope = await options.db.resolveScope({
    tenantSlug: folder.tenantSlug,
    agentFolder: folder.agentFolder,
    subAgentSlug: folder.subAgentSlug,
  });
  if (!scope) {
    return {
      ...base,
      disposition: "skip",
      reason: "no_marker",
      message: "Could not resolve binding scope (agent/tenant identity)",
    };
  }

  if (folder.class === "mcp") {
    return processMcp(folder, parsed, scope, options, base);
  }
  return processMarkerClass(folder, parsed, scope, options, base);
}

function parseSidecar(raw: string): ParsedSidecar {
  let record: Record<string, unknown> = {};
  try {
    const value = JSON.parse(raw) as unknown;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      record = value as Record<string, unknown>;
    }
  } catch {
    record = {};
  }
  const sig = record.signature;
  let envelope: ParsedSidecar["envelope"] = null;
  if (sig && typeof sig === "object" && !Array.isArray(sig)) {
    const s = sig as Record<string, unknown>;
    if (typeof s.signed_by === "string") {
      envelope = {
        signed_by: s.signed_by,
        signed_at: typeof s.signed_at === "string" ? s.signed_at : "",
      };
    }
  }
  return { raw: record, envelope };
}

/**
 * Build the U2 marker-config merge from a sidecar's behavioral fields.
 * References only — string `config` values pass through, non-string ones
 * (should any exist) are dropped so nothing token-like enters frontmatter.
 */
function mergeFromSidecar(raw: Record<string, unknown>): MarkerConfigMerge {
  const merge: MarkerConfigMerge = {};

  const permissions = raw.permissions;
  const operations =
    permissions &&
    typeof permissions === "object" &&
    Array.isArray((permissions as Record<string, unknown>).operations)
      ? (
          (permissions as Record<string, unknown>).operations as unknown[]
        ).filter((op): op is string => typeof op === "string")
      : undefined;
  if (operations && operations.length > 0) merge.operations = operations;

  if (
    raw.approval === "never" ||
    raw.approval === "once" ||
    raw.approval === "always"
  ) {
    merge.approval = raw.approval;
  }
  if (typeof raw.rate_limit_rpm === "number") {
    merge.rateLimitRpm = raw.rate_limit_rpm;
  }
  if (typeof raw.model_override === "string" && raw.model_override.trim()) {
    merge.modelOverride = raw.model_override;
  }
  if (
    raw.config &&
    typeof raw.config === "object" &&
    !Array.isArray(raw.config)
  ) {
    const config: Record<string, string> = {};
    for (const [k, v] of Object.entries(
      raw.config as Record<string, unknown>,
    )) {
      if (typeof v === "string") config[k] = v;
    }
    if (Object.keys(config).length > 0) merge.config = config;
  }
  return merge;
}

function sha256(bytes: string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function processMarkerClass(
  folder: DiscoveredFolder,
  parsed: ParsedSidecar,
  scope: { tenantId: string; scopeRef: CapabilityScopeRef },
  options: SidecarRetirementOptions,
  base: Pick<
    SidecarFolderPlan,
    "tenantSlug" | "agentFolder" | "subAgentSlug" | "class" | "slug" | "prefix"
  >,
): Promise<SidecarFolderPlan> {
  const markerFile =
    MARKER_FILE[folder.class as "skill" | "connection" | "tool"];
  const markerKey = `${folder.prefix}${markerFile}`;
  const markerBytes = markerFile ? await options.store.read(markerKey) : null;

  if (markerBytes === null) {
    // Sub-agent child grants (and orphaned sidecars) carry no marker file.
    // There is no frontmatter to merge into; the sidecar IS the whole grant.
    return processChildGrant(folder, parsed, scope, options, base);
  }

  const merge = mergeFromSidecar(parsed.raw);
  const mergedBytes = mergeMarkerConfig(
    markerBytes,
    folder.class as MarkerClass,
    merge,
  );
  const markerShaBefore = sha256(markerBytes);
  const markerShaAfter = sha256(mergedBytes);

  // Trust ladder (rule 2–5).
  const decision = classifyPair(folder.class, parsed, markerBytes, options);

  if (decision.kind === "clean") {
    if (options.mode === "apply") {
      await options.store.write(markerKey, mergedBytes);
      await options.recordBinding({
        tenantId: scope.tenantId,
        scopeRef: scope.scopeRef,
        class: folder.class,
        slug: folder.slug,
        markerSha: markerShaAfter,
        folderAttestationSha: computeFolderAttestation([
          { path: markerFile, content: mergedBytes },
        ]),
        signedBy: decision.signedBy,
        signedAt: decision.signedAt,
      });
      await options.store.delete([folder.sidecarKey]);
    }
    return {
      ...base,
      disposition: "clean-binding",
      scopeRef: scope.scopeRef,
      markerShaBefore,
      markerShaAfter,
      signedBy: decision.signedBy,
      message: `Clean pair → binding at post-merge sha (signed_by ${decision.signedBy})`,
    };
  }

  // Drift/unsigned: preserve behavioral config in the frontmatter but record
  // NO binding — the entry re-compiles withheld, matching its pre-migration
  // posture. The sidecar is still retired (deleted last).
  if (options.mode === "apply") {
    await options.store.write(markerKey, mergedBytes);
    await options.store.delete([folder.sidecarKey]);
  }
  return {
    ...base,
    disposition: "drift-no-binding",
    reason: decision.reason,
    markerShaBefore,
    markerShaAfter,
    message: `Drift/unsigned (${decision.reason}) → config merged, NO binding`,
  };
}

type PairDecision =
  | { kind: "clean"; signedBy: string; signedAt?: string }
  | { kind: "drift"; reason: SidecarDriftReason };

/**
 * The clean-vs-drift ladder (rules 2–5):
 *   - skill: never signature-gated → always clean, `signed_by: "backfill"`.
 *   - connection/tool WITH a valid envelope over the CURRENT marker bytes →
 *     clean, preserving the envelope's signed_by/signed_at.
 *   - connection/tool with a broken/absent envelope, or a valid envelope over
 *     drifted bytes → drift (withheld). No verifier available → also drift.
 */
function classifyPair(
  cls: SidecarClass,
  parsed: ParsedSidecar,
  markerBytes: string,
  options: SidecarRetirementOptions,
): PairDecision {
  if (cls === "skill") {
    return { kind: "clean", signedBy: "backfill", signedAt: options.now };
  }
  if (!parsed.envelope) {
    // connection/tool proposal an agent dropped without an approval.
    return { kind: "drift", reason: "unsigned" };
  }
  if (!options.verifier) {
    return { kind: "drift", reason: "no_verifier" };
  }
  const result = verifyCapabilitySidecar({
    verifier: options.verifier,
    sidecar: parsed.raw,
    definitionBytes: markerBytes,
  });
  if (result.ok) {
    return {
      kind: "clean",
      signedBy: parsed.envelope.signed_by,
      signedAt: parsed.envelope.signed_at || undefined,
    };
  }
  return { kind: "drift", reason: result.reason };
}

/**
 * Sub-agent child grants (and any orphaned sidecar): no marker file exists,
 * so nothing is merged. An enveloped grant that verifies over its
 * child-grant payload records a binding at the sub scope (mirroring the U8
 * `putAgentChildGrantSidecar` registry branch); anything else records no
 * binding. The sidecar is deleted last either way.
 */
async function processChildGrant(
  folder: DiscoveredFolder,
  parsed: ParsedSidecar,
  scope: { tenantId: string; scopeRef: CapabilityScopeRef },
  options: SidecarRetirementOptions,
  base: Pick<
    SidecarFolderPlan,
    "tenantSlug" | "agentFolder" | "subAgentSlug" | "class" | "slug" | "prefix"
  >,
): Promise<SidecarFolderPlan> {
  // U8 child-grant signing bytes: the narrowed-operations payload, or empty.
  const permissions = parsed.raw.permissions;
  const operations =
    permissions &&
    typeof permissions === "object" &&
    Array.isArray((permissions as Record<string, unknown>).operations)
      ? (
          (permissions as Record<string, unknown>).operations as unknown[]
        ).filter((op): op is string => typeof op === "string")
      : [];
  const payload = operations.length > 0 ? JSON.stringify({ operations }) : "";

  let decision: PairDecision;
  if (!parsed.envelope) {
    decision = { kind: "drift", reason: "unsigned" };
  } else if (!options.verifier) {
    decision = { kind: "drift", reason: "no_verifier" };
  } else {
    const result = verifyCapabilitySidecar({
      verifier: options.verifier,
      sidecar: parsed.raw,
      definitionBytes: payload,
    });
    decision = result.ok
      ? {
          kind: "clean",
          signedBy: parsed.envelope.signed_by,
          signedAt: parsed.envelope.signed_at || undefined,
        }
      : { kind: "drift", reason: result.reason };
  }

  if (decision.kind === "clean") {
    const markerSha = sha256(payload);
    if (options.mode === "apply") {
      await options.recordBinding({
        tenantId: scope.tenantId,
        scopeRef: scope.scopeRef,
        class: folder.class,
        slug: folder.slug,
        markerSha,
        folderAttestationSha: computeFolderAttestation(
          payload ? [{ path: "grant.json", content: payload }] : [],
        ),
        signedBy: decision.signedBy,
        signedAt: decision.signedAt,
      });
      await options.store.delete([folder.sidecarKey]);
    }
    return {
      ...base,
      disposition: "clean-binding",
      scopeRef: scope.scopeRef,
      markerShaAfter: markerSha,
      signedBy: decision.signedBy,
      message: `Child grant → sub-scope binding (signed_by ${decision.signedBy})`,
    };
  }

  if (options.mode === "apply") {
    await options.store.delete([folder.sidecarKey]);
  }
  return {
    ...base,
    disposition: "drift-no-binding",
    reason: decision.reason,
    message: `Child grant drift/unsigned (${decision.reason}) → NO binding`,
  };
}

/**
 * Legacy `mcp/<slug>/.assignment.json` (never enveloped, mirrors an operator
 * `tenant_mcp_servers` row): generate the first-class `mcp/<slug>/MCP.md`
 * marker (references only), record an agent-root `class: "mcp"` binding with
 * `signed_by: "backfill"` and the server-row provenance annotated on
 * `origin`, then delete the sidecar last.
 */
async function processMcp(
  folder: DiscoveredFolder,
  parsed: ParsedSidecar,
  scope: { tenantId: string; scopeRef: CapabilityScopeRef },
  options: SidecarRetirementOptions,
  base: Pick<
    SidecarFolderPlan,
    "tenantSlug" | "agentFolder" | "subAgentSlug" | "class" | "slug" | "prefix"
  >,
): Promise<SidecarFolderPlan> {
  const state = parsed.raw;
  const slug =
    typeof state.slug === "string" && state.slug ? state.slug : folder.slug;
  const name = typeof state.name === "string" && state.name ? state.name : slug;
  const server =
    typeof state.registryServerId === "string" ? state.registryServerId : "";
  const config: Record<string, string> = {};
  if (typeof state.transport === "string") config.transport = state.transport;
  if (typeof state.authType === "string") config.authType = state.authType;
  if (typeof state.secretRef === "string") config.secretRef = state.secretRef;
  const enabledTools = Array.isArray(state.enabledTools)
    ? (state.enabledTools as unknown[]).filter(
        (t): t is string => typeof t === "string",
      )
    : undefined;

  const markerBytes = serializeMcpDefinition({
    name: slug,
    description: `${name} — MCP connection (platform-managed).`,
    server,
    enabledTools,
    ...(Object.keys(config).length > 0 ? { config } : {}),
  });
  const markerKey = `${folder.prefix}MCP.md`;
  const markerSha = sha256(markerBytes);

  const origin = options.db.mcpOrigin
    ? await options.db.mcpOrigin({
        tenantSlug: folder.tenantSlug,
        agentFolder: folder.agentFolder,
        slug,
        registryServerId: server || undefined,
      })
    : null;

  if (options.mode === "apply") {
    await options.store.write(markerKey, markerBytes);
    await options.recordBinding({
      tenantId: scope.tenantId,
      scopeRef: scope.scopeRef,
      class: "mcp",
      slug,
      markerSha,
      folderAttestationSha: computeFolderAttestation([
        { path: "MCP.md", content: markerBytes },
      ]),
      signedBy: "backfill",
      signedAt: options.now,
      origin,
    });
    await options.store.delete([folder.sidecarKey]);
  }
  return {
    ...base,
    slug,
    disposition: "mcp-backfill",
    scopeRef: scope.scopeRef,
    markerShaAfter: markerSha,
    signedBy: "backfill",
    origin,
    message: `MCP mirror → MCP.md + agent-root binding (origin ${origin ?? "unknown"})`,
  };
}

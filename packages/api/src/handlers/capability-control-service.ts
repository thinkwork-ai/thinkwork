/**
 * capability-control-service — the narrow service Lambda behind Pi's two
 * capability control-plane tools (THINK-280 U2).
 *
 * Direct-invoke only (RequestResponse; NO HTTP route): the Pi container
 * reaches it via `lambda:InvokeFunction` over the approved in-account path
 * (public execute-api is not reliable from Pi's private VPC). The Pi role
 * may invoke exactly this function (agentcore-pi ApiLambdaInvoke).
 *
 * Identity is derived EXCLUSIVELY from a per-call Ed25519-signed caller
 * context (`@thinkwork/lambda/capability-caller-context`, kind tag
 * `capability-caller-context` — cryptographically domain-separated from
 * analyst contexts under the same key). Plaintext payload fields NEVER
 * name a tenant/agent/actor; a forged, absent, expired, or wrong-kind
 * context is rejected fail-closed with a uniform reason.
 *
 * Closed action union:
 *   - `capability_search` — the working projection: resolve ONE exact
 *     invocation tuple (namespace/class/slug[/version]/operationId +
 *     principal mode) against the verified tenant's ADMITTED definition
 *     versions. Only executable operations with a `ready` binding for the
 *     exact requested principal mode resolve (no cross-mode fallback, AE2).
 *     Research records and unsigned proposals can never appear here.
 *   - `connection_research` — non-executable research knowledge: search
 *     admitted/platform definitions + stored proposals, and optionally
 *     create a draft proposal (evidence only). It cannot sign, bind
 *     credentials, or dispatch — those code paths do not exist here.
 *
 * Responses are structured objects; expected failures return
 * `{ ok: false, reason }` rather than throwing, so the Pi client can relay
 * a safe message without a Lambda FunctionError.
 */

import { getDb } from "@thinkwork/database-pg";
import {
  capabilityCredentialBindings,
  capabilityDefinitions,
  capabilityDefinitionVersions,
} from "@thinkwork/database-pg/schema";
import { and, eq } from "drizzle-orm";
import { getConfig } from "@thinkwork/runtime-config";
import {
  verifyCapabilityCallerContext,
  type CapabilityCallerContextPayload,
} from "@thinkwork/lambda/capability-caller-context";
import {
  formatTwcapRef,
  operationContractHash,
  operationExecutabilityViolations,
  type CapabilityDescriptor,
  type OperationContract,
} from "@thinkwork/capability-contracts";
import {
  createConnectionProposal,
  searchCapabilityRuntime,
  type CapabilityConnectionProposalRow,
  type CapabilityDefinitionRow,
  type Db,
} from "../lib/capabilities/research.js";
import {
  createRoutineProposal,
  publishAutoComposedProposal,
  type RoutineProposalBundle,
} from "../lib/capabilities/routine-proposal.js";
import {
  autonomouslyAdmitProposal,
  type AdmissionFolderWriter,
} from "../lib/capabilities/admission.js";
import { resolveConfiguredCapabilitySigner } from "../lib/capabilities/sidecar-signing.js";
import { createDefaultRoutineProposalPromoter } from "../lib/capabilities/routine-promoter.js";
import { readOnlyHttpProbeRunner } from "../lib/capabilities/readiness.js";
import { readTenantCredentialSecret } from "../lib/tenant-credentials/secret-store.js";
import { agents, tenants } from "@thinkwork/database-pg/schema";

const LOG_PREFIX = "[capability-control-service]";

export const CAPABILITY_CONTROL_ACTIONS = [
  "capability_search",
  "connection_research",
  "routine_propose",
  "self_admit_connection",
  "self_approve_routine",
] as const;
export type CapabilityControlAction =
  (typeof CAPABILITY_CONTROL_ACTIONS)[number];

/**
 * SSM runtime-config allowlist of tenant ids permitted to self-extend
 * (comma/space-separated). Read fail-closed: an unset/empty document means NO
 * tenant is enabled, so the two autonomous actions stay inert until a tenant is
 * explicitly opted in. Governed autonomy is default-OFF.
 */
const SELF_EXTENSION_TENANTS_CONFIG_KEY = "CAPABILITY_SELF_EXTENSION_TENANTS";

function isSelfExtensionEnabled(tenantId: string): boolean {
  let raw = "";
  try {
    raw = getConfig(SELF_EXTENSION_TENANTS_CONFIG_KEY) || "";
  } catch {
    raw = "";
  }
  if (!raw.trim()) return false;
  const allow = new Set(
    raw
      .split(/[\s,]+/)
      .map((t) => t.trim())
      .filter(Boolean),
  );
  return allow.has(tenantId);
}

/**
 * Per-agent gate: only a capability-participating agent (its
 * `capability_folder_dispatch` flag set) may self-extend. Fail-closed — an
 * agent that isn't found, is foreign-tenant, or lacks the flag is rejected.
 * This is the agent-level companion to the tenant opt-in
 * ({@link isSelfExtensionEnabled}).
 */
async function agentMaySelfExtend(
  db: Db,
  context: CapabilityCallerContextPayload,
): Promise<boolean> {
  const [agent] = await db
    .select({ capabilityFolderDispatch: agents.capability_folder_dispatch })
    .from(agents)
    .where(
      and(
        eq(agents.id, context.agentId),
        eq(agents.tenant_id, context.tenantId),
      ),
    )
    .limit(1);
  return agent?.capabilityFolderDispatch === true;
}

const PRINCIPAL_MODES = new Set(["requester", "agent_owner", "service"]);

// ---------------------------------------------------------------------------
// Wire shapes
// ---------------------------------------------------------------------------

export interface CapabilityControlEvent {
  action?: unknown;
  /** Encoded signed caller context — the ONLY identity source. */
  callerContext?: unknown;
  /** capability_search: the exact invocation tuple + principal mode. */
  tuple?: unknown;
  principalMode?: unknown;
  /** connection_research: query + optional draft-proposal payload. */
  query?: unknown;
  allowExternal?: unknown;
  proposal?: unknown;
  /** routine_propose: the immutable bundle + optional target routine. */
  routineProposal?: unknown;
  /** self_admit_connection / self_approve_routine: the target proposal id. */
  proposalId?: unknown;
}

export type CapabilityControlRejection = {
  ok: false;
  reason: string;
  detail?: string;
};

export interface CapabilitySearchMatch {
  found: true;
  twcap: string;
  contractHash: string;
  operationId: string;
  effect: string;
  approvalPolicy: string;
  costClass: string;
  latencyClass: string;
  outputClass: string;
  principalMode: string;
  bindingId: string;
  definitionVersionId: string;
  version: number;
}

export type CapabilitySearchResult =
  | CapabilitySearchMatch
  | { found: false; reason: string; withheldReasons?: string[] };

export interface ConnectionResearchDefinitionSummary {
  id: string;
  namespace: string;
  class: string;
  slug: string;
  displayName: string;
  status: string;
  tenantScoped: boolean;
}

export interface ConnectionResearchProposalSummary {
  id: string;
  status: string;
  payloadFingerprint: string;
  definitionId: string | null;
  createdAt: string | null;
}

export interface ConnectionResearchResultOut {
  state: "ok" | "degraded";
  stateDetail?: string;
  definitions: ConnectionResearchDefinitionSummary[];
  proposals: ConnectionResearchProposalSummary[];
  createdProposal?: {
    outcome: "applied" | "rejected";
    reason?: string;
    proposalId?: string;
    payloadFingerprint?: string;
  };
}

export interface RoutineProposeResultOut {
  outcome: "applied" | "rejected";
  reason?: string;
  proposalId?: string;
  payloadFingerprint?: string;
  status?: string;
}

export interface SelfAdmitConnectionResultOut {
  outcome: "applied" | "rejected" | "held_for_review";
  reason?: string;
  /** The executable twcap ref of the admitted, runnable capability. */
  twcap?: string;
  definitionId?: string;
  definitionVersionId?: string;
  version?: number;
  /** Readiness of the auto-provisioned binding (U2b): ready | degraded | rejected. */
  bindingOutcome?: string;
  bindingReason?: string;
}

export interface SelfApproveRoutineResultOut {
  outcome: "applied" | "rejected" | "held_for_review";
  reason?: string;
  proposalId?: string;
  routineId?: string;
  gateSha?: string;
}

export type CapabilityControlResponse =
  | CapabilityControlRejection
  | { ok: true; action: "capability_search"; result: CapabilitySearchResult }
  | {
      ok: true;
      action: "connection_research";
      result: ConnectionResearchResultOut;
    }
  | {
      ok: true;
      action: "routine_propose";
      result: RoutineProposeResultOut;
    }
  | {
      ok: true;
      action: "self_admit_connection";
      result: SelfAdmitConnectionResultOut;
    }
  | {
      ok: true;
      action: "self_approve_routine";
      result: SelfApproveRoutineResultOut;
    };

// ---------------------------------------------------------------------------
// Seams (tests inject; production uses defaults)
// ---------------------------------------------------------------------------

export interface CapabilityControlDeps {
  db?: ReturnType<typeof getDb>;
  publicKeyPem?: string | null;
  nowMs?: number;
}

function readCapabilityPublicKey(): string | null {
  // Document-only key: read via getConfig ONLY (its env-wins merge still
  // honors a hand-set env var as an incident/test override).
  let value = "";
  try {
    value = getConfig("CAPABILITY_SIGNING_PUBLIC_KEY") || "";
  } catch {
    value = "";
  }
  if (!value.trim()) return null;
  return value.includes("\\n") ? value.replace(/\\n/g, "\n") : value;
}

function reject(reason: string, detail?: string): CapabilityControlRejection {
  return { ok: false, reason, ...(detail ? { detail } : {}) };
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

// ---------------------------------------------------------------------------
// capability_search
// ---------------------------------------------------------------------------

interface SearchTuple {
  namespace: string;
  class: string;
  slug: string;
  /** Decimal version string; absent = latest admitted. */
  version?: string;
  operationId: string;
}

function parseSearchTuple(raw: unknown): SearchTuple | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const namespace = asString(record.namespace);
  const klass = asString(record.class);
  const slug = asString(record.slug);
  const operationId = asString(record.operationId);
  const version = asString(record.version);
  if (!namespace || !klass || !slug || !operationId) return null;
  if (version && !/^[0-9]+$/.test(version)) return null;
  return {
    namespace,
    class: klass,
    slug,
    operationId,
    ...(version ? { version } : {}),
  };
}

async function runCapabilitySearch(
  db: ReturnType<typeof getDb>,
  context: CapabilityCallerContextPayload,
  event: CapabilityControlEvent,
): Promise<CapabilityControlResponse> {
  const tuple = parseSearchTuple(event.tuple);
  if (!tuple) {
    return reject(
      "invalid_tuple",
      "capability_search requires { namespace, class, slug, operationId } (+ optional decimal version)",
    );
  }
  const principalMode = asString(event.principalMode);
  if (!PRINCIPAL_MODES.has(principalMode)) {
    return reject(
      "invalid_principal_mode",
      "principalMode must be requester | agent_owner | service",
    );
  }

  // Working knowledge is the verified tenant's own admitted contracts —
  // platform (tenant_id NULL) definitions are admission references, never
  // auto-granted, so they do not resolve here.
  const definitionRows = (await db
    .select()
    .from(capabilityDefinitions)
    .where(
      and(
        eq(capabilityDefinitions.namespace, tuple.namespace),
        eq(capabilityDefinitions.class, tuple.class),
        eq(capabilityDefinitions.slug, tuple.slug),
      ),
    )) as CapabilityDefinitionRow[];
  const definition = definitionRows.find(
    (row) => row.tenant_id === context.tenantId && row.status === "active",
  );
  if (!definition) {
    return {
      ok: true,
      action: "capability_search",
      result: { found: false, reason: "definition_not_found" },
    };
  }

  const versionRows = (await db
    .select()
    .from(capabilityDefinitionVersions)
    .where(eq(capabilityDefinitionVersions.definition_id, definition.id))) as
    | Array<typeof capabilityDefinitionVersions.$inferSelect>
    | [];
  const admitted = versionRows
    .filter((row) => row.lifecycle === "admitted")
    .sort((a, b) => a.version - b.version);
  const versionRow = tuple.version
    ? admitted.find((row) => String(row.version) === tuple.version)
    : admitted.at(-1);
  if (!versionRow) {
    return {
      ok: true,
      action: "capability_search",
      result: { found: false, reason: "no_admitted_version" },
    };
  }

  const descriptor = versionRow.descriptor_json as CapabilityDescriptor;
  const operation: OperationContract | undefined = Array.isArray(
    descriptor?.operations,
  )
    ? descriptor.operations.find((op) => op.operationId === tuple.operationId)
    : undefined;
  if (!operation) {
    return {
      ok: true,
      action: "capability_search",
      result: { found: false, reason: "operation_not_found" },
    };
  }

  const withheldReasons = operationExecutabilityViolations(operation);
  if (withheldReasons.length > 0) {
    return {
      ok: true,
      action: "capability_search",
      result: { found: false, reason: "operation_withheld", withheldReasons },
    };
  }
  if (!operation.principalModes.includes(principalMode as never)) {
    return {
      ok: true,
      action: "capability_search",
      result: { found: false, reason: "principal_mode_not_accepted" },
    };
  }

  const contractHashes =
    versionRow.contract_hashes_json &&
    typeof versionRow.contract_hashes_json === "object"
      ? (versionRow.contract_hashes_json as Record<string, unknown>)
      : {};
  const contractHash = contractHashes[tuple.operationId];
  if (typeof contractHash !== "string") {
    return {
      ok: true,
      action: "capability_search",
      result: { found: false, reason: "contract_hash_missing" },
    };
  }

  // Exact-principal binding (R6/AE2): the requested mode must have its own
  // ready binding — resolution NEVER falls back across modes. User-pinned
  // bindings only satisfy the verified acting user.
  const bindingRows = (await db
    .select()
    .from(capabilityCredentialBindings)
    .where(
      and(
        eq(capabilityCredentialBindings.tenant_id, context.tenantId),
        eq(capabilityCredentialBindings.definition_version_id, versionRow.id),
      ),
    )) as Array<typeof capabilityCredentialBindings.$inferSelect>;
  const binding = bindingRows.find(
    (row) =>
      row.principal_mode === principalMode &&
      row.readiness === "ready" &&
      (row.subject_user_id === null ||
        (context.actorUserId !== undefined &&
          row.subject_user_id === context.actorUserId)),
  );
  if (!binding) {
    return {
      ok: true,
      action: "capability_search",
      result: { found: false, reason: "no_ready_binding_for_principal" },
    };
  }

  return {
    ok: true,
    action: "capability_search",
    result: {
      found: true,
      twcap: formatTwcapRef({
        namespace: definition.namespace,
        class: definition.class,
        slug: definition.slug,
        version: String(versionRow.version),
        operationId: operation.operationId,
        contractHash,
      }),
      contractHash,
      operationId: operation.operationId,
      effect: operation.effect,
      approvalPolicy: operation.approvalPolicy,
      costClass: operation.costClass,
      latencyClass: operation.latencyClass,
      outputClass: operation.outputClass,
      principalMode,
      bindingId: binding.id,
      definitionVersionId: versionRow.id,
      version: versionRow.version,
    },
  };
}

// ---------------------------------------------------------------------------
// connection_research
// ---------------------------------------------------------------------------

function definitionSummary(
  row: CapabilityDefinitionRow,
): ConnectionResearchDefinitionSummary {
  return {
    id: row.id,
    namespace: row.namespace,
    class: row.class,
    slug: row.slug,
    displayName: row.display_name,
    status: row.status,
    tenantScoped: row.tenant_id !== null,
  };
}

function proposalSummary(
  row: CapabilityConnectionProposalRow,
): ConnectionResearchProposalSummary {
  return {
    id: row.id,
    status: row.status,
    payloadFingerprint: row.payload_fingerprint,
    definitionId: row.definition_id ?? null,
    createdAt: row.created_at ? row.created_at.toISOString() : null,
  };
}

async function runConnectionResearch(
  db: ReturnType<typeof getDb>,
  context: CapabilityCallerContextPayload,
  event: CapabilityControlEvent,
): Promise<CapabilityControlResponse> {
  const query = asString(event.query);
  if (!query && !event.proposal) {
    return reject(
      "invalid_query",
      "connection_research requires a non-empty query (or a proposal to record)",
    );
  }

  const search = await searchCapabilityRuntime(db, {
    tenantId: context.tenantId,
    query,
    allowExternal: event.allowExternal === true,
    // External discovery is a later slice — the lib degrades `state`.
    externalFetcher: undefined,
  });

  const result: ConnectionResearchResultOut = {
    state: search.state,
    ...(search.stateDetail !== undefined
      ? { stateDetail: search.stateDetail }
      : {}),
    definitions: search.definitions.map(definitionSummary),
    proposals: search.proposals.map(proposalSummary),
  };

  // Optional draft-proposal creation: evidence only. Admission (signing),
  // bindings, and dispatch are structurally absent from this Lambda.
  if (event.proposal !== undefined) {
    const raw = event.proposal;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return reject("invalid_proposal", "proposal must be an object");
    }
    const record = raw as Record<string, unknown>;
    const created = await createConnectionProposal(db, {
      tenantId: context.tenantId,
      definitionId: asString(record.definitionId) || null,
      payload: record.payload,
      sourceUrls: Array.isArray(record.sourceUrls)
        ? (record.sourceUrls as string[])
        : [],
      actor: { type: "agent", id: context.agentId },
    });
    result.createdProposal = {
      outcome: created.outcome,
      ...(created.reason ? { reason: created.reason } : {}),
      ...(created.proposal
        ? {
            proposalId: created.proposal.id,
            payloadFingerprint: created.proposal.payload_fingerprint,
          }
        : {}),
    };
  }

  return { ok: true, action: "connection_research", result };
}

// ---------------------------------------------------------------------------
// routine_propose — create/update a Routine promotion proposal ONLY
// ---------------------------------------------------------------------------

/**
 * The narrow trusted-service leg for Routine proposals (THINK-280 U6). It
 * can ONLY create/update a proposal (status 'submitted' at most) — it never
 * approves, commits, validates, or activates. Tenant + actor are derived
 * from the VERIFIED caller context; the plaintext bundle cannot assert
 * another tenant/user, and dependencies are validated against the verified
 * tenant's admitted definition versions (a dependency absent from that
 * manifest is rejected by the lib).
 */
async function runRoutinePropose(
  db: ReturnType<typeof getDb>,
  context: CapabilityCallerContextPayload,
  event: CapabilityControlEvent,
): Promise<CapabilityControlResponse> {
  const raw = event.routineProposal;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return reject(
      "invalid_routine_proposal",
      "routine_propose requires a routineProposal object with a bundle",
    );
  }
  const record = raw as Record<string, unknown>;
  if (
    !record.bundle ||
    typeof record.bundle !== "object" ||
    Array.isArray(record.bundle)
  ) {
    return reject(
      "invalid_routine_proposal",
      "routineProposal.bundle required",
    );
  }

  const created = await createRoutineProposal(db, {
    tenantId: context.tenantId,
    routineId: asString(record.routineId) || null,
    bundle: record.bundle as unknown as RoutineProposalBundle,
    // Broker-sanitized already; the lib re-scrubs + fail-closes on residual
    // secret shapes. No secret material is asserted over the plaintext leg.
    secretSources: [],
    status: "submitted",
    actor: { type: "agent", id: context.agentId },
  });

  return {
    ok: true,
    action: "routine_propose",
    result: {
      outcome: created.outcome,
      ...(created.reason ? { reason: created.reason } : {}),
      ...(created.proposal
        ? {
            proposalId: created.proposal.id,
            payloadFingerprint: created.proposal.payload_fingerprint,
            status: created.proposal.status,
          }
        : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// self_admit_connection / self_approve_routine — governed autonomy (U4)
// ---------------------------------------------------------------------------

/**
 * AdmissionFolderWriter over putCapabilityFolder, targeting the tenant's
 * platform default agent workspace — the Lambda-side mirror of the resolver's
 * platformAgentFolderWriter. Any failure is caught by the admission lib and
 * surfaces as `projection_pending` on an applied admission; the signed version
 * row stays authoritative (the broker authorizes from the DB, not the folder).
 */
function platformAgentFolderWriter(db: Db): AdmissionFolderWriter {
  return {
    async write(input) {
      const [agent] = await db
        .select({
          slug: agents.slug,
          workspace_folder_name: agents.workspace_folder_name,
        })
        .from(agents)
        .where(
          and(
            eq(agents.tenant_id, input.tenantId),
            eq(agents.is_platform_default, true),
          ),
        )
        .limit(1);
      if (!agent?.slug) {
        throw new Error("tenant has no platform default agent workspace");
      }
      const [tenant] = await db
        .select({ slug: tenants.slug })
        .from(tenants)
        .where(eq(tenants.id, input.tenantId))
        .limit(1);
      if (!tenant?.slug) {
        throw new Error("tenant not found");
      }
      const workspaceFolder = agent.workspace_folder_name ?? agent.slug;
      const targetPrefix = `tenants/${tenant.slug}/agents/${workspaceFolder}/`;
      const { putCapabilityFolder } =
        await import("../lib/capabilities/folder-write.js");
      return putCapabilityFolder({
        targetPrefix,
        klass: input.klass,
        slug: input.slug,
        definition: input.definition,
        sidecar: input.sidecar,
        signedBy: input.signedBy,
      });
    },
  };
}

/**
 * Autonomous self-admission (governed autonomy). An agent admits a proposal it
 * composed with NO human — gated fail-closed on the per-tenant opt-in and the
 * auto-tier classifier inside the lib. On success it also auto-provisions the
 * agent's service principal + empty-credential binding and drives it to `ready`
 * (U2b), returning the executable twcap. A non-auto descriptor → held_for_review.
 */
async function runSelfAdmitConnection(
  db: Db,
  context: CapabilityCallerContextPayload,
  event: CapabilityControlEvent,
): Promise<CapabilityControlResponse> {
  if (!isSelfExtensionEnabled(context.tenantId)) {
    return reject("self_extension_disabled");
  }
  const proposalId = asString(event.proposalId);
  if (!proposalId) {
    return reject(
      "invalid_proposal_id",
      "self_admit_connection requires a proposalId",
    );
  }
  if (!(await agentMaySelfExtend(db, context))) {
    return reject("folder_dispatch_required");
  }
  const signer = await resolveConfiguredCapabilitySigner();
  if (!signer) {
    return reject("signing_unavailable");
  }

  const result = await autonomouslyAdmitProposal(db, {
    tenantId: context.tenantId,
    proposalId,
    agentId: context.agentId,
    signer,
    folderWriter: platformAgentFolderWriter(db),
    provisioner: {
      probeRunner: readOnlyHttpProbeRunner,
      secretResolver: { resolve: (ref) => readTenantCredentialSecret(ref) },
    },
  });

  if (result.outcome !== "applied") {
    return {
      ok: true,
      action: "self_admit_connection",
      result: {
        outcome: result.outcome,
        ...(result.reason ? { reason: result.reason } : {}),
      },
    };
  }

  // Build the executable twcap ref for the admitted version's first operation.
  const descriptor = result.version?.descriptor_json as
    | CapabilityDescriptor
    | undefined;
  const firstOp = descriptor?.operations?.[0];
  const out: SelfAdmitConnectionResultOut = {
    outcome: "applied",
    ...(result.definition ? { definitionId: result.definition.id } : {}),
    ...(result.version
      ? {
          definitionVersionId: result.version.id,
          version: result.version.version,
        }
      : {}),
    ...(result.binding
      ? {
          bindingOutcome: result.binding.outcome,
          ...(result.binding.reason
            ? { bindingReason: result.binding.reason }
            : {}),
        }
      : {}),
  };
  if (descriptor && firstOp && result.version) {
    out.twcap = formatTwcapRef({
      namespace: descriptor.namespace,
      class: descriptor.class,
      slug: descriptor.slug,
      version: String(result.version.version),
      operationId: firstOp.operationId,
      contractHash: operationContractHash(firstOp),
    });
  }
  return { ok: true, action: "self_admit_connection", result: out };
}

/**
 * Autonomous self-approval (governed autonomy). An agent promotes a routine it
 * composed with NO human — gated fail-closed on the per-tenant opt-in and the
 * auto-tier classifier over every pinned dependency inside the lib. The
 * hermetic fixture gate still runs on the promoted SHA. A non-auto dependency →
 * held_for_review (the proposal stays in the operator queue).
 */
async function runSelfApproveRoutine(
  db: Db,
  context: CapabilityCallerContextPayload,
  event: CapabilityControlEvent,
): Promise<CapabilityControlResponse> {
  if (!isSelfExtensionEnabled(context.tenantId)) {
    return reject("self_extension_disabled");
  }
  const proposalId = asString(event.proposalId);
  if (!proposalId) {
    return reject(
      "invalid_proposal_id",
      "self_approve_routine requires a proposalId",
    );
  }
  if (!(await agentMaySelfExtend(db, context))) {
    return reject("folder_dispatch_required");
  }

  const result = await publishAutoComposedProposal(
    db,
    { tenantId: context.tenantId, proposalId, agentId: context.agentId },
    { promoter: createDefaultRoutineProposalPromoter() },
  );

  const gateSha =
    result.promotion?.outcome === "promoted"
      ? (result.promotion.validatedSha ?? undefined)
      : undefined;
  return {
    ok: true,
    action: "self_approve_routine",
    result: {
      outcome: result.outcome,
      ...(result.reason ? { reason: result.reason } : {}),
      ...(result.proposal
        ? {
            proposalId: result.proposal.id,
            ...(result.proposal.routine_id
              ? { routineId: result.proposal.routine_id }
              : {}),
          }
        : {}),
      ...(gateSha ? { gateSha } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handleCapabilityControl(
  event: CapabilityControlEvent,
  deps: CapabilityControlDeps = {},
): Promise<CapabilityControlResponse> {
  const action = asString(event.action);
  if (!CAPABILITY_CONTROL_ACTIONS.includes(action as CapabilityControlAction)) {
    return reject("unknown_action");
  }

  // Fail-closed identity: absent key or absent/forged context both reject
  // with a uniform reason; the typed detail goes to the structured log only.
  const publicKeyPem =
    deps.publicKeyPem !== undefined
      ? deps.publicKeyPem
      : readCapabilityPublicKey();
  if (!publicKeyPem) {
    console.error(
      `${LOG_PREFIX} CAPABILITY_SIGNING_PUBLIC_KEY unavailable — rejecting`,
    );
    return reject("invalid_caller_context");
  }
  const contextValue = asString(event.callerContext);
  if (!contextValue) {
    return reject("invalid_caller_context");
  }
  const verified = verifyCapabilityCallerContext({
    contextValue,
    publicKeyPem,
    nowMs: deps.nowMs ?? Date.now(),
  });
  if (!verified.ok) {
    console.warn(
      `${LOG_PREFIX} caller-context rejected: ${verified.reason} (action=${action})`,
    );
    return reject("invalid_caller_context");
  }
  const context = verified.payload;

  const db = deps.db ?? getDb();
  try {
    if (action === "capability_search") {
      return await runCapabilitySearch(db, context, event);
    }
    if (action === "routine_propose") {
      return await runRoutinePropose(db, context, event);
    }
    if (action === "self_admit_connection") {
      return await runSelfAdmitConnection(db, context, event);
    }
    if (action === "self_approve_routine") {
      return await runSelfApproveRoutine(db, context, event);
    }
    return await runConnectionResearch(db, context, event);
  } catch (err) {
    console.error(
      `${LOG_PREFIX} ${action} failed for tenant ${context.tenantId}:`,
      err,
    );
    return reject(
      "internal_error",
      err instanceof Error ? err.message : String(err),
    );
  }
}

/** Lambda entry (direct InvokeCommand, RequestResponse). */
export async function handler(
  event: CapabilityControlEvent,
): Promise<CapabilityControlResponse> {
  return handleCapabilityControl(event ?? {});
}

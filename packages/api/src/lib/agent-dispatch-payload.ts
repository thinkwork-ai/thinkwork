/**
 * Shared dispatch-control fields for AgentCore invoke payloads.
 *
 * Three sites dispatch agent turns: `chat-agent-invoke.ts` (`invokePayload`),
 * `wakeup-processor.ts` (`agentCorePayload`), and the wakeup turn-loop
 * re-invoke. The #2395 bug class is a dispatch-critical field added to the
 * chat path and silently missed on a wakeup builder — the runtime then drops
 * extension tools (ask_user_question, task-status, fetch_workspace_source)
 * or model governance on resume/automation turns.
 *
 * Contract (enforced by `wakeup-processor.dispatch-parity.test.ts`):
 * - Every dispatch-critical field lives HERE, never inline in a builder.
 * - `buildAgentDispatchControlFields` returns exactly the keys listed in
 *   `REQUIRED_DISPATCH_FIELDS` (keys are always present; unconfigured values
 *   are `undefined` and drop out at JSON serialization).
 * - All three builders spread the helper into their payload literal.
 *
 * Plan 2026-06-12-002 U1 (dynamic workspace) — wakeup dispatch payload parity.
 */

import type { AgentRuntimePiExtension } from "./resolve-agent-runtime-config.js";
import type { EffectiveWorkspaceModelRoutingEntry } from "./workspace-renderer/index.js";

/**
 * The dispatch-critical fields every AgentCore payload builder must carry.
 * Adding a field to `buildAgentDispatchControlFields` without listing it here
 * (or vice versa) fails the parity test.
 */
export const REQUIRED_DISPATCH_FIELDS = [
  "thinkwork_api_url",
  "thinkwork_api_secret",
  "thread_turn_id",
  "config_fingerprint",
  "capabilities_manifest_fingerprint",
  "agent_profiles",
  "agent_profiles_authority",
  "pi_extensions",
  "model_routing_policy",
  "approved_model_ids",
  "rendered_workspace_prefix",
  "turn_context",
  "fetch_workspace_source_enabled",
  "finalize_callback_url",
  "finalize_callback_secret",
  "activity_callback_url",
  "activity_callback_secret",
  "okf_wiki_navigator_enabled",
  "document_plates",
  "withheld_connections",
  "member_spaces",
  "capability_private_session",
  "capability_caller_context",
] as const;

export type RequiredDispatchField = (typeof REQUIRED_DISPATCH_FIELDS)[number];

export interface DispatchTurnContext {
  spaceId: string;
  tenantSlug: string | undefined;
  spaceSlug: string | null | undefined;
}

/**
 * THINK-261 #6 / company-brain plan U6 — a space the invoking user belongs
 * to, with the name the runtime's scope labels render. Rides the payload as
 * `member_spaces`, a top-level dispatch field rather than a `turn_context`
 * member: `turn_context` is null on personal threads, which is exactly where
 * member-space recall fan-out matters most.
 */
export interface DispatchMemberSpace {
  id: string;
  name: string;
}

/**
 * THINK-280 U4 — the capability-private broker session bootstrap the trusted
 * Pi host writes into a Code Interpreter session (reserved path, chmod 0600).
 * Mirrors `SessionBootstrap` (capability-contracts/session.ts) plus the
 * private-DNS-off transport fields (THINK-144). `privateKey` is the
 * short-lived (<=15 min) Ed25519 session capability — NEVER a provider
 * credential — and must never appear in logs, stdout, or error strings.
 */
export interface DispatchCapabilitySessionBootstrap {
  sessionId: string;
  audience: string;
  /** Endpoint-specific VPCE DNS name (private DNS disabled — THINK-144). */
  brokerEndpoint: string;
  /** Private REST API id targeted through the VPCE. */
  brokerApiId: string;
  /** Base64 PKCS#8 DER Ed25519 private key (session-scoped, <=15 min). */
  privateKey: string;
  /** Next sequence to allocate (starts at 0). */
  nextSequence: number;
  expiresAt: string;
  /** AWS region for the execute-api Host header (SDK derives a default). */
  region?: string;
}

/**
 * THINK-280 U4 — per-invocation capability-private sandbox selection. Rides the
 * dispatch payload as `capability_private_session`, carrying the capability-
 * private VPC-mode interpreter id (tenants.sandbox_interpreter_capability_
 * private_id) plus the opened broker session bootstrap the runtime materializes
 * into the session.
 *
 * INERT by contract: only present when the broker is enabled AND a session was
 * opened for an executable capability projection. Absent (undefined) on every
 * normal dispatch, in which case runtime sandbox behavior is exactly as today.
 * Session-opening lives in U7 — this slice only defines and threads the field.
 */
export interface DispatchCapabilityPrivateSession {
  /** capability-private interpreter id (tenants.sandbox_interpreter_capability_private_id). */
  interpreterId: string;
  /** Broker session bootstrap — carries the short-lived session key; never logged. */
  bootstrap: DispatchCapabilitySessionBootstrap;
}

export interface AgentDispatchControlFieldArgs {
  /**
   * Pass call-time reads (`thinkworkApiUrl()` / `getApiAuthSecret()`), never
   * module-load captures — the SSM config document may load after module
   * init, and vitest stubs env after import.
   */
  thinkworkApiUrl: string;
  apiAuthSecret: string;
  threadId: string | null | undefined;
  threadTurnId: string | null | undefined;
  piExtensions: AgentRuntimePiExtension[];
  modelRoutingPolicy:
    | { routes: EffectiveWorkspaceModelRoutingEntry[] }
    | undefined;
  approvedModelIds: string[] | undefined;
  renderedWorkspacePrefix: string | undefined;
  turnContext: DispatchTurnContext | null;
  okfWikiNavigatorEnabled: boolean;
  /**
   * Chat dispatches AgentCore Event-mode: the runtime POSTs its end-of-turn
   * result to the finalize callback and answers the invoke with
   * `{ finalize_dispatched: true }` instead of the turn body. The wakeup
   * paths invoke RequestResponse and own all writeback (assistant insert,
   * email replies, cost recording, turn loop) from the synchronous response —
   * configuring the finalize callback there would flip response ownership
   * and break that bookkeeping. Wakeup builders MUST pass `false` until the
   * wakeup response path understands `finalize_dispatched`.
   */
  includeFinalizeCallback: boolean;
  /**
   * THINK-153 KTD4: the tenant's visible registered plates
   * ([{slug, displayName, useFor}]) for the emit_document tool surface.
   * Fresh per dispatch; undefined (registry read failure or older caller)
   * degrades the Pi extension to its core-4 fallback — server-side registry
   * validation stays authoritative either way.
   */
  documentPlates?: Array<{
    slug: string;
    displayName: string;
    useFor: string;
    /** Plate-wide operator authoring instructions (untruncated). */
    authoringInstructions?: string;
    /** THINK-183 KTD8: enforced manifest sections (id + expected title). */
    sections?: Array<{
      id: string;
      title: string;
      tier: "required" | "required-if-material";
      /** Operator-authored section instructions (untruncated). */
      guidance?: string;
      /** Plate-suggested visualizations for this section. */
      suggestedDirectives?: Array<{ kind: string; chartType?: string }>;
    }>;
    /** THINK-183 KTD8: declared analyses with op input-shape hints. */
    analyses?: Array<{
      key: string;
      op: string;
      inputHint: string;
      guidance?: string;
    }>;
  }>;
  /**
   * Resolved-config fingerprint (capability-mapping plan U12, KTD-3):
   * computeConfigFingerprint over the dispatch's resolved runtime config +
   * selection. The container forwards it opaquely into the per-turn
   * capability manifest so the inspector can gate divergence assertions on
   * fingerprint equality (R15). Optional — older callers omit it and the
   * manifest row lands with a null fingerprint.
   */
  configFingerprint?: string;
  /**
   * Content address of the compiled capabilities manifest the render
   * produced for this turn (THINK-173 U5, KTD-1). The runtime reads the
   * pinned `capabilities/<fingerprint>.json` from the synced workspace —
   * in-flight turns keep their pinned bytes across mid-turn edits.
   * Optional during the migration window; a flag-on agent dispatched
   * without it fails the turn loudly at the runtime (R9).
   */
  capabilitiesManifestFingerprint?: string;
  /**
   * THINK-229 U4 (R8): analyst connections WITHHELD by this dispatch's
   * MCP build (probe failure, credential missing…), with the same
   * human-readable detail the capability inspector shows. The container
   * injects them into delegated-child context so the model names the
   * outage instead of estimating.
   */
  withheldConnections?: Array<{ slug: string; detail: string }>;
  /**
   * THINK-261 #6 — the invoking user's member spaces (id + name), resolved
   * fresh per dispatch by `memberSpacesForDispatch`. The runtime fans memory
   * recall out to these space banks and labels recalled memories with the
   * space name. Undefined for user-less dispatches (memory is skipped there
   * anyway) or when the best-effort lookup failed.
   */
  memberSpaces?: DispatchMemberSpace[];
  /**
   * THINK-280 U4 — capability-private sandbox selection + broker session
   * bootstrap for this invocation. Undefined on every normal dispatch (the
   * key drops out at JSON serialization); present only when the broker is
   * enabled and a session was opened (U7). The runtime selects the
   * capability-private interpreter and writes the SDK + bootstrap into the
   * session; when absent, single-interpreter behavior is unchanged.
   */
  capabilityPrivateSession?: DispatchCapabilityPrivateSession;
  /**
   * THINK-280 U2 dispatch wiring — the Ed25519-signed capability caller
   * context (`mintCapabilityCallerContext`) the runtime requires before it
   * registers ANY capability Pi tools (connection_research, routine_propose,
   * self_admit_capability, …). Undefined disables capability tools for the
   * dispatch (the control Lambda rejects absent contexts fail-closed; there
   * is no unsigned fallback). Builders mint it only for
   * `capability_folder_dispatch` agents, mirroring the manifest-fingerprint
   * folder-mode signal above.
   */
  capabilityCallerContext?: string;
}

export function buildAgentDispatchControlFields(
  args: AgentDispatchControlFieldArgs,
): Record<RequiredDispatchField, unknown> {
  const apiBase = args.thinkworkApiUrl
    ? args.thinkworkApiUrl.replace(/\/$/, "")
    : "";
  const callbacksReady = Boolean(apiBase && args.threadId && args.threadTurnId);

  return {
    // Extension gate: the runtime registers ask_user_question / task-status
    // (and other platform extensions) only when the payload carries the API
    // wiring plus the active turn id.
    thinkwork_api_url: args.thinkworkApiUrl || undefined,
    thinkwork_api_secret: args.apiAuthSecret || undefined,
    thread_turn_id: args.threadTurnId || undefined,
    config_fingerprint: args.configFingerprint || undefined,
    capabilities_manifest_fingerprint:
      args.capabilitiesManifestFingerprint || undefined,
    // Subagent-folders U11: sub-agent profiles are manifest-authoritative
    // everywhere — the payload never carries full profile bodies. Pi
    // assembles central profiles from the pinned capabilities manifest
    // (`class: "agent"` entries); the array stays `[]` by contract.
    agent_profiles: [],
    agent_profiles_authority: "manifest",
    withheld_connections:
      args.withheldConnections && args.withheldConnections.length > 0
        ? args.withheldConnections
        : undefined,
    // Dynamic Pi extensions are resolved at invocation time from approved,
    // enabled assignments. Keep this beside agent_profiles so every dispatch
    // path carries the same runtime extension set.
    pi_extensions: args.piExtensions,
    model_routing_policy: args.modelRoutingPolicy,
    approved_model_ids: args.approvedModelIds,
    rendered_workspace_prefix: args.renderedWorkspacePrefix,
    turn_context: args.turnContext
      ? {
          ...args.turnContext,
          renderedWorkspacePrefix: args.renderedWorkspacePrefix,
        }
      : undefined,
    // fetch_workspace_source gate (plan 2026-06-12-002 U5). Derived HERE so
    // every dispatch builder ships it identically: the runtime additionally
    // gates on eval_mode and on its own workspace-bucket host seam, so the
    // flag only asserts the API-side wiring is complete — bearer wiring, an
    // active turn for fetch-event snapshots, and a rendered (projected)
    // workspace for the routing tree the tool navigates.
    fetch_workspace_source_enabled: Boolean(
      args.thinkworkApiUrl &&
      args.apiAuthSecret &&
      args.threadId &&
      args.threadTurnId &&
      args.renderedWorkspacePrefix,
    ),
    // Finalize-callback opt-in (plan 2026-05-22-006 U3) — chat-path only,
    // see `includeFinalizeCallback`.
    finalize_callback_url:
      args.includeFinalizeCallback && callbacksReady
        ? `${apiBase}/api/threads/${args.threadId}/finalize`
        : undefined,
    finalize_callback_secret:
      args.includeFinalizeCallback && args.apiAuthSecret && args.threadTurnId
        ? args.apiAuthSecret
        : undefined,
    // Activity-callback opt-in (plan 2026-06-03-001). The Pi runtime POSTs
    // live mid-turn activity to this URL with the same bearer secret.
    // Best-effort — never blocks or alters the synchronous response, so it
    // is safe on every dispatch path.
    activity_callback_url: callbacksReady
      ? `${apiBase}/api/threads/${args.threadId}/activity`
      : undefined,
    activity_callback_secret:
      args.apiAuthSecret && args.threadTurnId ? args.apiAuthSecret : undefined,
    okf_wiki_navigator_enabled: args.okfWikiNavigatorEnabled || undefined,
    document_plates: args.documentPlates,
    member_spaces:
      args.memberSpaces && args.memberSpaces.length > 0
        ? args.memberSpaces
        : undefined,
    // THINK-280 U4 — capability-private selection + broker session bootstrap.
    // Undefined on normal dispatch (drops out at serialization); the runtime
    // treats its absence as "no capability-private" and keeps single-
    // interpreter behavior. Assembled by U7 once a broker session is opened.
    capability_private_session: args.capabilityPrivateSession ?? undefined,
    // THINK-280 U2 dispatch wiring — the runtime's capability-tool gate.
    // Absent on non-capability agents and when platform signing is
    // unavailable; the runtime then registers no capability tools.
    capability_caller_context: args.capabilityCallerContext || undefined,
  };
}

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

import type { AgentProfileRuntimeConfig } from "./resolve-agent-runtime-config.js";
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
  "agent_profiles",
  "model_routing_policy",
  "approved_model_ids",
  "rendered_workspace_prefix",
  "turn_context",
  "fetch_workspace_source_enabled",
  "finalize_callback_url",
  "finalize_callback_secret",
  "activity_callback_url",
  "activity_callback_secret",
] as const;

export type RequiredDispatchField = (typeof REQUIRED_DISPATCH_FIELDS)[number];

export interface DispatchTurnContext {
  spaceId: string;
  tenantSlug: string | undefined;
  spaceSlug: string | null | undefined;
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
  agentProfiles: AgentProfileRuntimeConfig[];
  modelRoutingPolicy:
    | { routes: EffectiveWorkspaceModelRoutingEntry[] }
    | undefined;
  approvedModelIds: string[] | undefined;
  renderedWorkspacePrefix: string | undefined;
  turnContext: DispatchTurnContext | null;
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
    // Always an array — `[]` (not absent) when the tenant has no profiles.
    agent_profiles: args.agentProfiles,
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
  };
}

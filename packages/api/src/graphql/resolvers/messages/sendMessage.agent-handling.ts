import type { ThreadMode } from "../../../lib/threads/thread-mode.js";

export type AgentDispatchRequest = "FORCE_ON" | "FORCE_OFF" | "AUTO";

export interface SendMessageAgentHandlingInput {
  isUserMessage: boolean;
  senderType: string;
  agentRequested?: boolean | null;
  // THINK-136 KTD2: explicit tri-state from updated clients. Wins over the
  // legacy agentRequested boolean when both are present.
  agentDispatch?: AgentDispatchRequest | null;
  // Reserved wire field predating the tri-state. It is passed through the
  // gate input at every call site but deliberately NOT consumed by the gate
  // predicates: agentDispatch governs dispatch; dispatchMode's
  // MANAGED_DEFAULT semantics stay untouched (KTD2 records the rationale for
  // a separate field rather than extending MessageDispatchMode).
  dispatchMode?: "MANAGED_DEFAULT" | null;
  hasAgentMentions: boolean;
}

export interface DefaultAgentDispatchInput extends SendMessageAgentHandlingInput {
  hasComputerThread: boolean;
  customerOnboardingHandled: boolean;
  // Server-derived Thread Mode (U3): override, else human participant count.
  // Consulted only when the resolved request is AUTO. Callers that cannot
  // derive it (legacy fixtures) may omit it; absent mode is treated as
  // "agent" so pre-Thread-Mode behavior is preserved.
  threadMode?: ThreadMode | null;
}

export function normalizeMessageSenderType(senderType: unknown) {
  const normalized =
    typeof senderType === "string" ? senderType.trim().toLowerCase() : "";
  if (!normalized || normalized === "human") return "user";
  return normalized;
}

// KTD2 legacy mapping: explicit true -> FORCE_ON (an unchanged mobile client's
// deliberate toggle-ON must keep dispatching even in a server-derived
// Multiplayer thread), explicit false -> FORCE_OFF, absent -> AUTO.
export function resolveAgentDispatchRequest(input: {
  agentDispatch?: AgentDispatchRequest | null;
  agentRequested?: boolean | null;
}): AgentDispatchRequest {
  if (input.agentDispatch) return input.agentDispatch;
  if (input.agentRequested === true) return "FORCE_ON";
  if (input.agentRequested === false) return "FORCE_OFF";
  return "AUTO";
}

function canRequestAgentHandling(input: SendMessageAgentHandlingInput) {
  return (
    input.isUserMessage &&
    input.senderType === "user" &&
    resolveAgentDispatchRequest(input) !== "FORCE_OFF"
  );
}

// R5/KTD2 explicit-off-wins: an explicit tri-state FORCE_OFF suppresses every
// dispatch route for this message, including agent mentions. Deliberately
// keyed on the tri-state field only — NOT on the legacy boolean: today's
// shipped behavior dispatches mentions unconditionally (the mention branch
// never consulted agentRequested), and legacy clients (mobile) send
// agentRequested:false as their derived default while relying on @mentions to
// engage the agent. Mapping legacy false into mention suppression would
// regress that core engagement path (Goal Capsule stop condition). Legacy
// boolean false therefore keeps exactly today's semantics: default dispatch
// suppressed, mention dispatch allowed.
export function shouldSuppressAgentMentionDispatch(
  input: Pick<SendMessageAgentHandlingInput, "agentDispatch">,
) {
  return input.agentDispatch === "FORCE_OFF";
}

export function shouldApplyCustomerOnboardingChatUpdate(
  input: SendMessageAgentHandlingInput,
) {
  return (
    input.isUserMessage &&
    input.senderType === "user" &&
    resolveAgentDispatchRequest(input) !== "FORCE_OFF" &&
    !input.hasAgentMentions
  );
}

// Precedence (KTD2, pinned by review): FORCE_OFF -> agent mentions (handled
// by the mention-dispatch route, so this default gate stays closed) ->
// FORCE_ON -> AUTO falls to Thread Mode.
export function shouldDispatchDefaultAgentTurn(
  input: DefaultAgentDispatchInput,
) {
  if (!canRequestAgentHandling(input)) return false;
  if (
    input.hasAgentMentions ||
    input.hasComputerThread ||
    input.customerOnboardingHandled
  ) {
    return false;
  }
  const request = resolveAgentDispatchRequest(input);
  if (request === "FORCE_ON") return true;
  // AUTO: the server-derived Thread Mode decides (R1/R4). Absent mode (legacy
  // callers/fixtures) preserves pre-Thread-Mode auto-dispatch.
  return (input.threadMode ?? "agent") === "agent";
}

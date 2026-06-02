export interface SendMessageAgentHandlingInput {
  isUserMessage: boolean;
  senderType: string;
  agentRequested?: boolean | null;
  dispatchMode?: "MANAGED_DEFAULT" | "DESKTOP_LOCAL" | null;
  hasAgentMentions: boolean;
}

export interface DefaultAgentDispatchInput extends SendMessageAgentHandlingInput {
  hasComputerThread: boolean;
  customerOnboardingHandled: boolean;
}

export function normalizeMessageSenderType(senderType: unknown) {
  const normalized =
    typeof senderType === "string" ? senderType.trim().toLowerCase() : "";
  if (!normalized || normalized === "human") return "user";
  return normalized;
}

function canRequestAgentHandling(input: SendMessageAgentHandlingInput) {
  return (
    input.isUserMessage &&
    input.senderType === "user" &&
    input.agentRequested !== false
  );
}

export function shouldApplyCustomerOnboardingChatUpdate(
  input: SendMessageAgentHandlingInput,
) {
  return (
    input.isUserMessage &&
    input.senderType === "user" &&
    input.agentRequested !== false &&
    !input.hasAgentMentions
  );
}

export function shouldDispatchDefaultAgentTurn(
  input: DefaultAgentDispatchInput,
) {
  return (
    canRequestAgentHandling(input) &&
    !input.hasAgentMentions &&
    !input.hasComputerThread &&
    !input.customerOnboardingHandled
  );
}

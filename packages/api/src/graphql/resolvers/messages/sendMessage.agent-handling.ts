export interface SendMessageAgentHandlingInput {
  isUserMessage: boolean;
  senderType: string;
  agentRequested?: boolean | null;
  hasAgentMentions: boolean;
}

export interface DefaultAgentDispatchInput
  extends SendMessageAgentHandlingInput {
  hasComputerThread: boolean;
  customerOnboardingHandled: boolean;
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
  return canRequestAgentHandling(input) && !input.hasAgentMentions;
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

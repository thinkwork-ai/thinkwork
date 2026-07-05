import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { shouldDispatchDefaultAgentTurn } from "./sendMessage.agent-handling.js";

const mutationSource = readFileSync(
  new URL("./sendMessage.mutation.ts", import.meta.url),
  "utf8",
);
const gateSource = readFileSync(
  new URL("./sendMessage.agent-handling.ts", import.meta.url),
  "utf8",
);

// THINK-170 R0 regression: the Customer Onboarding chat interceptor used to
// consume the turn for any un-@mentioned user message in a workflow-tagged
// thread (regex NLU match → canned sender_type:"system" reply →
// customerOnboardingHandled short-circuit → shouldDispatchDefaultAgentTurn
// returned false and the platform agent never ran). These tests pin the
// retirement: sendMessage must have NO interception path, and an
// un-@mentioned user message must fall through to normal Thread Mode
// dispatch with nothing workflow-specific able to suppress it.
describe("customer onboarding interception is retired (THINK-170 R0)", () => {
  it("sendMessage no longer calls the onboarding chat-update interceptor", () => {
    expect(mutationSource).not.toContain("applyCustomerOnboardingChatUpdate");
    expect(mutationSource).not.toContain("customer-onboarding-chat-updates");
  });

  it("sendMessage has no customerOnboardingHandled short-circuit", () => {
    expect(mutationSource).not.toContain("customerOnboardingHandled");
    expect(gateSource).not.toContain("customerOnboardingHandled");
  });

  it("the API layer inserts no canned system workflow replies for chat messages", () => {
    // The interceptor's assistant insert surfaced here as a notifyNewMessage
    // with senderType:"system"; no such relay may exist in the resolver.
    expect(mutationSource).not.toContain('senderType: "system"');
    expect(gateSource).not.toContain("shouldApplyCustomerOnboardingChatUpdate");
  });

  it("an un-@mentioned user message in an onboarding-tagged thread dispatches the default agent turn", () => {
    // Exactly the mcphersonoil.com repro shape: plain user message, no
    // mentions, AUTO dispatch, Agent thread mode. The gate input no longer
    // carries any onboarding field, so nothing workflow-specific can return
    // false here — this is the same decision every other space thread gets.
    expect(
      shouldDispatchDefaultAgentTurn({
        isUserMessage: true,
        senderType: "user",
        agentDispatch: "AUTO",
        hasAgentMentions: false,
        hasComputerThread: false,
        threadMode: "agent",
      }),
    ).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import {
  resolveAgentDispatchRequest,
  shouldApplyCustomerOnboardingChatUpdate,
  shouldDispatchDefaultAgentTurn,
  shouldSuppressAgentMentionDispatch,
  type DefaultAgentDispatchInput,
} from "./sendMessage.agent-handling.js";

function gateInput(
  overrides: Partial<DefaultAgentDispatchInput> = {},
): DefaultAgentDispatchInput {
  return {
    isUserMessage: true,
    senderType: "user",
    hasAgentMentions: false,
    hasComputerThread: false,
    customerOnboardingHandled: false,
    ...overrides,
  };
}

describe("resolveAgentDispatchRequest (KTD2 legacy mapping)", () => {
  it("prefers the explicit tri-state over the legacy boolean", () => {
    expect(
      resolveAgentDispatchRequest({
        agentDispatch: "FORCE_OFF",
        agentRequested: true,
      }),
    ).toBe("FORCE_OFF");
    expect(
      resolveAgentDispatchRequest({
        agentDispatch: "AUTO",
        agentRequested: false,
      }),
    ).toBe("AUTO");
  });

  it("maps legacy explicit true to FORCE_ON (mobile toggle-ON keeps dispatching)", () => {
    expect(resolveAgentDispatchRequest({ agentRequested: true })).toBe(
      "FORCE_ON",
    );
  });

  it("maps legacy explicit false to FORCE_OFF and absent to AUTO", () => {
    expect(resolveAgentDispatchRequest({ agentRequested: false })).toBe(
      "FORCE_OFF",
    );
    expect(resolveAgentDispatchRequest({})).toBe("AUTO");
    expect(resolveAgentDispatchRequest({ agentRequested: null })).toBe("AUTO");
  });
});

describe("shouldDispatchDefaultAgentTurn (U4 precedence)", () => {
  it("AUTO + Agent mode dispatches", () => {
    expect(
      shouldDispatchDefaultAgentTurn(
        gateInput({ agentDispatch: "AUTO", threadMode: "agent" }),
      ),
    ).toBe(true);
  });

  it("AUTO + Multiplayer does not dispatch (AE1)", () => {
    expect(
      shouldDispatchDefaultAgentTurn(
        gateInput({ agentDispatch: "AUTO", threadMode: "multiplayer" }),
      ),
    ).toBe(false);
  });

  it("FORCE_ON dispatches even in Multiplayer", () => {
    expect(
      shouldDispatchDefaultAgentTurn(
        gateInput({ agentDispatch: "FORCE_ON", threadMode: "multiplayer" }),
      ),
    ).toBe(true);
  });

  it("a #profile mention dispatches even in Multiplayer (explicit engagement)", () => {
    // Live regression: "#Analyst … @user" in one message derived Multiplayer
    // and the agent silently never engaged — profile mentions ride the
    // default route (requestedProfileSlug), not the mention-dispatch route.
    expect(
      shouldDispatchDefaultAgentTurn(
        gateInput({
          agentDispatch: "AUTO",
          threadMode: "multiplayer",
          hasAgentProfileMentions: true,
        }),
      ),
    ).toBe(true);
  });

  it("FORCE_OFF still suppresses a #profile mention (explicit-off-wins)", () => {
    expect(
      shouldDispatchDefaultAgentTurn(
        gateInput({
          agentDispatch: "FORCE_OFF",
          threadMode: "agent",
          hasAgentProfileMentions: true,
        }),
      ),
    ).toBe(false);
  });

  it("FORCE_OFF suppresses even in Agent mode", () => {
    expect(
      shouldDispatchDefaultAgentTurn(
        gateInput({ agentDispatch: "FORCE_OFF", threadMode: "agent" }),
      ),
    ).toBe(false);
  });

  it("override=agent restores AUTO dispatch with 2+ participants (AE2 — mode already derived upstream)", () => {
    // The override is folded into threadMode by deriveThreadMode before the
    // gate runs; the gate only sees the derived value.
    expect(
      shouldDispatchDefaultAgentTurn(
        gateInput({ agentDispatch: "AUTO", threadMode: "agent" }),
      ),
    ).toBe(true);
  });

  it("legacy agentRequested:false suppresses (unchanged behavior)", () => {
    expect(
      shouldDispatchDefaultAgentTurn(
        gateInput({ agentRequested: false, threadMode: "agent" }),
      ),
    ).toBe(false);
  });

  it("legacy explicit agentRequested:true dispatches even in a server-derived Multiplayer thread (FORCE_ON mapping)", () => {
    expect(
      shouldDispatchDefaultAgentTurn(
        gateInput({ agentRequested: true, threadMode: "multiplayer" }),
      ),
    ).toBe(true);
  });

  it("absent boolean + Agent mode dispatches; absent threadMode is treated as agent (legacy callers)", () => {
    expect(
      shouldDispatchDefaultAgentTurn(gateInput({ threadMode: "agent" })),
    ).toBe(true);
    expect(shouldDispatchDefaultAgentTurn(gateInput({}))).toBe(true);
  });

  it("dispatchMode MANAGED_DEFAULT is inert with every tri-state value (KTD2)", () => {
    for (const agentDispatch of ["FORCE_ON", "AUTO"] as const) {
      expect(
        shouldDispatchDefaultAgentTurn(
          gateInput({
            agentDispatch,
            dispatchMode: "MANAGED_DEFAULT",
            threadMode: "agent",
          }),
        ),
      ).toBe(true);
    }
    expect(
      shouldDispatchDefaultAgentTurn(
        gateInput({
          agentDispatch: "FORCE_OFF",
          dispatchMode: "MANAGED_DEFAULT",
          threadMode: "agent",
        }),
      ),
    ).toBe(false);
    expect(
      shouldDispatchDefaultAgentTurn(
        gateInput({
          agentDispatch: "AUTO",
          dispatchMode: "MANAGED_DEFAULT",
          threadMode: "multiplayer",
        }),
      ),
    ).toBe(false);
  });

  it("agent mentions keep the default gate closed (mention route owns dispatch)", () => {
    expect(
      shouldDispatchDefaultAgentTurn(
        gateInput({
          hasAgentMentions: true,
          agentDispatch: "FORCE_ON",
          threadMode: "agent",
        }),
      ),
    ).toBe(false);
  });

  it("computer threads and handled onboarding still short-circuit", () => {
    expect(
      shouldDispatchDefaultAgentTurn(
        gateInput({ hasComputerThread: true, threadMode: "agent" }),
      ),
    ).toBe(false);
    expect(
      shouldDispatchDefaultAgentTurn(
        gateInput({ customerOnboardingHandled: true, threadMode: "agent" }),
      ),
    ).toBe(false);
  });

  it("non-user senders never dispatch", () => {
    expect(
      shouldDispatchDefaultAgentTurn(
        gateInput({ senderType: "agent", threadMode: "agent" }),
      ),
    ).toBe(false);
    expect(
      shouldDispatchDefaultAgentTurn(
        gateInput({ isUserMessage: false, threadMode: "agent" }),
      ),
    ).toBe(false);
  });
});

describe("shouldSuppressAgentMentionDispatch (R5 explicit-off-wins)", () => {
  it("explicit tri-state FORCE_OFF suppresses mention dispatch", () => {
    expect(
      shouldSuppressAgentMentionDispatch({ agentDispatch: "FORCE_OFF" }),
    ).toBe(true);
  });

  it("legacy boolean false does NOT suppress mentions (today's mention-wins preserved for legacy clients)", () => {
    expect(shouldSuppressAgentMentionDispatch({ agentDispatch: null })).toBe(
      false,
    );
    expect(
      shouldSuppressAgentMentionDispatch({ agentDispatch: undefined }),
    ).toBe(false);
  });

  it("AUTO and FORCE_ON never suppress mentions", () => {
    expect(shouldSuppressAgentMentionDispatch({ agentDispatch: "AUTO" })).toBe(
      false,
    );
    expect(
      shouldSuppressAgentMentionDispatch({ agentDispatch: "FORCE_ON" }),
    ).toBe(false);
  });
});

describe("shouldApplyCustomerOnboardingChatUpdate honors the tri-state", () => {
  it("FORCE_OFF (explicit or legacy false) skips the onboarding update", () => {
    expect(
      shouldApplyCustomerOnboardingChatUpdate({
        isUserMessage: true,
        senderType: "user",
        agentDispatch: "FORCE_OFF",
        hasAgentMentions: false,
      }),
    ).toBe(false);
    expect(
      shouldApplyCustomerOnboardingChatUpdate({
        isUserMessage: true,
        senderType: "user",
        agentRequested: false,
        hasAgentMentions: false,
      }),
    ).toBe(false);
  });

  it("AUTO applies as before", () => {
    expect(
      shouldApplyCustomerOnboardingChatUpdate({
        isUserMessage: true,
        senderType: "user",
        hasAgentMentions: false,
      }),
    ).toBe(true);
  });
});

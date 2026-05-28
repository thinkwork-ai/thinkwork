import { describe, expect, it } from "vitest";

import {
  capturedSystemPromptFromFinalizePayload,
  isHiddenDesktopDelegation,
} from "./process-finalize";

describe("capturedSystemPromptFromFinalizePayload", () => {
  it("uses the top-level composed prompt from runtime finalize payloads", () => {
    expect(
      capturedSystemPromptFromFinalizePayload({
        composed_system_prompt: "Current date: Monday",
        response: {},
      }),
    ).toBe("Current date: Monday");
  });

  it("falls back to a nested response prompt for older callback shapes", () => {
    expect(
      capturedSystemPromptFromFinalizePayload({
        composed_system_prompt: null,
        response: { composed_system_prompt: "Runtime Tool Policy" },
      }),
    ).toBe("Runtime Tool Policy");
  });

  it("ignores blank prompt values", () => {
    expect(
      capturedSystemPromptFromFinalizePayload({
        composed_system_prompt: "   ",
        response: { composed_system_prompt: "" },
      }),
    ).toBeNull();
  });
});

describe("isHiddenDesktopDelegation", () => {
  it("detects hidden managed delegation turn contexts", () => {
    expect(
      isHiddenDesktopDelegation({
        desktop_managed_delegation: {
          visibility: "hidden",
        },
      }),
    ).toBe(true);
    expect(
      isHiddenDesktopDelegation({
        desktop_managed_delegation: {
          visibility: "visible",
        },
      }),
    ).toBe(false);
  });
});

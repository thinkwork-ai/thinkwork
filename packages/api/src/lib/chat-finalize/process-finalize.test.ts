import { describe, expect, it } from "vitest";

import {
  capturedSystemPromptFromFinalizePayload,
  diagnosticsFromFinalizePayload,
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

describe("diagnosticsFromFinalizePayload", () => {
  it("prefers usage diagnostics because they are persisted on usage_json", () => {
    expect(
      diagnosticsFromFinalizePayload({
        usage: { diagnostics: { local_pi_timings_ms: { total_ms: 123 } } },
        response: { diagnostics: { local_pi_timings_ms: { total_ms: 999 } } },
      }),
    ).toEqual({ local_pi_timings_ms: { total_ms: 123 } });
  });

  it("falls back to response diagnostics for older runtime payloads", () => {
    expect(
      diagnosticsFromFinalizePayload({
        response: { diagnostics: { local_pi_timings_ms: { total_ms: 456 } } },
      }),
    ).toEqual({ local_pi_timings_ms: { total_ms: 456 } });
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

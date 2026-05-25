import { describe, expect, it } from "vitest";
import { extractComposedSystemPrompt } from "./wakeup-processor.js";

describe("wakeup processor system prompt capture", () => {
  it("extracts the composed prompt returned at the top level", () => {
    expect(
      extractComposedSystemPrompt({
        composed_system_prompt: "  Current date: Monday\n\nUSER.md  ",
      }),
    ).toBe("Current date: Monday\n\nUSER.md");
  });

  it("falls back to composed prompt nested in response payloads", () => {
    expect(
      extractComposedSystemPrompt({
        response: {
          composed_system_prompt: "Runtime Tool Policy\n\nUSER.md",
        },
      }),
    ).toBe("Runtime Tool Policy\n\nUSER.md");
  });

  it("ignores empty prompt captures", () => {
    expect(
      extractComposedSystemPrompt({
        composed_system_prompt: " ",
        response: { composed_system_prompt: "" },
      }),
    ).toBeNull();
  });
});

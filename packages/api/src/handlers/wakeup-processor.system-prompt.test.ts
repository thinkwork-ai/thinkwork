import { readFileSync } from "node:fs";
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

  it("passes active Space slugs into wakeup AgentCore payloads", () => {
    const source = readFileSync(
      new URL("./wakeup-processor.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("runSpaceSlug");
    expect(source).toContain("tenantSlug: tenantSlug || undefined");
    expect(source).toContain(
      "spaceSlug: renderedWorkspace.activeSpace?.slug ?? runSpaceSlug",
    );
    expect(source.indexOf("turn_context: runSpaceId")).toBeGreaterThan(-1);
  });
});

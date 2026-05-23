import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readSource(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("built-in tools page", () => {
  const source = readSource("../builtin-tools.tsx");

  it("shows effective platform-agent tool access", () => {
    expect(source).toContain("Agent access");
    expect(source).toContain("tenant platform agent used by chat");
  });

  it("does not point operators to retired agent-template configuration", () => {
    expect(source).not.toContain("Agent template opt-in");
    expect(source).not.toContain("Agent Template");
    expect(source.toLowerCase()).not.toContain("agent template");
  });
});

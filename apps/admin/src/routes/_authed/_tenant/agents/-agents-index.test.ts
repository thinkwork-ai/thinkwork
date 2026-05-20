import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./index.tsx", import.meta.url), "utf8");

describe("Agents index mention identity", () => {
  it("uses the agent name as the mention surface without a separate mention column", () => {
    expect(source).toContain("<Bot");
    expect(source).toContain("{row.original.name}");
    expect(source).not.toContain('header: "Mention"');
    expect(source).not.toContain("mentionHandle");
    expect(source).not.toContain("AtSign");
  });
});

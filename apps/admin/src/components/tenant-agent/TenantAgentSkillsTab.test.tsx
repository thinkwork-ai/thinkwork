import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("TenantAgentSkillsTab", () => {
  it("mounts WorkspaceEditor in tenant catalog mode", () => {
    const source = readFileSync(
      new URL("./TenantAgentSkillsTab.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toMatch(/target=\{\{ catalog: true \}\}/);
    expect(source).toMatch(/mode="catalog"/);
    expect(source).toMatch(/className="min-h-\[620px\]"/);
  });
});

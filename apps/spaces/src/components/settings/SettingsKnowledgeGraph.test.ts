import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "src/components/settings/SettingsKnowledgeGraph.tsx"),
  "utf8",
);

describe("SettingsKnowledgeGraph", () => {
  it("exposes the Cognee deployment control in Spaces settings", () => {
    expect(source).toContain("Knowledge Graph");
    expect(source).toContain("SettingsSetKnowledgeGraphDeploymentMutation");
    expect(source).toContain("Toggle Knowledge Graph infrastructure");
    expect(source).toContain("Disable Knowledge Graph?");
    expect(source).toContain("deployment queued");
    expect(source).toContain("cogneeEndpoint");
    expect(source).toContain("cogneeLogGroupName");
  });
});

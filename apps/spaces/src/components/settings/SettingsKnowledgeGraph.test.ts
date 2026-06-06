import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  resolve(process.cwd(), "src/components/settings/SettingsKnowledgeGraph.tsx"),
  "utf8",
);
const configSource = readFileSync(
  resolve(
    process.cwd(),
    "src/components/settings/knowledge-graph/KnowledgeGraphConfigPanel.tsx",
  ),
  "utf8",
);

describe("SettingsKnowledgeGraph", () => {
  it("opens the Explorer by default and keeps config behind the info toggle", () => {
    expect(source).toContain("Knowledge Graph");
    expect(source).toContain("KnowledgeGraphExplorer");
    expect(source).toContain("KnowledgeGraphConfigPanel");
    expect(source).toContain("showConfig ? (");
    expect(source).toContain("<KnowledgeGraphConfigPanel />");
    expect(source).toContain("<KnowledgeGraphExplorer");
    expect(source).toContain("threadSheetOpen={threadSheetOpen}");
    expect(source).toContain("onThreadSheetOpenChange={setThreadSheetOpen}");
    expect(source).toContain("Open thread ingest");
    expect(source).toContain("Show Knowledge Graph configuration");
    expect(source).toContain("Show Knowledge Graph Explorer");
    expect(source).toContain("Inspect Cognee entities");
  });

  it("keeps service health in the config panel but leaves deploy control in General", () => {
    expect(configSource).toContain("KnowledgeGraphConfigPanel");
    expect(configSource).not.toContain(
      "SettingsSetKnowledgeGraphDeploymentMutation",
    );
    expect(configSource).not.toContain("Toggle Knowledge Graph infrastructure");
    expect(configSource).toContain("Managed application state");
    expect(configSource).toContain("cogneeEndpoint");
    expect(configSource).toContain("cogneeLogGroupName");
    expect(configSource).toContain("SettingsKnowledgeGraphHealthCheckQuery");
    expect(configSource).toContain("Test connection");
    expect(configSource).toContain("knowledgeGraphHealthCheck");
  });
});

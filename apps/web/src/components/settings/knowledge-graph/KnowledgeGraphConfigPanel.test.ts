import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const configSource = readFileSync(
  resolve(
    process.cwd(),
    "src/components/settings/knowledge-graph/KnowledgeGraphConfigPanel.tsx",
  ),
  "utf8",
);
const cogneeRouteSource = readFileSync(
  resolve(process.cwd(), "src/routes/_authed/settings.applications.cognee.tsx"),
  "utf8",
);

describe("KnowledgeGraphConfigPanel", () => {
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

  it("is no longer mounted by the legacy Cognee route", () => {
    expect(cogneeRouteSource).toContain('pluginKey: "company-brain"');
    expect(cogneeRouteSource).not.toContain("KnowledgeGraphConfigPanel");
  });
});

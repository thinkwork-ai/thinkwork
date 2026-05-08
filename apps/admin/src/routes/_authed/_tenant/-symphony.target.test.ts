import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

function readSource(path: string) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

describe("Symphony connector setup route", () => {
  const routeSource = readSource("./symphony.tsx");
  const helperSource = readSource("../../../lib/connector-admin.ts");

  it("keeps Linear connector setup on first-class form fields", () => {
    expect(routeSource).toContain("New Linear Connector");
    expect(routeSource).toContain("Edit Linear Connector");
    expect(routeSource).toContain("Linear team key");
    expect(routeSource).toContain("linearTeamKey");
    expect(routeSource).toContain("linearCredentialSlug");
    expect(routeSource).toContain("linearWritebackState");
    expect(routeSource).toContain("GitHub PR setup");
    expect(routeSource).toContain("GitHub credential");
    expect(routeSource).toContain("githubCredentialSlug");
    expect(routeSource).toContain("githubOwner");
    expect(routeSource).toContain("githubRepoName");
    expect(routeSource).toContain("githubBaseBranch");
    expect(routeSource).toContain("githubFilePath");
    expect(routeSource).toContain("Target Computer");
    expect(routeSource).toContain("linear_tracker");
  });

  it("keeps advanced JSON available without making it the primary path", () => {
    expect(routeSource).toContain("Advanced connector settings");
    expect(routeSource).toContain("Config JSON");
    expect(routeSource).toContain("linearTrackerStarterConfigJson");
    expect(routeSource.indexOf("Linear team key")).toBeLessThan(
      routeSource.indexOf("Config JSON"),
    );
    expect(routeSource.indexOf("GitHub PR setup")).toBeLessThan(
      routeSource.indexOf("Config JSON"),
    );
  });

  it("keeps the checkpoint connector pinned to the symphony label", () => {
    expect(helperSource).toContain('LINEAR_CHECKPOINT_LABEL = "symphony"');
    expect(helperSource).toContain(
      "Checkpoint connector label must be symphony.",
    );
    expect(helperSource).toContain("labels: [values.linearLabel.trim()]");
  });

  it("surfaces missing GitHub credentials before runtime failure", () => {
    expect(routeSource).toContain("TenantCredentialsQuery");
    expect(routeSource).toContain("TenantCredentialStatus.Active");
    expect(routeSource).toContain("connectorGitHubCredentialStatus");
    expect(routeSource).toContain("GitHub setup required");
    expect(routeSource).toContain("Active GitHub credential");
    expect(helperSource).toContain("github: {");
    expect(helperSource).toContain(
      "credentialSlug: values.githubCredentialSlug.trim()",
    );
  });

  it("preserves single-line, no-scroll Symphony tables", () => {
    expect(routeSource.match(/allowHorizontalScroll=\{false\}/g)).toHaveLength(
      2,
    );
    expect(
      routeSource.match(/table-fixed/g)?.length ?? 0,
    ).toBeGreaterThanOrEqual(2);
    expect(
      routeSource.match(/whitespace-nowrap/g)?.length ?? 0,
    ).toBeGreaterThanOrEqual(2);
  });
});

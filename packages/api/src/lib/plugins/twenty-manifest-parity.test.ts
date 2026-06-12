/**
 * U10 contract parity: the twenty plugin manifest's infrastructure
 * component must mirror the deployment-runner adapter's required inputs
 * for ENABLE/UPGRADE — the manifest declares input CONTRACTS, the
 * adapter is the executable truth. A drift here means the manifest
 * documents inputs the runner no longer requires (or misses new ones).
 */

import { describe, expect, it } from "vitest";
import { managedAppRegistry } from "@thinkwork/deployment-runner/apps/registry";
import { twentyManifest } from "@thinkwork/plugin-catalog";

function manifestInfraInputs(): string[] {
  const infra = twentyManifest.versions[0]!.components.find(
    (component) => component.type === "infrastructure",
  );
  if (infra?.type !== "infrastructure") {
    throw new Error("twenty manifest is missing its infrastructure component");
  }
  return Object.keys(infra.terraformInputs).sort();
}

describe("twenty manifest ↔ adapter parity", () => {
  const adapter = managedAppRegistry.find(
    (candidate) => candidate.appKey === "twenty",
  );

  it("references a registered managed-app adapter key", () => {
    expect(adapter).toBeDefined();
  });

  it("terraformInputs mirror the adapter requiredInputs for ENABLE and UPGRADE", () => {
    for (const operation of ["ENABLE", "UPGRADE"] as const) {
      const required = adapter!
        .requiredInputs(operation)
        .map((input) => input.key)
        .sort();
      expect(manifestInfraInputs()).toEqual(required);
    }
  });

  it("the endpointFrom configKey is one of the adapter's required inputs", () => {
    const mcp = twentyManifest.versions[0]!.components.find(
      (component) => component.type === "mcp-server",
    );
    if (mcp?.type !== "mcp-server") throw new Error("missing mcp component");
    expect(mcp.endpointFrom?.managedApp).toBe("twenty");
    expect(manifestInfraInputs()).toContain(mcp.endpointFrom?.configKey);
  });
});

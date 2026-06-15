/**
 * THNK-27 U3 contract parity: Plane's draft plugin manifest must stay aligned
 * with the deployment-runner adapter before the manifest is published.
 */

import { describe, expect, it } from "vitest";
import { managedAppRegistry } from "@thinkwork/deployment-runner/apps/registry";
import { allPluginManifests, planeManifest } from "@thinkwork/plugin-catalog";
import { assertManagedAppKey } from "./handlers/infra.js";

function planeInfraInputs(): string[] {
  const infra = planeManifest.versions[0]!.components.find(
    (component) => component.type === "infrastructure",
  );
  if (infra?.type !== "infrastructure") {
    throw new Error("plane manifest is missing its infrastructure component");
  }
  return Object.keys(infra.terraformInputs).sort();
}

describe("plane manifest ↔ adapter parity", () => {
  const adapter = managedAppRegistry.find(
    (candidate) => candidate.appKey === "plane",
  );

  it("references a registered managed-app adapter key", () => {
    expect(adapter).toBeDefined();
    expect(assertManagedAppKey("plane")).toBe("plane");
  });

  it("terraformInputs mirror the adapter requiredInputs for ENABLE and UPGRADE", () => {
    for (const operation of ["ENABLE", "UPGRADE"] as const) {
      const required = adapter!
        .requiredInputs(operation)
        .map((input) => input.key)
        .sort();
      expect(planeInfraInputs()).toEqual(required);
    }
  });

  it("remains exported but unpublished until runtime and MCP activation are executable", () => {
    expect(planeManifest.pluginKey).toBe("plane");
    expect(
      allPluginManifests.map((candidate) => candidate.pluginKey),
    ).not.toContain("plane");
  });

  it("does not declare an MCP server before Plane PAT header auth is modeled", () => {
    expect(
      planeManifest.versions[0]!.components.some(
        (component) => component.type === "mcp-server",
      ),
    ).toBe(false);
  });
});

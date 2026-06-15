/**
 * LastMile manifest ↔ recorded discovery metadata drift guard
 * (plan 2026-06-12-001 U9).
 *
 * Asserts the published manifest against the RFC 9728 protected-resource
 * metadata captured from LastMile's live develop-stage servers. The live
 * half of this guard lives in `plugins/lastmile/smoke/lastmile-plugin-smoke.mjs`,
 * which re-fetches the same endpoints; this test pins the manifest to the
 * recorded fixture so the two can only drift apart loudly.
 */

import { describe, expect, it } from "vitest";

import {
  validatePluginManifest,
  type McpServerComponent,
} from "@thinkwork/plugin-catalog/contracts";

import { lastmileDiscoveryFixture } from "../src/discovery.fixture";
import { lastmileManifest } from "../src/manifest";

const SERVER_KEYS = ["crm", "tasks", "routing"] as const;
const validatedLastmileManifest = validatePluginManifest(lastmileManifest);

function mcpServer(key: string): McpServerComponent {
  const component = validatedLastmileManifest.versions[0].components.find(
    (candidate) => candidate.type === "mcp-server" && candidate.key === key,
  );
  if (component?.type !== "mcp-server") {
    throw new Error(`manifest is missing mcp-server component "${key}"`);
  }
  return component;
}

describe("lastmile manifest vs recorded discovery metadata", () => {
  it("declares exactly the three discovered MCP servers", () => {
    const keys = validatedLastmileManifest.versions[0].components
      .filter((component) => component.type === "mcp-server")
      .map((component) => component.key)
      .sort();
    expect(keys).toEqual([...SERVER_KEYS].sort());
  });

  it.each(SERVER_KEYS)(
    "%s endpoint and resource indicator match the recorded resource",
    (key) => {
      const recorded = lastmileDiscoveryFixture[key];
      const component = mcpServer(key);
      expect(component.endpointUrl).toBe(recorded.resource);
      if (component.auth.mode !== "oauth") {
        throw new Error(`mcp-server "${key}" must declare oauth`);
      }
      expect(component.auth.resourceIndicator).toBe(recorded.resource);
    },
  );

  it.each(SERVER_KEYS)(
    "%s auth domain is the recorded authorization server",
    (key) => {
      const recorded = lastmileDiscoveryFixture[key];
      const component = mcpServer(key);
      if (component.auth.mode !== "oauth") {
        throw new Error(`mcp-server "${key}" must declare oauth`);
      }
      expect(recorded.authorization_servers).toContain(
        component.auth.authDomain,
      );
      // One AS covers the whole plugin — a single app-level activation.
      expect(recorded.authorization_servers).toHaveLength(1);
    },
  );

  it.each(SERVER_KEYS)(
    "requiredOauthScopes are exactly the scopes %s supports",
    (key) => {
      const recorded = lastmileDiscoveryFixture[key];
      expect(
        [...validatedLastmileManifest.versions[0].requiredOauthScopes].sort(),
      ).toEqual([...recorded.scopes_supported].sort());
    },
  );

  it("contains no placeholder values", () => {
    const serialized = JSON.stringify(lastmileManifest);
    expect(serialized).not.toMatch(/\.invalid/);
    expect(serialized).not.toMatch(/PLACEHOLDER/i);
  });
});

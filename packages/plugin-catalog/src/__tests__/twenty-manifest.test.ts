import { describe, expect, it } from "vitest";

import {
  PluginManifestError,
  validatePluginManifest,
  type McpServerComponent,
  type PluginManifest,
} from "../contracts";
import { allPluginManifests, twentyManifest } from "../plugins";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function manifest(mutate?: (manifest: PluginManifest) => void): PluginManifest {
  const copy = clone(twentyManifest);
  mutate?.(copy);
  return copy;
}

function mcpComponent(m: PluginManifest): McpServerComponent {
  const component = m.versions[0].components.find(
    (candidate) => candidate.type === "mcp-server",
  );
  if (component?.type !== "mcp-server") {
    throw new Error("twenty manifest is missing its mcp-server component");
  }
  return component;
}

describe("twenty plugin manifest", () => {
  it("is registered in the published catalog list", () => {
    expect(
      allPluginManifests.map((candidate) => candidate.pluginKey),
    ).toContain("twenty");
  });

  it("validates: one endpointFrom mcp-server + one infrastructure component", () => {
    const validated = validatePluginManifest(twentyManifest);
    expect(validated.pluginKey).toBe("twenty");
    expect(validated.versions[0].version).toBe("0.1.0");

    const components = validated.versions[0].components;
    expect(components.map((component) => component.type).sort()).toEqual([
      "infrastructure",
      "mcp-server",
    ]);

    const mcp = mcpComponent(validated);
    expect(mcp.endpointUrl).toBeUndefined();
    expect(mcp.endpointFrom).toEqual({
      managedApp: "twenty",
      configKey: "publicUrl",
      path: "/mcp",
    });
    expect(mcp.auth).toEqual({ mode: "oauth-per-instance" });
  });

  it("declares the infrastructure component against the twenty adapter key", () => {
    const infra = twentyManifest.versions[0].components.find(
      (component) => component.type === "infrastructure",
    );
    if (infra?.type !== "infrastructure") throw new Error("missing infra");
    expect(infra.managedAppKey).toBe("twenty");
    expect(Object.keys(infra.terraformInputs).sort()).toEqual([
      "certificateArn",
      "dbUrlSecretArn",
      "encryptionKeySecretArn",
      "imageUri",
      "publicUrl",
    ]);
    for (const spec of Object.values(infra.terraformInputs)) {
      expect(spec.description.length).toBeGreaterThan(0);
      expect(spec.type).toBe("string");
    }
  });

  it("rejects a component declaring both endpointUrl and endpointFrom", () => {
    const bad = manifest();
    mcpComponent(bad).endpointUrl = "https://crm.example.com/mcp";
    expect(() => validatePluginManifest(bad)).toThrow(
      /exactly one of endpointUrl \/ endpointFrom/,
    );
  });

  it("rejects a component declaring neither endpointUrl nor endpointFrom", () => {
    const bad = manifest();
    delete mcpComponent(bad).endpointFrom;
    expect(() => validatePluginManifest(bad)).toThrow(
      /exactly one of endpointUrl \/ endpointFrom/,
    );
  });

  it("rejects endpointFrom missing its configKey", () => {
    const bad = manifest();
    delete (mcpComponent(bad).endpointFrom as { configKey?: string }).configKey;
    expect(() => validatePluginManifest(bad)).toThrow(
      /endpointFrom\.configKey/,
    );
  });

  it("rejects an endpointFrom path that is not absolute or carries a query", () => {
    const noSlash = manifest();
    mcpComponent(noSlash).endpointFrom!.path = "mcp";
    expect(() => validatePluginManifest(noSlash)).toThrow(
      /path must start with "\/"/,
    );

    const query = manifest();
    mcpComponent(query).endpointFrom!.path = "/mcp?x=1";
    expect(() => validatePluginManifest(query)).toThrow(PluginManifestError);
  });

  it("rejects oauth-per-instance auth on a static-endpoint server", () => {
    const bad = manifest();
    const mcp = mcpComponent(bad);
    delete mcp.endpointFrom;
    mcp.endpointUrl = "https://crm.example.com/mcp";
    expect(() => validatePluginManifest(bad)).toThrow(
      /"oauth-per-instance" requires endpointFrom/,
    );
  });

  it("still requires non-empty scopes for STATIC oauth servers", () => {
    // The per-instance exemption must not relax the static-server rule.
    const bad = manifest();
    const mcp = mcpComponent(bad);
    delete mcp.endpointFrom;
    mcp.endpointUrl = "https://crm.example.com/mcp";
    mcp.auth = {
      mode: "oauth",
      authDomain: "https://auth.example.com",
      resourceIndicator: "https://crm.example.com/mcp",
    };
    expect(() => validatePluginManifest(bad)).toThrow(
      /non-empty requiredOauthScopes/,
    );
  });

  it("allows empty requiredOauthScopes for a per-instance-only manifest", () => {
    expect(twentyManifest.versions[0].requiredOauthScopes).toEqual([]);
    expect(() => validatePluginManifest(twentyManifest)).not.toThrow();
  });
});

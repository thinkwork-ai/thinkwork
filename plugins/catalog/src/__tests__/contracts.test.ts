import { describe, expect, it } from "vitest";

import {
  PluginManifestError,
  validatePluginManifest,
  type PluginManifest,
  type PluginVersion,
} from "../contracts";
import { lastmileManifest } from "../registry";

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function manifest(mutate?: (manifest: PluginManifest) => void): PluginManifest {
  const copy = clone(lastmileManifest);
  mutate?.(copy);
  return copy;
}

function version(m: PluginManifest): PluginVersion {
  return m.versions[0];
}

describe("validatePluginManifest", () => {
  it("validates the LastMile manifest (three OAuth MCP servers + skills)", () => {
    const validated = validatePluginManifest(lastmileManifest);
    expect(validated.pluginKey).toBe("lastmile");
    const components = validated.versions[0].components;
    expect(
      components.filter((component) => component.type === "mcp-server"),
    ).toHaveLength(3);
    expect(
      components.filter((component) => component.type === "skills"),
    ).toHaveLength(1);
    expect(validated.versions[0].requiredOauthScopes.length).toBeGreaterThan(0);
  });

  it("rejects non-object input", () => {
    expect(() => validatePluginManifest(null)).toThrow(PluginManifestError);
    expect(() => validatePluginManifest("lastmile")).toThrow(
      PluginManifestError,
    );
  });

  it("rejects a plugin key violating SLUG_RE", () => {
    expect(() =>
      validatePluginManifest(manifest((m) => (m.pluginKey = "Last_Mile"))),
    ).toThrow(/pluginKey/);
  });

  it("validates premium metadata for key-gated plugins", () => {
    const ok = manifest((m) => {
      m.premium = {
        entitlementProductKey: "lastmile",
        installKeyRequired: true,
        installKeyPrompt: "Enter the install key provided by ThinkWork.",
      };
    });
    expect(validatePluginManifest(ok).premium).toEqual({
      entitlementProductKey: "lastmile",
      installKeyRequired: true,
      installKeyPrompt: "Enter the install key provided by ThinkWork.",
    });
  });

  it("rejects premium metadata without a true install-key requirement", () => {
    const bad = manifest((m) => {
      m.premium = {
        entitlementProductKey: "lastmile",
        installKeyRequired: true,
        installKeyPrompt: "Enter the install key provided by ThinkWork.",
      };
      (m.premium as { installKeyRequired?: boolean }).installKeyRequired =
        false;
    });
    expect(() => validatePluginManifest(bad)).toThrow(
      /premium\.installKeyRequired must be true/,
    );
  });

  it("rejects premium metadata without an entitlement product key", () => {
    const bad = manifest((m) => {
      m.premium = {
        entitlementProductKey: "lastmile",
        installKeyRequired: true,
        installKeyPrompt: "Enter the install key provided by ThinkWork.",
      };
      (m.premium as { entitlementProductKey?: string }).entitlementProductKey =
        "";
    });
    expect(() => validatePluginManifest(bad)).toThrow(
      /premium\.entitlementProductKey/,
    );
  });

  it("rejects an unknown component type", () => {
    const bad = manifest();
    (version(bad).components[0] as { type: string }).type = "webhook";
    expect(() => validatePluginManifest(bad)).toThrow(
      /unknown component type "webhook"/,
    );
  });

  it("rejects duplicate component keys within a version", () => {
    const bad = manifest();
    (version(bad).components[1] as { key: string }).key = "crm";
    expect(() => validatePluginManifest(bad)).toThrow(
      /duplicate component key "crm"/,
    );
  });

  it("rejects a skill slug containing a slash", () => {
    const bad = manifest();
    const skills = version(bad).components.find(
      (component) => component.type === "skills",
    );
    if (skills?.type !== "skills") throw new Error("missing skills component");
    skills.skills[0].slug = "lastmile/crm-basics";
    expect(() => validatePluginManifest(bad)).toThrow(/skill slug/);
  });

  it("rejects duplicate skill slugs within a version", () => {
    const bad = manifest();
    const skills = version(bad).components.find(
      (component) => component.type === "skills",
    );
    if (skills?.type !== "skills") throw new Error("missing skills component");
    skills.skills.push({ ...skills.skills[0] });
    expect(() => validatePluginManifest(bad)).toThrow(/duplicate skill slug/);
  });

  it("rejects an OAuth mcp-server missing its auth domain", () => {
    const bad = manifest();
    const server = version(bad).components[0];
    if (server.type !== "mcp-server" || server.auth.mode !== "oauth") {
      throw new Error("expected oauth mcp-server");
    }
    (server.auth as { authDomain?: string }).authDomain = undefined;
    expect(() => validatePluginManifest(bad)).toThrow(/auth\.authDomain/);
  });

  it("rejects an OAuth mcp-server missing its resource indicator", () => {
    const bad = manifest();
    const server = version(bad).components[0];
    if (server.type !== "mcp-server" || server.auth.mode !== "oauth") {
      throw new Error("expected oauth mcp-server");
    }
    (server.auth as { resourceIndicator?: string }).resourceIndicator =
      undefined;
    expect(() => validatePluginManifest(bad)).toThrow(
      /auth\.resourceIndicator/,
    );
  });

  it("rejects an mcp-server without an auth declaration", () => {
    const bad = manifest();
    const server = version(bad).components[0];
    (server as { auth?: unknown }).auth = undefined;
    expect(() => validatePluginManifest(bad)).toThrow(/auth is required/);
  });

  it("rejects OAuth servers when the version declares no scopes", () => {
    const bad = manifest();
    version(bad).requiredOauthScopes = [];
    expect(() => validatePluginManifest(bad)).toThrow(
      /non-empty requiredOauthScopes/,
    );
  });

  it("accepts an empty scope set when no component uses OAuth", () => {
    const ok = manifest();
    version(ok).requiredOauthScopes = [];
    for (const component of version(ok).components) {
      if (component.type === "mcp-server") {
        component.auth = { mode: "none" };
      }
    }
    expect(() => validatePluginManifest(ok)).not.toThrow();
  });

  it("accepts user-provided header auth without OAuth scopes", () => {
    const ok = manifest();
    version(ok).requiredOauthScopes = [];
    const server = version(ok).components[0];
    if (server.type !== "mcp-server") throw new Error("missing mcp-server");
    server.auth = {
      mode: "user-provided-headers",
      headers: [
        {
          name: "x-api-key",
          credentialKey: "apiKey",
          displayName: "API key",
          secret: true,
        },
      ],
    };
    for (const component of version(ok).components.slice(1)) {
      if (component.type === "mcp-server") component.auth = { mode: "none" };
    }
    expect(() => validatePluginManifest(ok)).not.toThrow();
  });

  it("accepts user-provided bearer auth with auxiliary headers", () => {
    const ok = manifest();
    version(ok).requiredOauthScopes = [];
    const server = version(ok).components[0];
    if (server.type !== "mcp-server") throw new Error("missing mcp-server");
    server.auth = {
      mode: "user-provided-headers",
      bearer: {
        credentialKey: "apiKey",
        displayName: "API key",
        secret: true,
      },
      headers: [
        {
          name: "x-workspace-slug",
          credentialKey: "workspaceSlug",
          displayName: "Workspace slug",
        },
      ],
    };
    for (const component of version(ok).components.slice(1)) {
      if (component.type === "mcp-server") component.auth = { mode: "none" };
    }
    expect(() => validatePluginManifest(ok)).not.toThrow();
  });

  it("rejects Authorization-shaped user-provided header auth", () => {
    const bad = manifest();
    const server = version(bad).components[0];
    if (server.type !== "mcp-server") throw new Error("missing mcp-server");
    server.auth = {
      mode: "user-provided-headers",
      headers: [
        {
          name: "Authorization",
          credentialKey: "apiKey",
          displayName: "API key",
        },
      ],
    };
    expect(() => validatePluginManifest(bad)).toThrow(/not allowed/);
  });

  it("rejects malformed semver", () => {
    for (const bad of ["1.0", "v1.0.0", "1.0.0.0", "01.2.3", "not-semver"]) {
      expect(() =>
        validatePluginManifest(manifest((m) => (m.versions[0].version = bad))),
      ).toThrow(/not valid semver/);
    }
  });

  it("accepts prerelease and build-metadata semver", () => {
    for (const good of ["1.0.0-rc.1", "0.1.0+build.5", "2.3.4-beta.2+sha.1"]) {
      expect(() =>
        validatePluginManifest(manifest((m) => (m.versions[0].version = good))),
      ).not.toThrow();
    }
  });

  it("rejects duplicate versions within a plugin", () => {
    const bad = manifest((m) => m.versions.push(clone(m.versions[0])));
    expect(() => validatePluginManifest(bad)).toThrow(/duplicate version/);
  });

  it("rejects a non-URL mcp-server endpoint", () => {
    const bad = manifest();
    (version(bad).components[0] as { endpointUrl: string }).endpointUrl =
      "not a url";
    expect(() => validatePluginManifest(bad)).toThrow(/must be a valid URL/);
  });

  it("rejects an absolute supporting-file path", () => {
    const bad = manifest();
    const skills = version(bad).components.find(
      (component) => component.type === "skills",
    );
    if (skills?.type !== "skills") throw new Error("missing skills component");
    skills.skills[0].supportingFiles = [
      { path: "/etc/passwd", content: "nope" },
    ];
    expect(() => validatePluginManifest(bad)).toThrow(/folder-relative/);
  });

  it("rejects a path-traversal supporting-file path", () => {
    const bad = manifest();
    const skills = version(bad).components.find(
      (component) => component.type === "skills",
    );
    if (skills?.type !== "skills") throw new Error("missing skills component");
    skills.skills[0].supportingFiles = [
      { path: "../outside.md", content: "nope" },
    ];
    expect(() => validatePluginManifest(bad)).toThrow(/folder-relative/);
  });

  it("validates infrastructure and ui-surface components", () => {
    const ok = manifest((m) => {
      m.versions[0].components.push(
        {
          type: "infrastructure",
          key: "infra",
          managedAppKey: "twenty",
          terraformInputs: {
            instance_size: {
              description: "Instance size for the managed app",
              type: "string",
            },
          },
        },
        {
          type: "ui-surface",
          key: "dashboard",
          displayName: "LastMile dashboard",
          intendedMount: "settings.plugins.detail.tab",
        },
      );
    });
    expect(() => validatePluginManifest(ok)).not.toThrow();
  });

  it("rejects an infrastructure component with a malformed input spec", () => {
    const bad = manifest((m) => {
      m.versions[0].components.push({
        type: "infrastructure",
        key: "infra",
        managedAppKey: "twenty",
        terraformInputs: {
          instance_size: { description: "", type: "string" },
        },
      });
    });
    expect(() => validatePluginManifest(bad)).toThrow(
      /terraformInputs\["instance_size"\]\.description/,
    );
  });

  it("rejects a ui-surface component missing its intended mount", () => {
    const bad = manifest((m) => {
      m.versions[0].components.push({
        type: "ui-surface",
        key: "dashboard",
        displayName: "LastMile dashboard",
        intendedMount: "",
      });
    });
    expect(() => validatePluginManifest(bad)).toThrow(/intendedMount/);
  });
});

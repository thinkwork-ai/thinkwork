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

  it("accepts tenant service credential auth without OAuth scopes", () => {
    const ok = manifest();
    version(ok).requiredOauthScopes = [];
    const server = version(ok).components[0];
    if (server.type !== "mcp-server") throw new Error("missing mcp-server");
    delete server.endpointUrl;
    server.endpointFrom = {
      managedApp: "n8n",
      configKey: "publicUrl",
      path: "/mcp-server/http",
    };
    server.auth = {
      mode: "tenant-service-credential",
      credentialKind: "n8n-mcp-access-token",
      secretRefConfigKey: "serviceCredentialSecretArn",
      headers: [
        {
          name: "Authorization",
          secretJsonKey: "N8N_MCP_SERVICE_CREDENTIAL",
          valuePrefix: "Bearer ",
        },
      ],
    };
    for (const component of version(ok).components.slice(1)) {
      if (component.type === "mcp-server") component.auth = { mode: "none" };
    }
    expect(() => validatePluginManifest(ok)).not.toThrow();
  });

  it("accepts provider-neutral MCP record-link hints", () => {
    const ok = manifest();
    const server = version(ok).components[0];
    if (server.type !== "mcp-server") throw new Error("missing mcp-server");
    server.recordLinkHints = {
      schemaVersion: 1,
      source: "plugin-manifest",
      routes: [
        {
          objectType: "opportunity",
          routeTemplate: "/object/opportunity/{id}",
          idFields: ["id", "opportunityId"],
          labelFields: ["name"],
        },
      ],
      workspace: {
        hashField: "workspaceId",
      },
    };

    const validated = validatePluginManifest(ok);
    const validatedServer = validated.versions[0].components[0];
    if (validatedServer.type !== "mcp-server") {
      throw new Error("expected mcp-server");
    }
    expect(validatedServer.recordLinkHints).toEqual(server.recordLinkHints);
  });

  it("rejects unsafe MCP record-link route templates", () => {
    for (const routeTemplate of [
      "https://crm.example.com/object/opportunity/{id}",
      "//crm.example.com/object/opportunity/{id}",
      "/object/opportunity",
      "/object/opportunity/{id}?tab=details",
      "/object/opportunity/{id}#workspace",
      "/object/opportunity/{id}/related/{id}",
      "/object/opportunity/{id}/{workspaceId}",
      "/object/opportunity/prefix-{id}",
      "/object/opportunity/{id}/..",
      "/object/opportunity/%2F{id}",
      "/object/opportunity/{id} details",
      "/object/opportunity/<script>/{id}",
    ]) {
      const bad = manifest();
      const server = version(bad).components[0];
      if (server.type !== "mcp-server") throw new Error("missing mcp-server");
      server.recordLinkHints = {
        schemaVersion: 1,
        source: "plugin-manifest",
        routes: [{ objectType: "opportunity", routeTemplate }],
      };

      expect(() => validatePluginManifest(bad)).toThrow(/recordLinkHints/);
    }
  });

  it("rejects malformed MCP record-link object and field hints", () => {
    const badObjectType = manifest();
    const objectServer = version(badObjectType).components[0];
    if (objectServer.type !== "mcp-server") {
      throw new Error("missing mcp-server");
    }
    objectServer.recordLinkHints = {
      schemaVersion: 1,
      source: "plugin-manifest",
      routes: [
        {
          objectType: "Opportunity" as never,
          routeTemplate: "/object/opportunity/{id}",
        },
      ],
    };
    expect(() => validatePluginManifest(badObjectType)).toThrow(/objectType/);

    const badIdField = manifest();
    const idServer = version(badIdField).components[0];
    if (idServer.type !== "mcp-server") throw new Error("missing mcp-server");
    idServer.recordLinkHints = {
      schemaVersion: 1,
      source: "plugin-manifest",
      routes: [
        {
          objectType: "opportunity",
          routeTemplate: "/object/opportunity/{id}",
          idFields: ["id", ""] as never,
        },
      ],
    };
    expect(() => validatePluginManifest(badIdField)).toThrow(/idFields/);

    for (const field of [
      "auth_config.secretRef",
      "accessToken",
      "headers.Authorization",
    ]) {
      const badSensitiveField = manifest();
      const sensitiveServer = version(badSensitiveField).components[0];
      if (sensitiveServer.type !== "mcp-server") {
        throw new Error("missing mcp-server");
      }
      sensitiveServer.recordLinkHints = {
        schemaVersion: 1,
        source: "plugin-manifest",
        routes: [
          {
            objectType: "opportunity",
            routeTemplate: "/object/opportunity/{id}",
            idFields: [field],
          },
        ],
      };
      expect(() => validatePluginManifest(badSensitiveField)).toThrow(
        /credential-shaped/,
      );
    }
  });

  it("rejects extra MCP record-link hint fields", () => {
    for (const recordLinkHints of [
      {
        schemaVersion: 1,
        source: "plugin-manifest",
        baseUrl: "https://crm.example.com",
        routes: [
          {
            objectType: "opportunity",
            routeTemplate: "/object/opportunity/{id}",
          },
        ],
      },
      {
        schemaVersion: 1,
        source: "plugin-manifest",
        headers: { Authorization: "Bearer nope" },
        routes: [
          {
            objectType: "opportunity",
            routeTemplate: "/object/opportunity/{id}",
          },
        ],
      },
      {
        schemaVersion: 1,
        source: "plugin-manifest",
        routes: [
          {
            objectType: "opportunity",
            routeTemplate: "/object/opportunity/{id}",
            queryTemplate: "?token={token}",
          },
        ],
      },
      {
        schemaVersion: 1,
        source: "plugin-manifest",
        routes: [
          {
            objectType: "opportunity",
            routeTemplate: "/object/opportunity/{id}",
          },
        ],
        workspace: {
          hashField: "workspaceId",
          secretRef: "twenty-workspace-secret",
        },
      },
    ]) {
      const bad = manifest();
      const server = version(bad).components[0];
      if (server.type !== "mcp-server") throw new Error("missing mcp-server");
      server.recordLinkHints = recordLinkHints as never;

      expect(() => validatePluginManifest(bad)).toThrow(/not allowed/);
    }
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

  it("rejects tenant service credential auth without endpointFrom", () => {
    const bad = manifest();
    const server = version(bad).components[0];
    if (server.type !== "mcp-server") throw new Error("missing mcp-server");
    server.auth = {
      mode: "tenant-service-credential",
      credentialKind: "n8n-mcp-access-token",
      secretRefConfigKey: "serviceCredentialSecretArn",
      headers: [
        {
          name: "Authorization",
          secretJsonKey: "N8N_MCP_SERVICE_CREDENTIAL",
          valuePrefix: "Bearer ",
        },
      ],
    };
    expect(() => validatePluginManifest(bad)).toThrow(/requires endpointFrom/);
  });

  it("rejects raw values in tenant service credential manifests", () => {
    const bad = manifest();
    const server = version(bad).components[0];
    if (server.type !== "mcp-server") throw new Error("missing mcp-server");
    delete server.endpointUrl;
    server.endpointFrom = {
      managedApp: "n8n",
      configKey: "publicUrl",
      path: "/mcp-server/http",
    };
    server.auth = {
      mode: "tenant-service-credential",
      credentialKind: "n8n-mcp-access-token",
      secretRefConfigKey: "serviceCredentialSecretArn",
      headers: [
        {
          name: "Authorization",
          secretJsonKey: "N8N_MCP_SERVICE_CREDENTIAL",
          valuePrefix: "Bearer ",
          value: "do-not-ship",
        } as never,
      ],
    };
    expect(() => validatePluginManifest(bad)).toThrow(
      /value is not allowed in tenant-service-credential manifests/,
    );
  });

  it("requires Authorization service credentials to use Bearer auth", () => {
    const bad = manifest();
    const server = version(bad).components[0];
    if (server.type !== "mcp-server") throw new Error("missing mcp-server");
    delete server.endpointUrl;
    server.endpointFrom = {
      managedApp: "n8n",
      configKey: "publicUrl",
      path: "/mcp-server/http",
    };
    server.auth = {
      mode: "tenant-service-credential",
      credentialKind: "n8n-mcp-access-token",
      secretRefConfigKey: "serviceCredentialSecretArn",
      headers: [
        {
          name: "Authorization",
          secretJsonKey: "N8N_MCP_SERVICE_CREDENTIAL",
          valuePrefix: "Token ",
        },
      ],
    };
    expect(() => validatePluginManifest(bad)).toThrow(
      /must be "Bearer " for Authorization/,
    );
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

  it("validates auth-provider components", () => {
    const ok = manifest((m) => {
      m.versions[0].components.push({
        type: "auth-provider",
        key: "workos-auth",
        displayName: "WorkOS Cognito federation",
        provider: "workos",
        settingsSurface: "settings.plugins.workos-auth",
        cognitoIdentityProviderName: "WorkOSAuth",
        configFields: [
          {
            key: "issuerUrl",
            displayName: "WorkOS issuer URL",
            required: true,
            storage: "metadata",
          },
          {
            key: "clientSecret",
            displayName: "WorkOS client secret",
            required: true,
            storage: "secret-ref",
          },
        ],
        publicOptions: [
          {
            key: "sso",
            displayName: "Continue with SSO",
            providerSpecific: false,
            recommended: true,
          },
        ],
      });
    });
    expect(() => validatePluginManifest(ok)).not.toThrow();
  });

  it("rejects auth-provider config fields that expose values in the manifest", () => {
    const bad = manifest((m) => {
      m.versions[0].components.push({
        type: "auth-provider",
        key: "workos-auth",
        displayName: "WorkOS Cognito federation",
        provider: "workos",
        settingsSurface: "settings.plugins.workos-auth",
        cognitoIdentityProviderName: "WorkOSAuth",
        configFields: [
          {
            key: "clientSecret",
            displayName: "WorkOS client secret",
            required: true,
            storage: "secret-ref",
            value: "do-not-ship",
          } as never,
        ],
        publicOptions: [
          {
            key: "sso",
            displayName: "Continue with SSO",
            providerSpecific: false,
            recommended: true,
          },
        ],
      });
    });
    expect(() => validatePluginManifest(bad)).toThrow(
      /value is not allowed in auth-provider manifests/,
    );
  });

  it("validates an email-channel capability with Resend, SendGrid, and SES providers", () => {
    const ok = manifest((m) => {
      m.versions[0].capabilities = [
        {
          type: "email-channel",
          key: "agent-space-email",
          displayName: "Agent and Space email",
          providers: [
            {
              key: "resend",
              displayName: "Resend",
              recommended: true,
            },
            {
              key: "sendgrid",
              displayName: "SendGrid",
            },
            {
              key: "ses",
              displayName: "Amazon SES",
              compatibility: true,
            },
          ],
          settingsSurface: "settings.plugins.email-channel",
        },
      ];
    });
    expect(() => validatePluginManifest(ok)).not.toThrow();
  });

  it("rejects deferred email-channel providers", () => {
    const bad = manifest((m) => {
      m.versions[0].capabilities = [
        {
          type: "email-channel",
          key: "agent-space-email",
          displayName: "Agent and Space email",
          providers: [
            {
              key: "smtp" as "resend",
              displayName: "SMTP",
              recommended: true,
            },
          ],
          settingsSurface: "settings.plugins.email-channel",
        },
      ];
    });
    expect(() => validatePluginManifest(bad)).toThrow(
      /not a supported email-channel provider/,
    );
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

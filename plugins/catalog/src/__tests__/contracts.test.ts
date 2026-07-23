import { describe, expect, it } from "vitest";

import {
  PluginManifestError,
  validatePluginManifest,
  type PluginManifest,
  type PluginVersion,
} from "../contracts";

/**
 * Local fixture manifest exercising the richest contract surface: three
 * OAuth MCP servers plus a bundled skill. (Shape preserved from the
 * retired LastMile catalog entry, THINK-334 U6.)
 */
const FIXTURE_AUTH_DOMAIN = "https://fixture-auth.example.invalid";
const FIXTURE_MCP_BASE = "https://fixture-mcp.example.invalid";

const fixtureManifest = {
  pluginKey: "fixture-crm",
  displayName: "Fixture CRM",
  description:
    "Contract-test fixture plugin with CRM, task, and routing MCP servers.",
  versions: [
    {
      version: "0.1.0",
      requiredOauthScopes: ["openid", "email", "profile", "offline_access"],
      components: [
        {
          type: "mcp-server",
          key: "crm",
          displayName: "Fixture CRM",
          description: "Customer accounts and sales opportunities.",
          endpointUrl: `${FIXTURE_MCP_BASE}/crm`,
          auth: {
            mode: "oauth",
            authDomain: FIXTURE_AUTH_DOMAIN,
            resourceIndicator: `${FIXTURE_MCP_BASE}/crm`,
          },
        },
        {
          type: "mcp-server",
          key: "tasks",
          displayName: "Fixture Tasks",
          description: "Work orders and task assignments.",
          endpointUrl: `${FIXTURE_MCP_BASE}/tasks`,
          auth: {
            mode: "oauth",
            authDomain: FIXTURE_AUTH_DOMAIN,
            resourceIndicator: `${FIXTURE_MCP_BASE}/tasks`,
          },
        },
        {
          type: "mcp-server",
          key: "routing",
          displayName: "Fixture Routing",
          description: "Route planning and technician dispatch.",
          endpointUrl: `${FIXTURE_MCP_BASE}/routing`,
          auth: {
            mode: "oauth",
            authDomain: FIXTURE_AUTH_DOMAIN,
            resourceIndicator: `${FIXTURE_MCP_BASE}/routing`,
          },
        },
        {
          type: "skills",
          key: "skills",
          skills: [
            {
              slug: "fixture-crm--crm-basics",
              skillMd: [
                "---",
                "name: fixture-crm--crm-basics",
                "description: Fixture skill for contract validation tests.",
                "---",
                "",
                "# Fixture CRM basics",
                "",
                "Work CRM requests through the fixture MCP tools.",
              ].join("\n"),
            },
          ],
        },
      ],
    },
  ],
} as unknown as PluginManifest;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function manifest(mutate?: (manifest: PluginManifest) => void): PluginManifest {
  const copy = clone(fixtureManifest);
  mutate?.(copy);
  return copy;
}

function version(m: PluginManifest): PluginVersion {
  return m.versions[0];
}

describe("validatePluginManifest", () => {
  it("validates the fixture manifest (three OAuth MCP servers + skills)", () => {
    const validated = validatePluginManifest(fixtureManifest);
    expect(validated.pluginKey).toBe("fixture-crm");
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
    expect(() => validatePluginManifest("fixture-crm")).toThrow(
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
        entitlementProductKey: "fixture-crm",
        installKeyRequired: true,
        installKeyPrompt: "Enter the install key provided by ThinkWork.",
      };
    });
    expect(validatePluginManifest(ok).premium).toEqual({
      entitlementProductKey: "fixture-crm",
      installKeyRequired: true,
      installKeyPrompt: "Enter the install key provided by ThinkWork.",
    });
  });

  it("rejects premium metadata without a true install-key requirement", () => {
    const bad = manifest((m) => {
      m.premium = {
        entitlementProductKey: "fixture-crm",
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
        entitlementProductKey: "fixture-crm",
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
    skills.skills[0].slug = "fixture-crm/crm-basics";
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

  it("accepts provider-neutral MCP result transforms", () => {
    const ok = manifest();
    const server = version(ok).components[0];
    if (server.type !== "mcp-server") throw new Error("missing mcp-server");
    (server as unknown as Record<string, unknown>).resultTransforms = [
      {
        type: "scaled-integer-to-decimal",
        sourceField: "amountMicros",
        targetField: "value",
        scale: 6,
        removeSource: true,
      },
    ];

    const validated = validatePluginManifest(ok);
    const validatedServer = validated.versions[0].components[0];
    if (validatedServer.type !== "mcp-server") {
      throw new Error("expected mcp-server");
    }
    expect(
      (validatedServer as unknown as Record<string, unknown>).resultTransforms,
    ).toEqual((server as unknown as Record<string, unknown>).resultTransforms);
  });

  it("rejects unsafe or unbounded MCP result transforms", () => {
    for (const transform of [
      {
        type: "unknown-transform",
        sourceField: "amountMicros",
        targetField: "value",
        scale: 6,
      },
      {
        type: "scaled-integer-to-decimal",
        sourceField: "auth.token",
        targetField: "value",
        scale: 6,
      },
      {
        type: "scaled-integer-to-decimal",
        sourceField: "amountMicros",
        targetField: "value",
        scale: 100,
      },
    ]) {
      const bad = manifest();
      const server = version(bad).components[0];
      if (server.type !== "mcp-server") throw new Error("missing mcp-server");
      (server as unknown as Record<string, unknown>).resultTransforms = [
        transform,
      ];

      expect(() => validatePluginManifest(bad)).toThrow(/resultTransforms/);
    }
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
          displayName: "Fixture CRM dashboard",
          intendedMount: "settings.plugins.detail.tab",
          launch: {
            schemaVersion: 1,
            type: "app",
            appKey: "fixture-crm-dashboard",
            routeSegment: "dashboard",
            mount: "main-shell",
            runtime: "trusted-bundled-react",
            description: "Account engagement dashboard.",
            icon: "layout-dashboard",
            entitlementProductKey: "fixture-crm",
          },
        },
      );
    });
    expect(() => validatePluginManifest(ok)).not.toThrow();
  });

  it("accepts settings-only ui-surface components without launch metadata", () => {
    const ok = manifest((m) => {
      m.versions[0].components.push({
        type: "ui-surface",
        key: "settings",
        displayName: "Fixture CRM settings",
        intendedMount: "settings.plugins.detail.tab",
      });
    });
    const validated = validatePluginManifest(ok);
    const surface = validated.versions[0].components.find(
      (component) => component.type === "ui-surface",
    );
    expect(surface).toMatchObject({
      type: "ui-surface",
      key: "settings",
      displayName: "Fixture CRM settings",
      intendedMount: "settings.plugins.detail.tab",
    });
    expect(surface?.type === "ui-surface" ? surface.launch : undefined).toBe(
      undefined,
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
        displayName: "Fixture CRM dashboard",
        intendedMount: "",
      });
    });
    expect(() => validatePluginManifest(bad)).toThrow(/intendedMount/);
  });

  it("rejects malformed ui-surface launch metadata", () => {
    for (const launch of [
      null,
      {
        schemaVersion: 2,
        type: "app",
        appKey: "fixture-crm-dashboard",
        routeSegment: "dashboard",
        mount: "main-shell",
        runtime: "trusted-bundled-react",
      },
      {
        schemaVersion: 1,
        type: "widget",
        appKey: "fixture-crm-dashboard",
        routeSegment: "dashboard",
        mount: "main-shell",
        runtime: "trusted-bundled-react",
      },
      {
        schemaVersion: 1,
        type: "app",
        appKey: "Fixture_CRM",
        routeSegment: "dashboard",
        mount: "main-shell",
        runtime: "trusted-bundled-react",
      },
      {
        schemaVersion: 1,
        type: "app",
        appKey: "fixture-crm-dashboard",
        routeSegment: "/dashboard",
        mount: "main-shell",
        runtime: "trusted-bundled-react",
      },
      {
        schemaVersion: 1,
        type: "app",
        appKey: "fixture-crm-dashboard",
        routeSegment: "dashboard",
        mount: "settings",
        runtime: "trusted-bundled-react",
      },
      {
        schemaVersion: 1,
        type: "app",
        appKey: "fixture-crm-dashboard",
        routeSegment: "dashboard",
        mount: "main-shell",
        runtime: "remote-url",
      },
      {
        schemaVersion: 1,
        type: "app",
        appKey: "fixture-crm-dashboard",
        routeSegment: "dashboard",
        mount: "main-shell",
        runtime: "trusted-bundled-react",
        url: "https://example.com/dashboard",
      },
    ]) {
      const bad = manifest((m) => {
        m.versions[0].components.push({
          type: "ui-surface",
          key: "dashboard",
          displayName: "Fixture CRM dashboard",
          intendedMount: "settings.plugins.detail.tab",
          launch,
        } as never);
      });
      expect(() => validatePluginManifest(bad)).toThrow(/launch/);
    }
  });
});

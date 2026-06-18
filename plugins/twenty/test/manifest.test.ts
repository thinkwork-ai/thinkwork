import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { managedAppRegistry } from "@thinkwork/deployment-runner/apps/registry";

import {
  PluginManifestError,
  validatePluginManifest,
  type InfrastructureComponent,
  type McpServerComponent,
  type PluginManifest,
} from "@thinkwork/plugin-catalog/contracts";
import { defineFirstPartyPluginPackage } from "@thinkwork/plugin-catalog/plugin-package";

import { twentyPluginPackage } from "../src";
import { twentyManifest } from "../src/manifest";

const validatedTwentyManifest = validatePluginManifest(twentyManifest);
const testDir = dirname(fileURLToPath(import.meta.url));

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function manifest(mutate?: (manifest: PluginManifest) => void): PluginManifest {
  const copy = validatePluginManifest(clone(twentyManifest));
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

function infrastructureComponent(): InfrastructureComponent {
  const component = validatedTwentyManifest.versions[0].components.find(
    (candidate) => candidate.type === "infrastructure",
  );
  if (component?.type !== "infrastructure") {
    throw new Error("twenty manifest is missing its infrastructure component");
  }
  return component;
}

function adapterRequiredInputs(operation: "ENABLE" | "UPGRADE"): string[] {
  const adapter = managedAppRegistry.find(
    (candidate) => candidate.appKey === "twenty",
  );
  if (!adapter) {
    throw new Error("Twenty managed-app adapter is not registered");
  }
  return adapter
    .requiredInputs(operation)
    .map((input) => input.key)
    .sort();
}

function readTwentyApp(path: string): string {
  return readFileSync(join(testDir, "..", "twenty-app", path), "utf8");
}

describe("twenty plugin manifest", () => {
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

  it("owns a native Twenty app package for the ThinkWork Webhook workflow action", () => {
    const defined = defineFirstPartyPluginPackage(twentyPluginPackage);

    expect(defined.ownedSources).toContainEqual({
      kind: "runtime",
      path: "plugins/twenty/twenty-app",
      description:
        "Native Twenty app package that exposes the ThinkWork Webhook workflow action.",
    });

    const applicationConfig = readTwentyApp("src/application-config.ts");
    const workflowAction = readTwentyApp(
      "src/logic-functions/thinkwork-webhook.logic-function.ts",
    );

    expect(applicationConfig).toContain("defineApplication");
    expect(applicationConfig).toContain("displayName: APP_DISPLAY_NAME");
    expect(applicationConfig).toContain("THINKWORK_WEBHOOK_URL");
    expect(applicationConfig).toContain("isSecret: true");
    expect(applicationConfig).toContain("THINKWORK_TRIGGER_STAGE");
    expect(applicationConfig).toContain('value: "Customer"');
    expect(workflowAction).toContain("defineLogicFunction");
    expect(workflowAction).toContain("workflowActionTriggerSettings");
    expect(workflowAction).toContain('label: "ThinkWork Webhook"');
    expect(workflowAction).toContain("process.env.THINKWORK_WEBHOOK_URL");
    expect(workflowAction).toContain("process.env.THINKWORK_TRIGGER_STAGE");
    expect(workflowAction).toContain('status: "skipped_stage"');
    expect(workflowAction).toContain("triggerStage: configuredStage");
    expect(workflowAction).toContain('source: "twenty-app"');
    expect(workflowAction).not.toContain("opportunity.won");
  });

  it("declares the infrastructure component against the twenty adapter key", () => {
    const infra = infrastructureComponent();
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

  it("keeps infrastructure inputs aligned with the managed-app adapter", () => {
    const inputs = Object.keys(
      infrastructureComponent().terraformInputs,
    ).sort();
    expect(inputs).toEqual(adapterRequiredInputs("ENABLE"));
    expect(inputs).toEqual(adapterRequiredInputs("UPGRADE"));
    expect(inputs).toContain(
      mcpComponent(validatedTwentyManifest).endpointFrom?.configKey,
    );
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
    expect(validatedTwentyManifest.versions[0].requiredOauthScopes).toEqual([]);
    expect(() => validatePluginManifest(twentyManifest)).not.toThrow();
  });
});

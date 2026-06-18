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

function readRepo(path: string): string {
  return readFileSync(join(testDir, "..", "..", "..", path), "utf8");
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

    const appYarnLock = readTwentyApp("yarn.lock");
    const appNvmrc = readTwentyApp(".nvmrc");
    const appPackageJson = readTwentyApp("package.json");
    const appReadme = readTwentyApp("README.md");
    const applicationConfig = readTwentyApp("src/application-config.ts");
    const settingsComponent = readTwentyApp(
      "src/front-components/thinkwork-settings.front-component.tsx",
    );
    const workflowAction = readTwentyApp(
      "src/logic-functions/thinkwork-webhook.logic-function.ts",
    );

    expect(appYarnLock).toContain("twenty-sdk@npm:2.9.0");
    expect(appYarnLock).toContain("twenty-client-sdk@npm:2.9.0");
    expect(appNvmrc.trim()).toBe("24");
    expect(appPackageJson).toContain('"twenty": ">=2.9.0 <3.0.0"');
    expect(appReadme).toContain(
      "docs/runbooks/twenty-thinkwork-native-app-install.md",
    );
    expect(applicationConfig).toContain("defineApplication");
    expect(applicationConfig).toContain("displayName: APP_DISPLAY_NAME");
    expect(applicationConfig).toContain(
      "settingsCustomTabFrontComponentUniversalIdentifier",
    );
    expect(applicationConfig).toContain(
      "THINKWORK_SETTINGS_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER",
    );
    expect(applicationConfig).toContain("THINKWORK_WEBHOOK_URL");
    expect(applicationConfig).toContain("isSecret: true");
    expect(applicationConfig).toContain("THINKWORK_TRIGGER_STAGE");
    expect(applicationConfig).toContain('value: "Customer"');
    expect(settingsComponent).toContain("defineFrontComponent");
    expect(settingsComponent).toContain(
      "THINKWORK_SETTINGS_FRONT_COMPONENT_UNIVERSAL_IDENTIFIER",
    );
    expect(settingsComponent).toContain("updateOneApplicationVariable");
    expect(settingsComponent).toContain("THINKWORK_WEBHOOK_URL");
    expect(settingsComponent).toContain("THINKWORK_TRIGGER_STAGE");
    expect(settingsComponent).toContain("Customer");
    expect(workflowAction).toContain("defineLogicFunction");
    expect(workflowAction).not.toContain("databaseEventTriggerSettings");
    expect(workflowAction).toContain("workflowActionTriggerSettings");
    expect(workflowAction).toContain('label: "ThinkWork Webhook"');
    expect(workflowAction).toContain("process.env.THINKWORK_WEBHOOK_URL");
    expect(workflowAction).toContain("process.env.THINKWORK_TRIGGER_STAGE");
    expect(workflowAction).toContain('status: "skipped_stage"');
    expect(workflowAction).toContain("triggerStage: configuredStage");
    expect(workflowAction).toContain('source: "twenty-app"');
    expect(workflowAction).not.toContain("opportunity.won");
  });

  it("documents the guarded deployment sync path for installing the native app", () => {
    const deployWorkflow = readRepo(".github/workflows/deploy.yml");
    const operationsWorkflow = readRepo(
      ".github/workflows/twenty-thinkwork-app.yml",
    );
    const syncScript = readRepo(
      "plugins/twenty/scripts/sync-thinkwork-app.mjs",
    );
    const wireScript = readRepo(
      "plugins/twenty/scripts/wire-thinkwork-workflow.mjs",
    );

    expect(deployWorkflow).toContain("sync_twenty_thinkwork_app");
    expect(deployWorkflow).toContain("TWENTY_DEPLOY_API_KEY");
    expect(deployWorkflow).toContain("TWENTY_APP_SYNC_API_KEY");
    expect(deployWorkflow).toContain("sync-thinkwork-app.mjs");
    expect(deployWorkflow).toContain("wire-thinkwork-workflow.mjs");
    expect(operationsWorkflow).toContain("Twenty ThinkWork App Operations");
    expect(operationsWorkflow).toContain("validate-package");
    expect(operationsWorkflow).toContain("APPLY TWENTY THINKWORK APP");
    expect(operationsWorkflow).toContain(
      "YARN_ENABLE_IMMUTABLE_INSTALLS=false yarn install",
    );
    expect(operationsWorkflow).toContain("TWENTY_DEPLOY_API_KEY");
    expect(operationsWorkflow).toContain("sync-thinkwork-app.mjs");
    expect(operationsWorkflow).toContain("wire-thinkwork-workflow.mjs");
    expect(operationsWorkflow).not.toContain("terraform-apply");
    expect(syncScript).toContain("app:publish");
    expect(syncScript).toContain("--private");
    expect(syncScript).toContain("app:install");
    expect(syncScript).toContain("remote:status");
    expect(syncScript).toContain("--dry-run");
    expect(syncScript).not.toContain("HTTP_REQUEST");
    expect(wireScript).toContain('type: "LOGIC_FUNCTION"');
    expect(wireScript).toContain("UpdateWorkflowVersionStep");
    expect(wireScript).toContain("findManyLogicFunctions");
    expect(wireScript).not.toContain("AWS_LAMBDA");
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

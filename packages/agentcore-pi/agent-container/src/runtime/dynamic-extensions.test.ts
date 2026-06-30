import { describe, expect, it, vi } from "vitest";
import type { PiExtensionRuntimeDescriptor } from "@thinkwork/pi-runtime-core";
import { loadDynamicPiExtensions } from "./dynamic-extensions.js";

function descriptor(
  overrides: Partial<PiExtensionRuntimeDescriptor> = {},
): PiExtensionRuntimeDescriptor {
  return {
    extensionId: "11111111-1111-4111-8111-111111111111",
    versionId: "22222222-2222-4222-8222-222222222222",
    assignmentId: "33333333-3333-4333-8333-333333333333",
    sourceId: "11111111-1111-4111-8111-111111111111",
    name: "issue_search",
    displayName: "Issue Search",
    repositoryUrl: "https://github.com/acme/issues-extension",
    repositoryOwner: "acme",
    repositoryName: "issues-extension",
    sourceRef: "main",
    commitSha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    manifestHash:
      "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    artifactHash:
      "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    artifactUri:
      "github://acme/issues-extension/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    runtimeTarget: "agentcore-pi",
    targetType: "default_agent",
    agentProfileId: null,
    toolNames: ["search_issues"],
    lifecycleHooks: [],
    permissionClasses: [],
    grantedPermissionClasses: [],
    ...overrides,
  };
}

function fakePi() {
  const tools: Array<{ name: string; execute: () => Promise<unknown> }> = [];
  const hooks = new Map<string, Array<(event: unknown) => Promise<void>>>();
  return {
    api: {
      registerTool: (tool: unknown) => {
        tools.push(tool as { name: string; execute: () => Promise<unknown> });
      },
      on: (event: string, handler: (event: unknown) => Promise<void>) => {
        const list = hooks.get(event) ?? [];
        list.push(handler);
        hooks.set(event, list);
      },
    },
    tools,
    hooks,
  };
}

describe("loadDynamicPiExtensions", () => {
  it("registers a validated proxy factory and folds tool names into the allowlist", () => {
    const result = loadDynamicPiExtensions({
      value: [descriptor()],
      targetType: "default_agent",
      reservedToolNames: ["read"],
    });

    expect(result.extensionToolNames).toEqual(["search_issues"]);
    expect(result.extensionFactories).toHaveLength(1);
    expect(result.evidence).toMatchObject([
      {
        status: "loaded",
        name: "issue_search",
        toolNames: ["search_issues"],
        artifactHashPrefix: "cccccccccccc",
      },
    ]);

    const pi = fakePi();
    result.extensionFactories[0](pi.api as never);
    expect(pi.tools.map((tool) => tool.name)).toEqual(["search_issues"]);
  });

  it("loads hook-only extensions without adding model-visible tools", () => {
    const result = loadDynamicPiExtensions({
      value: [
        descriptor({
          toolNames: [],
          lifecycleHooks: ["before_agent_start"],
        }),
      ],
      targetType: "default_agent",
    });

    const pi = fakePi();
    result.extensionFactories[0](pi.api as never);
    expect(result.extensionToolNames).toEqual([]);
    expect(pi.tools).toEqual([]);
    expect(pi.hooks.get("before_agent_start")).toHaveLength(1);
  });

  it("skips malformed descriptors without throwing", () => {
    const log = vi.fn();
    const result = loadDynamicPiExtensions({
      value: [
        descriptor({
          artifactUri: "github://acme/issues-extension/not-the-commit",
        }),
      ],
      targetType: "default_agent",
      log,
    });

    expect(result.extensionFactories).toEqual([]);
    expect(result.extensionToolNames).toEqual([]);
    expect(result.evidence[0]).toMatchObject({
      status: "skipped",
      reason: "artifact_uri_mismatch",
    });
    expect(log).toHaveBeenCalledWith(
      "dynamic_pi_extension_skipped",
      expect.objectContaining({ reason: "artifact_uri_mismatch" }),
    );
  });

  it("rejects duplicate dynamic tool names against the existing surface", () => {
    const result = loadDynamicPiExtensions({
      value: [descriptor({ toolNames: ["read"] })],
      targetType: "default_agent",
      reservedToolNames: ["read"],
    });

    expect(result.extensionFactories).toEqual([]);
    expect(result.evidence[0]).toMatchObject({
      status: "skipped",
      reason: "duplicate_tool_name",
    });
  });

  it("keeps profile-scoped descriptors scoped to their assigned profile", () => {
    const result = loadDynamicPiExtensions({
      value: [
        descriptor({
          targetType: "agent_profile",
          agentProfileId: "44444444-4444-4444-8444-444444444444",
        }),
      ],
      targetType: "agent_profile",
      agentProfileId: "55555555-5555-4555-8555-555555555555",
    });

    expect(result.extensionFactories).toEqual([]);
    expect(result.evidence[0]).toMatchObject({
      status: "skipped",
      reason: "agent_profile_mismatch",
    });
  });

  it("fails closed when a descriptor requests provider access", () => {
    const result = loadDynamicPiExtensions({
      value: [
        descriptor({
          permissionClasses: ["network"],
          grantedPermissionClasses: ["network"],
        }),
      ],
      targetType: "default_agent",
    });

    expect(result.extensionFactories).toEqual([]);
    expect(result.evidence[0]).toMatchObject({
      status: "skipped",
      reason: "unavailable_provider",
    });
  });
});

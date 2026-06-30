import { describe, expect, it } from "vitest";
import {
  assertDynamicExtensionRunnerPayload,
  buildDynamicExtensionRunnerEnv,
  runDynamicExtension,
} from "./dynamic-extension-runner.js";

describe("dynamic extension runner boundary", () => {
  it("sanitizes inherited process environment", () => {
    const env = buildDynamicExtensionRunnerEnv({
      PATH: "/usr/bin",
      HOME: "/tmp",
      AWS_SECRET_ACCESS_KEY: "do-not-copy",
      THINKWORK_API_SECRET: "do-not-copy",
    });

    expect(env).toEqual({ PATH: "/usr/bin", HOME: "/tmp" });
  });

  it("bounds runner input payload size", () => {
    expect(() =>
      assertDynamicExtensionRunnerPayload({ value: "x".repeat(70 * 1024) }),
    ).toThrow(/exceeds/);
  });

  it("fails closed until an isolated signed executor is configured", async () => {
    const result = await runDynamicExtension({
      descriptor: {
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
      },
      operation: "tool",
      name: "search_issues",
      input: { query: "bug" },
    });

    expect(result).toMatchObject({
      ok: false,
      error:
        "Dynamic extension artifact execution is disabled until an isolated signed runner is configured.",
    });
  });
});

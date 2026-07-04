import { describe, expect, it } from "vitest";

import { buildInvocationResources } from "../src/server.js";
import { HandleStore } from "../src/mcp.js";
import { McpToolRegistry } from "../src/mcp-registry.js";
import { ARTIFACTS_TOOL_NAMES } from "@thinkwork/pi-extensions";

/**
 * THINK-145 U9 dark-tool guard. The activation allowlist gates the model to the
 * listed tool names — a registered extension tool omitted from the allowlist
 * silently never reaches the model. This test enumerates the artifacts
 * extension's declared tool names and asserts each one is folded into the
 * built allowlist (`bundle.extensionToolNames`) when the gate is satisfied,
 * and that none register when the gate is not (eval mode / userless turn).
 */

function baseArgs(
  overrides: {
    payload?: Record<string, unknown>;
    identity?: Partial<{
      tenantId: string;
      userId: string;
      agentId: string;
      threadId: string;
    }>;
  } = {},
) {
  return {
    payload: {
      tenant_id: "tenant-1",
      user_id: "user-1",
      assistant_id: "agent-1",
      thread_id: "thread-1",
      message: "hello",
      thinkwork_api_url: "https://api.example.com",
      thinkwork_api_secret: "test-secret-do-not-leak",
      ...(overrides.payload ?? {}),
    },
    identity: {
      tenantId: "tenant-1",
      userId: "user-1",
      agentId: "agent-1",
      threadId: "thread-1",
      tenantSlug: "",
      agentSlug: "",
      traceId: "",
      ...(overrides.identity ?? {}),
    },
    env: {
      awsRegion: "us-east-1",
      agentCoreMemoryId: "",
      hindsightEndpoint: "",
      memoryEngine: "managed" as const,
      memoryRetainFnName: "",
      dbClusterArn: "",
      dbSecretArn: "",
      dbName: "thinkwork",
      workspaceBucket: "",
      workspaceDir: "/tmp/workspace",
      piAgentDir: "/tmp/thinkwork-pi-agent",
      gitSha: "test",
    },
    agentCoreClient: {} as never,
    workspaceSkills: [],
    connectMcpServer: async () => [],
    sessionStoreFactory: () => ({}) as never,
    cleanup: [],
    handleStore: new HandleStore(),
    mcpJsonConfig: { directTools: [] },
    mcpRegistry: new McpToolRegistry(),
  };
}

describe("buildInvocationResources — artifacts extension allowlist (U9 dark-tool guard)", () => {
  it("folds every declared artifacts tool name into the activation allowlist", async () => {
    const bundle = await buildInvocationResources(baseArgs() as never);
    for (const name of ARTIFACTS_TOOL_NAMES) {
      expect(bundle.extensionToolNames).toContain(name);
    }
    bundle.handleStore.clear();
  });

  it("registers no artifacts tools when the turn has no acting user", async () => {
    const bundle = await buildInvocationResources(
      baseArgs({ identity: { userId: "" } }) as never,
    );
    for (const name of ARTIFACTS_TOOL_NAMES) {
      expect(bundle.extensionToolNames).not.toContain(name);
    }
    bundle.handleStore.clear();
  });

  it("registers no artifacts tools in eval mode", async () => {
    const bundle = await buildInvocationResources(
      baseArgs({ payload: { eval_mode: true } }) as never,
    );
    for (const name of ARTIFACTS_TOOL_NAMES) {
      expect(bundle.extensionToolNames).not.toContain(name);
    }
    bundle.handleStore.clear();
  });
});

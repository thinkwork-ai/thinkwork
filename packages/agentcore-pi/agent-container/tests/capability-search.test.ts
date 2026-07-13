/**
 * capability_search Pi tool tests (THINK-280 U2).
 *
 * The transport contract lives in capability-control-client.test.ts; this
 * suite pins the tool surface: name/parameters, exact-tuple forwarding,
 * and the never-throws failure rendering.
 */

import { describe, expect, it, vi } from "vitest";
import { InvokeCommand } from "@aws-sdk/client-lambda";
import {
  buildCapabilitySearchTool,
  CAPABILITY_SEARCH_TOOL_NAME,
} from "../src/runtime/tools/capability-search.js";

function lambdaReturning(body: unknown) {
  const send = vi.fn().mockResolvedValue({
    Payload: new TextEncoder().encode(JSON.stringify(body)),
  });
  return { client: { send }, send };
}

const ENV = { capabilityControlFnName: "capability-control-fn" };

describe("buildCapabilitySearchTool", () => {
  it("registers under the exact tool name", () => {
    const tool = buildCapabilitySearchTool({
      env: ENV,
      lambdaClient: lambdaReturning({}).client,
      callerContext: "ctx",
    });
    expect(tool.name).toBe(CAPABILITY_SEARCH_TOOL_NAME);
    expect(tool.name).toBe("capability_search");
  });

  it("forwards the exact invocation tuple + principal mode with the signed context", async () => {
    const { client, send } = lambdaReturning({
      ok: true,
      result: { found: true, twcap: "twcap://acme/..." },
    });
    const tool = buildCapabilitySearchTool({
      env: ENV,
      lambdaClient: client,
      callerContext: "signed-context",
    });
    const result = await tool.execute(
      "call-1",
      {
        namespace: "acme",
        class: "connection",
        slug: "github-rest",
        operationId: "repos.get",
        version: "2",
        principalMode: "service",
      },
      undefined as never,
      undefined as never,
    );
    const command = send.mock.calls[0]![0] as InvokeCommand;
    const payload = JSON.parse(
      new TextDecoder().decode(command.input.Payload as Uint8Array),
    );
    expect(payload).toEqual({
      action: "capability_search",
      callerContext: "signed-context",
      principalMode: "service",
      tuple: {
        namespace: "acme",
        class: "connection",
        slug: "github-rest",
        operationId: "repos.get",
        version: "2",
      },
    });
    expect(result.details).toMatchObject({ ok: true });
    expect(result.content[0]).toMatchObject({ type: "text" });
  });

  it("returns a safe text failure (never throws) when the context is unavailable", async () => {
    const { client, send } = lambdaReturning({});
    const tool = buildCapabilitySearchTool({
      env: ENV,
      lambdaClient: client,
      callerContext: "",
    });
    const result = await tool.execute(
      "call-1",
      {
        namespace: "acme",
        class: "connection",
        slug: "github-rest",
        operationId: "repos.get",
        principalMode: "service",
      },
      undefined as never,
      undefined as never,
    );
    expect(send).not.toHaveBeenCalled();
    expect(result.details).toMatchObject({
      ok: false,
      reason: "caller_context_unavailable",
    });
    expect((result.content[0] as { text: string }).text).toContain(
      "capability_search unavailable",
    );
  });
});

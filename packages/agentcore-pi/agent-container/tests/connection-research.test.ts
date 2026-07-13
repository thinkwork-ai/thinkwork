/**
 * connection_research Pi tool tests (THINK-280 U2).
 *
 * Pins the tool surface: name, query/proposal forwarding (research is
 * evidence-only — the request shape has no sign/bind/dispatch fields to
 * forward), and the never-throws failure rendering.
 */

import { describe, expect, it, vi } from "vitest";
import { InvokeCommand } from "@aws-sdk/client-lambda";
import {
  buildConnectionResearchTool,
  CONNECTION_RESEARCH_TOOL_NAME,
} from "../src/runtime/tools/connection-research.js";

function lambdaReturning(body: unknown) {
  const send = vi.fn().mockResolvedValue({
    Payload: new TextEncoder().encode(JSON.stringify(body)),
  });
  return { client: { send }, send };
}

const ENV = { capabilityControlFnName: "capability-control-fn" };

describe("buildConnectionResearchTool", () => {
  it("registers under the exact tool name", () => {
    const tool = buildConnectionResearchTool({
      env: ENV,
      lambdaClient: lambdaReturning({}).client,
      callerContext: "ctx",
    });
    expect(tool.name).toBe(CONNECTION_RESEARCH_TOOL_NAME);
    expect(tool.name).toBe("connection_research");
  });

  it("forwards query, allowExternal, and a draft proposal with the signed context", async () => {
    const { client, send } = lambdaReturning({
      ok: true,
      result: { state: "ok", definitions: [], proposals: [] },
    });
    const tool = buildConnectionResearchTool({
      env: ENV,
      lambdaClient: client,
      callerContext: "signed-context",
    });
    const result = await tool.execute(
      "call-1",
      {
        query: "github",
        allowExternal: true,
        proposal: {
          payload: { descriptor: { slug: "github-rest" } },
          sourceUrls: ["https://docs.github.com/rest"],
        },
      },
      undefined as never,
      undefined as never,
    );
    const command = send.mock.calls[0]![0] as InvokeCommand;
    const payload = JSON.parse(
      new TextDecoder().decode(command.input.Payload as Uint8Array),
    );
    expect(payload).toEqual({
      action: "connection_research",
      callerContext: "signed-context",
      query: "github",
      allowExternal: true,
      proposal: {
        payload: { descriptor: { slug: "github-rest" } },
        sourceUrls: ["https://docs.github.com/rest"],
      },
    });
    expect(result.details).toMatchObject({ ok: true });
  });

  it("returns a safe text failure (never throws) on a service rejection", async () => {
    const { client } = lambdaReturning({
      ok: false,
      reason: "invalid_caller_context",
    });
    const tool = buildConnectionResearchTool({
      env: ENV,
      lambdaClient: client,
      callerContext: "forged",
    });
    const result = await tool.execute(
      "call-1",
      { query: "github" },
      undefined as never,
      undefined as never,
    );
    expect(result.details).toMatchObject({
      ok: false,
      reason: "invalid_caller_context",
    });
    expect((result.content[0] as { text: string }).text).toContain(
      "connection_research unavailable",
    );
  });
});

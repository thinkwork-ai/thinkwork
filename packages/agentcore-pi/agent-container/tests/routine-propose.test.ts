/**
 * routine_propose Pi tool tests (THINK-280 U6).
 *
 * Pins the tool surface: name, bundle/routineId forwarding with the signed
 * context, and — critically — that the ONLY action the tool can send is
 * `routine_propose`. It has no path to approve, commit, validate, or
 * activate (those are operator/backend concerns; the tool cannot express
 * them).
 */

import { describe, expect, it, vi } from "vitest";
import { InvokeCommand } from "@aws-sdk/client-lambda";
import {
  buildRoutineProposeTool,
  ROUTINE_PROPOSE_TOOL_NAME,
} from "../src/runtime/tools/routine-propose.js";

function lambdaReturning(body: unknown) {
  const send = vi.fn().mockResolvedValue({
    Payload: new TextEncoder().encode(JSON.stringify(body)),
  });
  return { client: { send }, send };
}

const ENV = { capabilityControlFnName: "capability-control-fn" };

describe("buildRoutineProposeTool", () => {
  it("registers under the exact tool name", () => {
    const tool = buildRoutineProposeTool({
      env: ENV,
      lambdaClient: lambdaReturning({}).client,
      callerContext: "ctx",
    });
    expect(tool.name).toBe(ROUTINE_PROPOSE_TOOL_NAME);
    expect(tool.name).toBe("routine_propose");
  });

  it("forwards the bundle + routineId with the signed context under ONLY the routine_propose action", async () => {
    const { client, send } = lambdaReturning({
      ok: true,
      result: {
        outcome: "applied",
        proposalId: "p1",
        payloadFingerprint: "f",
        status: "submitted",
      },
    });
    const tool = buildRoutineProposeTool({
      env: ENV,
      lambdaClient: client,
      callerContext: "signed-context",
    });
    const bundle = {
      slug: "issue-health",
      code: "def run(input):\n    return {}\n",
    };
    const result = await tool.execute(
      "call-1",
      { routineId: "r1", bundle },
      undefined as never,
      undefined as never,
    );
    const command = send.mock.calls[0]![0] as InvokeCommand;
    const payload = JSON.parse(
      new TextDecoder().decode(command.input.Payload as Uint8Array),
    );
    expect(payload).toEqual({
      action: "routine_propose",
      callerContext: "signed-context",
      routineProposal: { routineId: "r1", bundle },
    });
    // No approve/commit/validate/activate fields exist on the wire.
    expect(Object.keys(payload).sort()).toEqual([
      "action",
      "callerContext",
      "routineProposal",
    ]);
    expect((result as { details: { ok: boolean } }).details.ok).toBe(true);
  });

  it("never throws — a service failure renders a safe text result", async () => {
    const send = vi.fn().mockResolvedValue({ FunctionError: "Unhandled" });
    const tool = buildRoutineProposeTool({
      env: ENV,
      lambdaClient: { send },
      callerContext: "ctx",
    });
    const result = (await tool.execute(
      "call-1",
      { bundle: {} },
      undefined as never,
      undefined as never,
    )) as { content: { text: string }[]; details: { ok: boolean } };
    expect(result.details.ok).toBe(false);
    expect(result.content[0].text).toContain("routine_propose unavailable");
  });

  it("short-circuits when the dispatch carried no signed caller context", async () => {
    const send = vi.fn();
    const tool = buildRoutineProposeTool({
      env: ENV,
      lambdaClient: { send },
      callerContext: "",
    });
    const result = (await tool.execute(
      "call-1",
      { bundle: {} },
      undefined as never,
      undefined as never,
    )) as { details: { ok: boolean; reason?: string } };
    expect(result.details.ok).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });
});

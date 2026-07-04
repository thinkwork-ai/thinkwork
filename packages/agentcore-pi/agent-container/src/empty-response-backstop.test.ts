import { describe, expect, it, vi } from "vitest";
import type { RunAgentLoopResult } from "@thinkwork/pi-runtime-core";

import {
  EmptyResponseError,
  applyEmptyResponseBackstop,
  turnProducedNoUserVisibleOutput,
} from "./empty-response-backstop.js";

function result(
  overrides: Partial<RunAgentLoopResult> = {},
): RunAgentLoopResult {
  return {
    content: "",
    modelId: "m",
    toolsCalled: [],
    toolInvocations: [],
    ...overrides,
  };
}

const okInvocation = (
  name: string,
  extra: Partial<RunAgentLoopResult["toolInvocations"][number]> = {},
): RunAgentLoopResult["toolInvocations"][number] => ({
  id: `${name}-1`,
  name,
  tool_name: name,
  status: "ok",
  is_error: false,
  runtime: "pi",
  ...extra,
});

describe("turnProducedNoUserVisibleOutput", () => {
  it("is true for empty text + no UI + no visible tool output", () => {
    expect(turnProducedNoUserVisibleOutput(result())).toBe(true);
    // A bare tool call (e.g. a read) is NOT user-visible.
    expect(
      turnProducedNoUserVisibleOutput(
        result({ toolInvocations: [okInvocation("bash")] }),
      ),
    ).toBe(true);
  });

  it("is false when the assistant produced text", () => {
    expect(
      turnProducedNoUserVisibleOutput(result({ content: "here you go" })),
    ).toBe(false);
    // whitespace-only text still counts as empty.
    expect(turnProducedNoUserVisibleOutput(result({ content: "  \n " }))).toBe(
      true,
    );
  });

  it("is false when a UI part was emitted (GenUI / state_snapshot)", () => {
    expect(
      turnProducedNoUserVisibleOutput(
        result({
          uiMessageParts: [
            { type: "data-json-render", id: "p1", data: {} } as never,
          ],
        }),
      ),
    ).toBe(false);
  });

  it("is false when a document card was emitted (emit_document posts directly)", () => {
    expect(
      turnProducedNoUserVisibleOutput(
        result({ toolInvocations: [okInvocation("emit_document")] }),
      ),
    ).toBe(false);
    // a FAILED emit_document is not user-visible output.
    expect(
      turnProducedNoUserVisibleOutput(
        result({
          toolInvocations: [
            okInvocation("emit_document", { is_error: true, status: "error" }),
          ],
        }),
      ),
    ).toBe(true);
  });

  it("is false when the turn asked a user question (ask_user_question posts directly)", () => {
    expect(
      turnProducedNoUserVisibleOutput(
        result({
          toolInvocations: [
            okInvocation("ask_user_question", {
              result: {
                details: {
                  thinkworkAskUserQuestion: { endTurn: true, questionId: "q1" },
                },
              },
            }),
          ],
        }),
      ),
    ).toBe(false);
  });
});

describe("applyEmptyResponseBackstop", () => {
  it("issues no retry when the turn already produced user-visible output", async () => {
    const retry = vi.fn();
    const out = await applyEmptyResponseBackstop({
      runResult: result({ content: "done" }),
      retry,
    });
    expect(retry).not.toHaveBeenCalled();
    expect(out.content).toBe("done");
  });

  it("issues no retry when a state_snapshot / UI part is present", async () => {
    const retry = vi.fn();
    const runResult = result({
      uiMessageParts: [
        { type: "data-json-render", id: "p1", data: {} } as never,
      ],
    });
    const out = await applyEmptyResponseBackstop({ runResult, retry });
    expect(retry).not.toHaveBeenCalled();
    expect(out).toBe(runResult);
  });

  it("issues exactly one forced continuation and returns it when it recovers", async () => {
    const logs: Array<Record<string, unknown>> = [];
    const retry = vi
      .fn()
      .mockResolvedValue(result({ content: "final answer" }));
    const out = await applyEmptyResponseBackstop({
      runResult: result(),
      retry,
      threadId: "t1",
      log: (entry) => logs.push(entry),
    });
    expect(retry).toHaveBeenCalledTimes(1);
    expect(out.content).toBe("final answer");
    expect(logs.map((l) => l.phase)).toEqual(["detected", "recovered"]);
  });

  it("throws EmptyResponseError when the retry is still empty (fail loudly)", async () => {
    const logs: Array<Record<string, unknown>> = [];
    const retry = vi.fn().mockResolvedValue(result());
    await expect(
      applyEmptyResponseBackstop({
        runResult: result(),
        retry,
        threadId: "t1",
        log: (entry) => logs.push(entry),
      }),
    ).rejects.toBeInstanceOf(EmptyResponseError);
    expect(retry).toHaveBeenCalledTimes(1);
    expect(logs.map((l) => l.phase)).toEqual(["detected", "failed"]);
    const err = new EmptyResponseError();
    expect(err.code).toBe("empty_response");
    expect(err.message).toContain("empty_response");
  });
});

import { InvokeCommand, type LambdaClient } from "@aws-sdk/client-lambda";
import { describe, expect, it, vi } from "vitest";

import { createLambdaCallbackFetch } from "../src/runtime/callback-lambda-fetch.js";

interface RecordedInvoke {
  command: InvokeCommand;
  input: InvokeCommand["input"];
  event: Record<string, unknown>;
}

function makeLambdaClient(recorder: RecordedInvoke[]): LambdaClient {
  return {
    send: vi.fn(async (command: InvokeCommand) => {
      const payload = command.input.Payload;
      const event =
        payload instanceof Uint8Array
          ? JSON.parse(new TextDecoder().decode(payload))
          : {};
      recorder.push({ command, input: command.input, event });
      return {
        Payload: new TextEncoder().encode(
          JSON.stringify({
            statusCode: 200,
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ ok: true }),
          }),
        ),
      };
    }),
  } as unknown as LambdaClient;
}

describe("createLambdaCallbackFetch", () => {
  it("invokes the finalize Lambda for chat finalize callbacks", async () => {
    const invocations: RecordedInvoke[] = [];
    const fallbackFetch = vi.fn();
    const fetchImpl = createLambdaCallbackFetch({
      fallbackFetch: fallbackFetch as unknown as typeof fetch,
      lambdaClient: makeLambdaClient(invocations),
      finalizeFunctionName: "thinkwork-dev-api-chat-agent-finalize",
      activityFunctionName: "thinkwork-dev-api-chat-agent-activity",
    });

    const response = await fetchImpl(
      "https://api.thinkwork.ai/api/threads/thread-1/finalize",
      {
        method: "POST",
        headers: {
          authorization: "Bearer secret",
          "content-type": "application/json",
        },
        body: JSON.stringify({ status: "ok" }),
      },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(fallbackFetch).not.toHaveBeenCalled();
    expect(invocations).toHaveLength(1);
    expect(invocations[0]?.input.FunctionName).toBe(
      "thinkwork-dev-api-chat-agent-finalize",
    );
    expect(invocations[0]?.event).toMatchObject({
      routeKey: "POST /api/threads/{threadId}/finalize",
      rawPath: "/api/threads/thread-1/finalize",
      pathParameters: { threadId: "thread-1" },
      body: JSON.stringify({ status: "ok" }),
    });
  });

  it("invokes the activity Lambda for chat activity callbacks", async () => {
    const invocations: RecordedInvoke[] = [];
    const fetchImpl = createLambdaCallbackFetch({
      fallbackFetch: vi.fn() as unknown as typeof fetch,
      lambdaClient: makeLambdaClient(invocations),
      finalizeFunctionName: "finalize-fn",
      activityFunctionName: "activity-fn",
    });

    await fetchImpl("https://api.thinkwork.ai/api/threads/thread-2/activity", {
      method: "POST",
      body: JSON.stringify({ event: "tool.start" }),
    });

    expect(invocations[0]?.input.FunctionName).toBe("activity-fn");
    expect(invocations[0]?.event).toMatchObject({
      routeKey: "POST /api/threads/{threadId}/activity",
      rawPath: "/api/threads/thread-2/activity",
      pathParameters: { threadId: "thread-2" },
    });
  });

  it("falls back to fetch for unrelated URLs", async () => {
    const invocations: RecordedInvoke[] = [];
    const fallbackResponse = new Response("ok", { status: 200 });
    const fallbackFetch = vi.fn(async () => fallbackResponse);
    const fetchImpl = createLambdaCallbackFetch({
      fallbackFetch: fallbackFetch as unknown as typeof fetch,
      lambdaClient: makeLambdaClient(invocations),
      finalizeFunctionName: "finalize-fn",
      activityFunctionName: "activity-fn",
    });

    const response = await fetchImpl(
      "https://api.thinkwork.ai/api/skills/complete",
      {
        method: "POST",
      },
    );

    expect(response).toBe(fallbackResponse);
    expect(fallbackFetch).toHaveBeenCalledOnce();
    expect(invocations).toHaveLength(0);
  });

  it("falls back when the target function name is not configured", async () => {
    const invocations: RecordedInvoke[] = [];
    const fallbackResponse = new Response("ok", { status: 202 });
    const fallbackFetch = vi.fn(async () => fallbackResponse);
    const logger = vi.fn();
    const fetchImpl = createLambdaCallbackFetch({
      fallbackFetch: fallbackFetch as unknown as typeof fetch,
      lambdaClient: makeLambdaClient(invocations),
      finalizeFunctionName: "",
      activityFunctionName: "activity-fn",
      logger,
    });

    const response = await fetchImpl(
      "https://api.thinkwork.ai/api/threads/thread-3/finalize",
      { method: "POST" },
    );

    expect(response.status).toBe(202);
    expect(fallbackFetch).toHaveBeenCalledOnce();
    expect(invocations).toHaveLength(0);
    expect(logger).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "lambda_callback_fetch_missing_function_name",
        target: "finalize",
        threadId: "thread-3",
      }),
    );
  });
});

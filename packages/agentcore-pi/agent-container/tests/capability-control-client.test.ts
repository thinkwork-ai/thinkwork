/**
 * capability-control-client tests (THINK-280 U2).
 *
 * Pins the never-throws contract, the RequestResponse invoke shape (the
 * signed caller context rides the payload; the fn name comes from the env
 * snapshot, never process.env), and the response parsing paths.
 */

import { describe, expect, it, vi } from "vitest";
import { InvokeCommand } from "@aws-sdk/client-lambda";
import {
  describeCapabilityControlFailure,
  invokeCapabilityControl,
  type CapabilityControlRequest,
} from "../src/runtime/tools/capability-control-client.js";

const REQUEST: CapabilityControlRequest = {
  action: "capability_search",
  tuple: {
    namespace: "acme",
    class: "connection",
    slug: "github-rest",
    operationId: "repos.get",
  },
  principalMode: "service",
};

function clientReturning(response: unknown) {
  const send = vi.fn().mockResolvedValue(response);
  return { client: { send }, send };
}

function encodeResponse(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

describe("invokeCapabilityControl", () => {
  it("short-circuits when the function name is unconfigured", async () => {
    const { client, send } = clientReturning({});
    const outcome = await invokeCapabilityControl({
      request: REQUEST,
      callerContext: "ctx",
      env: { capabilityControlFnName: "" },
      lambdaClient: client,
    });
    expect(outcome).toMatchObject({
      ok: false,
      reason: "capability_control_unconfigured",
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("short-circuits when the dispatch carried no signed caller context", async () => {
    const { client, send } = clientReturning({});
    const outcome = await invokeCapabilityControl({
      request: REQUEST,
      callerContext: "",
      env: { capabilityControlFnName: "fn" },
      lambdaClient: client,
    });
    expect(outcome).toMatchObject({
      ok: false,
      reason: "caller_context_unavailable",
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("invokes RequestResponse with the caller context inside the payload", async () => {
    const { client, send } = clientReturning({
      Payload: encodeResponse({ ok: true, result: { found: false } }),
    });
    const outcome = await invokeCapabilityControl({
      request: REQUEST,
      callerContext: "signed-context",
      env: { capabilityControlFnName: "capability-control-fn" },
      lambdaClient: client,
    });
    expect(outcome).toEqual({
      ok: true,
      action: "capability_search",
      result: { found: false },
    });
    const command = send.mock.calls[0]![0] as InvokeCommand;
    expect(command).toBeInstanceOf(InvokeCommand);
    expect(command.input.FunctionName).toBe("capability-control-fn");
    expect(command.input.InvocationType).toBe("RequestResponse");
    const payload = JSON.parse(
      new TextDecoder().decode(command.input.Payload as Uint8Array),
    );
    expect(payload).toMatchObject({
      action: "capability_search",
      callerContext: "signed-context",
      principalMode: "service",
      tuple: { slug: "github-rest" },
    });
  });

  it("maps a structured service rejection through without throwing", async () => {
    const { client } = clientReturning({
      Payload: encodeResponse({
        ok: false,
        reason: "invalid_caller_context",
      }),
    });
    const outcome = await invokeCapabilityControl({
      request: REQUEST,
      callerContext: "forged",
      env: { capabilityControlFnName: "fn" },
      lambdaClient: client,
    });
    expect(outcome).toEqual({ ok: false, reason: "invalid_caller_context" });
  });

  it("never throws on invoke errors", async () => {
    const send = vi.fn().mockRejectedValue(new Error("network down"));
    const outcome = await invokeCapabilityControl({
      request: REQUEST,
      callerContext: "ctx",
      env: { capabilityControlFnName: "fn" },
      lambdaClient: { send },
    });
    expect(outcome).toEqual({
      ok: false,
      reason: "invoke_failed",
      detail: "network down",
    });
  });

  it("surfaces Lambda FunctionError as a typed failure", async () => {
    const { client } = clientReturning({
      FunctionError: "Unhandled",
      Payload: encodeResponse({ errorMessage: "boom" }),
    });
    const outcome = await invokeCapabilityControl({
      request: REQUEST,
      callerContext: "ctx",
      env: { capabilityControlFnName: "fn" },
      lambdaClient: client,
    });
    expect(outcome).toEqual({
      ok: false,
      reason: "function_error",
      detail: "Unhandled",
    });
  });

  it("treats an empty or unparseable payload as a typed failure", async () => {
    const empty = await invokeCapabilityControl({
      request: REQUEST,
      callerContext: "ctx",
      env: { capabilityControlFnName: "fn" },
      lambdaClient: clientReturning({ Payload: new Uint8Array() }).client,
    });
    expect(empty).toEqual({ ok: false, reason: "empty_response" });

    const garbage = await invokeCapabilityControl({
      request: REQUEST,
      callerContext: "ctx",
      env: { capabilityControlFnName: "fn" },
      lambdaClient: clientReturning({
        Payload: new TextEncoder().encode("not json"),
      }).client,
    });
    expect(garbage).toEqual({ ok: false, reason: "unparseable_response" });
  });
});

describe("describeCapabilityControlFailure", () => {
  it("renders reason and optional detail", () => {
    expect(
      describeCapabilityControlFailure({ ok: false, reason: "invoke_failed" }),
    ).toBe("invoke_failed");
    expect(
      describeCapabilityControlFailure({
        ok: false,
        reason: "invoke_failed",
        detail: "network down",
      }),
    ).toBe("invoke_failed: network down");
  });
});

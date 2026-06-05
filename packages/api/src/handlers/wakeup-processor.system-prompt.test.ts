import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  extractComposedSystemPrompt,
  invokeAgentCore,
} from "./wakeup-processor.js";

const mocks = vi.hoisted(() => ({
  lambdaSend: vi.fn(),
}));

vi.mock("@aws-sdk/client-lambda", () => ({
  LambdaClient: vi.fn(() => ({ send: mocks.lambdaSend })),
  InvokeCommand: vi.fn((input) => ({ input })),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("AGENTCORE_FUNCTION_NAME", "strands-runtime-fn");
  vi.stubEnv("AGENTCORE_PI_FUNCTION_NAME", "pi-runtime-fn");
  mocks.lambdaSend.mockResolvedValue({
    Payload: new TextEncoder().encode(
      JSON.stringify({ statusCode: 200, body: JSON.stringify({ ok: true }) }),
    ),
  });
});

describe("wakeup processor system prompt capture", () => {
  it("extracts the composed prompt returned at the top level", () => {
    expect(
      extractComposedSystemPrompt({
        composed_system_prompt: "  Current date: Monday\n\nUSER.md  ",
      }),
    ).toBe("Current date: Monday\n\nUSER.md");
  });

  it("falls back to composed prompt nested in response payloads", () => {
    expect(
      extractComposedSystemPrompt({
        response: {
          composed_system_prompt: "Runtime Tool Policy\n\nUSER.md",
        },
      }),
    ).toBe("Runtime Tool Policy\n\nUSER.md");
  });

  it("ignores empty prompt captures", () => {
    expect(
      extractComposedSystemPrompt({
        composed_system_prompt: " ",
        response: { composed_system_prompt: "" },
      }),
    ).toBeNull();
  });

  it("passes active Space slugs into wakeup AgentCore payloads", () => {
    const source = readFileSync(
      new URL("./wakeup-processor.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("runSpaceSlug");
    expect(source).toContain("tenantSlug: tenantSlug || undefined");
    expect(source).toContain(
      "spaceSlug: renderedWorkspace.activeSpace?.slug ?? runSpaceSlug",
    );
    expect(source).toContain(
      "current_user_email: currentUserEmail || undefined",
    );
    expect(source).toContain("current_user_name: currentUserName || undefined");
    expect(source).toContain("checkUserBudgetAndPauseWork");
    expect(source).toContain("userId: costOwnerUserId ?? null");
    expect(source).toContain("user_id: costOwnerUserId || undefined");
    expect(source.indexOf("turn_context: runSpaceId")).toBeGreaterThan(-1);
  });

  it("routes legacy Strands wakeups to the Pi AgentCore runtime", async () => {
    const result = await invokeAgentCore({ message: "wake up" }, "strands");

    expect(result).toEqual({
      ok: true,
      status: 200,
      result: { ok: true },
    });
    expect(mocks.lambdaSend).toHaveBeenCalledTimes(1);
    const command = mocks.lambdaSend.mock.calls[0][0] as {
      input: { FunctionName: string; InvocationType: string };
    };
    expect(command.input).toMatchObject({
      FunctionName: "pi-runtime-fn",
      InvocationType: "RequestResponse",
    });
  });

  it("reports Pi runtime provisioning errors even for legacy wakeup selectors", async () => {
    vi.stubEnv("AGENTCORE_PI_FUNCTION_NAME", "");

    const result = await invokeAgentCore({ message: "wake up" }, "strands");

    expect(result).toMatchObject({
      ok: false,
      status: 503,
      result: {
        runtime_type: "pi",
        error: "Pi runtime not yet provisioned in this stage.",
      },
    });
    expect(mocks.lambdaSend).not.toHaveBeenCalled();
  });
});

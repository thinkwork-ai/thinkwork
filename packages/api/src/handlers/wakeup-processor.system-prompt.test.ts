import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  extractComposedSystemPrompt,
  invokeAgentCore,
  SOURCES_WITH_MESSAGES,
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
    expect(source.indexOf("turnContext: runSpaceId")).toBeGreaterThan(-1);
  });

  it("passes the extension gate fields so ask_user_question registers on wakeup turns", () => {
    const source = readFileSync(
      new URL("./wakeup-processor.ts", import.meta.url),
      "utf8",
    );

    // The runtime registers the ask_user_question (and task-status)
    // extensions only when the invoke payload carries the API wiring plus
    // the active turn id (server.ts gate). chat-agent-invoke passes these;
    // the wakeup path must too, or every question_answer resume /
    // automation turn silently loses the tool and asks in prose. The fields
    // now flow through the shared dispatch helper (plan 2026-06-12-002 U1);
    // wakeup-processor.dispatch-parity.test.ts holds the full contract.
    expect(source).toContain("thinkworkApiUrl: thinkworkApiUrl()");
    expect(source).toContain("apiAuthSecret: getApiAuthSecret()");
    expect(source).toContain("threadTurnId: run.id");
  });

  it("excludes every source-specific message branch from the catch-all assistant insert", () => {
    const source = readFileSync(
      new URL("./wakeup-processor.ts", import.meta.url),
      "utf8",
    );

    // Membership pin: question_answer replies through the chat branch
    // (same condition as chat_message/automation), so it MUST be excluded
    // from the catch-all or the assistant message is inserted twice.
    expect(SOURCES_WITH_MESSAGES).toEqual([
      "chat_message",
      "automation",
      "question_answer",
      "email_triage",
      "email_received",
      "webhook",
    ]);

    // The catch-all is gated on the exclusion list…
    expect(source).toContain("!SOURCES_WITH_MESSAGES.includes(wakeup.source)");
    // …and the chat branch really does handle question_answer.
    expect(source).toContain('wakeup.source === "question_answer"');
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

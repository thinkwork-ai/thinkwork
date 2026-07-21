import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  extractComposedSystemPrompt,
  invokeAgentCore,
  resolveWakeupRuntimeType,
  shouldInsertSyntheticWakeupUserMessage,
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
  it("resolves legacy tenant-selected AgentCore automation defaults to Pi (THINK-324)", () => {
    expect(
      resolveWakeupRuntimeType({
        source: "workflow_step",
        agentRuntime: "pi",
        templateRuntime: "pi",
        runtimeConfig: { defaultThreadRuntime: "agentcore" },
      }),
    ).toBe("pi");
  });

  it("honors a selected Pi runtime for background automation", () => {
    expect(
      resolveWakeupRuntimeType({
        source: "trigger",
        agentRuntime: "agentcore",
        templateRuntime: "agentcore",
        runtimeConfig: { defaultThreadRuntime: "pi" },
      }),
    ).toBe("pi");
  });

  it("does not reinterpret interactive wakeups after the default changes", () => {
    expect(
      resolveWakeupRuntimeType({
        source: "chat_message",
        agentRuntime: "pi",
        templateRuntime: "pi",
        runtimeConfig: { defaultThreadRuntime: "agentcore" },
      }),
    ).toBe("pi");
  });

  it("resolves a legacy harness question-resume pin to Pi (THINK-324)", () => {
    expect(
      resolveWakeupRuntimeType({
        source: "question_answer",
        agentRuntime: "pi",
        templateRuntime: "pi",
        runtimeConfig: { defaultThreadRuntime: "pi" },
        pinnedRuntimeType: "agentcore",
      }),
    ).toBe("pi");
  });

  it("resolves legacy agentcore agent rows to Pi when no default exists (THINK-324)", () => {
    expect(
      resolveWakeupRuntimeType({
        source: "agent_loop",
        agentRuntime: "agentcore",
        templateRuntime: "pi",
        runtimeConfig: {},
      }),
    ).toBe("pi");
  });

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

  it("resolves scheduled-job run-as into the dispatch identity (THINK-302 U7)", () => {
    const source = readFileSync(
      new URL("./wakeup-processor.ts", import.meta.url),
      "utf8",
    );

    // The scheduled_jobs run_as_user_id must be read at dispatch, revalidated,
    // and seed the SAME cost-owner/identity variable the render tuple reads —
    // so run-as composes the target user's scopes (R28) and is cost-owned by
    // them. Revalidation runs BEFORE the budget check.
    expect(source).toContain("run_as_user_id: scheduledJobs.run_as_user_id");
    expect(source).toContain("revalidateRunAsAtDispatch");
    expect(source).toContain("resolveRunAsTargetMembership");
    // Seeds the shared identity variable (parity with the chat path's userId).
    expect(source).toContain("costOwnerUserId = effectiveRunAsUserId");
    // The run-as DB read (unique to the dispatch block) must sit before the
    // budget-check call so budget is charged to the effective identity.
    expect(
      source.indexOf("run_as_user_id: scheduledJobs.run_as_user_id"),
      "run-as revalidation must precede the budget check",
    ).toBeLessThan(source.indexOf("checkUserBudgetAndPauseWork({"));
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

    // The synthetic user-message insert is gated through the shared helper…
    expect(source).toContain("shouldInsertSyntheticWakeupUserMessage({");
    // …and the chat branch really does handle question_answer.
    expect(source).toContain('wakeup.source === "question_answer"');
  });

  it("skips synthetic visible user messages for pre-seeded webhook openings only", () => {
    expect(
      shouldInsertSyntheticWakeupUserMessage({
        source: "webhook",
        payload: {
          openingMessageAlreadyPersisted: true,
          webhookPayload: { hello: "agent still sees this" },
        },
      }),
    ).toBe(false);
    expect(
      shouldInsertSyntheticWakeupUserMessage({
        source: "webhook",
        payload: {
          webhookPayload: { legacy: true },
        },
      }),
    ).toBe(true);
    expect(
      shouldInsertSyntheticWakeupUserMessage({
        source: "schedule",
        payload: null,
      }),
    ).toBe(true);
    expect(
      shouldInsertSyntheticWakeupUserMessage({
        source: "chat_message",
        payload: null,
      }),
    ).toBe(false);
    expect(
      shouldInsertSyntheticWakeupUserMessage({
        source: "question_answer",
        payload: null,
      }),
    ).toBe(false);
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

  it("routes legacy agentcore wakeups to the Pi function (THINK-324)", async () => {
    vi.stubEnv("AGENTCORE_PI_FUNCTION_NAME", "thinkwork-dev-agentcore-pi");

    const result = await invokeAgentCore({ message: "wake up" }, "agentcore");

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
      FunctionName: "thinkwork-dev-agentcore-pi",
      InvocationType: "RequestResponse",
    });
  });
});

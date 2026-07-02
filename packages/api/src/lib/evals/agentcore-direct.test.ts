import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AgentCoreEvalEmptyResponseError,
  buildEvalAgentCorePayload,
  extractAgentCoreUsage,
  DEFAULT_EVAL_AGENTCORE_MAX_ATTEMPTS,
  DEFAULT_EVAL_MAX_TOKENS,
  DEFAULT_EVAL_MODEL_ID,
  evalAgentCoreAttemptSessionId,
  evalAgentCoreInvokeTimeoutMs,
  evalMaxTokens,
  evalModelId,
  extractAgentCoreResponseText,
  invokeAgentCoreForEval,
  selectReplayMcpTools,
  type EvalReplayToolOverride,
} from "./agentcore-direct.js";
import { resolveAgentRuntimeConfig } from "../resolve-agent-runtime-config.js";
import type { AgentRuntimeConfig } from "../resolve-agent-runtime-config.js";

const lambdaSendMock = vi.hoisted(() => vi.fn());
vi.mock("@aws-sdk/client-lambda", () => ({
  LambdaClient: class {
    send = (...args: unknown[]) => lambdaSendMock(...args);
  },
  InvokeCommand: class {
    constructor(public readonly input: { Payload?: Uint8Array }) {}
  },
}));

vi.mock("../resolve-agent-runtime-config.js", () => ({
  resolveAgentRuntimeConfig: vi.fn(),
}));

vi.mock("../resolve-runtime-function-name.js", () => ({
  resolveRuntimeFunctionName: () => "thinkwork-test-agentcore-pi",
}));

const runtimeConfig: AgentRuntimeConfig = {
  tenantId: "tenant-1",
  tenantSlug: "acme",
  agentId: "agent-1",
  agentName: "Eval Agent",
  agentSlug: "eval-agent",
  agentSystemPrompt: "Base prompt",
  humanName: undefined,
  humanPairId: null,
  templateId: "template-1",
  templateModel: "us.anthropic.claude-sonnet-4-6",
  budgetMonthlyCents: 10_000,
  budgetPaused: false,
  blockedTools: [],
  sandboxTemplate: null,
  browserAutomationEnabled: false,
  threadJsonRenderUiEnabled: false,
  contextEngineEnabled: false,
  guardrailId: null,
  guardrailConfig: undefined,
  runtimeType: "pi",
  skillsConfig: [],
  trustedSkillIds: [],
  webExtractConfig: {
    toolSlug: "web-extract",
    provider: "firecrawl",
    apiKey: "fc-key",
    config: null,
  },
  knowledgeBasesConfig: undefined,
  mcpConfigs: [],
  piExtensions: [],
  agentProfilesConfig: [],
};

describe("direct AgentCore eval payload", () => {
  it("defaults eval invocations to Kimi K2.5 and disables memory", () => {
    const payload = buildEvalAgentCorePayload({
      tenantId: "tenant-1",
      agentId: "agent-1",
      sessionId: "session-1",
      message: "Refuse this unsafe request",
      model: null,
      systemPrompt: null,
      runtimeConfig,
    });

    expect(payload).toMatchObject({
      assistant_id: "agent-1",
      thread_id: "session-1",
      trigger_channel: "eval",
      model: DEFAULT_EVAL_MODEL_ID,
      max_tokens: DEFAULT_EVAL_MAX_TOKENS,
      eval_mode: true,
      eval_tools_enabled: false,
      use_memory: false,
      messages_history: [],
      context_engine_enabled: false,
      context_engine_config: undefined,
      mcp_configs: undefined,
      browser_automation_enabled: false,
    });
  });

  it("strips outbound side-effect configs even when the runtime config carries them (U8 kill list)", () => {
    const payload = buildEvalAgentCorePayload({
      tenantId: "tenant-1",
      agentId: "agent-1",
      sessionId: "session-1",
      message: "Replay a real flagged thread",
      model: null,
      systemPrompt: null,
      runtimeConfig: {
        ...runtimeConfig,
        webSearchConfig: { provider: "exa", apiKey: "exa-key" } as never,
        webExtractConfig: {
          toolSlug: "web-extract",
          provider: "firecrawl",
          apiKey: "fc-key",
          config: null,
        },
        sendEmailConfig: {
          apiUrl: "https://api.example.com",
          apiSecret: "secret",
          agentId: "agent-1",
          tenantId: "tenant-1",
          threadId: "thread-1",
        } as never,
      },
    });

    // Replay of a recorded thread must never send real email or hit
    // external web APIs — the configs are stripped at the payload layer
    // (the Pi server's eval_mode registration gate is layer 2).
    expect(payload.send_email_config).toBeUndefined();
    expect(payload.web_search_config).toBeUndefined();
    expect(payload.web_extract_config).toBeUndefined();
  });

  it("ships flagged-thread replay history as messages_history in the chat-agent-invoke row shape", () => {
    const messagesHistory = [
      { role: "user" as const, content: "Hi, customer 123 wants a refund" },
      { role: "assistant" as const, content: "Sure — what was the order id?" },
    ];
    const payload = buildEvalAgentCorePayload({
      tenantId: "tenant-1",
      agentId: "agent-1",
      sessionId: "session-1",
      message: "So what do I tell the customer?",
      model: null,
      systemPrompt: null,
      runtimeConfig,
      messagesHistory,
    });

    expect(payload.messages_history).toEqual(messagesHistory);
    expect(payload.message).toBe("So what do I tell the customer?");
    // Replay stays read-only: memory off, eval mode on.
    expect(payload.eval_mode).toBe(true);
    expect(payload.use_memory).toBe(false);
  });

  it("honors explicit model and test-case system prompt overrides", () => {
    const payload = buildEvalAgentCorePayload({
      tenantId: "tenant-1",
      agentId: "agent-1",
      sessionId: "session-1",
      message: "hello",
      model: "us.anthropic.claude-haiku-4-5",
      systemPrompt: "Case prompt",
      runtimeConfig,
    });

    expect(payload.model).toBe("us.anthropic.claude-haiku-4-5");
    expect(payload.system_prompt).toBe("Case prompt");
  });

  it("does not pass a user_id for eval invocations (evals are user-less; Pi accepts this when eval_mode=true)", () => {
    const payload = buildEvalAgentCorePayload({
      tenantId: "tenant-1",
      agentId: "agent-1",
      sessionId: "session-1",
      message: "hello",
      model: null,
      systemPrompt: null,
      runtimeConfig,
    });

    expect(payload.eval_mode).toBe(true);
    expect(payload.user_id).toBeUndefined();
  });

  it("never enables the workspace fetch tool for eval sessions (plan 2026-06-12-002 U10; gating implemented runtime-side under eval_mode)", () => {
    const payload = buildEvalAgentCorePayload({
      tenantId: "tenant-1",
      agentId: "agent-1",
      sessionId: "session-1",
      message: "hello",
      model: null,
      systemPrompt: null,
      runtimeConfig,
    });

    // Eval payloads must always run with eval_mode so the runtime's
    // extension gates (task-status, ask_user_question, fetch_workspace_source)
    // all stay closed.
    expect(payload.eval_mode).toBe(true);
    expect(payload.eval_tools_enabled).toBe(false);
    // Written loosely against the payload-builder contract so it holds
    // regardless of when U5's enable-flag name lands: no key that could
    // enable the workspace-source fetch tool may ever be truthy on an eval
    // payload.
    expect(payload.fetch_workspace_source_enabled).toBeUndefined();
    for (const [key, value] of Object.entries(payload)) {
      if (/fetch/i.test(key)) {
        expect(value, `eval payload key "${key}" must not be enabled`).not.toBe(
          true,
        );
      }
    }
  });
});

describe("read-only MCP tools on replay — default-allow heuristic (U14)", () => {
  const crmServer = {
    name: "lastmile--crm",
    url: "https://crm.example.com/mcp",
    transport: "streamable-http",
    availableTools: [
      "opportunities_list",
      "create_opportunity",
      "opportunity_update",
    ],
  };
  const docsServer = {
    name: "docs--reader",
    url: "https://docs.example.com/mcp",
    transport: "streamable-http",
    availableTools: ["search", "fetch"],
  };
  const runtimeWithMcp = {
    ...runtimeConfig,
    mcpConfigs: [crmServer, docsServer],
  };

  it("no overrides → read tools auto-allowed, write tools blocked", () => {
    const selected = selectReplayMcpTools(runtimeWithMcp.mcpConfigs, undefined);
    expect(selected).toHaveLength(2);
    const crm = selected?.find((s) => s.name === "lastmile--crm");
    // opportunities_list (read) survives; create_opportunity +
    // opportunity_update (write) are blocked by the heuristic.
    expect(crm?.tools).toEqual(["opportunities_list"]);
    const docs = selected?.find((s) => s.name === "docs--reader");
    expect(docs?.tools).toEqual(["search", "fetch"]);

    const payload = buildEvalAgentCorePayload({
      tenantId: "tenant-1",
      agentId: "agent-1",
      sessionId: "session-1",
      message: "list opportunities",
      model: null,
      systemPrompt: null,
      runtimeConfig: runtimeWithMcp,
      replayToolOverrides: [],
    });
    const configs = payload.mcp_configs as Array<{
      name: string;
      tools: string[];
    }>;
    expect(configs).toHaveLength(2);
    expect(configs.find((c) => c.name === "lastmile--crm")?.tools).toEqual([
      "opportunities_list",
    ]);
  });

  it("force-allow restores a blocked write tool", () => {
    const overrides: EvalReplayToolOverride[] = [
      {
        serverName: "lastmile--crm",
        toolName: "create_opportunity",
        mode: "allow",
      },
    ];
    const selected = selectReplayMcpTools(runtimeWithMcp.mcpConfigs, overrides);
    const crm = selected?.find((s) => s.name === "lastmile--crm");
    // The auto-allowed read + the force-allowed write both survive; the
    // still-blocked opportunity_update does not.
    expect(crm?.tools).toEqual(["opportunities_list", "create_opportunity"]);
    expect(crm?.tools).not.toContain("opportunity_update");
  });

  it("force-block suppresses an auto-allowed read; empties + drops the server", () => {
    const selected = selectReplayMcpTools(
      [crmServer], // only the CRM server in scope
      [
        {
          serverName: "lastmile--crm",
          toolName: "opportunities_list",
          mode: "block",
        },
      ],
    );
    // opportunities_list (the only read) is force-blocked; the writes stay
    // blocked → no usable tools → server dropped → undefined.
    expect(selected).toBeUndefined();
  });

  it("drops a server with no cached availableTools unless force-allowed", () => {
    const blindServer = {
      name: "blind--server",
      url: "https://blind.example.com/mcp",
      transport: "streamable-http",
      availableTools: [],
    };
    // No overrides → unclassifiable → no tools → dropped → undefined.
    expect(selectReplayMcpTools([blindServer], [])).toBeUndefined();

    // A force-allow restores exactly that tool (the runtime still gates via
    // toolWhitelist).
    const selected = selectReplayMcpTools(
      [blindServer],
      [{ serverName: "blind--server", toolName: "secret_read", mode: "allow" }],
    );
    expect(selected).toHaveLength(1);
    expect(selected?.[0].tools).toEqual(["secret_read"]);
  });

  it("an override for a server the agent does not have is ignored", () => {
    const selected = selectReplayMcpTools(
      [docsServer],
      [{ serverName: "ghost--server", toolName: "anything", mode: "allow" }],
    );
    // docs--reader still has its read tools by default; the ghost override
    // matches no server.
    expect(selected).toHaveLength(1);
    expect(selected?.[0].name).toBe("docs--reader");
  });

  it("no mcp servers at all → undefined", () => {
    expect(selectReplayMcpTools([], undefined)).toBeUndefined();
    expect(selectReplayMcpTools(undefined as never, undefined)).toBeUndefined();
  });

  it("preserves the email/web kill-list and eval_mode regardless of overrides", () => {
    const payload = buildEvalAgentCorePayload({
      tenantId: "tenant-1",
      agentId: "agent-1",
      sessionId: "session-1",
      message: "list opportunities",
      model: null,
      systemPrompt: null,
      runtimeConfig: runtimeWithMcp,
      replayToolOverrides: [
        {
          serverName: "lastmile--crm",
          toolName: "create_opportunity",
          mode: "allow",
        },
      ],
    });

    expect(payload.send_email_config).toBeUndefined();
    expect(payload.web_search_config).toBeUndefined();
    expect(payload.web_extract_config).toBeUndefined();
    expect(payload.eval_mode).toBe(true);
    expect(payload.use_memory).toBe(false);
  });

  it("synthetic (no-mcp) runtime config leaves mcp_configs undefined", () => {
    // The base runtimeConfig has mcpConfigs: [] — the non-flagged synthetic
    // path is unaffected.
    const payload = buildEvalAgentCorePayload({
      tenantId: "tenant-1",
      agentId: "agent-1",
      sessionId: "session-1",
      message: "hello",
      model: null,
      systemPrompt: null,
      runtimeConfig,
    });
    expect(payload.mcp_configs).toBeUndefined();
  });
});

describe("direct AgentCore eval helpers", () => {
  it("normalizes empty model overrides to Kimi K2.5", () => {
    expect(evalModelId(null)).toBe(DEFAULT_EVAL_MODEL_ID);
    expect(evalModelId("")).toBe(DEFAULT_EVAL_MODEL_ID);
    expect(evalModelId("moonshotai.kimi-k2.5")).toBe("moonshotai.kimi-k2.5");
  });

  it("keeps AgentCore invoke timeouts below the eval worker timeout", () => {
    expect(evalAgentCoreInvokeTimeoutMs()).toBe(180_000);
    expect(evalAgentCoreInvokeTimeoutMs("5000")).toBe(5_000);
    expect(evalAgentCoreInvokeTimeoutMs("nope")).toBe(180_000);
  });

  it("normalizes eval max token overrides", () => {
    expect(evalMaxTokens()).toBe(1_024);
    expect(evalMaxTokens("4096")).toBe(4_096);
    expect(evalMaxTokens("0")).toBe(1_024);
    expect(evalMaxTokens("nope")).toBe(1_024);
  });

  it("uses fresh AgentCore sessions for empty-response retry attempts", () => {
    expect(evalAgentCoreAttemptSessionId("eval-run-1-case-1", 1)).toBe(
      "eval-run-1-case-1",
    );
    expect(evalAgentCoreAttemptSessionId("eval-run-1-case-1", 2)).toBe(
      "eval-run-1-case-1-retry-2",
    );
    expect(evalAgentCoreAttemptSessionId("eval-run-1-case-1", 3)).toBe(
      "eval-run-1-case-1-retry-3",
    );
  });

  it("extracts OpenAI-style AgentCore response text", () => {
    expect(
      extractAgentCoreResponseText({
        choices: [{ message: { content: "safe refusal" } }],
      }),
    ).toBe("safe refusal");
    expect(extractAgentCoreResponseText({ response: { text: "nested" } })).toBe(
      "nested",
    );
    expect(
      extractAgentCoreResponseText({ response_text: "strands response" }),
    ).toBe("strands response");
  });

  it("extracts agent-turn usage from the pi-ai Usage shape and the normalized shape (U5)", () => {
    // Pi runtime `pi_usage` / `response.usage` shape.
    expect(
      extractAgentCoreUsage({
        input: 1200,
        output: 340,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 1540,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      }),
    ).toEqual({ inputTokens: 1200, outputTokens: 340 });
    // Normalized shape.
    expect(
      extractAgentCoreUsage({ inputTokens: 10, outputTokens: 20 }),
    ).toEqual({ inputTokens: 10, outputTokens: 20 });
  });

  it("returns undefined for missing or unusable usage — never a fabricated zero (U5, R6)", () => {
    expect(extractAgentCoreUsage(undefined)).toBeUndefined();
    expect(extractAgentCoreUsage(null)).toBeUndefined();
    expect(extractAgentCoreUsage("usage")).toBeUndefined();
    expect(extractAgentCoreUsage([1200, 340])).toBeUndefined();
    // Partial usage (one side missing/invalid) is unusable for pricing.
    expect(extractAgentCoreUsage({ input: 1200 })).toBeUndefined();
    expect(extractAgentCoreUsage({ input: 1200, output: -1 })).toBeUndefined();
    expect(
      extractAgentCoreUsage({ input: Number.NaN, output: 340 }),
    ).toBeUndefined();
    expect(
      extractAgentCoreUsage({ input: "1200", output: "340" }),
    ).toBeUndefined();
  });
});

describe("direct AgentCore eval empty-response in-process retry", () => {
  function lambdaResponse(body: unknown) {
    return {
      Payload: new TextEncoder().encode(
        JSON.stringify({ statusCode: 200, body: JSON.stringify(body) }),
      ),
    };
  }

  function sentThreadId(callIndex: number): string {
    const command = lambdaSendMock.mock.calls[callIndex][0] as {
      input: { Payload: Uint8Array };
    };
    const event = JSON.parse(new TextDecoder().decode(command.input.Payload));
    return JSON.parse(event.body).thread_id;
  }

  beforeEach(() => {
    lambdaSendMock.mockReset();
    vi.mocked(resolveAgentRuntimeConfig).mockResolvedValue(runtimeConfig);
  });

  it("retries empty responses in-process with a fresh session and succeeds without SQS involvement", async () => {
    lambdaSendMock
      .mockResolvedValueOnce(lambdaResponse({ response: "" }))
      .mockResolvedValueOnce(lambdaResponse({ response: "I refuse." }));

    const result = await invokeAgentCoreForEval({
      tenantId: "tenant-1",
      agentId: "agent-1",
      sessionId: "session-1",
      message: "Refuse this",
      model: null,
    });

    expect(result.output).toBe("I refuse.");
    expect(lambdaSendMock).toHaveBeenCalledTimes(2);
    expect(sentThreadId(0)).toBe("session-1");
    expect(sentThreadId(1)).toBe("session-1-retry-2");
  });

  it("gives up after the 3-attempt budget and surfaces the empty-response error", async () => {
    lambdaSendMock.mockResolvedValue(lambdaResponse({ response: "" }));

    await expect(
      invokeAgentCoreForEval({
        tenantId: "tenant-1",
        agentId: "agent-1",
        sessionId: "session-1",
        message: "Refuse this",
        model: null,
      }),
    ).rejects.toBeInstanceOf(AgentCoreEvalEmptyResponseError);
    expect(lambdaSendMock).toHaveBeenCalledTimes(
      DEFAULT_EVAL_AGENTCORE_MAX_ATTEMPTS,
    );
  });

  it("surfaces the runtime's pi_usage as the envelope's usage (U5)", async () => {
    lambdaSendMock.mockResolvedValueOnce(
      lambdaResponse({
        response: { role: "assistant", content: "I refuse." },
        composed_system_prompt: "composed prompt",
        pi_usage: {
          input: 1200,
          output: 340,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 1540,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
      }),
    );

    const result = await invokeAgentCoreForEval({
      tenantId: "tenant-1",
      agentId: "agent-1",
      sessionId: "session-1",
      message: "Refuse this",
      model: null,
    });

    expect(result.output).toBe("I refuse.");
    expect(result.usage).toEqual({ inputTokens: 1200, outputTokens: 340 });
  });

  it("falls back to response.usage when pi_usage is absent, and tolerates envelopes with neither (older runtime images)", async () => {
    lambdaSendMock.mockResolvedValueOnce(
      lambdaResponse({
        response: {
          role: "assistant",
          content: "I refuse.",
          usage: { input: 50, output: 7 },
        },
      }),
    );
    const withResponseUsage = await invokeAgentCoreForEval({
      tenantId: "tenant-1",
      agentId: "agent-1",
      sessionId: "session-1",
      message: "Refuse this",
      model: null,
    });
    expect(withResponseUsage.usage).toEqual({
      inputTokens: 50,
      outputTokens: 7,
    });

    // Older runtime image: no usage anywhere — the envelope leaves usage
    // undefined (the worker records nulls, never zeros).
    lambdaSendMock.mockResolvedValueOnce(
      lambdaResponse({ response: "I refuse." }),
    );
    const withoutUsage = await invokeAgentCoreForEval({
      tenantId: "tenant-1",
      agentId: "agent-1",
      sessionId: "session-1",
      message: "Refuse this",
      model: null,
    });
    expect(withoutUsage.output).toBe("I refuse.");
    expect(withoutUsage.usage).toBeUndefined();
  });

  it("does not retry non-empty-response invoke errors in-process", async () => {
    lambdaSendMock.mockRejectedValue(
      new Error("ThrottlingException: Rate exceeded"),
    );

    await expect(
      invokeAgentCoreForEval({
        tenantId: "tenant-1",
        agentId: "agent-1",
        sessionId: "session-1",
        message: "Refuse this",
        model: null,
      }),
    ).rejects.toThrow(/ThrottlingException/);
    expect(lambdaSendMock).toHaveBeenCalledTimes(1);
  });
});

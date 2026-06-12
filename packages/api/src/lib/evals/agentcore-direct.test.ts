import { describe, expect, it } from "vitest";
import {
  buildEvalAgentCorePayload,
  DEFAULT_EVAL_MAX_TOKENS,
  DEFAULT_EVAL_MODEL_ID,
  evalAgentCoreAttemptSessionId,
  evalAgentCoreInvokeTimeoutMs,
  evalMaxTokens,
  evalModelId,
  extractAgentCoreResponseText,
} from "./agentcore-direct.js";
import type { AgentRuntimeConfig } from "../resolve-agent-runtime-config.js";

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
  contextEngineEnabled: false,
  guardrailId: null,
  guardrailConfig: undefined,
  runtimeType: "pi",
  skillsConfig: [],
  webExtractConfig: {
    toolSlug: "web-extract",
    provider: "firecrawl",
    apiKey: "fc-key",
    config: null,
  },
  knowledgeBasesConfig: undefined,
  mcpConfigs: [],
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
      context_engine_enabled: false,
      context_engine_config: undefined,
      web_extract_config: {
        toolSlug: "web-extract",
        provider: "firecrawl",
        apiKey: "fc-key",
        config: null,
      },
      mcp_configs: undefined,
      browser_automation_enabled: false,
    });
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
});

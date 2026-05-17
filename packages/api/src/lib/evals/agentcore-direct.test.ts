import { describe, expect, it } from "vitest";
import {
  buildEvalAgentCorePayload,
  DEFAULT_EVAL_MODEL_ID,
  evalAgentCoreInvokeTimeoutMs,
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
  blockedTools: [],
  sandboxTemplate: null,
  browserAutomationEnabled: false,
  contextEngineEnabled: false,
  guardrailId: null,
  guardrailConfig: undefined,
  runtimeType: "strands",
  skillsConfig: [],
  knowledgeBasesConfig: undefined,
  mcpConfigs: [],
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
      use_memory: false,
    });
  });

  it("honors explicit model and test-case system prompt overrides", () => {
    const payload = buildEvalAgentCorePayload({
      tenantId: "tenant-1",
      agentId: "agent-1",
      sessionId: "session-1",
      message: "hello",
      model: "moonshotai.kimi-k2.5",
      systemPrompt: "Case prompt",
      runtimeConfig,
    });

    expect(payload.model).toBe("moonshotai.kimi-k2.5");
    expect(payload.system_prompt).toBe("Case prompt");
  });
});

describe("direct AgentCore eval helpers", () => {
  it("normalizes empty model overrides to Kimi K2.5", () => {
    expect(evalModelId(null)).toBe(DEFAULT_EVAL_MODEL_ID);
    expect(evalModelId("")).toBe(DEFAULT_EVAL_MODEL_ID);
    expect(evalModelId("moonshotai.kimi-k2.5")).toBe("moonshotai.kimi-k2.5");
  });

  it("keeps AgentCore invoke timeouts below the eval worker timeout", () => {
    expect(evalAgentCoreInvokeTimeoutMs()).toBe(210_000);
    expect(evalAgentCoreInvokeTimeoutMs("5000")).toBe(5_000);
    expect(evalAgentCoreInvokeTimeoutMs("nope")).toBe(210_000);
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
  });
});

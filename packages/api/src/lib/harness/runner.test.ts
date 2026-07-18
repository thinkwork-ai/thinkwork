import { describe, expect, it, vi } from "vitest";
import {
  computeHarnessProjectionFingerprints,
  HarnessDuplicateDeliveryError,
  normalizeHarnessWireEvent,
  parseHarnessInvokeEvent,
  runHarnessTurn,
  type HarnessRunnerDeps,
  type HarnessStreamEvent,
} from "./runner.js";
import type { FinalizePayload } from "../chat-finalize/types.js";

function stream(
  events: HarnessStreamEvent[],
): AsyncIterable<HarnessStreamEvent> {
  return (async function* () {
    for (const event of events) yield event;
  })();
}

describe("Harness projection fingerprints", () => {
  it("keeps one logical-agent base while participant projections differ", () => {
    const common = {
      tenantId: "tenant-1",
      threadId: "thread-1",
      agentId: "agent-1",
      harnessConfigurationFingerprint: "harness-config",
      harnessVersion: "5",
      sessionStrategy: "fresh",
    };
    const alice = computeHarnessProjectionFingerprints({
      ...common,
      participantId: "alice",
      turnId: "turn-alice",
      configFingerprint: "alice-config",
      manifestFingerprint: "alice-manifest",
    });
    const bob = computeHarnessProjectionFingerprints({
      ...common,
      participantId: "bob",
      turnId: "turn-bob",
      configFingerprint: "bob-config",
      manifestFingerprint: "bob-manifest",
    });
    expect(alice.baseFingerprint).toBe(bob.baseFingerprint);
    expect(alice.participantFingerprint).not.toBe(bob.participantFingerprint);
  });
});

function textEvents(
  text: string,
  stopReason = "end_turn",
): HarnessStreamEvent[] {
  return [
    { messageStart: { role: "assistant" } },
    { contentBlockStart: { contentBlockIndex: 0 } },
    { contentBlockDelta: { contentBlockIndex: 0, delta: { text } } },
    { contentBlockStop: { contentBlockIndex: 0 } },
    { messageStop: { stopReason } },
    { metadata: { usage: { inputTokens: 100, outputTokens: 20 } } },
  ];
}

function toolUseEvents(
  name: string,
  toolUseId: string,
  input: Record<string, unknown>,
  stopReason = "tool_use",
): HarnessStreamEvent[] {
  const json = JSON.stringify(input);
  return [
    { messageStart: { role: "assistant" } },
    {
      contentBlockStart: {
        contentBlockIndex: 0,
        start: { toolUse: { toolUseId, name } },
      },
    },
    {
      contentBlockDelta: {
        contentBlockIndex: 0,
        delta: { toolUse: { input: json.slice(0, 10) } },
      },
    },
    {
      contentBlockDelta: {
        contentBlockIndex: 0,
        delta: { toolUse: { input: json.slice(10) } },
      },
    },
    { contentBlockStop: { contentBlockIndex: 0 } },
    { messageStop: { stopReason } },
    { metadata: { usage: { inputTokens: 50, outputTokens: 10 } } },
  ];
}

const EMIT_INPUT = {
  genre: "qbr",
  title: "QBR: 777 Automotive",
  abstract: "Quarterly business review.",
  digest_markdown: "# QBR\n\ncontent",
};

function basePayload(): Record<string, unknown> {
  return {
    tenant_id: "tenant-1",
    tenant_slug: "tenant-one",
    thread_id: "thread-1",
    assistant_id: "agent-1",
    thread_turn_id: "turn-1",
    trace_id: "trace-1",
    message: "Generate the QBR for 777 Automotive",
    system_prompt: "You are ThinkWork, the tenant platform agent.",
    messages_history: [],
    model: "moonshotai.kimi-k2.5",
    instance_id: "thinkwork-agent",
    agent_name: "ThinkWork Agent",
    cost_owner_user_id: "user-1",
    user_id: "user-1",
    capabilities_manifest_fingerprint: "manifest-fp",
    config_fingerprint: "config-fp",
    skills: [
      {
        skillId: "document-composer",
        s3Key: "tenants/tei/agents/thinkwork-agent/skills/document-composer",
      },
    ],
    mcp_configs: [
      {
        name: "lastmile-data",
        url: "https://mcp.example.com/lastmile",
        transport: "streamable-http",
        auth: { type: "bearer", token: "tok" },
        tools: ["query"],
      },
    ],
    document_plates: [
      { slug: "qbr", displayName: "QBR", useFor: "quarterly business reviews" },
    ],
    agent_profiles: [],
    pi_extensions: [],
  };
}

interface TestDeps extends HarnessRunnerDeps {
  finalizePayloads: FinalizePayload[];
  invocations: Array<{ messages: unknown }>;
  emissions: Array<Record<string, unknown>>;
}

function makeDeps(
  streams: Array<AsyncIterable<HarnessStreamEvent>>,
  options: {
    emitResults?: Array<{ statusCode: number; body: Record<string, unknown> }>;
  } = {},
): TestDeps {
  const finalizePayloads: FinalizePayload[] = [];
  const invocations: Array<{ messages: unknown }> = [];
  const emissions: Array<Record<string, unknown>> = [];
  const emitResults = [...(options.emitResults ?? [])];
  const queue = [...streams];
  return {
    finalizePayloads,
    invocations,
    emissions,
    workspaceBucket: "bucket-1",
    keepaliveIntervalMs: 0,
    resolveHarness: vi.fn(async () => ({
      harnessArn: "arn:aws:bedrock-agentcore:us-east-1:123:harness/h1",
      harnessId: "h1",
      harnessVersion: "3",
      qualifier: "ThinkworkProof",
      configurationFingerprint: "harness-config-fp",
      sessionStrategy: "fresh" as const,
    })),
    mintHarnessAssertion: vi.fn(async () => ({
      token: "signed-turn-assertion",
      expiresAt: 2_000_000_000,
      jti: "jti-1",
    })),
    prepareFreshTurn: vi.fn(async () => ({
      sessionRecordId: "session-row-1",
      runtimeSessionId: "tw-harness-turn-turn-1",
      capturedHighWater: 1,
      currentMessage: "Generate the QBR for 777 Automotive",
      history: [],
    })),
    transitionFreshTurn: vi.fn(async () => {}),
    abandonFreshTurn: vi.fn(async () => {}),
    invokeHarness: vi.fn(async (input) => {
      invocations.push({ messages: input.messages });
      const next = queue.shift();
      if (!next) throw new Error("test: no more scripted streams");
      return next;
    }),
    emitDocument: vi.fn(async (input) => {
      emissions.push(input.raw);
      return (
        emitResults.shift() ?? {
          statusCode: 200,
          body: {
            ok: true,
            artifactId: "artifact-1",
            documentId: "doc-1",
            status: "draft",
            headVersion: 0,
          },
        }
      );
    }),
    finalize: vi.fn(async (payload: FinalizePayload) => {
      finalizePayloads.push(payload);
      return { finalized: true, messageId: "msg-1" };
    }),
    bumpTurnActivity: vi.fn(async () => {}),
    fetchWorkspaceText: vi.fn(async () => null),
  };
}

describe("parseHarnessInvokeEvent", () => {
  it("unwraps the API-GW-shaped body", () => {
    expect(
      parseHarnessInvokeEvent({
        rawPath: "/invocations",
        body: JSON.stringify({ tenant_id: "t" }),
      }),
    ).toEqual({ tenant_id: "t" });
  });

  it("passes through a bare payload", () => {
    expect(parseHarnessInvokeEvent({ tenant_id: "t" })).toEqual({
      tenant_id: "t",
    });
  });
});

describe("normalizeHarnessWireEvent", () => {
  it("adapts the live flat Harness stream union into the runner shape", () => {
    expect(normalizeHarnessWireEvent({ role: "assistant" })).toEqual({
      messageStart: { role: "assistant" },
    });
    expect(
      normalizeHarnessWireEvent({
        contentBlockIndex: 0,
        delta: { text: "hello" },
      }),
    ).toEqual({
      contentBlockDelta: {
        contentBlockIndex: 0,
        delta: { text: "hello" },
      },
    });
    expect(normalizeHarnessWireEvent({ contentBlockIndex: 0 })).toEqual({
      contentBlockStop: { contentBlockIndex: 0 },
    });
    expect(normalizeHarnessWireEvent({ stopReason: "end_turn" })).toEqual({
      messageStop: { stopReason: "end_turn" },
    });
    expect(
      normalizeHarnessWireEvent({
        metrics: { latencyMs: 10 },
        usage: { inputTokens: 5, outputTokens: 2 },
      }),
    ).toEqual({
      metadata: { usage: { inputTokens: 5, outputTokens: 2 } },
    });
  });
});

describe("runHarnessTurn — happy path", () => {
  it("fulfills emit_document and finalizes completed with the evidence triple", async () => {
    const deps = makeDeps([
      stream(toolUseEvents("emit_document", "tool-1", EMIT_INPUT)),
      stream(textEvents("Here is the QBR.")),
    ]);

    const result = await runHarnessTurn(basePayload(), deps);

    expect(result.status).toBe("completed");
    // Emission received the camelCase raw shape handleDocumentEmission parses.
    expect(deps.emissions).toEqual([
      {
        genre: "qbr",
        title: "QBR: 777 Automotive",
        abstract: "Quarterly business review.",
        digestMarkdown: "# QBR\n\ncontent",
      },
    ]);
    // Tool result went back on the same session as a toolResult block.
    expect(deps.invocations).toHaveLength(2);
    const followUp = deps.invocations[1].messages as Array<{
      role: string;
      content: Array<Record<string, unknown>>;
    }>;
    // The continuation resends the stream-ending assistant message (the
    // harness never persists it) followed by the toolResult user message.
    expect(followUp).toHaveLength(2);
    expect(followUp[0].role).toBe("assistant");
    expect(followUp[0].content[0].toolUse).toMatchObject({
      toolUseId: "tool-1",
      name: "emit_document",
    });
    expect(followUp[1].role).toBe("user");
    expect(followUp[1].content[0].toolResult).toMatchObject({
      toolUseId: "tool-1",
      status: "success",
    });

    expect(deps.finalizePayloads).toHaveLength(1);
    const finalize = deps.finalizePayloads[0];
    expect(finalize).toMatchObject({
      thread_turn_id: "turn-1",
      status: "completed",
      runtime_type: "harness",
      agent_model: "moonshotai.kimi-k2.5",
      cost_owner_user_id: "user-1",
      changed_files: [],
    });
    expect(finalize.response?.content).toBe("Here is the QBR.");
    expect(finalize.usage).toMatchObject({
      model: "moonshotai.kimi-k2.5",
      input_tokens: 150,
      output_tokens: 30,
    });
    const harness = (finalize.response?.diagnostics as Record<string, unknown>)
      ?.harness as Record<string, unknown>;
    expect(harness).toMatchObject({
      harness_id: "h1",
      harness_version: "3",
      manifest_fingerprint: "manifest-fp",
      config_fingerprint: "config-fp",
      artifact_id: "artifact-1",
      emission_attempts: 1,
      emission_successes: 1,
    });
    expect(harness.projection_fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(finalize.response?.tool_invocations).toEqual([
      expect.objectContaining({
        tool_name: "emit_document",
        status: "completed",
      }),
    ]);
  });

  it("refreshes an expiring turn assertion before a tool continuation", async () => {
    let nowMs = 1_000_000;
    const deps = makeDeps([
      stream(toolUseEvents("emit_document", "tool-1", EMIT_INPUT)),
      stream(textEvents("Published with a refreshed assertion.")),
    ]);
    (deps.mintHarnessAssertion as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        token: "assertion-1",
        expiresAt: 1_060,
        jti: "jti-1",
      })
      .mockResolvedValueOnce({
        token: "assertion-2",
        expiresAt: 1_360,
        jti: "jti-2",
      });
    (deps.invokeHarness as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(async () => {
        nowMs = 1_040_000;
        return stream(toolUseEvents("emit_document", "tool-1", EMIT_INPUT));
      })
      .mockImplementationOnce(async () =>
        stream(textEvents("Published with a refreshed assertion.")),
      );
    deps.now = () => nowMs;

    await runHarnessTurn(basePayload(), deps);

    expect(deps.mintHarnessAssertion).toHaveBeenCalledTimes(2);
    expect(deps.invokeHarness).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ bearerToken: "assertion-2" }),
    );
  });

  it("relays toolResults ONLY for the final assistant message's toolUses (internal builtin rounds excluded)", async () => {
    // One stream, three messages: the harness fulfilled a builtin tool
    // internally (assistant toolUse + user toolResult), then ended the
    // stream on an assistant emit_document toolUse. Relaying a result for
    // the builtin too corrupts the Bedrock conversation ("toolResult
    // blocks exceed toolUse blocks" — observed live, THINK-311 turn #12).
    const multiMessage: HarnessStreamEvent[] = [
      { messageStart: { role: "assistant" } },
      {
        contentBlockStart: {
          contentBlockIndex: 0,
          start: {
            toolUse: { toolUseId: "builtin-1", name: "memory_search" },
          },
        },
      },
      {
        contentBlockDelta: {
          contentBlockIndex: 0,
          delta: { toolUse: { input: "{}" } },
        },
      },
      { contentBlockStop: { contentBlockIndex: 0 } },
      { messageStop: { stopReason: "tool_use" } },
      { messageStart: { role: "user" } },
      { contentBlockStart: { contentBlockIndex: 0 } },
      { contentBlockStop: { contentBlockIndex: 0 } },
      { messageStop: { stopReason: "tool_result" } },
      { messageStart: { role: "assistant" } },
      {
        contentBlockStart: {
          contentBlockIndex: 0,
          start: { toolUse: { toolUseId: "tool-9", name: "emit_document" } },
        },
      },
      {
        contentBlockDelta: {
          contentBlockIndex: 0,
          delta: { toolUse: { input: JSON.stringify(EMIT_INPUT) } },
        },
      },
      { contentBlockStop: { contentBlockIndex: 0 } },
      { messageStop: { stopReason: "tool_use" } },
      { metadata: { usage: { inputTokens: 80, outputTokens: 15 } } },
    ];
    const deps = makeDeps([
      stream(multiMessage),
      stream(textEvents("Published.")),
    ]);

    const result = await runHarnessTurn(basePayload(), deps);

    expect(result.status).toBe("completed");
    expect(deps.emissions).toHaveLength(1);
    const followUp = deps.invocations[1].messages as Array<{
      role: string;
      content: Array<Record<string, unknown>>;
    }>;
    // Assistant resend carries ONLY the final assistant message's toolUse,
    // and exactly ONE toolResult follows — never the builtin's.
    expect(followUp[0].role).toBe("assistant");
    expect(followUp[0].content).toHaveLength(1);
    expect(followUp[0].content[0].toolUse).toMatchObject({
      toolUseId: "tool-9",
      name: "emit_document",
    });
    expect(followUp[1].role).toBe("user");
    expect(followUp[1].content).toHaveLength(1);
    expect(followUp[1].content[0].toolResult).toMatchObject({
      toolUseId: "tool-9",
      status: "success",
    });
  });

  it("relays emission rejections as error tool results and lets the model retry", async () => {
    const deps = makeDeps(
      [
        stream(toolUseEvents("emit_document", "tool-1", EMIT_INPUT)),
        stream(toolUseEvents("emit_document", "tool-2", EMIT_INPUT)),
        stream(textEvents("Fixed and emitted.")),
      ],
      {
        emitResults: [
          {
            statusCode: 200,
            body: {
              ok: false,
              code: "COMPILE_REJECTED",
              diagnostics: [
                {
                  code: "ANALYSIS_INVALID",
                  message: "trend needs 3-24 points",
                  location: "tw:analysis",
                },
              ],
            },
          },
          {
            statusCode: 200,
            body: {
              ok: true,
              artifactId: "artifact-2",
              documentId: "doc-2",
              status: "draft",
              headVersion: 0,
            },
          },
        ],
      },
    );

    const result = await runHarnessTurn(basePayload(), deps);

    expect(result.status).toBe("completed");
    expect(deps.emissions).toHaveLength(2);
    const firstResult = (
      deps.invocations[1].messages as Array<{
        content: Array<Record<string, unknown>>;
      }>
    )[1].content[0].toolResult as Record<string, unknown>;
    expect(firstResult.status).toBe("error");
    expect(JSON.stringify(firstResult.content)).toContain("ANALYSIS_INVALID");
    const harness = (
      deps.finalizePayloads[0].response?.diagnostics as Record<string, unknown>
    )?.harness as Record<string, unknown>;
    expect(harness).toMatchObject({
      emission_attempts: 2,
      emission_successes: 1,
      artifact_id: "artifact-2",
    });
  });
});

describe("runHarnessTurn — explicit failures (AE2/KTD-4)", () => {
  it("fails on a non-end_turn terminal stopReason naming the reason", async () => {
    const deps = makeDeps([
      stream(textEvents("partial...", "max_iterations_exceeded")),
    ]);
    const result = await runHarnessTurn(basePayload(), deps);
    expect(result.status).toBe("failed");
    expect(deps.finalizePayloads[0].error_message).toContain(
      "max_iterations_exceeded",
    );
    expect(deps.invocations).toHaveLength(1);
  });

  it("fails on runtimeClientError", async () => {
    const deps = makeDeps([
      stream([
        { messageStart: { role: "assistant" } },
        { runtimeClientError: { message: "MCP endpoint unreachable" } },
      ]),
    ]);
    const result = await runHarnessTurn(basePayload(), deps);
    expect(result.status).toBe("failed");
    expect(deps.finalizePayloads[0].error_message).toContain(
      "runtime_client_error",
    );
  });

  it("fails when the run ends without a successful emission after rejections (never a false pass)", async () => {
    const deps = makeDeps(
      [
        stream(toolUseEvents("emit_document", "tool-1", EMIT_INPUT)),
        stream(textEvents("Sorry, giving up.")),
      ],
      {
        emitResults: [
          {
            statusCode: 200,
            body: { ok: false, code: "COMPILE_REJECTED", diagnostics: [] },
          },
        ],
      },
    );
    const result = await runHarnessTurn(basePayload(), deps);
    expect(result.status).toBe("failed");
    expect(deps.finalizePayloads[0].error_message).toContain(
      "without a successful document emission",
    );
  });

  it("fails fatally on COMPILER_DEFECT instead of looping", async () => {
    const deps = makeDeps(
      [stream(toolUseEvents("emit_document", "tool-1", EMIT_INPUT))],
      {
        emitResults: [
          {
            statusCode: 500,
            body: { ok: false, code: "COMPILER_DEFECT", error: "boom" },
          },
        ],
      },
    );
    const result = await runHarnessTurn(basePayload(), deps);
    expect(result.status).toBe("failed");
    expect(deps.finalizePayloads[0].error_message).toContain("COMPILER_DEFECT");
  });

  it("fails a projection rejection before any Harness call, naming the capability", async () => {
    const deps = makeDeps([]);
    const payload = {
      ...basePayload(),
      guardrail_config: { guardrailIdentifier: "g" },
    };
    const result = await runHarnessTurn(payload, deps);
    expect(result.status).toBe("failed");
    expect(deps.finalizePayloads[0].error_message).toContain(
      "bedrock_guardrail",
    );
    expect(deps.resolveHarness).not.toHaveBeenCalled();
    expect(deps.invocations).toHaveLength(0);
  });

  it("declares unsupported payload features (goal mode) without invoking Harness", async () => {
    const deps = makeDeps([]);
    const payload = { ...basePayload(), goal_mode: { enabled: true } };
    const result = await runHarnessTurn(payload, deps);
    expect(result.status).toBe("failed");
    expect(deps.finalizePayloads[0].error_message).toContain("goal_mode");
    expect(deps.resolveHarness).not.toHaveBeenCalled();
  });

  it("fails the pi-ai analog: empty content + zero output tokens on end_turn", async () => {
    const deps = makeDeps([
      stream([
        { messageStart: { role: "assistant" } },
        { messageStop: { stopReason: "end_turn" } },
        { metadata: { usage: { inputTokens: 10, outputTokens: 0 } } },
      ]),
    ]);
    const result = await runHarnessTurn(basePayload(), deps);
    expect(result.status).toBe("failed");
    expect(deps.finalizePayloads[0].error_message).toContain(
      "empty content and zero output tokens",
    );
  });

  it("returns malformed tool input as an error tool result and continues", async () => {
    const deps = makeDeps([
      stream([
        { messageStart: { role: "assistant" } },
        {
          contentBlockStart: {
            contentBlockIndex: 0,
            start: { toolUse: { toolUseId: "tool-1", name: "emit_document" } },
          },
        },
        {
          contentBlockDelta: {
            contentBlockIndex: 0,
            delta: { toolUse: { input: "{not json" } },
          },
        },
        { messageStop: { stopReason: "tool_use" } },
      ]),
      stream(textEvents("Answered without a document.")),
    ]);
    const result = await runHarnessTurn(basePayload(), deps);
    expect(result.status).toBe("completed");
    expect(deps.emissions).toHaveLength(0);
    const toolResult = (
      deps.invocations[1].messages as Array<{
        content: Array<Record<string, unknown>>;
      }>
    )[1].content[0].toolResult as Record<string, unknown>;
    expect(toolResult.status).toBe("error");
    expect(JSON.stringify(toolResult.content)).toContain(
      "malformed tool input",
    );
  });
});

describe("runHarnessTurn — turn lifecycle (KTD-9)", () => {
  it("acknowledges a duplicate delivery without finalizing the live turn", async () => {
    const deps = makeDeps([]);
    (deps.prepareFreshTurn as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new HarnessDuplicateDeliveryError("running"),
    );

    const result = await runHarnessTurn(basePayload(), deps);

    expect(result.status).toBe("completed");
    expect(deps.finalize).not.toHaveBeenCalled();
    expect(deps.invokeHarness).not.toHaveBeenCalled();
  });

  it("bumps last_activity_at while streaming", async () => {
    const deps = makeDeps([stream(textEvents("done"))]);
    await runHarnessTurn(basePayload(), deps);
    expect(deps.bumpTurnActivity).toHaveBeenCalledWith({
      turnId: "turn-1",
      tenantId: "tenant-1",
    });
  });

  it("finalizes-through-failure when the SDK throws mid-run", async () => {
    const deps = makeDeps([]);
    (deps.invokeHarness as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("ValidationException: bad session id"),
    );
    const result = await runHarnessTurn(basePayload(), deps);
    expect(result.status).toBe("failed");
    expect(deps.finalizePayloads).toHaveLength(1);
    expect(deps.finalizePayloads[0]).toMatchObject({
      status: "failed",
      runtime_type: "harness",
    });
    expect(deps.finalizePayloads[0].error_message).toContain(
      "ValidationException",
    );
  });

  it("publishes only through the Harness authorization fence", async () => {
    const deps = makeDeps([stream(textEvents("authorized answer"))]);
    (deps.finalize as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(async (payload: FinalizePayload) => {
        deps.finalizePayloads.push(payload);
        return { finalized: false, messageId: null };
      })
      .mockImplementationOnce(async (payload: FinalizePayload) => {
        deps.finalizePayloads.push(payload);
        return { finalized: true, messageId: "failure-message" };
      });

    const result = await runHarnessTurn(basePayload(), deps);

    expect(result.status).toBe("failed");
    expect(deps.finalizePayloads[0]).toMatchObject({
      status: "completed",
      claim: {
        status: "running",
        harness_session_id: "session-row-1",
        harness_participant_user_id: "user-1",
      },
    });
    expect(deps.finalizePayloads[1]).toMatchObject({ status: "failed" });
    expect(deps.abandonFreshTurn).toHaveBeenCalledWith(
      expect.objectContaining({ reasonCode: "turn_failed" }),
    );
    expect(deps.transitionFreshTurn).not.toHaveBeenCalledWith(
      expect.objectContaining({ to: "completed" }),
    );
  });
});
